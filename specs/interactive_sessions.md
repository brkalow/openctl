# Interactive Sessions

This document specifies the architecture for bidirectional communication with live Claude Code sessions, enabling users to send follow-up messages, feedback, and diff comments from the browser directly into running sessions.

**Depends on:** [live_streaming.md](./live_streaming.md)

## Overview

Interactive sessions extend the live streaming infrastructure with **inbound messaging** - the ability to send user input from the browser to a running Claude Code session. This enables:

- **Follow-up prompts**: Send additional instructions mid-session
- **Diff comments**: Comment on specific lines of a diff, injected as context
- **Suggested edits**: Propose code changes that Claude can apply
- **Corrections**: Interrupt and redirect when Claude goes off track

**Design goals:**
1. The user's terminal experience remains unchanged - Claude Code runs with its full TUI
2. The local user **controls** what gets injected - remote messages require approval
3. Remote viewers can send feedback, but it's gated by the session owner

**Key decisions:**
- **CLI naming:** Use `archive` (e.g., `archive session`, `archive wrap`)
- **Approval notification:** Inline prompt when Claude is waiting (Option A)
- **User input streaming:** Only stream output (which contains user prompts already)
- **Browser rendering:** Hybrid - JSONL for structured view, PTY for live updates
- **Auth dependency:** Can ship without Phase 2 auth; approval gate provides protection

```
┌─────────────┐       ┌─────────────┐       ┌─────────────┐       ┌────────────┐
│   Browser   │◄─────►│   Server    │◄─────►│ PTY Wrapper │◄─────►│ Claude TUI │
│             │  ws   │             │  ws   │             │  pty  │  (normal)  │
│  viewing    │◄──────│  broadcast  │◄──────│  tap output │◄──────│            │
│  feedback   │──────►│  relay      │──────►│  approval Q │       │            │
│             │       │             │       │      │      │       │            │
│  status     │◄──────│  notify     │◄──────│  user Y/N   │       │            │
│  (pending/  │       │             │       │      │      │       │            │
│   approved) │       │             │       │  inject inp │──────►│            │
└─────────────┘       └─────────────┘       └─────────────┘       └────────────┘
                                                   │
                                                   ▼
                                            ┌────────────┐
                                            │   User's   │
                                            │  Terminal  │
                                            │ (sees TUI  │
                                            │  + approval│
                                            │  prompts)  │
                                            └────────────┘
```

## PTY Wrapper

The wrapper uses a pseudo-terminal (PTY) to run Claude Code with its full TUI intact. It acts as a transparent proxy, tapping the I/O stream for observation while allowing remote input injection.

### Why PTY?

The original daemon design tails JSONL files written by Claude Code. This works for observation but not interaction - we can't write to those files to inject messages.

Alternative approaches considered:
- **Stream-JSON mode** (`--input-format stream-json`): Bypasses TUI entirely, loses the familiar terminal experience
- **File-based IPC**: No built-in Claude Code support, unreliable
- **MCP injection**: Requires Claude to poll, doesn't allow true input injection

The PTY approach:
- Preserves the full TUI experience
- User can interact normally in their terminal
- Wrapper can inject input as simulated keystrokes
- Session data flows to server for live viewing

### Architecture

```typescript
interface PTYSession {
  id: string;                    // Server-assigned session ID
  proc: ReturnType<typeof Bun.spawn>;  // Bun subprocess with terminal
  projectPath: string;           // Working directory
  state: "running" | "waiting";  // Detected from output
  pendingInjections: string[];   // Queued when Claude is busy
  streamToken: string;           // Auth token for server
  outputBuffer: string;          // For state detection
}
```

**States:**
- `running` - Claude is actively processing (generating response, running tools)
- `waiting` - Claude is at the prompt, awaiting user input
- State is detected by pattern-matching terminal output

### Spawning Claude

```typescript
function spawnSession(projectPath: string, initialPrompt?: string): PTYSession {
  const session: PTYSession = {
    id: generateSessionId(),
    proc: null as any,  // Set below
    projectPath,
    state: "running",
    pendingInjections: [],
    streamToken: generateToken(),
    outputBuffer: ""
  };

  const proc = Bun.spawn(["claude", ...(initialPrompt ? [initialPrompt] : [])], {
    cwd: projectPath,
    env: process.env,
    terminal: {
      cols: 120,
      rows: 40,
      data(terminal, data) {
        // 1. Forward to user's terminal (if attached)
        process.stdout.write(data);

        // 2. Stream to server for web viewing
        pushOutputToServer(session.id, session.streamToken, data);

        // 3. Detect state changes
        detectState(session, data);
      },
    },
  });

  session.proc = proc;

  // Handle exit
  proc.exited.then(() => {
    markSessionComplete(session.id, session.streamToken);
  });

  return session;
}
```

