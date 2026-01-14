/**
 * WebSocket client for bidirectional communication with the Archive server.
 *
 * Handles:
 * - Connecting to the server's wrapper WebSocket endpoint
 * - Authentication with stream token
 * - Sending output and state updates
 * - Receiving inject, resize, interrupt, and end commands
 * - Automatic reconnection on disconnect
 */

import type { ServerToWrapperMessage, WrapperState } from "./types";

export interface ServerConnectionOptions {
  serverUrl: string;
  sessionId: string;
  streamToken: string;
  onInject: (content: string, source: string | undefined, messageId: string) => void;
  onResize?: (cols: number, rows: number) => void;
  onInterrupt?: () => void;
  onEnd?: () => void;
  onError?: (error: Error) => void;
}

export class ServerConnection {
  private ws: WebSocket | null = null;
  private options: ServerConnectionOptions;
  private reconnecting = false;
  private destroyed = false;
  private authenticated = false;
  private pendingAuth: { resolve: () => void; reject: (err: Error) => void } | null = null;

  constructor(options: ServerConnectionOptions) {
    this.options = options;
  }

  /**
   * Connect to the server WebSocket
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const protocol = this.options.serverUrl.startsWith("https") ? "wss:" : "ws:";
      const host = this.options.serverUrl.replace(/^https?:\/\//, "");
      const url = `${protocol}//${host}/api/sessions/${this.options.sessionId}/wrapper`;

      try {
        this.ws = new WebSocket(url);
      } catch (err) {
        reject(err);
        return;
      }

      this.ws.onopen = () => {
        // Store the promise callbacks for auth response
        this.pendingAuth = { resolve, reject };
        // Authenticate with stream token
        this.send({ type: "auth", token: this.options.streamToken });
      };

      this.ws.onmessage = (event) => {
        try {
          const msg: ServerToWrapperMessage = JSON.parse(
            typeof event.data === "string" ? event.data : event.data.toString()
          );
          this.handleMessage(msg);
        } catch {
          // Invalid message, ignore
        }
      };

      this.ws.onerror = () => {
        const error = new Error("WebSocket connection failed");
        if (this.pendingAuth) {
          this.pendingAuth.reject(error);
          this.pendingAuth = null;
        }
        this.options.onError?.(error);
      };

      this.ws.onclose = () => {
        this.authenticated = false;
        if (this.pendingAuth) {
          this.pendingAuth.reject(new Error("Connection closed before auth"));
          this.pendingAuth = null;
        }
        if (!this.destroyed) {
          this.scheduleReconnect();
        }
      };
    });
  }

  private handleMessage(msg: ServerToWrapperMessage): void {
    switch (msg.type) {
      case "auth_ok":
        this.authenticated = true;
        if (this.pendingAuth) {
          this.pendingAuth.resolve();
          this.pendingAuth = null;
        }
        break;
      case "auth_failed":
        this.authenticated = false;
        if (this.pendingAuth) {
          this.pendingAuth.reject(new Error("Authentication failed"));
          this.pendingAuth = null;
        }
        break;
      case "inject":
        this.options.onInject(msg.content, msg.source, msg.message_id);
        break;
      case "resize":
        this.options.onResize?.(msg.cols, msg.rows);
        break;
      case "interrupt":
        this.options.onInterrupt?.();
        break;
      case "end":
        this.options.onEnd?.();
        break;
    }
  }

  private send(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  /**
   * Send terminal output to the server
   */
  sendOutput(data: string): void {
    this.send({ type: "output", data });
  }

  /**
   * Send state update to the server
   */
  sendState(state: WrapperState): void {
    this.send({ type: "state", state });
  }

  /**
   * Notify server that the session has ended
   */
  sendEnded(exitCode: number): void {
    this.send({ type: "ended", exitCode });
  }

  /**
   * Send feedback status (approved/rejected) to the server
   */
  sendFeedbackStatus(messageId: string, status: "approved" | "rejected"): void {
    this.send({ type: "feedback_status", message_id: messageId, status });
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this.reconnecting) return;
    this.reconnecting = true;

    setTimeout(() => {
      this.reconnecting = false;
      if (!this.destroyed) {
        this.connect().catch(() => {
          // Reconnect failed, try again
          this.scheduleReconnect();
        });
      }
    }, 2000);
  }

  /**
   * Check if connected to the server
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Destroy the connection and stop reconnection attempts
   */
  destroy(): void {
    this.destroyed = true;
    if (this.ws) {
      this.ws.close(1000);
      this.ws = null;
    }
  }
}
