# Interactive Sessions: PTY Wrapper CLI

> **Spec reference:** [specs/interactive_sessions.md](../specs/interactive_sessions.md)

## Overview

This plan implements the PTY wrapper CLI commands that spawn Claude Code with bidirectional communication support. The wrapper uses `Bun.Terminal` to preserve Claude's TUI while enabling remote input injection.

## Dependencies

- Existing CLI scaffolding (`cli/index.ts`, `cli/commands/`)
- Existing live streaming server endpoints (`/api/sessions/live`, WebSocket)

## Goals

1. `archive wrap claude [args...]` - Wrap any Claude command with PTY
2. `archive session "<prompt>"` - Start a new interactive session
3. State detection (waiting vs running)
4. WebSocket connection to server for bidirectional streaming
5. Basic approval flow for remote messages

## Directory Structure

```
cli/
  commands/
    wrap.ts              # archive wrap command
    session.ts           # Update existing session command (add interactive subcommand)
  wrapper/
    index.ts             # PTY wrapper main logic
    state-detector.ts    # Detect Claude waiting vs running
    server-connection.ts # WebSocket client to server
    approval.ts          # Remote message approval flow
    types.ts             # Shared types
```

## Tasks

### 1. Create Wrapper Types

Define shared interfaces for the wrapper module.

**File:** `cli/wrapper/types.ts`

```typescript
export interface WrapperSession {
  id: string;                    // Server-assigned session ID
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
```

### 2. State Detection

Detect when Claude is waiting for input vs actively processing.

**File:** `cli/wrapper/state-detector.ts`

```typescript
const PROMPT_PATTERNS = [
  /❯\s*$/,           // Standard prompt
  />>>\s*$/,         // Alternative prompt
  /\[Y\/n\]/,        // Permission prompt
  /Press Enter/,     // Confirmation prompt
];

const RUNNING_PATTERNS = [
  /⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏/,  // Spinner characters
  /Reading|Writing|Editing/,   // Tool activity
  /Thinking\.\.\./,            // Processing indicator
];

export class StateDetector {
  private buffer = "";
  private currentState: "running" | "waiting" = "running";
  private onStateChange: (state: "running" | "waiting") => void;

  constructor(onStateChange: (state: "running" | "waiting") => void) {
    this.onStateChange = onStateChange;
  }

  process(data: string): void {
    this.buffer += data;

    // Keep last 500 chars for pattern matching
    if (this.buffer.length > 500) {
      this.buffer = this.buffer.slice(-500);
    }

    const newState = this.detectState();
    if (newState !== this.currentState) {
      this.currentState = newState;
      this.onStateChange(newState);
    }
  }

  private detectState(): "running" | "waiting" {
    // Check for prompt patterns (waiting state)
    for (const pattern of PROMPT_PATTERNS) {
      if (pattern.test(this.buffer)) {
        return "waiting";
      }
    }

    // Check for running patterns
    for (const pattern of RUNNING_PATTERNS) {
      if (pattern.test(this.buffer)) {
        return "running";
      }
    }

    return this.currentState;
  }

  getState(): "running" | "waiting" {
    return this.currentState;
  }
}
```

### 3. Server Connection

WebSocket client for bidirectional communication with the server.

**File:** `cli/wrapper/server-connection.ts`

