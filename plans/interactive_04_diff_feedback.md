# Interactive Sessions: Diff Comments & Suggested Edits

> **Spec reference:** [specs/interactive_sessions.md](../specs/interactive_sessions.md)

## Overview

This plan adds the ability to comment on specific diff lines and suggest code edits. These are injected into the running Claude session with context, enabling precise feedback on code changes.

## Dependencies

- [interactive_03_browser.md](./interactive_03_browser.md) - Basic feedback UI must be in place
- Existing diff panel (`src/components/DiffPanel.ts` or equivalent)

## Goals

1. Add comment icon to diff lines that opens inline comment input
2. Support multi-line selection for suggested edits
3. Format comments with file/line context
4. Show pending comments inline in diff view

## UI Design

### Diff Comment

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

### Suggested Edit

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

## Tasks

### 1. Diff Line Actions

Add hover actions to diff lines for interactive sessions.

**File:** `src/components/DiffLineActions.ts`

```typescript
import { Component } from "./base";

export interface DiffLineActionsState {
  isInteractive: boolean;
  canComment: boolean;
  lineNumber: number;
  filename: string;
  lineContent: string;
  isAdded: boolean;
  showCommentInput: boolean;
  commentText: string;
}

export class DiffLineActions extends Component<DiffLineActionsState> {
  private onComment: (file: string, line: number, content: string) => void;
  private onSuggestEdit: (file: string, lineStart: number, lineEnd: number) => void;

  constructor(
    container: HTMLElement,
    onComment: (file: string, line: number, content: string) => void,
    onSuggestEdit: (file: string, lineStart: number, lineEnd: number) => void
  ) {
    super(container);
    this.onComment = onComment;
    this.onSuggestEdit = onSuggestEdit;
    this.state = {
      isInteractive: false,
      canComment: false,
      lineNumber: 0,
      filename: "",
      lineContent: "",
      isAdded: false,
      showCommentInput: false,
      commentText: "",
    };
  }

  render(): string {
    const { isInteractive, canComment, showCommentInput, lineNumber, filename } = this.state;

    if (!isInteractive || !canComment) {
      return "";
    }

    if (showCommentInput) {
      return this.renderCommentInput();
    }

    return `
      <div class="diff-line-actions">
        <button class="diff-action-btn comment-btn" title="Add comment">
          💬
        </button>
        <button class="diff-action-btn suggest-btn" title="Suggest edit">
          ✏️
        </button>
      </div>
    `;
  }

  private renderCommentInput(): string {
    return `
      <div class="diff-comment-input">
        <textarea
          class="diff-comment-textarea"
          placeholder="Add a comment on this line..."
          rows="2"
        >${this.state.commentText}</textarea>
        <div class="diff-comment-actions">
          <button class="diff-comment-cancel">Cancel</button>
          <button class="diff-comment-submit">Send</button>
        </div>
      </div>
    `;
  }

  afterRender(): void {
    // Comment button
    this.container.querySelector(".comment-btn")?.addEventListener("click", () => {
      this.setState({ showCommentInput: true });
    });

    // Suggest edit button
    this.container.querySelector(".suggest-btn")?.addEventListener("click", () => {
      this.onSuggestEdit(this.state.filename, this.state.lineNumber, this.state.lineNumber);
    });

    // Comment input
    const textarea = this.container.querySelector(".diff-comment-textarea") as HTMLTextAreaElement;
    if (textarea) {
      textarea.focus();
      textarea.addEventListener("input", () => {
        this.state.commentText = textarea.value;
      });
      textarea.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          this.submitComment();
        }
        if (e.key === "Escape") {
          this.setState({ showCommentInput: false, commentText: "" });
        }
      });
    }

    // Cancel button
    this.container.querySelector(".diff-comment-cancel")?.addEventListener("click", () => {
      this.setState({ showCommentInput: false, commentText: "" });
    });

    // Submit button
    this.container.querySelector(".diff-comment-submit")?.addEventListener("click", () => {
      this.submitComment();
    });
  }

  private submitComment(): void {
    const { filename, lineNumber, commentText } = this.state;
    if (!commentText.trim()) return;

    this.onComment(filename, lineNumber, commentText.trim());
    this.setState({ showCommentInput: false, commentText: "" });
  }
}
```

### 2. Diff Panel Integration

Update diff panel to show line actions on hover.

**File:** `src/components/DiffPanel.ts` (updates)

