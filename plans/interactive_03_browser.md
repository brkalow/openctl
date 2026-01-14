# Interactive Sessions: Browser UI

> **Spec reference:** [specs/interactive_sessions.md](../specs/interactive_sessions.md)

## Overview

This plan adds browser UI for sending feedback to interactive sessions. Users can send follow-up messages when Claude is waiting for input.

## Dependencies

- [interactive_02_server.md](./interactive_02_server.md) - Server must relay messages to wrapper
- Existing live session UI (`src/client/liveSession.ts`, `src/components/SessionDetail.ts`)

## Goals

1. Show input field for follow-up messages during live interactive sessions
2. Display feedback status (pending, approved, rejected)
3. Show wrapper connection status
4. Show Claude state (waiting vs running)
5. Disable input when not applicable

## UI States

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          Session States                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Non-interactive session:                                               │
│  - No input field shown                                                 │
│  - Normal live session view                                             │
│                                                                          │
│  Interactive + Wrapper disconnected:                                     │
│  - Input disabled                                                        │
│  - Banner: "Waiting for session to connect..."                          │
│                                                                          │
│  Interactive + Claude running:                                          │
│  - Input disabled                                                        │
│  - Status: "Claude is working..."                                       │
│                                                                          │
│  Interactive + Claude waiting:                                          │
│  - Input enabled                                                         │
│  - Placeholder: "Send a follow-up message..."                           │
│                                                                          │
│  Session complete:                                                       │
│  - Input hidden                                                          │
│  - Badge: "Session ended"                                                │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Tasks

### 1. Update LiveSessionManager

Extend to handle new interactive session features.

**File:** `src/client/liveSession.ts` (updates)

```typescript
// Add to ServerMessage type
type ServerMessage =
  // ... existing types
  | { type: "feedback_queued"; message_id: string; position: number }
  | { type: "feedback_status"; message_id: string; status: "approved" | "rejected" | "expired" }
  | { type: "wrapper_status"; connected: boolean }
  | { type: "state"; state: "running" | "waiting" }
  | { type: "output"; data: string };

// Add to LiveSessionCallbacks
export interface LiveSessionCallbacks {
  // ... existing callbacks
  onFeedbackQueued?: (messageId: string, position: number) => void;
  onFeedbackStatus?: (messageId: string, status: "approved" | "rejected" | "expired") => void;
  onWrapperStatus?: (connected: boolean) => void;
  onClaudeState?: (state: "running" | "waiting") => void;
}

// Add to LiveSessionState
export interface LiveSessionState {
  isLive: boolean;
  isConnected: boolean;
  pendingToolCalls: Set<string>;
  lastMessageIndex: number;
  // New:
  isInteractive: boolean;
  wrapperConnected: boolean;
  claudeState: "running" | "waiting" | "unknown";
  pendingFeedback: Map<string, { position: number; status: "pending" | "approved" | "rejected" }>;
}

// Add to handleMessage in LiveSessionManager
private handleMessage(data: ServerMessage): void {
  switch (data.type) {
    // ... existing cases

    case "connected":
      this.lastIndex = data.last_index;
      // Store interactive state
      this.isInteractive = data.interactive ?? false;
      this.wrapperConnected = data.wrapper_connected ?? false;
      break;

    case "feedback_queued":
      this.callbacks.onFeedbackQueued?.(data.message_id, data.position);
      break;

    case "feedback_status":
      this.callbacks.onFeedbackStatus?.(data.message_id, data.status);
      break;

    case "wrapper_status":
      this.wrapperConnected = data.connected;
      this.callbacks.onWrapperStatus?.(data.connected);
      break;

    case "state":
      this.claudeState = data.state;
      this.callbacks.onClaudeState?.(data.state);
      break;
  }
}

// Add method to send feedback
sendFeedback(content: string): void {
  this.send({ type: "user_message", content });
}

sendDiffComment(file: string, line: number, content: string): void {
  this.send({ type: "diff_comment", file, line, content });
}

sendSuggestedEdit(file: string, oldContent: string, newContent: string): void {
  this.send({ type: "suggested_edit", file, old_content: oldContent, new_content: newContent });
}
```

### 2. Create Feedback Input Component

New component for the follow-up message input.

**File:** `src/components/FeedbackInput.ts`