```typescript
import type { ServerToWrapperMessage, WrapperToServerMessage, WrapperState } from "./types";

export interface ServerConnectionOptions {
  serverUrl: string;
  sessionId: string;
  streamToken: string;
  onInject: (content: string, source: string | undefined, messageId: string) => void;
  onResize?: (cols: number, rows: number) => void;
  onInterrupt?: () => void;
  onEnd?: () => void;
}

export class ServerConnection {
  private ws: WebSocket | null = null;
  private options: ServerConnectionOptions;
  private reconnecting = false;
  private destroyed = false;

  constructor(options: ServerConnectionOptions) {
    this.options = options;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const protocol = this.options.serverUrl.startsWith("https") ? "wss:" : "ws:";
      const host = this.options.serverUrl.replace(/^https?:\/\//, "");
      const url = `${protocol}//${host}/api/sessions/${this.options.sessionId}/wrapper`;

      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        // Authenticate with stream token
        this.send({ type: "auth", token: this.options.streamToken });
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg: ServerToWrapperMessage = JSON.parse(event.data);
          this.handleMessage(msg);
        } catch {
          // Invalid message
        }
      };

      this.ws.onerror = () => {
        if (!this.reconnecting) {
          reject(new Error("WebSocket connection failed"));
        }
      };

      this.ws.onclose = () => {
        if (!this.destroyed) {
          this.scheduleReconnect();
        }
      };
    });
  }

  private handleMessage(msg: ServerToWrapperMessage): void {
    switch (msg.type) {
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

  sendOutput(data: string): void {
    this.send({ type: "output", data });
  }

  sendState(state: WrapperState): void {
    this.send({ type: "state", state });
  }

  sendEnded(exitCode: number): void {
    this.send({ type: "ended", exitCode });
  }

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

  destroy(): void {
    this.destroyed = true;
    if (this.ws) {
      this.ws.close(1000);
      this.ws = null;
    }
  }
}
```

### 4. Approval Flow

Handle remote message approval before injection.

**File:** `cli/wrapper/approval.ts`

```typescript
import type { PendingMessage } from "./types";

// ANSI escape codes for styling
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const BOX_TOP = "┌─────────────────────────────────────────────────────────────────┐";
const BOX_BOT = "└─────────────────────────────────────────────────────────────────┘";

export function renderApprovalPrompt(msg: PendingMessage): string {
  const source = msg.source || "anonymous";
  const preview = msg.content.length > 60
    ? msg.content.slice(0, 60) + "..."
    : msg.content;

  return `
${CYAN}${BOX_TOP}${RESET}
${CYAN}│${RESET} ${BOLD}📩 Remote feedback from ${source}${RESET}
${CYAN}│${RESET}
${CYAN}│${RESET} "${preview}"
${CYAN}│${RESET}
${CYAN}│${RESET} ${DIM}[y] Accept  [n] Reject  [v] View full  [i] Ignore all${RESET}
${CYAN}${BOX_BOT}${RESET}
`;
}

export class ApprovalManager {
  private pending: PendingMessage[] = [];
  private onApprove: (msg: PendingMessage) => void;
  private onReject: (msg: PendingMessage) => void;
  private ignoreAll = false;

  constructor(
    onApprove: (msg: PendingMessage) => void,
    onReject: (msg: PendingMessage) => void
  ) {
    this.onApprove = onApprove;
    this.onReject = onReject;
  }

  addMessage(msg: PendingMessage): void {
    if (this.ignoreAll) {
      this.onReject(msg);
      return;
    }
    this.pending.push(msg);
  }

  hasPending(): boolean {
    return this.pending.length > 0;
  }

  getPending(): PendingMessage[] {
    return [...this.pending];
  }

  getOldest(): PendingMessage | undefined {
    return this.pending[0];
  }

  handleKey(key: string): { handled: boolean; output?: string } {
    if (this.pending.length === 0) {
      return { handled: false };
    }

    const msg = this.pending[0];

    switch (key.toLowerCase()) {
      case "y":
        this.pending.shift();
        this.onApprove(msg);
        return { handled: true, output: `${GREEN}✓ Approved${RESET}\n` };

      case "n":
        this.pending.shift();
        this.onReject(msg);
        return { handled: true, output: `${RED}✗ Rejected${RESET}\n` };

      case "v":
        return {
          handled: true,
          output: `\n${BOLD}Full message:${RESET}\n${msg.content}\n\n${DIM}[y] Accept  [n] Reject${RESET}\n`,
        };

      case "i":
        this.ignoreAll = true;
        // Reject all pending
        for (const m of this.pending) {
          this.onReject(m);
        }
        this.pending = [];
        return { handled: true, output: `${YELLOW}⚠ Ignoring all remote messages for this session${RESET}\n` };

      default:
        return { handled: false };
    }
  }

  setIgnoreAll(ignore: boolean): void {
    this.ignoreAll = ignore;
  }
}
```

### 5. Main Wrapper Logic

Core PTY wrapper implementation using Bun.Terminal.

**File:** `cli/wrapper/index.ts`

```typescript
import { StateDetector } from "./state-detector";
import { ServerConnection } from "./server-connection";
import { ApprovalManager, renderApprovalPrompt } from "./approval";
import type { WrapperSession, PendingMessage } from "./types";

export interface WrapperOptions {
  command: string[];
  cwd: string;
  serverUrl: string;
  sessionId: string;
  streamToken: string;
  approvalMode?: "ask" | "auto" | "reject";
  title?: string;
}

export async function startWrapper(options: WrapperOptions): Promise<number> {
  const {
    command,
    cwd,
    serverUrl,
    sessionId,
    streamToken,
    approvalMode = "ask",
    title,
  } = options;

  let currentState: "running" | "waiting" = "running";
  let proc: ReturnType<typeof Bun.spawn> | null = null;
  let exitCode = 0;

  // State detector
  const stateDetector = new StateDetector((state) => {
    currentState = state;
    serverConnection.sendState(state);

    // Show approval prompt when transitioning to waiting and messages pending
    if (state === "waiting" && approvalManager.hasPending()) {
      const msg = approvalManager.getOldest();
      if (msg) {
        process.stdout.write(renderApprovalPrompt(msg));
      }
    }
  });

  // Approval manager
  const approvalManager = new ApprovalManager(
    (msg) => {
      // Approved - inject into Claude
      if (proc?.terminal && currentState === "waiting") {
        const prefix = msg.source ? `[Remote feedback from ${msg.source}]\n` : "";
        proc.terminal.write(prefix + msg.content + "\r");
        currentState = "running";
      }
      serverConnection.sendFeedbackStatus(msg.id, "approved");
    },
    (msg) => {
      // Rejected
      serverConnection.sendFeedbackStatus(msg.id, "rejected");
    }
  );

  if (approvalMode === "reject") {
    approvalManager.setIgnoreAll(true);
  }

  // Server connection
  const serverConnection = new ServerConnection({
    serverUrl,
    sessionId,
    streamToken,
    onInject: (content, source, messageId) => {
      const msg: PendingMessage = {
        id: messageId,
        content,
        source: source || "anonymous",
        type: "message",
        receivedAt: new Date(),
      };

      if (approvalMode === "auto") {
        // Auto-approve
        if (proc?.terminal && currentState === "waiting") {
          const prefix = source ? `[Remote feedback from ${source}]\n` : "";
          proc.terminal.write(prefix + content + "\r");
          currentState = "running";
        }
        serverConnection.sendFeedbackStatus(messageId, "approved");
      } else {
        approvalManager.addMessage(msg);

        // Show prompt if waiting
        if (currentState === "waiting") {
          process.stdout.write(renderApprovalPrompt(msg));
        }
      }
    },
    onResize: (cols, rows) => {
      proc?.terminal?.resize(cols, rows);
    },
    onInterrupt: () => {
      proc?.terminal?.write("\x03");
    },
    onEnd: () => {
      proc?.kill();
    },
  });

  // Connect to server
  try {
    await serverConnection.connect();
  } catch (err) {
    console.error("Failed to connect to server:", err);
    return 1;
  }

  // Get terminal size
  const cols = process.stdout.columns || 120;
  const rows = process.stdout.rows || 40;

  // Spawn Claude with PTY
  proc = Bun.spawn(command, {
    cwd,
    env: process.env,
    terminal: {
      cols,
      rows,
      data(terminal, data) {
        // Forward to user's terminal
        process.stdout.write(data);

        // Stream to server
        serverConnection.sendOutput(data);

        // Detect state
        stateDetector.process(data);
      },
    },
  });

  // Handle stdin for approval keys
  if (process.stdin.isTTY) {
    // Raw mode for single key capture
    process.stdin.setRawMode(true);

    const reader = process.stdin.readable?.getReader();
    if (reader) {
      (async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const text = new TextDecoder().decode(value);

          // Check for approval keys when waiting with pending messages
          if (currentState === "waiting" && approvalManager.hasPending()) {
            const result = approvalManager.handleKey(text);
            if (result.handled) {
              if (result.output) {
                process.stdout.write(result.output);
              }
              continue;
            }
          }

          // Forward to Claude
          proc?.terminal?.write(text);
        }
      })();
    }
  }

  // Handle terminal resize
  process.stdout.on("resize", () => {
    const newCols = process.stdout.columns || 120;
    const newRows = process.stdout.rows || 40;
    proc?.terminal?.resize(newCols, newRows);
  });

  // Wait for process to exit
  exitCode = await proc.exited;

  // Cleanup
  serverConnection.sendEnded(exitCode);
  serverConnection.destroy();

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }

  return exitCode;
}
```

### 6. Wrap Command

CLI command to wrap any Claude invocation.

**File:** `cli/commands/wrap.ts`

```typescript
import { parseArgs } from "util";
import { loadConfig } from "../lib/config";
import { startWrapper } from "../wrapper";

