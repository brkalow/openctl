/**
 * Shared types for the PTY wrapper module
 */

export interface WrapperSession {
  id: string; // Server-assigned session ID
  proc: ReturnType<typeof Bun.spawn>;
  projectPath: string;
  state: "running" | "waiting";
  pendingApprovals: PendingMessage[];
  approvalMode: "ask" | "auto" | "reject";
  streamToken: string;
  outputBuffer: string;
}

export interface PendingMessage {
  id: string;
  content: string;
  source: string;
  type: "message" | "diff_comment" | "suggested_edit";
  receivedAt: Date;
  context?: {
    file: string;
    line: number;
  };
}

export type WrapperState = "running" | "waiting";

// Messages from server (relay from browser)
export type ServerToWrapperMessage =
  | { type: "inject"; content: string; source?: string; message_id: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "interrupt" }
  | { type: "end" };

// Messages to server
export type WrapperToServerMessage =
  | { type: "output"; data: string }
  | { type: "state"; state: WrapperState }
  | { type: "ended"; exitCode: number }
  | { type: "feedback_status"; message_id: string; status: "approved" | "rejected" };
