import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initializeDatabase } from "../../src/db/schema";
import { SessionRepository } from "../../src/db/repository";
import { unlinkSync, existsSync } from "fs";

const TEST_DB_PATH = "data/test-upsert.db";

describe("SessionRepository upsert", () => {
  let db: Database;
  let repo: SessionRepository;

  beforeEach(() => {
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
    db = initializeDatabase(TEST_DB_PATH);
    repo = new SessionRepository(db);
  });

  afterEach(() => {
    db.close();
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
  });

  describe("getSessionByClaudeSessionId", () => {
    test("returns null when no session exists", () => {
      const result = repo.getSessionByClaudeSessionId("nonexistent-uuid");
      expect(result).toBeNull();
    });

    test("finds session by claude_session_id", () => {
      repo.createSession({
        id: "sess_123",
        title: "Test Session",
        description: null,
        claude_session_id: "uuid-12345",
        pr_url: null,
        share_token: null,
        project_path: null,
        model: null,
        harness: null,
        repo_url: null,
        status: "archived",
        last_activity_at: null,
      });

      const result = repo.getSessionByClaudeSessionId("uuid-12345");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("sess_123");
      expect(result!.claude_session_id).toBe("uuid-12345");
    });
  });

  describe("upsertSessionWithDataAndReview", () => {
    test("creates new session when claude_session_id does not exist", () => {
      const { session, isUpdate } = repo.upsertSessionWithDataAndReview(
        {
          id: "sess_new",
          title: "New Session",
          description: "A new session",
          claude_session_id: "uuid-new",
          pr_url: null,
          share_token: null,
          project_path: "/path/to/project",
          model: "claude-3",
          harness: "claude-code",
          repo_url: null,
          status: "archived",
          last_activity_at: null,
        },
        [
          {
            session_id: "sess_new",
            role: "user",
            content: "Hello",
            content_blocks: [{ type: "text", text: "Hello" }],
            timestamp: "2024-01-01T00:00:00Z",
            message_index: 0,
          },
        ],
        [],
        undefined,
        "client-123"
      );

      expect(isUpdate).toBe(false);
      expect(session.id).toBe("sess_new");
      expect(session.title).toBe("New Session");

      const messages = repo.getMessages("sess_new");
      expect(messages.length).toBe(1);
      expect(messages[0].content).toBe("Hello");
    });

    test("updates existing session when claude_session_id matches", () => {
      // First, create initial session
      repo.upsertSessionWithDataAndReview(
        {
          id: "sess_original",
          title: "Original Title",
          description: "Original description",
          claude_session_id: "uuid-existing",
          pr_url: null,
          share_token: null,
          project_path: "/original/path",
          model: "claude-2",
          harness: "claude-code",
          repo_url: null,
          status: "archived",
          last_activity_at: null,
        },
        [
          {
            session_id: "sess_original",
            role: "user",
            content: "Original message",
            content_blocks: [{ type: "text", text: "Original message" }],
            timestamp: "2024-01-01T00:00:00Z",
            message_index: 0,
          },
        ],
        [],
        undefined,
        "client-123"
      );

      // Now upsert with same claude_session_id
      const { session, isUpdate } = repo.upsertSessionWithDataAndReview(
        {
          id: "sess_should_not_be_used",
          title: "Updated Title",
          description: "Updated description",
          claude_session_id: "uuid-existing",
          pr_url: "https://github.com/pr/1",
          share_token: null,
          project_path: "/updated/path",
          model: "claude-3",
          harness: "claude-code",
          repo_url: null,
          status: "archived",
          last_activity_at: null,
        },
        [
          {
            session_id: "sess_should_not_be_used",
            role: "user",
            content: "Updated message 1",
            content_blocks: [{ type: "text", text: "Updated message 1" }],
            timestamp: "2024-01-02T00:00:00Z",
            message_index: 0,
          },
          {
            session_id: "sess_should_not_be_used",
            role: "assistant",
            content: "Updated message 2",
            content_blocks: [{ type: "text", text: "Updated message 2" }],
            timestamp: "2024-01-02T00:00:01Z",
            message_index: 1,
          },
        ],
        [],
        undefined,
        "client-123"
      );

      expect(isUpdate).toBe(true);
      // Should keep the original session ID
      expect(session.id).toBe("sess_original");
      // Should update the title and other metadata
      expect(session.title).toBe("Updated Title");
      expect(session.description).toBe("Updated description");
      expect(session.pr_url).toBe("https://github.com/pr/1");
      expect(session.project_path).toBe("/updated/path");
      expect(session.model).toBe("claude-3");

      // Should have the new messages (old ones cleared)
      const messages = repo.getMessages("sess_original");
      expect(messages.length).toBe(2);
      expect(messages[0].content).toBe("Updated message 1");
      expect(messages[1].content).toBe("Updated message 2");
    });

    test("creates new session when claude_session_id is null", () => {
      const { session, isUpdate } = repo.upsertSessionWithDataAndReview(
        {
          id: "sess_no_uuid",
          title: "No UUID Session",
          description: null,
          claude_session_id: null,
          pr_url: null,
          share_token: null,
          project_path: null,
          model: null,
          harness: null,
          repo_url: null,
          status: "archived",
          last_activity_at: null,
        },
        [],
        [],
        undefined,
        "client-123"
      );

      expect(isUpdate).toBe(false);
      expect(session.id).toBe("sess_no_uuid");
    });
  });
});