```typescript
// Add to DiffPanel state
interface DiffPanelState {
  // ... existing
  isInteractive: boolean;
  canComment: boolean;
  hoveredLine: { file: string; line: number } | null;
  activeCommentLine: { file: string; line: number } | null;
  pendingComments: Map<string, { status: "pending" | "approved" | "rejected" }>;
}

// Add methods
setInteractive(interactive: boolean, canComment: boolean): void {
  this.setState({ isInteractive: interactive, canComment });
}

// Update line rendering to include action buttons
private renderDiffLine(file: string, line: DiffLine, lineNum: number): string {
  const { isInteractive, canComment, hoveredLine, activeCommentLine } = this.state;
  const isHovered = hoveredLine?.file === file && hoveredLine?.line === lineNum;
  const hasActiveComment = activeCommentLine?.file === file && activeCommentLine?.line === lineNum;
  const showActions = isInteractive && canComment && (isHovered || hasActiveComment) && line.type !== "context";

  return `
    <div
      class="diff-line ${line.type}"
      data-file="${file}"
      data-line="${lineNum}"
    >
      <span class="diff-line-number">${lineNum}</span>
      <span class="diff-line-content">${escapeHtml(line.content)}</span>
      ${showActions ? `
        <div class="diff-line-actions-container" data-file="${file}" data-line="${lineNum}">
          ${hasActiveComment ? this.renderInlineComment(file, lineNum) : this.renderActionButtons()}
        </div>
      ` : ""}
    </div>
  `;
}

private renderActionButtons(): string {
  return `
    <div class="diff-line-actions">
      <button class="diff-action-btn comment-btn" title="Add comment (c)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
      </button>
      <button class="diff-action-btn suggest-btn" title="Suggest edit (e)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      </button>
    </div>
  `;
}

private renderInlineComment(file: string, line: number): string {
  return `
    <div class="diff-inline-comment">
      <textarea
        class="diff-comment-textarea"
        placeholder="Add feedback on this line..."
        rows="2"
        autofocus
      ></textarea>
      <div class="diff-comment-footer">
        <span class="diff-comment-hint">⌘Enter to send, Esc to cancel</span>
        <div class="diff-comment-buttons">
          <button class="diff-comment-cancel">Cancel</button>
          <button class="diff-comment-submit">Send</button>
        </div>
      </div>
    </div>
  `;
}

// Add event handlers
afterRender(): void {
  // ... existing

  // Track hover for showing actions
  this.container.querySelectorAll(".diff-line").forEach(el => {
    el.addEventListener("mouseenter", () => {
      const file = el.getAttribute("data-file");
      const line = parseInt(el.getAttribute("data-line") || "0", 10);
      if (file && line) {
        this.setState({ hoveredLine: { file, line } });
      }
    });
    el.addEventListener("mouseleave", () => {
      // Only clear if not active comment line
      if (!this.state.activeCommentLine) {
        this.setState({ hoveredLine: null });
      }
    });
  });

  // Comment button clicks
  this.container.querySelectorAll(".comment-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const container = (e.target as HTMLElement).closest("[data-file]");
      const file = container?.getAttribute("data-file");
      const line = parseInt(container?.getAttribute("data-line") || "0", 10);
      if (file && line) {
        this.setState({ activeCommentLine: { file, line } });
      }
    });
  });

  // Suggest edit button clicks
  this.container.querySelectorAll(".suggest-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const container = (e.target as HTMLElement).closest("[data-file]");
      const file = container?.getAttribute("data-file");
      const line = parseInt(container?.getAttribute("data-line") || "0", 10);
      if (file && line) {
        this.openSuggestEditModal(file, line);
      }
    });
  });

  // Comment input handlers
  this.setupCommentInputHandlers();
}

private setupCommentInputHandlers(): void {
  const textarea = this.container.querySelector(".diff-comment-textarea") as HTMLTextAreaElement;
  if (!textarea) return;

  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      this.submitComment(textarea.value);
    }
    if (e.key === "Escape") {
      this.setState({ activeCommentLine: null });
    }
  });

  this.container.querySelector(".diff-comment-cancel")?.addEventListener("click", () => {
    this.setState({ activeCommentLine: null });
  });

  this.container.querySelector(".diff-comment-submit")?.addEventListener("click", () => {
    this.submitComment(textarea.value);
  });
}

private submitComment(content: string): void {
  const { activeCommentLine } = this.state;
  if (!activeCommentLine || !content.trim()) return;

  this.onDiffComment?.(activeCommentLine.file, activeCommentLine.line, content.trim());
  this.setState({ activeCommentLine: null });
}
```