```typescript
import { Component } from "./base";

export interface FeedbackInputState {
  isInteractive: boolean;
  wrapperConnected: boolean;
  claudeState: "running" | "waiting" | "unknown";
  sessionComplete: boolean;
  pendingFeedback: Array<{
    id: string;
    status: "pending" | "approved" | "rejected";
  }>;
}

export class FeedbackInput extends Component<FeedbackInputState> {
  private input: HTMLTextAreaElement | null = null;
  private onSubmit: (content: string) => void;

  constructor(
    container: HTMLElement,
    onSubmit: (content: string) => void
  ) {
    super(container);
    this.onSubmit = onSubmit;
    this.state = {
      isInteractive: false,
      wrapperConnected: false,
      claudeState: "unknown",
      sessionComplete: false,
      pendingFeedback: [],
    };
  }

  render(): string {
    const { isInteractive, wrapperConnected, claudeState, sessionComplete, pendingFeedback } = this.state;

    // Non-interactive or complete sessions don't show input
    if (!isInteractive || sessionComplete) {
      return "";
    }

    // Determine input state
    const canSend = wrapperConnected && claudeState === "waiting";
    const statusText = this.getStatusText();
    const pendingCount = pendingFeedback.filter(f => f.status === "pending").length;

    return `
      <div class="feedback-input-container">
        ${this.renderStatus(statusText, pendingCount)}
        <div class="feedback-input-wrapper ${canSend ? "" : "disabled"}">
          <textarea
            class="feedback-input"
            placeholder="${canSend ? "Send a follow-up message..." : "Waiting..."}"
            ${canSend ? "" : "disabled"}
            rows="2"
          ></textarea>
          <button
            class="feedback-submit"
            ${canSend ? "" : "disabled"}
            title="Send feedback (Ctrl+Enter)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
            </svg>
          </button>
        </div>
        ${this.renderPendingFeedback()}
      </div>
    `;
  }

  private getStatusText(): string {
    const { wrapperConnected, claudeState } = this.state;

    if (!wrapperConnected) {
      return "Waiting for session to connect...";
    }

    switch (claudeState) {
      case "running":
        return "Claude is working...";
      case "waiting":
        return "Claude is waiting for input";
      default:
        return "";
    }
  }

  private renderStatus(text: string, pendingCount: number): string {
    if (!text && pendingCount === 0) return "";

    return `
      <div class="feedback-status">
        <span class="feedback-status-text">${text}</span>
        ${pendingCount > 0 ? `
          <span class="feedback-pending-badge">
            ${pendingCount} pending approval
          </span>
        ` : ""}
      </div>
    `;
  }

  private renderPendingFeedback(): string {
    const pending = this.state.pendingFeedback.filter(f => f.status === "pending");
    if (pending.length === 0) return "";

    return `
      <div class="feedback-pending-list">
        ${pending.map(f => `
          <div class="feedback-pending-item">
            <span class="feedback-pending-icon">⏳</span>
            <span>Waiting for approval...</span>
          </div>
        `).join("")}
      </div>
    `;
  }

  afterRender(): void {
    this.input = this.container.querySelector(".feedback-input");
    const submitBtn = this.container.querySelector(".feedback-submit");

    if (this.input) {
      // Handle Enter to submit (Ctrl+Enter or Cmd+Enter)
      this.input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          this.submit();
        }
      });

      // Auto-resize
      this.input.addEventListener("input", () => {
        if (this.input) {
          this.input.style.height = "auto";
          this.input.style.height = Math.min(this.input.scrollHeight, 150) + "px";
        }
      });
    }

    submitBtn?.addEventListener("click", () => this.submit());
  }

  private submit(): void {
    if (!this.input || !this.input.value.trim()) return;

    const content = this.input.value.trim();
    this.input.value = "";
    this.input.style.height = "auto";

    this.onSubmit(content);
  }

  // Public methods for updating state
  setInteractive(interactive: boolean): void {
    this.setState({ isInteractive: interactive });
  }

  setWrapperConnected(connected: boolean): void {
    this.setState({ wrapperConnected: connected });
  }

  setClaudeState(state: "running" | "waiting" | "unknown"): void {
    this.setState({ claudeState: state });
  }

  setSessionComplete(complete: boolean): void {
    this.setState({ sessionComplete: complete });
  }

  addPendingFeedback(id: string): void {
    this.setState({
      pendingFeedback: [...this.state.pendingFeedback, { id, status: "pending" }],
    });
  }

  updateFeedbackStatus(id: string, status: "approved" | "rejected"): void {
    this.setState({
      pendingFeedback: this.state.pendingFeedback.map(f =>
        f.id === id ? { ...f, status } : f
      ),
    });

    // Remove from list after a delay
    setTimeout(() => {
      this.setState({
        pendingFeedback: this.state.pendingFeedback.filter(f => f.id !== id),
      });
    }, 3000);
  }
}
```