### State Detection

Claude Code shows distinct patterns when waiting for input vs. running:

```typescript
const PROMPT_PATTERNS = [
  /❯\s*$/,           // Standard prompt
  />>>\s*$/,         // Alternative prompt
  /\[Y\/n\]/,        // Permission prompt (y/n)
  /Press Enter/,     // Confirmation prompt
];

const RUNNING_PATTERNS = [
  /⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏/,  // Spinner characters
  /Reading|Writing|Editing/,   // Tool activity
  /Thinking\.\.\./,            // Processing indicator
];

function detectState(session: PTYSession, data: string) {
  session.outputBuffer += data;

  // Keep last 500 chars for pattern matching
  if (session.outputBuffer.length > 500) {
    session.outputBuffer = session.outputBuffer.slice(-500);
  }

  // Check for prompt patterns (waiting state)
  for (const pattern of PROMPT_PATTERNS) {
    if (pattern.test(session.outputBuffer)) {
      if (session.state !== "waiting") {
        session.state = "waiting";
        flushPendingInjections(session);
      }
      return;
    }
  }

  // Check for running patterns
  for (const pattern of RUNNING_PATTERNS) {
    if (pattern.test(session.outputBuffer)) {
      session.state = "running";
      return;
    }
  }
}
```

### Input Injection

Remote messages go through an **approval flow** before injection. The local user controls what gets sent to Claude.

#### Approval Flow

```
Remote Feedback          Pending Queue         Local Approval         Claude
     │                        │                      │                   │
     │  "fix the bug"         │                      │                   │
     ├───────────────────────►│                      │                   │
     │                        │  notification        │                   │
     │                        ├─────────────────────►│                   │
     │                        │                      │ user reviews      │
     │                        │                      │ presses 'y'       │
     │                        │                      ├──────────────────►│
     │                        │                      │                   │
```

#### Pending Messages

Remote messages queue until the local user approves:

```typescript
interface PendingMessage {
  id: string;
  content: string;
  source: string;           // Who sent it (email or "anonymous")
  type: "message" | "diff_comment" | "suggested_edit";
  receivedAt: Date;
  context?: {               // For diff comments
    file: string;
    line: number;
  };
}

interface PTYSession {
  // ... existing fields
  pendingApprovals: PendingMessage[];
  approvalMode: "ask" | "auto" | "reject";
}
```

#### Approval Modes

Users can configure how remote messages are handled:

| Mode | Behavior |
|------|----------|
| `ask` (default) | Show notification, wait for user approval |
| `auto` | Auto-approve from trusted sources (configured list) |
| `reject` | Reject all remote messages (view-only mode) |

```bash
# Set approval mode
archive config set approval-mode ask
archive config set approval-mode auto --trusted "alice@example.com,bob@example.com"
archive config set approval-mode reject
```

#### Notification UI

When a remote message arrives in `ask` mode, the wrapper shows a notification.

**Chosen approach: Inline notification (when Claude is waiting)**

```
❯
┌─────────────────────────────────────────────────────────────────┐
│ 📩 Remote feedback from alice@example.com                       │
│                                                                 │
│ "Use a separate secret for refresh tokens"                      │
│                                                                 │
│ [y] Accept  [n] Reject  [v] View full  [i] Ignore all          │
└─────────────────────────────────────────────────────────────────┘
```

User presses `y` → message injected, `n` → discarded, `v` → show full content, `i` → set reject mode for session.

**Option B: Status line notification (non-blocking)**

The wrapper adds a status line at the bottom of the terminal:

```
[Claude working...]
───────────────────────────────────────────────────────────────────
📩 1 pending message from alice@example.com · Press Ctrl+R to review
```

User presses `Ctrl+R` at any time to open the review interface.

**Option C: System notification**

Use OS notifications (macOS Notification Center, etc.) with a sound. User switches to terminal to review.

#### Implementation