### 3. Suggested Edit Modal

Modal for suggesting code edits with before/after view.

**File:** `src/components/SuggestEditModal.ts`

```typescript
import { Component } from "./base";

export interface SuggestEditModalState {
  isOpen: boolean;
  filename: string;
  lineStart: number;
  lineEnd: number;
  originalContent: string;
  suggestedContent: string;
}

export class SuggestEditModal extends Component<SuggestEditModalState> {
  private onSubmit: (file: string, oldContent: string, newContent: string) => void;
  private onClose: () => void;

  constructor(
    container: HTMLElement,
    onSubmit: (file: string, oldContent: string, newContent: string) => void,
    onClose: () => void
  ) {
    super(container);
    this.onSubmit = onSubmit;
    this.onClose = onClose;
    this.state = {
      isOpen: false,
      filename: "",
      lineStart: 0,
      lineEnd: 0,
      originalContent: "",
      suggestedContent: "",
    };
  }

  render(): string {
    if (!this.state.isOpen) return "";

    const { filename, lineStart, lineEnd, originalContent, suggestedContent } = this.state;
    const lineRange = lineStart === lineEnd ? `line ${lineStart}` : `lines ${lineStart}-${lineEnd}`;

    return `
      <div class="modal-overlay">
        <div class="suggest-edit-modal">
          <div class="modal-header">
            <h3>Suggest an edit to ${filename}:${lineRange}</h3>
            <button class="modal-close">&times;</button>
          </div>
          <div class="modal-body">
            <div class="edit-section">
              <label>Current code:</label>
              <pre class="code-preview original">${escapeHtml(originalContent)}</pre>
            </div>
            <div class="edit-section">
              <label>Your suggested change:</label>
              <textarea
                class="suggested-content"
                rows="8"
                placeholder="Enter your suggested code..."
              >${suggestedContent}</textarea>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn-cancel">Cancel</button>
            <button class="btn-submit">Send Suggestion</button>
          </div>
        </div>
      </div>
    `;
  }

  afterRender(): void {
    if (!this.state.isOpen) return;

    // Close button
    this.container.querySelector(".modal-close")?.addEventListener("click", () => {
      this.close();
    });

    // Cancel button
    this.container.querySelector(".btn-cancel")?.addEventListener("click", () => {
      this.close();
    });

    // Submit button
    this.container.querySelector(".btn-submit")?.addEventListener("click", () => {
      this.submit();
    });

    // Textarea
    const textarea = this.container.querySelector(".suggested-content") as HTMLTextAreaElement;
    if (textarea) {
      textarea.focus();
      textarea.addEventListener("input", () => {
        this.state.suggestedContent = textarea.value;
      });
      textarea.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          this.close();
        }
      });
    }

    // Overlay click
    this.container.querySelector(".modal-overlay")?.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).classList.contains("modal-overlay")) {
        this.close();
      }
    });
  }

  open(filename: string, lineStart: number, lineEnd: number, originalContent: string): void {
    this.setState({
      isOpen: true,
      filename,
      lineStart,
      lineEnd,
      originalContent,
      suggestedContent: originalContent, // Pre-fill with original
    });
  }

  close(): void {
    this.setState({ isOpen: false });
    this.onClose();
  }

  private submit(): void {
    const { filename, originalContent, suggestedContent } = this.state;
    if (!suggestedContent.trim() || suggestedContent === originalContent) {
      return;
    }

    this.onSubmit(filename, originalContent, suggestedContent);
    this.close();
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
```

### 4. Styles for Diff Feedback

**File:** `public/styles/diff-feedback.css`

