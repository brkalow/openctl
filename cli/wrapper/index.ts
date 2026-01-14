/**
 * Core PTY wrapper implementation using Bun.Terminal.
 *
 * This wraps Claude Code (or any command) in a pseudo-terminal, enabling:
 * - Full TUI preservation (colors, cursor movement, etc.)
 * - Real-time streaming of output to the Archive server (when available)
 * - Remote message injection when Claude is waiting for input
 * - State detection (waiting vs running)
 *
 * The server connection is optional and non-blocking - Claude starts
 * immediately and the wrapper attempts to connect in the background.
 */

import { StateDetector } from "./state-detector";
import { ServerConnection } from "./server-connection";
import { ApprovalManager } from "./approval";
import { checkPlatform } from "./platform";
import type { PendingMessage, WrapperState } from "./types";

export interface WrapperOptions {
  command: string[];
  cwd: string;
  serverUrl: string;
  title: string;
  approvalMode?: "ask" | "auto" | "reject";
  clientId: string;
  debug?: boolean;
}

interface SessionInfo {
  id: string;
  streamToken: string;
  url: string;
}

/**
 * Start the PTY wrapper for an interactive session
 */
export async function startWrapper(options: WrapperOptions): Promise<number> {
  // Check platform compatibility
  checkPlatform();

  const { command, cwd, serverUrl, title, approvalMode = "ask", clientId, debug = false } = options;
  const log = debug ? (...args: unknown[]) => console.error("[wrapper]", ...args) : () => {};

  let currentState: WrapperState = "running";
  let serverConnection: ServerConnection | null = null;
  let sessionInfo: SessionInfo | null = null;
  let outputBuffer: string[] = []; // Buffer output while disconnected
  let processExited = false; // Track if process has exited to avoid writing to closed terminal
  let pendingInInput: PendingMessage | null = null; // Message currently shown in Claude's input

  // Reference to write to the PTY
  let writeToTerminal: ((data: string | Uint8Array) => void) | null = null;

  // State detector
  const stateDetector = new StateDetector((state) => {
    log("state change:", currentState, "->", state);
    currentState = state;
    serverConnection?.sendState(state);

    // Clear pending input when Claude starts running (user submitted or cleared)
    if (state === "running") {
      pendingInInput = null;
    }

    // Show pending message in Claude's input when transitioning to waiting
    if (state === "waiting" && approvalManager.hasPending() && !pendingInInput) {
      log("showing pending message in input");
      const msg = approvalManager.getOldest();
      if (msg) {
        showInInput(msg);
      }
    }
  }, debug);

  // Function to inject text into the terminal (final submission)
  const injectText = (content: string, _source?: string) => {
    if (writeToTerminal && currentState === "waiting") {
      writeToTerminal(content + "\n");
      currentState = "running";
    }
  };

  // Function to show message in Claude's input field (user can submit with Enter or clear)
  const showInInput = (msg: PendingMessage) => {
    if (writeToTerminal && currentState === "waiting") {
      // Write to input but don't submit (no Enter) - user decides
      writeToTerminal(msg.content);
      pendingInInput = msg;
      log("populated input with remote message");
      // Mark as approved since we're showing it - rejection is just clearing
      serverConnection?.sendFeedbackStatus(msg.id, "approved");
      approvalManager.removeMessage(msg.id);
    }
  };

  // Approval manager
  const approvalManager = new ApprovalManager(
    (msg) => {
      // Approved - inject into Claude
      injectText(msg.content, msg.source);
      serverConnection?.sendFeedbackStatus(msg.id, "approved");
    },
    (msg) => {
      // Rejected
      serverConnection?.sendFeedbackStatus(msg.id, "rejected");
    }
  );

  if (approvalMode === "reject") {
    approvalManager.setIgnoreAll(true);
  }

  // Function to create session on server
  const createSession = async (): Promise<SessionInfo | null> => {
    try {
      const response = await fetch(`${serverUrl}/api/sessions/live`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Archive-Client-ID": clientId,
        },
        body: JSON.stringify({
          title,
          project_path: cwd,
          interactive: true,
        }),
      });

      if (!response.ok) {
        return null;
      }

      const data = (await response.json()) as {
        id: string;
        stream_token: string;
        url?: string;
      };

      return {
        id: data.id,
        streamToken: data.stream_token,
        url: data.url || `${serverUrl}/sessions/${data.id}`,
      };
    } catch {
      return null;
    }
  };

  // Function to setup server connection
  const setupServerConnection = async (info: SessionInfo): Promise<boolean> => {
    serverConnection = new ServerConnection({
      serverUrl,
      sessionId: info.id,
      streamToken: info.streamToken,
      onInject: (content, source, messageId) => {
        log("received inject:", { messageId, source, contentLength: content.length });
        const msg: PendingMessage = {
          id: messageId,
          content,
          source: source || "anonymous",
          type: "message",
          receivedAt: new Date(),
        };

        if (approvalMode === "auto") {
          // Auto-approve
          log("auto-approving inject");
          injectText(content, source);
          serverConnection?.sendFeedbackStatus(messageId, "approved");
        } else {
          log("queueing inject, currentState:", currentState);
          approvalManager.addMessage(msg);

          // Show in input if waiting and nothing pending in input yet
          if (currentState === "waiting" && !pendingInInput) {
            log("showing in input immediately (already waiting)");
            showInInput(msg);
          }
        }
      },
      onResize: (cols, rows) => {
        // Resize the PTY if we have access
        proc?.terminal?.resize(cols, rows);
      },
      onInterrupt: () => {
        // Send Ctrl+C to the process
        writeToTerminal?.("\x03");
      },
      onEnd: () => {
        proc?.kill();
      },
      onError: () => {
        // Silently handle connection errors - will reconnect
      },
    });

    try {
      await serverConnection.connect();

      // Send any buffered output
      for (const data of outputBuffer) {
        serverConnection.sendOutput(data);
      }
      outputBuffer = [];

      return true;
    } catch {
      serverConnection = null;
      return false;
    }
  };

  // Try to create session and connect in background
  const connectToServer = async () => {
    log("connecting to server:", serverUrl);
    sessionInfo = await createSession();

    if (sessionInfo) {
      log("session created:", sessionInfo.id);
      console.log(`Session: ${sessionInfo.url}`);
      const connected = await setupServerConnection(sessionInfo);
      if (connected) {
        log("websocket connected");
      } else {
        log("websocket connection failed, scheduling reconnect");
        scheduleReconnect();
      }
    } else {
      log("session creation failed, scheduling reconnect");
      scheduleReconnect();
    }
  };

  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleReconnect = () => {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;
      if (!sessionInfo) {
        sessionInfo = await createSession();
        if (sessionInfo) {
          console.log(`Session: ${sessionInfo.url}`);
        }
      }
      if (sessionInfo && !serverConnection?.isConnected()) {
        await setupServerConnection(sessionInfo);
        if (!serverConnection?.isConnected()) {
          scheduleReconnect();
        }
      }
    }, 5000);
  };

  // Get terminal size
  const cols = process.stdout.columns || 120;
  const rows = process.stdout.rows || 40;

  // Set up environment with terminal info
  const env = {
    ...process.env,
    TERM: process.env.TERM || "xterm-256color",
    COLUMNS: String(cols),
    LINES: String(rows),
  };

  // Start server connection in background
  connectToServer();

  // Spawn Claude with Bun.Terminal for proper PTY support
  const proc = Bun.spawn(command, {
    cwd,
    env,
    terminal: {
      cols,
      rows,
      data(terminal, data) {
        // Forward output to user's terminal
        process.stdout.write(data);

        // Convert to string for processing
        const text = typeof data === "string" ? data : new TextDecoder().decode(data);

        // Stream to server or buffer
        if (serverConnection?.isConnected()) {
          serverConnection.sendOutput(text);
        } else {
          // Buffer output (limit to last 100KB)
          outputBuffer.push(text);
          const totalSize = outputBuffer.reduce((sum, s) => sum + s.length, 0);
          while (totalSize > 100000 && outputBuffer.length > 1) {
            outputBuffer.shift();
          }
        }

        // Detect state from output
        stateDetector.process(text);
      },
    },
  });

  // Set up write function
  writeToTerminal = (data) => {
    if (!processExited) {
      proc.terminal?.write(data);
    }
  };

  // Handle terminal resize
  process.stdout.on("resize", () => {
    const newCols = process.stdout.columns || 120;
    const newRows = process.stdout.rows || 40;
    proc.terminal?.resize(newCols, newRows);
  });

  // Forward stdin to the PTY using event-based handling
  // (for-await blocks forever since stdin never closes)
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  // Handle stdin data events
  const stdinHandler = (chunk: Buffer) => {
    // Don't write to closed terminal
    if (processExited) return;

    // Clear pending input tracking when user starts typing
    if (pendingInInput) {
      pendingInInput = null;
    }

    // Forward to Claude
    proc.terminal?.write(chunk);
  };

  process.stdin.on("data", stdinHandler);

  // Wait for process to exit
  const exitCode = await proc.exited;
  processExited = true;

  // Remove stdin handler
  process.stdin.off("data", stdinHandler);

  // Cleanup
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
  }
  if (serverConnection) {
    serverConnection.sendEnded(exitCode);
    serverConnection.destroy();
  }

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }

  return exitCode;
}

export { StateDetector } from "./state-detector";
export { ServerConnection } from "./server-connection";
export { ApprovalManager, renderApprovalPrompt, clearApprovalPrompt } from "./approval";
export type { WrapperOptions };