```typescript
function onRemoteMessage(session: PTYSession, msg: PendingMessage) {
  if (session.approvalMode === "reject") {
    notifyRemoteRejected(msg);
    return;
  }

  if (session.approvalMode === "auto" && isTrustedSource(msg.source)) {
    injectApproved(session, msg);
    return;
  }

  // Queue for approval
  session.pendingApprovals.push(msg);
  showApprovalNotification(session, msg);
}

function injectApproved(session: PTYSession, msg: PendingMessage) {
  const content = formatMessage(msg);

  if (session.state === "waiting") {
    session.pty.write(content + "\r");
    session.state = "running";
  } else {
    session.pendingInjections.push(content);
  }

  // Notify remote that message was accepted
  notifyRemoteAccepted(msg);
}

function showApprovalNotification(session: PTYSession, msg: PendingMessage) {
  // Show inline notification if Claude is waiting
  if (session.state === "waiting") {
    renderInlineApprovalPrompt(session, msg);
  } else {
    // Show status line notification
    updateStatusLine(session, `📩 ${session.pendingApprovals.length} pending`);
  }
}
```

#### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+R` | Open review interface for pending messages |
| `Ctrl+Y` | Quick-approve oldest pending message |
| `Ctrl+N` | Quick-reject oldest pending message |

#### Review Interface

Pressing `Ctrl+R` opens a TUI overlay:

```
┌─────────────────── Pending Remote Messages ───────────────────────┐
│                                                                   │
│  1. alice@example.com (2m ago)                          [message] │
│     "Use a separate secret for refresh tokens"                    │
│                                                                   │
│  2. bob@example.com (5m ago)                        [diff_comment] │
│     src/auth.ts:16: "This should validate the token expiry"       │
│                                                                   │
│ ─────────────────────────────────────────────────────────────────│
│ [↑↓] Navigate  [y] Accept  [n] Reject  [a] Accept all  [q] Close │
└───────────────────────────────────────────────────────────────────┘
```

#### Remote Feedback

Remote viewers see the status of their messages:

```typescript
type FeedbackStatus =
  | { status: "pending"; position: number }
  | { status: "approved"; injectedAt: Date }
  | { status: "rejected"; reason?: string }
  | { status: "expired" };  // User didn't respond within timeout
```

Browser shows:
- ⏳ "Waiting for approval..." (pending)
- ✅ "Message sent to session" (approved)
- ❌ "Message was declined" (rejected)

---

### User Experience

The user starts a session via the CLI:

```bash
# Start a new interactive session
archive session "implement user authentication"

# Or wrap an existing claude command
archive wrap claude
```

What the user sees:
1. Normal Claude TUI appears in their terminal
2. They can type, approve permissions, use all features normally
3. Session is automatically streamed to the web archive
4. When remote feedback arrives, text appears in their terminal as if typed
5. Claude processes it, user sees the response

**Visual indicator for remote input:**

To avoid confusion when remote input appears, we can prefix it:

```typescript
function injectInput(session: PTYSession, content: string, source: string) {
  const prefix = `[Remote feedback from ${source}]\n`;
  session.pty.write(prefix + content + "\r");
}
```

User sees:
```
❯ [Remote feedback from alice@example.com]
Use a separate secret for refresh tokens

Claude is thinking...
```

### Terminal Attachment

The wrapper can run in two modes:

**Attached mode** (default): User's terminal is connected
```bash
archive session "my task"
# User sees and interacts with Claude TUI
```

**Detached mode**: Runs in background, view via web only
```bash
archive session --detached "my task"
# Returns session URL, no local TUI
# Session runs headless, viewable in browser
```

For detached mode, we don't forward to stdout:

```typescript
pty.onData((data) => {
  // Only stream to server, no local output
  pushOutputToServer(session.id, session.streamToken, data);
  detectState(session, data);
});
```

---

## Server Changes

### New WebSocket Messages

Extend the WebSocket protocol from live_streaming.md:

**Client → Server (new):**

```typescript
type ClientMessage =
  | { type: "subscribe"; from_index?: number }
  | { type: "ping" }
  // New interactive messages:
  | { type: "user_message"; content: string }
  | { type: "diff_comment"; file: string; line: number; content: string }
  | { type: "suggested_edit"; file: string; old_content: string; new_content: string };
```

**Server → Client (new):**

```typescript
type ServerMessage =
  // ... existing messages from live_streaming.md
  | { type: "input_accepted"; message_id: string }
  | { type: "input_queued"; message_id: string; position: number }
  | { type: "input_rejected"; message_id: string; reason: string };
```