export async function wrap(args: string[]): Promise<void> {
  // Find -- separator or just use remaining args
  const dashIndex = args.indexOf("--");
  const wrapperArgs = dashIndex >= 0 ? args.slice(0, dashIndex) : [];
  const command = dashIndex >= 0 ? args.slice(dashIndex + 1) : args;

  if (command.length === 0) {
    console.log(`
Usage: archive wrap [options] -- <command> [args...]

Wraps a Claude Code command with PTY for interactive sessions.
Enables remote feedback injection while preserving the TUI.

Options:
  --server <url>       Archive server URL (default: from config)
  --title <text>       Session title
  --approval <mode>    Approval mode: ask (default), auto, reject

Examples:
  archive wrap -- claude
  archive wrap -- claude --resume abc123
  archive wrap --title "Auth feature" -- claude "implement user auth"
    `);
    return;
  }

  const { values } = parseArgs({
    args: wrapperArgs,
    options: {
      server: { type: "string" },
      title: { type: "string" },
      approval: { type: "string" },
    },
  });

  const config = loadConfig();
  const serverUrl = values.server || config.server || "http://localhost:3000";
  const approvalMode = (values.approval as "ask" | "auto" | "reject") || "ask";

  // Create live session on server
  const cwd = process.cwd();
  const title = values.title || `Interactive: ${command.join(" ").slice(0, 50)}`;

  console.log(`Creating interactive session...`);
  console.log(`  Server: ${serverUrl}`);
  console.log(`  Title: ${title}`);
  console.log(`  Approval mode: ${approvalMode}`);
  console.log();

  const response = await fetch(`${serverUrl}/api/sessions/live`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title,
      project_path: cwd,
      interactive: true, // Flag this as an interactive session
    }),
  });

  if (!response.ok) {
    console.error(`Failed to create session: ${response.status}`);
    process.exit(1);
  }

  const { id: sessionId, stream_token: streamToken, url } = await response.json();

  console.log(`Session URL: ${url}`);
  console.log(`Starting Claude...`);
  console.log();

  const exitCode = await startWrapper({
    command,
    cwd,
    serverUrl,
    sessionId,
    streamToken,
    approvalMode,
    title,
  });

  process.exit(exitCode);
}
```

### 7. Update Session Command

Add interactive mode to existing session command.

**File:** `cli/commands/session.ts` (additions)

```typescript
// Add new subcommand: archive session start "<prompt>"