### 3. Create Feedback Styles

CSS for the feedback input component.

**File:** `public/styles/feedback.css`

```css
.feedback-input-container {
  padding: 1rem;
  border-top: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.feedback-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
  font-size: 0.875rem;
}

.feedback-status-text {
  color: var(--text-muted);
}

.feedback-pending-badge {
  background: var(--accent-yellow);
  color: var(--text-primary);
  padding: 0.125rem 0.5rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 500;
}

.feedback-input-wrapper {
  display: flex;
  gap: 0.5rem;
  align-items: flex-end;
}

.feedback-input-wrapper.disabled {
  opacity: 0.6;
}

.feedback-input {
  flex: 1;
  padding: 0.75rem;
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-family: inherit;
  font-size: 0.875rem;
  resize: none;
  min-height: 2.5rem;
  max-height: 150px;
}

.feedback-input:focus {
  outline: none;
  border-color: var(--accent-blue);
  box-shadow: 0 0 0 2px var(--accent-blue-faint);
}

.feedback-input:disabled {
  cursor: not-allowed;
  background: var(--bg-tertiary);
}

.feedback-submit {
  padding: 0.75rem;
  border: none;
  border-radius: 0.5rem;
  background: var(--accent-blue);
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
}

.feedback-submit:hover:not(:disabled) {
  background: var(--accent-blue-hover);
}

.feedback-submit:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.feedback-pending-list {
  margin-top: 0.75rem;
}

.feedback-pending-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem;
  background: var(--bg-tertiary);
  border-radius: 0.375rem;
  font-size: 0.875rem;
  color: var(--text-muted);
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

/* Toast notifications for feedback status */
.feedback-toast {
  position: fixed;
  bottom: 1rem;
  right: 1rem;
  padding: 0.75rem 1rem;
  border-radius: 0.5rem;
  font-size: 0.875rem;
  animation: slideIn 0.2s ease-out;
  z-index: 1000;
}

.feedback-toast.approved {
  background: var(--accent-green);
  color: white;
}

.feedback-toast.rejected {
  background: var(--accent-red);
  color: white;
}

@keyframes slideIn {
  from {
    transform: translateY(1rem);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}
```

### 4. Integrate with Session Detail

Add feedback input to the session detail page.

**File:** `src/components/SessionDetail.ts` (updates)