### Feedback Relay

Server receives feedback via WebSocket, validates, and forwards to the wrapper:

```typescript
// Server-side WebSocket handler
ws.on("message", async (data) => {
  const msg = JSON.parse(data);

  switch (msg.type) {
    case "user_message":
      await relayToWrapper(sessionId, {
        type: "inject",
        content: msg.content
      });
      ws.send(JSON.stringify({ type: "input_accepted", message_id: msg.id }));
      break;

    case "diff_comment":
      // Format as contextual feedback
      const formatted = formatDiffComment(msg.file, msg.line, msg.content);
      await relayToWrapper(sessionId, {
        type: "inject",
        content: formatted
      });
      break;

    case "suggested_edit":
      const editPrompt = formatSuggestedEdit(msg.file, msg.old_content, msg.new_content);
      await relayToWrapper(sessionId, {
        type: "inject",
        content: editPrompt
      });
      break;
  }
});
```

### Wrapper Communication

Server communicates with the wrapper via a secondary WebSocket:

```
Browser ◄──► Server ◄──► PTY Wrapper ◄──► Claude TUI
         ws          ws             pty
```

**Server → Wrapper messages:**

```typescript
type WrapperCommand =
  | { type: "inject"; content: string; source?: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "interrupt" }  // Send Ctrl+C
  | { type: "end" };       // End session gracefully
```

**Wrapper → Server messages:**

```typescript
type WrapperEvent =
  | { type: "output"; data: string }           // Raw terminal output
  | { type: "state"; state: "running" | "waiting" }
  | { type: "ended"; exitCode: number }
  | { type: "error"; error: string };
```

**Note:** We stream raw terminal output (including ANSI escape codes) for real-time updates, but use the **hybrid approach** for rendering:
- JSONL file provides structured data (messages, tool calls, results)
- PTY stream provides real-time "Claude is typing..." indicator
- This keeps the session view consistent with archived sessions

---

## Browser UI

### Follow-up Input

Live sessions show an input field when Claude is waiting:

```
┌────────────────────────────────────────────────────────────────────┐
│  ● LIVE  Implementing auth feature                    [PR] [Share] │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  [Conversation messages...]                                        │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ Claude is waiting for input...                                │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ Send a follow-up message...                              [⏎] │ │
│  └──────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────┘
```

**States:**
- **Running**: Input disabled, shows "Claude is working..."
- **Waiting**: Input enabled, placeholder "Send a follow-up message..."
- **Ended**: Input hidden, shows "Session ended"

### Diff Comments

Users can comment on specific diff lines:

```
┌──────────────────────────────────────────────────────────────────┐
│  src/auth.ts                                              +45 -12 │
├──────────────────────────────────────────────────────────────────┤
│  15 │   const token = jwt.sign(payload, secret);                 │
│  16 │+  const refreshToken = jwt.sign(payload, secret, {         │ [💬]
│  17 │+    expiresIn: '7d'                                        │
│  18 │+  });                                                      │
│     │                                                            │
│     │  ┌────────────────────────────────────────────────────┐   │
│     │  │ Should use a separate secret for refresh tokens    │   │
│     │  │                                          [Send] [×] │   │
│     │  └────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

Clicking the comment icon on a line opens an inline input. The comment is formatted with context:

```typescript
function formatDiffComment(file: string, line: number, comment: string): string {
  return `Feedback on ${file} line ${line}:

> ${getDiffLineContent(file, line)}

Comment: ${comment}

Please address this feedback.`;
}
```

### Suggested Edits

For more specific feedback, users can suggest code changes:

```
┌──────────────────────────────────────────────────────────────────┐
│  Suggest an edit to src/auth.ts:16-18                            │
├──────────────────────────────────────────────────────────────────┤
│  Current:                                                        │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ const refreshToken = jwt.sign(payload, secret, {           │ │
│  │   expiresIn: '7d'                                          │ │
│  │ });                                                        │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  Suggested:                                                      │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ const refreshToken = jwt.sign(payload, REFRESH_SECRET, {   │ │
│  │   expiresIn: '7d'                                          │ │
│  │ });                                                        │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  [Cancel]                                        [Send Suggestion]│
└──────────────────────────────────────────────────────────────────┘
```

Formatted as:

```typescript
function formatSuggestedEdit(file: string, oldContent: string, newContent: string): string {
  return `I have a suggested edit for ${file}:

Current code:
\`\`\`
${oldContent}
\`\`\`

Suggested change:
\`\`\`
${newContent}
\`\`\`

Please review and apply this change if appropriate.`;
}
```

---

## Two Modes: Daemon vs Wrapper

The `archive` CLI supports **two distinct modes** of operation:

### Daemon Mode (Passive Observation)

From [live_streaming.md](./live_streaming.md) - watches JSONL files written by Claude Code sessions.

```bash
# Start the daemon - watches for any Claude session
archive daemon

