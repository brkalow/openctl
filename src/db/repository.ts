import { Database } from "bun:sqlite";
import type { Session, Message, Diff } from "./schema";

export class SessionRepository {
  constructor(private db: Database) {}

  createSession(session: Omit<Session, "created_at" | "updated_at">): Session {
    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, title, description, claude_session_id, pr_url, share_token, project_path)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      RETURNING *
    `);
    return stmt.get(
      session.id,
      session.title,
      session.description,
      session.claude_session_id,
      session.pr_url,
      session.share_token,
      session.project_path
    ) as Session;
  }

  updateSession(id: string, updates: Partial<Omit<Session, "id" | "created_at">>): Session | null {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.title !== undefined) {
      fields.push("title = ?");
      values.push(updates.title);
    }
    if (updates.description !== undefined) {
      fields.push("description = ?");
      values.push(updates.description);
    }
    if (updates.claude_session_id !== undefined) {
      fields.push("claude_session_id = ?");
      values.push(updates.claude_session_id);
    }
    if (updates.pr_url !== undefined) {
      fields.push("pr_url = ?");
      values.push(updates.pr_url);
    }
    if (updates.share_token !== undefined) {
      fields.push("share_token = ?");
      values.push(updates.share_token);
    }
    if (updates.project_path !== undefined) {
      fields.push("project_path = ?");
      values.push(updates.project_path);
    }

    if (fields.length === 0) return this.getSession(id);

    fields.push("updated_at = datetime('now')");
    values.push(id);

    const stmt = this.db.prepare(`
      UPDATE sessions SET ${fields.join(", ")} WHERE id = ? RETURNING *
    `);
    return stmt.get(...values) as Session | null;
  }

  getSession(id: string): Session | null {
    const stmt = this.db.prepare("SELECT * FROM sessions WHERE id = ?");
    return stmt.get(id) as Session | null;
  }

  getSessionByShareToken(token: string): Session | null {
    const stmt = this.db.prepare("SELECT * FROM sessions WHERE share_token = ?");
    return stmt.get(token) as Session | null;
  }

  getAllSessions(): Session[] {
    const stmt = this.db.prepare("SELECT * FROM sessions ORDER BY created_at DESC");
    return stmt.all() as Session[];
  }

  deleteSession(id: string): boolean {
    const stmt = this.db.prepare("DELETE FROM sessions WHERE id = ?");
    const result = stmt.run(id);
    return result.changes > 0;
  }

  addMessage(message: Omit<Message, "id">): Message {
    const stmt = this.db.prepare(`
      INSERT INTO messages (session_id, role, content, timestamp, message_index)
      VALUES (?, ?, ?, ?, ?)
      RETURNING *
    `);
    return stmt.get(
      message.session_id,
      message.role,
      message.content,
      message.timestamp,
      message.message_index
    ) as Message;
  }

  addMessages(messages: Omit<Message, "id">[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO messages (session_id, role, content, timestamp, message_index)
      VALUES (?, ?, ?, ?, ?)
    `);
    const transaction = this.db.transaction(() => {
      for (const msg of messages) {
        stmt.run(msg.session_id, msg.role, msg.content, msg.timestamp, msg.message_index);
      }
    });
    transaction();
  }

  getMessages(sessionId: string): Message[] {
    const stmt = this.db.prepare(
      "SELECT * FROM messages WHERE session_id = ? ORDER BY message_index ASC"
    );
    return stmt.all(sessionId) as Message[];
  }

  addDiff(diff: Omit<Diff, "id">): Diff {
    const stmt = this.db.prepare(`
      INSERT INTO diffs (session_id, filename, diff_content, diff_index)
      VALUES (?, ?, ?, ?)
      RETURNING *
    `);
    return stmt.get(diff.session_id, diff.filename, diff.diff_content, diff.diff_index) as Diff;
  }

  addDiffs(diffs: Omit<Diff, "id">[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO diffs (session_id, filename, diff_content, diff_index)
      VALUES (?, ?, ?, ?)
    `);
    const transaction = this.db.transaction(() => {
      for (const diff of diffs) {
        stmt.run(diff.session_id, diff.filename, diff.diff_content, diff.diff_index);
      }
    });
    transaction();
  }

  getDiffs(sessionId: string): Diff[] {
    const stmt = this.db.prepare(
      "SELECT * FROM diffs WHERE session_id = ? ORDER BY diff_index ASC"
    );
    return stmt.all(sessionId) as Diff[];
  }

  clearMessages(sessionId: string): void {
    const stmt = this.db.prepare("DELETE FROM messages WHERE session_id = ?");
    stmt.run(sessionId);
  }

  clearDiffs(sessionId: string): void {
    const stmt = this.db.prepare("DELETE FROM diffs WHERE session_id = ?");
    stmt.run(sessionId);
  }
}
