import { describe, test, expect, beforeEach, mock } from "bun:test";
import { SpawnedSessionManager } from "../../cli/lib/spawned-session-manager";
import type {
  DaemonToServerMessage,
  StartSessionMessage,
} from "../../cli/types/daemon-ws";
import { mkdtempSync, rmdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("SpawnedSessionManager", () => {
  let manager: SpawnedSessionManager;
  let sentMessages: DaemonToServerMessage[];
  let tempDir: string;

  beforeEach(() => {
    sentMessages = [];
    manager = new SpawnedSessionManager((msg) => {
      sentMessages.push(msg);
    });
    // Create a temp directory for testing
    tempDir = mkdtempSync(join(tmpdir(), "spawner-test-"));
  });

  describe("validateWorkingDirectory", () => {
    test("rejects invalid working directory", async () => {
      const request: StartSessionMessage = {
        type: "start_session",
        session_id: "test-123",
        prompt: "Test prompt",
        cwd: "/nonexistent/path/that/does/not/exist",
      };

      await manager.startSession(request);

      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].type).toBe("session_ended");
      const msg = sentMessages[0] as {
        type: "session_ended";
        error?: string;
        exit_code: number;
      };
      expect(msg.error).toContain("Invalid working directory");
      expect(msg.exit_code).toBe(1);
    });

    test("accepts valid working directory", async () => {
      // The manager will try to spawn claude, which may fail if not installed
      // But it should not fail validation
      const request: StartSessionMessage = {
        type: "start_session",
        session_id: "test-valid-dir",
        prompt: "Test prompt",
        cwd: tempDir,
      };

      await manager.startSession(request);

      // If claude is installed, it will start; if not, we get an error
      // Either way, we should NOT get "Invalid working directory" error
      const endMsg = sentMessages.find((m) => m.type === "session_ended") as
        | { type: "session_ended"; error?: string }
        | undefined;

      if (endMsg?.error) {
        expect(endMsg.error).not.toContain("Invalid working directory");
      }
    });
  });

  describe("buildClaudeArgs", () => {
    test("builds correct args with minimal request", () => {
      const args = (manager as any).buildClaudeArgs({
        prompt: "Test prompt",
        cwd: "/tmp",
      });

      expect(args).toContain("-p");
      expect(args).toContain("Test prompt");
      expect(args).toContain("--output-format");
      expect(args).toContain("stream-json");
      expect(args).toContain("--input-format");
      expect(args).toContain("stream-json");
      expect(args).toContain("--verbose");
    });

    test("builds correct args with model", () => {
      const args = (manager as any).buildClaudeArgs({
        prompt: "Test prompt",
        cwd: "/tmp",
        model: "claude-sonnet-4-20250514",
      });

      expect(args).toContain("--model");
      expect(args).toContain("claude-sonnet-4-20250514");
    });

    test("builds correct args with resume session", () => {
      const args = (manager as any).buildClaudeArgs({
        prompt: "Test prompt",
        cwd: "/tmp",
        resume_session_id: "prev-session-123",
      });

      expect(args).toContain("--resume");
      expect(args).toContain("prev-session-123");
    });

    test("builds correct args with permission_mode relay", () => {
      const args = (manager as any).buildClaudeArgs({
        prompt: "Test prompt",
        cwd: "/tmp",
        permission_mode: "relay",
      });

      expect(args).toContain("--permission-prompt-tool");
      expect(args).toContain("stdio");
    });

    test("builds correct args with permission_mode auto", () => {
      const args = (manager as any).buildClaudeArgs({
        prompt: "Test prompt",
        cwd: "/tmp",
        permission_mode: "auto",
      });

      expect(args).toContain("--dangerously-skip-permissions");
    });

    test("builds correct args with permission_mode auto-safe", () => {
      const args = (manager as any).buildClaudeArgs({
        prompt: "Test prompt",
        cwd: "/tmp",
        permission_mode: "auto-safe",
      });

      // auto-safe uses stdio permission tool like relay
      expect(args).toContain("--permission-prompt-tool");
      expect(args).toContain("stdio");
      expect(args).not.toContain("--dangerously-skip-permissions");
    });

    test("builds correct args with no permission_mode (no flag)", () => {
      const args = (manager as any).buildClaudeArgs({
        prompt: "Test prompt",
        cwd: "/tmp",
      });

      expect(args).not.toContain("--permission-prompt-tool");
      expect(args).not.toContain("--dangerously-skip-permissions");
    });
  });

  describe("session management", () => {
    test("getActiveSessions returns empty array when no sessions", () => {
      expect(manager.getActiveSessions()).toEqual([]);
    });

    test("getAllSessionInfo returns empty array when no sessions", () => {
      expect(manager.getAllSessionInfo()).toEqual([]);
    });

    test("getSession returns undefined for nonexistent session", () => {
      expect(manager.getSession("nonexistent")).toBeUndefined();
    });

    test("getSessionInfo returns undefined for nonexistent session", () => {
      expect(manager.getSessionInfo("nonexistent")).toBeUndefined();
    });

    test("getSessionHistory returns empty array for nonexistent session", () => {
      expect(manager.getSessionHistory("nonexistent")).toEqual([]);
    });
  });

  describe("sendInput", () => {
    test("sendInput logs error for nonexistent session", async () => {
      // Should not throw, just log
      await manager.sendInput("nonexistent", "test input");
      // No messages sent to server
      expect(sentMessages.length).toBe(0);
    });
  });

  describe("endSession", () => {
    test("endSession does nothing for nonexistent session", async () => {
      // Should not throw
      await manager.endSession("nonexistent");
      expect(sentMessages.length).toBe(0);
    });
  });

  describe("interruptSession", () => {
    test("interruptSession does nothing for nonexistent session", async () => {
      // Should not throw
      await manager.interruptSession("nonexistent");
      expect(sentMessages.length).toBe(0);
    });
  });

  describe("injectToolResult", () => {
    test("injectToolResult does nothing for nonexistent session", async () => {
      // Should not throw
      await manager.injectToolResult("nonexistent", "tool-123", "result");
      expect(sentMessages.length).toBe(0);
    });
  });

  describe("processStreamMessage", () => {
    test("extracts claude session ID from init message", () => {
      // Create a mock session to test message processing
      const session = {
        id: "test-session",
        claudeSessionId: undefined,
        state: "starting" as const,
        outputHistory: [] as any[],
        maxHistorySize: 1000,
      };

      // Call private method
      (manager as any).processStreamMessage(session, {
        type: "system",
        subtype: "init",
        session_id: "claude-internal-123",
      });

      expect(session.claudeSessionId).toBe("claude-internal-123");
      expect(session.state).toBe("running");
    });

    test("updates state to waiting on result message", () => {
      const session = {
        id: "test-session",
        state: "running" as const,
        outputHistory: [] as any[],
        maxHistorySize: 1000,
      };

      (manager as any).processStreamMessage(session, {
        type: "result",
        duration_ms: 1000,
      });

      expect(session.state).toBe("waiting");
    });

    test("detects AskUserQuestion tool use", () => {
      const session = {
        id: "test-session",
        state: "waiting" as const,
        pendingToolUseId: undefined,
        outputHistory: [] as any[],
        maxHistorySize: 1000,
      };

      (manager as any).processStreamMessage(session, {
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool-use-123",
              name: "AskUserQuestion",
              input: {
                question: "What color?",
                options: ["Red", "Blue", "Green"],
              },
            },
          ],
        },
      });

      expect(session.state).toBe("running");
      expect(session.pendingToolUseId).toBe("tool-use-123");

      // Check question_prompt message was sent
      expect(sentMessages.length).toBe(1);
      const msg = sentMessages[0] as {
        type: "question_prompt";
        session_id: string;
        tool_use_id: string;
        question: string;
        options?: string[];
      };
      expect(msg.type).toBe("question_prompt");
      expect(msg.session_id).toBe("test-session");
      expect(msg.tool_use_id).toBe("tool-use-123");
      expect(msg.question).toBe("What color?");
      expect(msg.options).toEqual(["Red", "Blue", "Green"]);
    });
  });

  describe("recordMessage", () => {
    test("records messages to history", () => {
      const session = {
        outputHistory: [] as any[],
        maxHistorySize: 100,
      };

      const msg = { type: "assistant", message: { role: "assistant", content: [] } };
      (manager as any).recordMessage(session, msg);

      expect(session.outputHistory.length).toBe(1);
      expect(session.outputHistory[0]).toBe(msg);
    });

    test("trims history when exceeding max size", () => {
      const session = {
        outputHistory: [] as any[],
        maxHistorySize: 3,
      };

      // Add 5 messages
      for (let i = 0; i < 5; i++) {
        (manager as any).recordMessage(session, { index: i });
      }

      // Should only keep last 3
      expect(session.outputHistory.length).toBe(3);
      expect((session.outputHistory[0] as any).index).toBe(2);
      expect((session.outputHistory[2] as any).index).toBe(4);
    });
  });
});