# User runs claude normally in another terminal
claude "implement feature X"
```

- **No changes to user workflow** - run `claude` as usual
- **Read-only** - observe but cannot inject input
- **Works with any session** - even ones started before daemon
- **Detects sessions automatically** via filesystem watching

### Wrapper Mode (Interactive)

From this spec - spawns Claude with a PTY for bidirectional communication.

```bash
# Start an interactive session
archive session "implement feature X"

# Or wrap an existing claude command
archive wrap claude --resume abc123
```

- **Requires explicit opt-in** - user starts session via `archive`
- **Bidirectional** - can inject follow-ups, diff comments, edits
- **Full TUI preserved** - user sees normal Claude interface
- **Approval flow** - local user controls what gets injected

### Comparison

| Aspect | Daemon Mode | Wrapper Mode |
|--------|-------------|--------------|
| **Command** | `archive daemon` | `archive session` / `archive wrap` |
| **How sessions start** | User runs `claude` normally | User runs via `archive` |
| **Observation method** | Tail JSONL files | Tap PTY output |
| **Interaction** | Read-only | Bidirectional |
| **TUI** | User sees TUI, daemon doesn't | User sees TUI, wrapper taps it |
| **Use case** | Passive streaming, team visibility | Code review feedback, collaboration |

### When to Use Each

**Daemon mode:**
- Team wants visibility into ongoing sessions without changing workflow
- Observing sessions on remote machines
- Retroactive streaming (session started, then daemon launched)
- Environments where PTY wrapper can't run

**Wrapper mode:**
- Interactive code review with feedback injection
- Collaborative sessions where viewers send follow-ups
- Sessions where you want bidirectional communication

### Both Running Together

The modes are complementary. A typical setup:

1. **Daemon always running** - streams all sessions for team visibility
2. **Wrapper for specific sessions** - when you need interactivity

```bash
# Terminal 1: daemon watches everything
archive daemon

# Terminal 2: user starts interactive session (also picked up by daemon)
archive session "implement auth"

