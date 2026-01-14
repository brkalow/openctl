/**
 * Handles remote message approval before injection into Claude.
 *
 * When in "ask" mode, remote messages must be approved by the user
 * before they're injected into the terminal. This provides a security
 * layer to prevent unwanted input from being sent to Claude.
 */

import type { PendingMessage } from "./types";

// ANSI escape codes for styling
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const BG_BLUE = "\x1b[44m";
const WHITE = "\x1b[97m";

const BELL = "\x07";
// OSC sequence to set terminal title
const SET_TITLE = (title: string) => `\x1b]0;${title}\x07`;

/**
 * Render the approval prompt for a pending message
 * Uses terminal title + bell since TUI apps capture all screen output
 */
export function renderApprovalPrompt(msg: PendingMessage): string {
  const source = msg.source || "anonymous";
  // Bell to alert user + set terminal title to show pending message
  return `${BELL}${SET_TITLE(`📩 PENDING: ${source} - Press y/n to respond`)}`;
}

/**
 * Clear the approval prompt (restore normal title)
 */
export function clearApprovalPrompt(): string {
  return SET_TITLE("Claude Code");
}

/**
 * Manages the approval queue and handles user input for approvals
 */
export class ApprovalManager {
  private pending: PendingMessage[] = [];
  private onApprove: (msg: PendingMessage) => void;
  private onReject: (msg: PendingMessage) => void;
  private ignoreAll = false;

  constructor(onApprove: (msg: PendingMessage) => void, onReject: (msg: PendingMessage) => void) {
    this.onApprove = onApprove;
    this.onReject = onReject;
  }

  /**
   * Add a message to the pending queue
   */
  addMessage(msg: PendingMessage): void {
    if (this.ignoreAll) {
      this.onReject(msg);
      return;
    }
    this.pending.push(msg);
  }

  /**
   * Check if there are pending messages
   */
  hasPending(): boolean {
    return this.pending.length > 0;
  }

  /**
   * Get all pending messages
   */
  getPending(): PendingMessage[] {
    return [...this.pending];
  }

  /**
   * Get the oldest pending message
   */
  getOldest(): PendingMessage | undefined {
    return this.pending[0];
  }

  /**
   * Get the count of pending messages
   */
  getCount(): number {
    return this.pending.length;
  }

  /**
   * Remove a specific message by ID (used when handled externally)
   */
  removeMessage(id: string): void {
    this.pending = this.pending.filter((m) => m.id !== id);
  }

  /**
   * Handle a key press for approval decisions
   */
  handleKey(key: string): { handled: boolean; output?: string } {
    if (this.pending.length === 0) {
      return { handled: false };
    }

    const msg = this.pending[0];

    switch (key.toLowerCase()) {
      case "y":
        this.pending.shift();
        this.onApprove(msg);
        // Clear prompt and show brief confirmation
        return { handled: true, output: clearApprovalPrompt() };

      case "n":
        this.pending.shift();
        this.onReject(msg);
        // Clear prompt
        return { handled: true, output: clearApprovalPrompt() };

      case "v":
        // Show full message - this will mess up TUI but user requested it
        return {
          handled: true,
          output: `\n${BOLD}=== Remote message from ${msg.source} ===${RESET}\n${msg.content}\n${BOLD}=== Press y to accept, n to reject ===${RESET}\n`,
        };

      case "i":
        this.ignoreAll = true;
        // Reject all pending
        for (const m of this.pending) {
          this.onReject(m);
        }
        this.pending = [];
        return {
          handled: true,
          output: clearApprovalPrompt(),
        };

      default:
        return { handled: false };
    }
  }

  /**
   * Set whether to ignore all incoming messages
   */
  setIgnoreAll(ignore: boolean): void {
    this.ignoreAll = ignore;
  }

  /**
   * Check if ignoring all messages
   */
  isIgnoringAll(): boolean {
    return this.ignoreAll;
  }

  /**
   * Clear all pending messages (rejecting them)
   */
  clear(): void {
    for (const m of this.pending) {
      this.onReject(m);
    }
    this.pending = [];
  }
}
