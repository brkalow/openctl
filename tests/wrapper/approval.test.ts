import { describe, test, expect, beforeEach } from "bun:test";
import { ApprovalManager, renderApprovalPrompt } from "../../cli/wrapper/approval";
import type { PendingMessage } from "../../cli/wrapper/types";

describe("ApprovalManager", () => {
  let approved: PendingMessage[];
  let rejected: PendingMessage[];
  let manager: ApprovalManager;

  beforeEach(() => {
    approved = [];
    rejected = [];
    manager = new ApprovalManager(
      (msg) => approved.push(msg),
      (msg) => rejected.push(msg)
    );
  });

  describe("message queue", () => {
    test("adds messages to pending queue", () => {
      const msg: PendingMessage = {
        id: "1",
        content: "test message",
        source: "user1",
        type: "message",
        receivedAt: new Date(),
      };

      manager.addMessage(msg);
      expect(manager.hasPending()).toBe(true);
      expect(manager.getCount()).toBe(1);
      expect(manager.getOldest()).toBe(msg);
    });

    test("queues multiple messages", () => {
      const msg1: PendingMessage = {
        id: "1",
        content: "first",
        source: "user1",
        type: "message",
        receivedAt: new Date(),
      };
      const msg2: PendingMessage = {
        id: "2",
        content: "second",
        source: "user2",
        type: "message",
        receivedAt: new Date(),
      };

      manager.addMessage(msg1);
      manager.addMessage(msg2);

      expect(manager.getCount()).toBe(2);
      expect(manager.getOldest()).toBe(msg1);
    });

    test("getPending returns copy of queue", () => {
      const msg: PendingMessage = {
        id: "1",
        content: "test",
        source: "user1",
        type: "message",
        receivedAt: new Date(),
      };

      manager.addMessage(msg);
      const pending = manager.getPending();

      expect(pending).toHaveLength(1);
      expect(pending[0]).toBe(msg);

      // Modifying the returned array shouldn't affect the manager
      pending.pop();
      expect(manager.getCount()).toBe(1);
    });
  });

  describe("key handling", () => {
    test("'y' approves and removes message", () => {
      const msg: PendingMessage = {
        id: "1",
        content: "test",
        source: "user1",
        type: "message",
        receivedAt: new Date(),
      };

      manager.addMessage(msg);
      const result = manager.handleKey("y");

      expect(result.handled).toBe(true);
      // Output is the clearApprovalPrompt (terminal title reset)
      expect(result.output).toContain("Claude Code");
      expect(approved).toHaveLength(1);
      expect(approved[0]).toBe(msg);
      expect(manager.hasPending()).toBe(false);
    });

    test("'Y' (uppercase) also approves", () => {
      const msg: PendingMessage = {
        id: "1",
        content: "test",
        source: "user1",
        type: "message",
        receivedAt: new Date(),
      };

      manager.addMessage(msg);
      const result = manager.handleKey("Y");

      expect(result.handled).toBe(true);
      expect(approved).toHaveLength(1);
    });

    test("'n' rejects and removes message", () => {
      const msg: PendingMessage = {
        id: "1",
        content: "test",
        source: "user1",
        type: "message",
        receivedAt: new Date(),
      };

      manager.addMessage(msg);
      const result = manager.handleKey("n");

      expect(result.handled).toBe(true);
      // Output is the clearApprovalPrompt (terminal title reset)
      expect(result.output).toContain("Claude Code");
      expect(rejected).toHaveLength(1);
      expect(rejected[0]).toBe(msg);
      expect(manager.hasPending()).toBe(false);
    });

    test("'v' shows full message without removing", () => {
      const msg: PendingMessage = {
        id: "1",
        content: "This is a very long message",
        source: "user1",
        type: "message",
        receivedAt: new Date(),
      };

      manager.addMessage(msg);
      const result = manager.handleKey("v");

      expect(result.handled).toBe(true);
      // Shows message content with source header
      expect(result.output).toContain("Remote message from user1");
      expect(result.output).toContain("This is a very long message");
      expect(manager.hasPending()).toBe(true);
      expect(approved).toHaveLength(0);
      expect(rejected).toHaveLength(0);
    });

    test("'i' rejects all pending and sets ignore mode", () => {
      const msg1: PendingMessage = {
        id: "1",
        content: "first",
        source: "user1",
        type: "message",
        receivedAt: new Date(),
      };
      const msg2: PendingMessage = {
        id: "2",
        content: "second",
        source: "user2",
        type: "message",
        receivedAt: new Date(),
      };

      manager.addMessage(msg1);
      manager.addMessage(msg2);

      const result = manager.handleKey("i");

      expect(result.handled).toBe(true);
      // Output is the clearApprovalPrompt (terminal title reset)
      expect(result.output).toContain("Claude Code");
      expect(rejected).toHaveLength(2);
      expect(manager.hasPending()).toBe(false);
      expect(manager.isIgnoringAll()).toBe(true);
    });

    test("unrecognized keys are not handled", () => {
      const msg: PendingMessage = {
        id: "1",
        content: "test",
        source: "user1",
        type: "message",
        receivedAt: new Date(),
      };

      manager.addMessage(msg);
      const result = manager.handleKey("x");

      expect(result.handled).toBe(false);
      expect(result.output).toBeUndefined();
      expect(manager.hasPending()).toBe(true);
    });

    test("returns not handled when queue is empty", () => {
      const result = manager.handleKey("y");

      expect(result.handled).toBe(false);
    });
  });

  describe("ignore all mode", () => {
    test("setIgnoreAll rejects new messages immediately", () => {
      manager.setIgnoreAll(true);

      const msg: PendingMessage = {
        id: "1",
        content: "test",
        source: "user1",
        type: "message",
        receivedAt: new Date(),
      };

      manager.addMessage(msg);

      expect(manager.hasPending()).toBe(false);
      expect(rejected).toHaveLength(1);
    });

    test("isIgnoringAll returns current mode", () => {
      expect(manager.isIgnoringAll()).toBe(false);

      manager.setIgnoreAll(true);
      expect(manager.isIgnoringAll()).toBe(true);

      manager.setIgnoreAll(false);
      expect(manager.isIgnoringAll()).toBe(false);
    });
  });

  describe("clear", () => {
    test("clears all pending messages and rejects them", () => {
      const msg1: PendingMessage = {
        id: "1",
        content: "first",
        source: "user1",
        type: "message",
        receivedAt: new Date(),
      };
      const msg2: PendingMessage = {
        id: "2",
        content: "second",
        source: "user2",
        type: "message",
        receivedAt: new Date(),
      };

      manager.addMessage(msg1);
      manager.addMessage(msg2);

      manager.clear();

      expect(manager.hasPending()).toBe(false);
      expect(rejected).toHaveLength(2);
    });
  });
});

describe("renderApprovalPrompt", () => {
  test("renders terminal title with source", () => {
    const msg: PendingMessage = {
      id: "1",
      content: "Please fix the bug",
      source: "reviewer",
      type: "message",
      receivedAt: new Date(),
    };

    const output = renderApprovalPrompt(msg);

    // Simplified format: bell + terminal title with PENDING indicator
    expect(output).toContain("PENDING");
    expect(output).toContain("reviewer");
    // Should include bell character
    expect(output).toContain("\x07");
  });

  test("includes OSC escape sequence for terminal title", () => {
    const msg: PendingMessage = {
      id: "1",
      content: "This is a very long message that should be truncated because it exceeds the maximum preview length allowed",
      source: "reviewer",
      type: "message",
      receivedAt: new Date(),
    };

    const output = renderApprovalPrompt(msg);

    // Should include OSC sequence for terminal title
    expect(output).toContain("\x1b]0;");
  });

  test("uses anonymous for missing source", () => {
    const msg: PendingMessage = {
      id: "1",
      content: "test",
      source: "",
      type: "message",
      receivedAt: new Date(),
    };

    const output = renderApprovalPrompt(msg);

    expect(output).toContain("anonymous");
  });
});