case "start":
  return sessionStart(args.slice(1));

// ...

async function sessionStart(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      server: { type: "string" },
      title: { type: "string" },
      approval: { type: "string" },
      detached: { type: "boolean" },
    },
    allowPositionals: true,
  });

  const prompt = positionals.join(" ");
  if (!prompt) {
    console.error("Error: Prompt is required");
    console.log("Usage: archive session start \"<prompt>\" [options]");
    process.exit(1);
  }

  const config = loadConfig();
  const serverUrl = values.server || config.server || "http://localhost:3000";

  // Delegate to wrap command
  const { wrap } = await import("./wrap");
  await wrap([
    ...(values.server ? ["--server", values.server] : []),
    ...(values.title ? ["--title", values.title] : []),
    ...(values.approval ? ["--approval", values.approval] : []),
    "--",
    "claude",
    prompt,
  ]);
}
```

### 8. Update CLI Entry Point

Register new commands.

**File:** `cli/index.ts` (additions)

```typescript
import { wrap } from "./commands/wrap";

const commands: Record<string, (args: string[]) => Promise<void>> = {
  // ... existing commands
  wrap,
};
```

### 9. Platform Check

Add platform detection since Bun.Terminal is POSIX-only.

**File:** `cli/wrapper/platform.ts`

```typescript
export function checkPlatform(): void {
  if (process.platform === "win32") {
    console.error("Error: Interactive sessions are not yet supported on Windows.");
    console.error("Bun.Terminal requires a POSIX system (macOS, Linux).");
    console.error("");
    console.error("You can still use:");
    console.error("  - archive daemon   (passive observation)");
    console.error("  - archive upload   (manual session upload)");
    process.exit(1);
  }
}
```

## Testing

### Manual Testing

```bash
# Start the server
bun run dev

# In another terminal, start an interactive session
archive wrap -- claude "hello"

# In a browser, open the session URL and try sending feedback

# Test approval flow
# - Should see approval prompt when message arrives
# - Press 'y' to approve, 'n' to reject
```

### Unit Tests

**File:** `tests/wrapper/state-detector.test.ts`

```typescript
import { describe, it, expect } from "bun:test";
import { StateDetector } from "../../cli/wrapper/state-detector";

describe("StateDetector", () => {
  it("detects waiting state from prompt", () => {
    let state: string = "running";
    const detector = new StateDetector((s) => { state = s; });

    detector.process("Some output\n");
    expect(state).toBe("running");

    detector.process("❯ ");
    expect(state).toBe("waiting");
  });

  it("detects running state from spinner", () => {
    let state: string = "waiting";
    const detector = new StateDetector((s) => { state = s; });

    detector.process("❯ ");
    expect(state).toBe("waiting");

    detector.process("\r⠋ Thinking...");
    expect(state).toBe("running");
  });
});
```

## Checklist

- [x] Create `cli/wrapper/types.ts`
- [x] Create `cli/wrapper/state-detector.ts`
- [x] Create `cli/wrapper/server-connection.ts`
- [x] Create `cli/wrapper/approval.ts`
- [x] Create `cli/wrapper/index.ts`
- [x] Create `cli/wrapper/platform.ts`
- [x] Create `cli/commands/start.ts` (renamed from wrap.ts)
- [x] Update `cli/commands/session.ts` with `start` subcommand
- [x] Update `cli/index.ts` to register `start` command
- [x] Add unit tests for state detector and approval manager
- [x] Manual testing with mock server