```css
/* Diff line actions */
.diff-line {
  position: relative;
}

.diff-line-actions-container {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  padding-right: 0.5rem;
}

.diff-line-actions {
  display: flex;
  gap: 0.25rem;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 0.375rem;
  padding: 0.125rem;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.diff-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  border-radius: 0.25rem;
  cursor: pointer;
  color: var(--text-muted);
  transition: all 0.15s;
}

.diff-action-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

/* Inline comment */
.diff-inline-comment {
  position: absolute;
  top: 100%;
  left: 2rem;
  right: 1rem;
  z-index: 10;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  padding: 0.75rem;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  margin-top: 0.25rem;
}

.diff-comment-textarea {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid var(--border-color);
  border-radius: 0.375rem;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-family: inherit;
  font-size: 0.875rem;
  resize: vertical;
  min-height: 60px;
}

.diff-comment-textarea:focus {
  outline: none;
  border-color: var(--accent-blue);
}

.diff-comment-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 0.5rem;
}

.diff-comment-hint {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.diff-comment-buttons {
  display: flex;
  gap: 0.5rem;
}

.diff-comment-cancel,
.diff-comment-submit {
  padding: 0.375rem 0.75rem;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  cursor: pointer;
  transition: all 0.15s;
}

.diff-comment-cancel {
  background: transparent;
  border: 1px solid var(--border-color);
  color: var(--text-muted);
}

.diff-comment-cancel:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.diff-comment-submit {
  background: var(--accent-blue);
  border: none;
  color: white;
}

.diff-comment-submit:hover {
  background: var(--accent-blue-hover);
}

/* Pending comment indicator */
.diff-line.has-pending-comment::after {
  content: "⏳";
  position: absolute;
  right: 0.5rem;
  top: 50%;
  transform: translateY(-50%);
  font-size: 0.75rem;
}

/* Suggest edit modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.suggest-edit-modal {
  background: var(--bg-primary);
  border-radius: 0.75rem;
  width: 90%;
  max-width: 700px;
  max-height: 90vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid var(--border-color);
}

.modal-header h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
}

.modal-close {
  background: none;
  border: none;
  font-size: 1.5rem;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0;
  line-height: 1;
}

.modal-close:hover {
  color: var(--text-primary);
}

.modal-body {
  padding: 1.5rem;
  overflow-y: auto;
}

.edit-section {
  margin-bottom: 1.5rem;
}

.edit-section:last-child {
  margin-bottom: 0;
}

.edit-section label {
  display: block;
  font-size: 0.875rem;
  font-weight: 500;
  margin-bottom: 0.5rem;
  color: var(--text-muted);
}

.code-preview {
  padding: 1rem;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 0.5rem;
  font-family: monospace;
  font-size: 0.875rem;
  overflow-x: auto;
  white-space: pre;
  margin: 0;
}

.code-preview.original {
  background: var(--bg-deleted-subtle);
  border-color: var(--border-deleted);
}

.suggested-content {
  width: 100%;
  padding: 1rem;
  background: var(--bg-added-subtle);
  border: 1px solid var(--border-added);
  border-radius: 0.5rem;
  font-family: monospace;
  font-size: 0.875rem;
  resize: vertical;
  min-height: 150px;
  color: var(--text-primary);
}

.suggested-content:focus {
  outline: none;
  border-color: var(--accent-green);
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 1rem 1.5rem;
  border-top: 1px solid var(--border-color);
}

.btn-cancel,
.btn-submit {
  padding: 0.5rem 1rem;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-cancel {
  background: transparent;
  border: 1px solid var(--border-color);
  color: var(--text-muted);
}

.btn-cancel:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.btn-submit {
  background: var(--accent-green);
  border: none;
  color: white;
}

.btn-submit:hover {
  background: var(--accent-green-hover);
}
```

### 5. Keyboard Shortcuts

Add keyboard shortcuts for quick feedback actions.

**File:** `src/client/diffKeyboardShortcuts.ts`

```typescript
export function setupDiffKeyboardShortcuts(
  container: HTMLElement,
  callbacks: {
    onComment: (file: string, line: number) => void;
    onSuggestEdit: (file: string, line: number) => void;
  }
): () => void {
  let selectedLine: { file: string; line: number } | null = null;

  function handleKeyDown(e: KeyboardEvent): void {
    // Only handle when diff panel is focused and a line is selected
    if (!selectedLine) return;

    // Ignore if in input/textarea
    if (["INPUT", "TEXTAREA"].includes((e.target as HTMLElement).tagName)) {
      return;
    }

    switch (e.key.toLowerCase()) {
      case "c":
        e.preventDefault();
        callbacks.onComment(selectedLine.file, selectedLine.line);
        break;
      case "e":
        e.preventDefault();
        callbacks.onSuggestEdit(selectedLine.file, selectedLine.line);
        break;
    }
  }

  function handleClick(e: MouseEvent): void {
    const lineEl = (e.target as HTMLElement).closest(".diff-line[data-file][data-line]");
    if (lineEl) {
      const file = lineEl.getAttribute("data-file");
      const line = parseInt(lineEl.getAttribute("data-line") || "0", 10);
      if (file && line) {
        // Clear previous selection
        container.querySelector(".diff-line.selected")?.classList.remove("selected");
        lineEl.classList.add("selected");
        selectedLine = { file, line };
      }
    } else {
      selectedLine = null;
      container.querySelector(".diff-line.selected")?.classList.remove("selected");
    }
  }

  container.addEventListener("keydown", handleKeyDown);
  container.addEventListener("click", handleClick);

  // Return cleanup function
  return () => {
    container.removeEventListener("keydown", handleKeyDown);
    container.removeEventListener("click", handleClick);
  };
}
```