# Terminal 3: user runs normal claude (daemon observes, read-only)
claude "fix bug"
```

The daemon will observe both sessions, but only the wrapped session supports input injection.

---

## Security Considerations

### Authentication

Interactive sessions can ship **without Phase 2 auth** because the local approval mechanism provides protection:

- Remote messages require explicit approval from the local user
- The approval gate prevents unauthorized injection regardless of who sends the message
- Phase 2 auth will add:
  - Identity tracking (who sent which message)
  - Collaborator lists (skip approval for trusted users)
  - Access control (who can view/send to which sessions)

### Rate Limiting

Prevent abuse:

| Action | Limit |
|--------|-------|
| Messages per session | 100/hour |
| Diff comments per session | 50/hour |
| Suggested edits per session | 20/hour |

### Input Validation

Sanitize all user input before injection:

- Max message length: 10,000 characters
- No control characters
- Escape any prompt injection attempts (though Claude should handle this)

### Permission Escalation

The wrapper runs Claude with the same permissions as the original session:

- If session was started with `--dangerously-skip-permissions`, injected messages inherit that
- Otherwise, permission prompts need to be relayed back to the browser (future enhancement)

---

## Implementation Phases

### Phase 3.1: PTY Wrapper Foundation

**Wrapper (`archive` CLI):**
- [ ] PTY spawning with node-pty
- [ ] Output capture and forwarding to user terminal
- [ ] WebSocket connection to server
- [ ] State detection (waiting vs running)
- [ ] Basic approval flow (inline prompt when Claude is waiting)
- [ ] Keyboard shortcuts (Ctrl+R for review, Ctrl+Y/N for quick approve/reject)

**Server:**
- [ ] WebSocket relay infrastructure (browser ↔ wrapper)
- [ ] Raw terminal output storage/forwarding
- [ ] `user_message` handling and relay to wrapper
- [ ] Feedback status tracking (pending/approved/rejected)

**Browser:**
- [ ] Follow-up input field for live sessions
- [ ] Connection status indicator
- [ ] Feedback status display (pending/approved/rejected)
- [ ] Hybrid rendering: JSONL-based structured view + PTY stream for live typing indicator

### Phase 3.2: Diff Feedback

**Browser:**
- [ ] Inline comment UI on diff lines
- [ ] Comment formatting with context

**Server:**
- [ ] `diff_comment` message handling
- [ ] Context extraction from stored diff

**Wrapper:**
- [ ] Handle formatted diff comments as injected input

### Phase 3.3: Suggested Edits

**Browser:**
- [ ] Edit suggestion modal
- [ ] Side-by-side diff preview

**Server:**
- [ ] `suggested_edit` message handling

### Phase 3.4: Robustness & Polish

**Wrapper:**
- [ ] Message queuing while Claude is running
- [ ] Graceful handling of Claude crashes/exits
- [ ] Detached mode (headless sessions)
- [ ] `archive wrap` to wrap existing claude commands
- [ ] Advanced approval modes (`auto` with trusted list, `reject`)
- [ ] `archive config` for approval settings
- [ ] Status line notification (non-blocking)
- [ ] Full review TUI overlay (Ctrl+R)

**Server:**
- [ ] Rate limiting
- [ ] Input validation
- [ ] Auth enforcement
- [ ] Message expiry (timeout for pending messages)

**Browser:**
- [ ] Optimistic UI updates
- [ ] Error handling for rejected inputs
- [ ] Reconnection with message replay
- [ ] Terminal resize support
- [ ] Show approval queue status ("2 messages pending approval")

---

## Open Questions

1. **Permission prompts**: How to handle Claude requesting permissions mid-session?
   - With PTY approach, user can approve permissions normally in their terminal
   - For detached/headless sessions, need different strategy:
     - Option A: Auto-reject and inform browser viewer
     - Option B: Relay to browser for approval (inject "y" or "n" based on browser response)
     - Option C: Require `--dangerously-skip-permissions` for detached sessions only

2. **Multiple viewers**: If multiple users are viewing a live session, who can send messages?
   - Option A: Only session owner
   - Option B: Anyone with link (chaotic but simple)
   - Option C: Explicit collaborator list
   - Note: With PTY approach, the local user always has priority (they're at the terminal)

3. **Message attribution**: Should injected messages show who sent them?
   - Useful for collaborative review
   - Requires auth integration
   - Prefix approach: `[Remote feedback from alice@example.com]`

4. **Interruption**: Should we support stopping Claude mid-response?
   - With PTY, we can send Ctrl+C (`\x03`) to interrupt
   - User at terminal can do this naturally
   - Remote viewers would need explicit "interrupt" button

5. **Existing sessions**: Can we attach the wrapper to a session already running in a terminal?
   - Not directly - PTY wrapper must spawn the process
   - Alternative: `archive wrap` command that user runs instead of `claude`
   - Could support "takeover" by reading existing JSONL + spawning new process with `--resume`

6. **Terminal output rendering**: How to display PTY output in the browser?
   - ~~Option A: xterm.js - full terminal emulation, shows exactly what user sees~~
   - **Option B: Hybrid** - continue using JSONL parsing for structured view, PTY for live indicator ✓
   - ~~Option C: Parse ANSI codes server-side, convert to styled HTML~~
   - **Decision:** Hybrid approach - consistent with existing session view, use PTY stream only for real-time updates

7. **Output synchronization**: PTY output and JSONL file may have timing differences
   - PTY is real-time, JSONL is written after each message completes
   - For structured data (tool calls, etc.), prefer JSONL
   - For live "typing" experience, use PTY stream
   - May need to reconcile the two sources

8. **Local user input**: When user types in their terminal, should it also stream to browser?
   - **Decision:** Only stream output, not raw user input
   - Claude's output already contains user prompts (in the conversation), so viewers see the full conversation
   - No additional privacy concerns since we're not capturing keystrokes separately

9. **Detached mode approval**: How to handle approval for headless sessions?
   - No local user to approve - who controls what gets injected?
   - Option A: Require `--auto-approve` flag for detached, trust all remote input
   - Option B: Owner approves via browser (relay approval prompts to web UI)
   - Option C: Only allow messages from authenticated, pre-approved collaborators
   - Recommendation: Start with Option A (explicit flag), add Option B later

---

## Appendix A: PTY Implementation

### Bun.Terminal (Built-in)

Bun has built-in PTY support via `Bun.Terminal` ([added in v1.3.5](https://bun.com/blog/bun-v1.3.5)). No external dependencies required.

```typescript
// Spawn Claude with PTY
const proc = Bun.spawn(["claude"], {
  cwd: projectPath,
  env: process.env,
  terminal: {
    cols: 120,
    rows: 40,
    data(terminal, data) {
      // Called when data is received from the terminal
      // 1. Forward to user's terminal
      process.stdout.write(data);

      // 2. Stream to server
      pushOutputToServer(sessionId, streamToken, data);

      // 3. Detect state
      detectState(data);
    },
  },
});

