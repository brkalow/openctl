import { useState, useEffect, useCallback, useRef } from "react";
import type { ContentBlock, StreamJsonMessage } from "../../types/daemon-ws";

export type SessionState =
  | "connecting"
  | "starting"
  | "running"
  | "waiting"
  | "ending"
  | "ended"
  | "failed"
  | "disconnected";

export interface StreamMessage extends StreamJsonMessage {
  [key: string]: unknown;
}

export interface QuestionPrompt {
  toolUseId: string;
  question: string;
  options?: string[];
}

export interface PermissionPrompt {
  requestId: string;
  tool: string;
  description: string;
  details: Record<string, unknown>;
}

interface UseSpawnedSessionOptions {
  sessionId: string;
  onMessage?: (messages: StreamMessage[]) => void;
  onStateChange?: (state: SessionState) => void;
  onQuestionPrompt?: (prompt: QuestionPrompt) => void;
  onPermissionPrompt?: (prompt: PermissionPrompt) => void;
}

export function useSpawnedSession({
  sessionId,
  onMessage,
  onStateChange,
  onQuestionPrompt,
  onPermissionPrompt,
}: UseSpawnedSessionOptions) {
  const [state, setState] = useState<SessionState>("connecting");
  const [messages, setMessages] = useState<StreamMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);

  // Store callbacks in refs to avoid reconnecting when callbacks change
  const onMessageRef = useRef(onMessage);
  const onStateChangeRef = useRef(onStateChange);
  const onQuestionPromptRef = useRef(onQuestionPrompt);
  const onPermissionPromptRef = useRef(onPermissionPrompt);

  useEffect(() => {
    onMessageRef.current = onMessage;
    onStateChangeRef.current = onStateChange;
    onQuestionPromptRef.current = onQuestionPrompt;
    onPermissionPromptRef.current = onPermissionPrompt;
  });

  // Update state and notify
  const updateState = useCallback((newState: SessionState) => {
    setState(newState);
    onStateChangeRef.current?.(newState);
  }, []);

  // Handle incoming messages
  const handleMessage = useCallback(
    (data: Record<string, unknown>) => {
      switch (data.type) {
        case "connected":
          // Initial connection info
          reconnectAttemptsRef.current = 0;
          break;

        case "message":
          // Stream messages from Claude
          if (data.messages && Array.isArray(data.messages)) {
            const newMessages = data.messages as StreamMessage[];
            setMessages((prev) => [...prev, ...newMessages]);
            onMessageRef.current?.(newMessages);

            // Update state based on message content
            for (const msg of newMessages) {
              if (msg.type === "system" && msg.subtype === "init") {
                updateState("running");
              }
              if (msg.type === "result") {
                updateState("waiting");
              }
              if (msg.type === "assistant") {
                updateState("running");
              }
            }
          }
          break;

        case "complete":
          updateState("ended");
          if (data.error && typeof data.error === "string") {
            setError(data.error);
          }
          break;

        case "question_prompt":
          onQuestionPromptRef.current?.({
            toolUseId: data.tool_use_id as string,
            question: data.question as string,
            options: data.options as string[] | undefined,
          });
          break;

        case "permission_prompt":
          onPermissionPromptRef.current?.({
            requestId: data.request_id as string,
            tool: data.tool as string,
            description: data.description as string,
            details: data.details as Record<string, unknown>,
          });
          break;

        case "daemon_disconnected":
          updateState("disconnected");
          if (data.message && typeof data.message === "string") {
            setError(data.message);
          }
          break;

        case "heartbeat":
        case "pong":
          // Ignore heartbeats
          break;

        case "error":
          console.error("[ws] Server error:", data.message);
          break;

        default:
          console.log("[ws] Unknown message type:", data.type);
      }
    },
    [updateState]
  );

  // Schedule reconnection with exponential backoff
  const scheduleReconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    const attempt = reconnectAttemptsRef.current;
    if (attempt >= 5) {
      console.log("[ws] Max reconnect attempts reached");
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, attempt), 15000);
    reconnectAttemptsRef.current = attempt + 1;

    reconnectTimeoutRef.current = setTimeout(() => {
      console.log(`[ws] Attempting reconnect (attempt ${attempt + 1})...`);
      connect();
    }, delay);
  }, []);

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(
      `${protocol}//${window.location.host}/api/sessions/${sessionId}/ws`
    );

    ws.onopen = () => {
      console.log("[ws] Connected to session", sessionId);
      updateState("starting");
      reconnectAttemptsRef.current = 0;

      // Subscribe from beginning
      ws.send(JSON.stringify({ type: "subscribe", from_index: 0 }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleMessage(data);
      } catch (err) {
        console.error("[ws] Failed to parse message:", err);
      }
    };

    ws.onclose = (event) => {
      console.log("[ws] Disconnected from session", sessionId);
      // Don't update state or reconnect if this was a clean close or we're already ended/failed
      if (event.code === 1000) {
        return;
      }

      setState((currentState) => {
        if (currentState !== "ended" && currentState !== "failed") {
          updateState("disconnected");
          scheduleReconnect();
        }
        return currentState;
      });
    };

    ws.onerror = (err) => {
      console.error("[ws] WebSocket error:", err);
    };

    wsRef.current = ws;
  }, [sessionId, updateState, handleMessage, scheduleReconnect]);

  // Send user message
  const sendMessage = useCallback(
    (content: string) => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) {
        console.error("[ws] Cannot send, WebSocket not open");
        return false;
      }

      wsRef.current.send(
        JSON.stringify({
          type: "user_message",
          content,
        })
      );

      updateState("running");
      return true;
    },
    [updateState]
  );

  // Send interrupt
  const interrupt = useCallback(() => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;

    wsRef.current.send(JSON.stringify({ type: "interrupt" }));
  }, []);

  // Send end session
  const endSession = useCallback(() => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;

    wsRef.current.send(JSON.stringify({ type: "end_session" }));
    updateState("ending");
  }, [updateState]);

  // Answer question
  const answerQuestion = useCallback((toolUseId: string, answer: string) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;

    wsRef.current.send(
      JSON.stringify({
        type: "question_response",
        tool_use_id: toolUseId,
        answer,
      })
    );
  }, []);

  // Respond to permission
  const respondToPermission = useCallback(
    (requestId: string, allow: boolean) => {
      if (wsRef.current?.readyState !== WebSocket.OPEN) return;

      wsRef.current.send(
        JSON.stringify({
          type: "permission_response",
          request_id: requestId,
          allow,
        })
      );
    },
    []
  );

  // Connect on mount
  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      wsRef.current?.close(1000);
    };
  }, [connect]);

  return {
    state,
    messages,
    error,
    sendMessage,
    interrupt,
    endSession,
    answerQuestion,
    respondToPermission,
  };
}
