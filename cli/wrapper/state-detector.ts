/**
 * Detects when Claude is waiting for input vs actively processing.
 *
 * This is used to determine when it's safe to inject remote messages
 * and when to show approval prompts to the user.
 */

import type { WrapperState } from "./types";

// Strip ANSI escape codes for cleaner pattern matching
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "") // CSI sequences (colors, cursor)
    .replace(/\x1b\][^\x07]*\x07/g, "") // OSC sequences (title, etc)
    .replace(/\x1b\[\?[0-9;]*[a-zA-Z]/g, "") // Private mode sequences
    .replace(/\x1b>[0-9]*[a-zA-Z]/g, "") // Other escape sequences
    .replace(/[\x00-\x1f]/g, (c) => (c === "\n" || c === "\r" ? c : "")); // Control chars except newline
}

// Patterns that indicate Claude is waiting for user input
const PROMPT_PATTERNS = [
  /\? for shortcuts/, // Claude Code idle indicator
  />\s*$/, // Simple prompt
  /❯\s*$/, // Unicode prompt
  /❯ /, // Unicode prompt followed by content (Claude shows suggestions after ❯)
  />>>\s*$/, // Alternative prompt
  /\[Y\/n\]/i, // Permission prompt
  /Press Enter/i, // Confirmation prompt
  /\(y\/n\)/i, // Yes/no prompt
  /\[yes\/no\]/i, // Verbose yes/no
];

// Patterns that indicate Claude is actively processing
const RUNNING_PATTERNS = [
  /⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏/, // Spinner characters
  /Reading|Writing|Editing/, // Tool activity
  /Thinking\.\.\./, // Processing indicator
  /Working\.\.\./, // Working indicator
];

export class StateDetector {
  private buffer = "";
  private currentState: WrapperState = "running";
  private onStateChange: (state: WrapperState) => void;
  private debug: boolean;

  constructor(onStateChange: (state: WrapperState) => void, debug = false) {
    this.onStateChange = onStateChange;
    this.debug = debug;
  }

  /**
   * Process new output data and detect state changes
   */
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

  private detectState(): WrapperState {
    // Strip ANSI codes for cleaner matching
    const cleanBuffer = stripAnsi(this.buffer);
    // Get last 100 chars for prompt detection (prompts appear at end)
    const tail = cleanBuffer.slice(-100);

    if (this.debug) {
      const escapedTail = tail.replace(/\n/g, "\\n").replace(/\r/g, "\\r");
      console.error("[state-detector] tail:", JSON.stringify(escapedTail));
    }

    // Check for running patterns first (they take precedence)
    for (const pattern of RUNNING_PATTERNS) {
      if (pattern.test(cleanBuffer)) {
        return "running";
      }
    }

    // Check for prompt patterns (waiting state)
    for (const pattern of PROMPT_PATTERNS) {
      if (pattern.test(tail)) {
        if (this.debug) {
          console.error("[state-detector] matched prompt pattern:", pattern);
        }
        return "waiting";
      }
    }

    return this.currentState;
  }

  /**
   * Get the current detected state
   */
  getState(): WrapperState {
    return this.currentState;
  }

  /**
   * Reset the detector state
   */
  reset(): void {
    this.buffer = "";
    this.currentState = "running";
  }
}