### 6. Integration with Session Detail

Wire up diff feedback to the session detail page.

**File:** `src/components/SessionDetail.ts` (additions)

```typescript
import { SuggestEditModal } from "./SuggestEditModal";
import { setupDiffKeyboardShortcuts } from "../client/diffKeyboardShortcuts";

// Add to SessionDetail class

private suggestEditModal: SuggestEditModal | null = null;
private cleanupKeyboardShortcuts: (() => void) | null = null;

// In initialization
private initializeDiffFeedback(): void {
  if (!this.session?.interactive) return;

  // Create modal container
  const modalContainer = document.createElement("div");
  modalContainer.id = "suggest-edit-modal-container";
  document.body.appendChild(modalContainer);

  this.suggestEditModal = new SuggestEditModal(
    modalContainer,
    (file, oldContent, newContent) => {
      this.liveManager?.sendSuggestedEdit(file, oldContent, newContent);
    },
    () => {
      // Modal closed
    }
  );

  // Set up diff panel for interactive feedback
  if (this.diffPanel) {
    this.diffPanel.setInteractive(true, this.isWrapperConnected());
    this.diffPanel.onDiffComment = (file, line, content) => {
      this.liveManager?.sendDiffComment(file, line, content);
    };
  }

  // Set up keyboard shortcuts
  const diffContainer = document.getElementById("diff-panel");
  if (diffContainer) {
    this.cleanupKeyboardShortcuts = setupDiffKeyboardShortcuts(diffContainer, {
      onComment: (file, line) => {
        // Focus the comment input for this line
        this.diffPanel?.openCommentInput(file, line);
      },
      onSuggestEdit: (file, line) => {
        this.openSuggestEditModal(file, line);
      },
    });
  }
}

private openSuggestEditModal(file: string, line: number): void {
  // Get the content of the selected line(s)
  const content = this.getLineContent(file, line);
  if (content) {
    this.suggestEditModal?.open(file, line, line, content);
  }
}

private getLineContent(file: string, line: number): string | null {
  // Get line content from diff data
  const diff = this.session?.diffs?.find(d => d.filename === file);
  if (!diff) return null;

  // Parse diff to find line content
  // This is simplified - real implementation needs proper diff parsing
  const lines = diff.content.split("\n");
  // Find the line in the diff
  // ...
  return null; // TODO: implement proper line extraction
}

// Cleanup on destroy
destroy(): void {
  this.cleanupKeyboardShortcuts?.();
  document.getElementById("suggest-edit-modal-container")?.remove();
  // ... existing cleanup
}
```

## Testing

### Manual Testing

1. Start interactive session with wrapper
2. Open in browser, navigate to diff panel
3. Hover over changed lines - action buttons should appear
4. Click comment button - inline input should open
5. Submit comment - should show pending state
6. Click suggest edit - modal should open
7. Submit edit - should send to session

### Test Scenarios

- [ ] Comment button appears on hover for added/removed lines
- [ ] Comment button does NOT appear for context lines
- [ ] Comment input opens on button click
- [ ] Comment input closes on Escape
- [ ] Comment submits on Cmd+Enter
- [ ] Comment shows pending state after submit
- [ ] Suggest edit modal opens with correct line content
- [ ] Suggest edit modal pre-fills with original content
- [ ] Keyboard shortcut 'c' opens comment input
- [ ] Keyboard shortcut 'e' opens suggest edit modal
- [ ] Actions disabled when wrapper disconnected
- [ ] Actions disabled when Claude is running

## Checklist

- [ ] Create `DiffLineActions` component
- [ ] Update `DiffPanel` with hover actions and inline comments
- [ ] Create `SuggestEditModal` component
- [ ] Create diff feedback CSS styles
- [ ] Add keyboard shortcuts for diff actions
- [ ] Integrate with `SessionDetail`
- [ ] Wire up to `LiveSessionManager` send methods
- [ ] Add pending state indicators
- [ ] Test all scenarios
