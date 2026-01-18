/**
 * Daemon WebSocket Message Types
 *
 * Defines the message protocol for bidirectional communication between
 * the daemon and server over WebSocket.
 *
 * Keep in sync with src/types/daemon-ws.ts
 */

// ============================================
// Daemon -> Server Messages
// ============================================

export interface DaemonConnectedMessage {
  type: "daemon_connected";
  client_id: string;
  capabilities: {
    can_spawn_sessions: boolean;
    spawnable_harnesses: SpawnableHarnessInfo[];
  };
}

export interface SpawnableHarnessInfo {
  id: string; // "claude-code", "aider", etc.
  name: string; // Human-readable name
  available: boolean; // Is the CLI installed?
  supports_permission_relay: boolean;
  supports_streaming: boolean;
  default_model?: string;
}

export interface SessionOutputMessage {
  type: "session_output";
  session_id: string;
  messages: StreamJsonMessage[];
}

export interface SessionEndedMessage {
  type: "session_ended";
  session_id: string;
  exit_code: number;
  error?: string;
  reason?: "completed" | "user_terminated" | "error" | "timeout";
}

export interface PermissionPromptMessage {
  type: "permission_prompt";
  session_id: string;
  request_id: string;
  tool: string;
  description: string;
  details: Record<string, unknown>;
}

export interface QuestionPromptMessage {
  type: "question_prompt";
  session_id: string;
  tool_use_id: string;
  question: string;
  options?: string[];
}

export type DaemonToServerMessage =
  | DaemonConnectedMessage
  | SessionOutputMessage
  | SessionEndedMessage
  | PermissionPromptMessage
  | QuestionPromptMessage;

// ============================================
// Server -> Daemon Messages
// ============================================

export interface StartSessionMessage {
  type: "start_session";
  session_id: string; // Server-assigned ID
  prompt: string; // Initial prompt
  cwd: string; // Working directory
  harness?: string; // "claude-code" (default), "aider", etc.
  model?: string; // Model to use
  permission_mode?: "relay" | "auto-safe" | "auto";
  resume_session_id?: string; // Harness session ID to resume
}

export interface SendInputMessage {
  type: "send_input";
  session_id: string;
  content: string;
}

export interface EndSessionMessage {
  type: "end_session";
  session_id: string;
}

export interface InterruptSessionMessage {
  type: "interrupt_session";
  session_id: string;
}

export interface PermissionResponseMessage {
  type: "permission_response";
  session_id: string;
  request_id: string;
  allow: boolean;
}

export interface QuestionResponseMessage {
  type: "question_response";
  session_id: string;
  tool_use_id: string;
  answer: string;
}

export type ServerToDaemonMessage =
  | StartSessionMessage
  | SendInputMessage
  | EndSessionMessage
  | InterruptSessionMessage
  | PermissionResponseMessage
  | QuestionResponseMessage;

// ============================================
// Stream JSON types (from Claude Code output)
// ============================================

export interface StreamJsonMessage {
  type: "system" | "assistant" | "user" | "result";
  subtype?: string;
  message?: {
    id?: string;
    role: string;
    content: ContentBlock[];
    model?: string;
    usage?: { input_tokens: number; output_tokens: number };
  };
  session_id?: string;
  cwd?: string;
  duration_ms?: number;
  is_error?: boolean;
}

export interface ContentBlock {
  type: "text" | "tool_use" | "tool_result" | "thinking";
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
}