```typescript
import { FeedbackInput } from "./FeedbackInput";
import { LiveSessionManager } from "../client/liveSession";

// In SessionDetail class:

private feedbackInput: FeedbackInput | null = null;
private liveManager: LiveSessionManager | null = null;

// In render method, add feedback input container at the end of conversation panel:
private renderConversationPanel(): string {
  return `
    <div class="conversation-panel">
      <div class="conversation-messages" id="messages-container">
        ${this.renderMessages()}
      </div>
      <div id="feedback-input-container"></div>
    </div>
  `;
}

// In initializeLiveSession method:
private initializeLiveSession(): void {
  if (!this.session?.status === "live") return;

  // Create feedback input
  const feedbackContainer = document.getElementById("feedback-input-container");
  if (feedbackContainer) {
    this.feedbackInput = new FeedbackInput(
      feedbackContainer,
      (content) => this.handleFeedbackSubmit(content)
    );
  }

  // Set up live manager with interactive callbacks
  this.liveManager = new LiveSessionManager(this.session.id, {
    onMessage: (messages, index) => this.handleLiveMessage(messages, index),
    onToolResult: (result) => this.handleToolResult(result),
    onDiff: (files) => this.handleDiffUpdate(files),
    onComplete: () => this.handleSessionComplete(),
    onConnectionChange: (connected) => this.handleConnectionChange(connected),

    // Interactive callbacks
    onFeedbackQueued: (messageId, position) => {
      this.feedbackInput?.addPendingFeedback(messageId);
      this.showToast(`Message queued (position: ${position})`, "info");
    },
    onFeedbackStatus: (messageId, status) => {
      this.feedbackInput?.updateFeedbackStatus(messageId, status);
      this.showToast(
        status === "approved" ? "Message sent to session" : "Message was declined",
        status === "approved" ? "success" : "error"
      );
    },
    onWrapperStatus: (connected) => {
      this.feedbackInput?.setWrapperConnected(connected);
    },
    onClaudeState: (state) => {
      this.feedbackInput?.setClaudeState(state);
    },
  });

  // Set initial interactive state
  if (this.session.interactive) {
    this.feedbackInput?.setInteractive(true);
    this.feedbackInput?.setWrapperConnected(this.session.wrapper_connected ?? false);
  }

  this.liveManager.connect();
}

private handleFeedbackSubmit(content: string): void {
  if (!this.liveManager) return;
  this.liveManager.sendFeedback(content);
}

private handleSessionComplete(): void {
  this.feedbackInput?.setSessionComplete(true);
  // ... existing complete handling
}

private showToast(message: string, type: "info" | "success" | "error"): void {
  const toast = document.createElement("div");
  toast.className = `feedback-toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 200);
  }, 3000);
}
```

### 5. Update Session API Response

Include interactive fields in session detail response.

**File:** `src/routes/api.ts` (updates)

```typescript
// In getSessionDetail method:
return Response.json({
  // ... existing fields
  interactive: session.interactive ?? false,
  wrapper_connected: session.wrapper_connected ?? false,
});
```

### 6. Add Interactive Badge

Show badge on session list for interactive sessions.

**File:** `src/components/SessionList.ts` (updates)

```typescript
// In renderSessionCard:
private renderSessionCard(session: Session): string {
  const isLive = session.status === "live";
  const isInteractive = session.interactive;

  return `
    <div class="session-card ${isLive ? "live" : ""}">
      <div class="session-header">
        <span class="session-title">${session.title}</span>
        <div class="session-badges">
          ${isLive ? '<span class="badge live">● LIVE</span>' : ""}
          ${isInteractive ? '<span class="badge interactive">↔ Interactive</span>' : ""}
        </div>
      </div>
      <!-- ... rest of card -->
    </div>
  `;
}
```

**Styles:**

```css
.badge.interactive {
  background: var(--accent-purple);
  color: white;
}
```

### 7. Keyboard Shortcut Help

Add help text for keyboard shortcuts.

**File:** `src/components/FeedbackInput.ts` (addition to render)

```typescript
// Add to the input wrapper:
<div class="feedback-help">
  <span class="feedback-shortcut">⌘Enter</span> to send
</div>
```

**Styles:**

```css
.feedback-help {
  font-size: 0.75rem;
  color: var(--text-muted);
  margin-top: 0.25rem;
}

.feedback-shortcut {
  font-family: monospace;
  background: var(--bg-tertiary);
  padding: 0.125rem 0.25rem;
  border-radius: 0.25rem;
}
```

## Testing

### Manual Testing

1. Start server and wrapper for an interactive session
2. Open session in browser
3. Verify:
   - Input shows when Claude is waiting
   - Input disabled when Claude is running
   - Status text updates correctly
   - Feedback submits and shows pending state
   - Toast appears on approval/rejection

### Visual States to Test

- [ ] Non-interactive session (no input shown)
- [ ] Interactive, wrapper disconnected
- [ ] Interactive, wrapper connected, Claude running
- [ ] Interactive, wrapper connected, Claude waiting
- [ ] Message submitted (pending state)
- [ ] Message approved (toast + clear pending)
- [ ] Message rejected (toast + clear pending)
- [ ] Session complete (input hidden)

## Checklist

- [ ] Update `LiveSessionManager` with interactive callbacks
- [ ] Create `FeedbackInput` component
- [ ] Create feedback CSS styles
- [ ] Integrate feedback input into session detail
- [ ] Update session API to include interactive fields
- [ ] Add interactive badge to session list
- [ ] Add keyboard shortcut help
- [ ] Add toast notification system
- [ ] Manual testing all states