// Write input to the terminal
proc.terminal.write("hello\r");  // \r = Enter

// Send control characters
proc.terminal.write("\x03");     // Ctrl+C

// Resize
proc.terminal.resize(80, 24);

// Wait for process to exit
await proc.exited;

// Cleanup
proc.terminal.close();
```

### Standalone Terminal (Reusable)

For more control, create a standalone terminal:

```typescript
await using terminal = new Bun.Terminal({
  cols: 120,
  rows: 40,
  data(term, data) {
    process.stdout.write(data);
    pushOutputToServer(sessionId, streamToken, data);
    detectState(data);
  },
});

const proc = Bun.spawn(["claude", initialPrompt], {
  cwd: projectPath,
  terminal,
});

// Terminal is closed automatically via `await using`
```

### Platform Support

`Bun.Terminal` is only available on POSIX systems (Linux, macOS). Windows support is not yet available but [requested](https://github.com/oven-sh/bun/issues/25593).

### Fallback: node-pty

If Windows support is needed, use [node-pty](https://github.com/microsoft/node-pty) as a fallback:

```bash
bun add node-pty
```

```typescript
import { spawn, IPty } from "node-pty";

const pty: IPty = spawn("claude", [], {
  name: "xterm-256color",
  cols: 120,
  rows: 40,
  cwd: process.cwd(),
  env: process.env
});

pty.onData((data: string) => {
  process.stdout.write(data);
});

pty.write("hello\r");
pty.resize(80, 24);
pty.kill();
```

### Hybrid Browser Rendering

The browser uses a **hybrid approach** for live sessions:

1. **JSONL parsing** (existing): Provides structured message view, tool calls, results
2. **PTY stream**: Used only for real-time status indicator ("Claude is typing...")

```typescript
// Server pushes both JSONL updates and PTY stream events
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  switch (msg.type) {
    case "message":
      // Structured message from JSONL - render in existing message view
      appendMessage(msg.data);
      break;

    case "output":
      // Raw PTY output - used for live status detection
      updateLiveIndicator(msg.data);
      break;

    case "state":
      // Wrapper detected state change
      setSessionState(msg.state); // "running" | "waiting"
      break;
  }
};

function updateLiveIndicator(ptyOutput: string) {
  // Detect typing patterns from PTY output
  if (/⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏/.test(ptyOutput)) {
    showTypingIndicator("Claude is working...");
  }
}
```

**Note:** xterm.js could be added later for a "raw terminal" view option, but the hybrid approach keeps the UI consistent with archived sessions.

---

## Appendix B: Stream-JSON Protocol (Alternative)

If TUI preservation is not required, the stream-json approach is simpler:

### Input Messages (stdin)

```json
{"type":"user","message":{"role":"user","content":"Your message here"},"session_id":"optional-id"}
```

### Output Messages (stdout)

```json
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Response..."}]}}
{"type":"tool_use","id":"tu_123","name":"Read","input":{"file_path":"src/index.ts"}}
{"type":"tool_result","tool_use_id":"tu_123","content":"file contents..."}
{"type":"system","subtype":"init","session_id":"abc123"}
```

### Known Issues

- [Duplicate JSONL entries](https://github.com/anthropics/claude-code/issues/5034) when using stream-json input
- [Tool result injection](https://github.com/anthropics/claude-code/issues/16712) - synthetic responses when resuming with pending tool_use

### When to Use Stream-JSON

- Detached/headless sessions where no user is at a terminal
- Automated pipelines where TUI adds no value
- Programmatic integrations that only need structured data
