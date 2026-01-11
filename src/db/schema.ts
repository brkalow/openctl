import { Database } from "bun:sqlite";

export function initializeDatabase(dbPath: string = "sessions.db"): Database {
  const db = new Database(dbPath);

  // Enable foreign key enforcement
  db.run("PRAGMA foreign_keys = ON");

  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      claude_session_id TEXT,
      pr_url TEXT,
      share_token TEXT UNIQUE,
      project_path TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp TEXT,
      message_index INTEGER,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS diffs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      filename TEXT,
      diff_content TEXT NOT NULL,
      diff_index INTEGER DEFAULT 0,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_diffs_session ON diffs(session_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_share_token ON sessions(share_token)`);

  return db;
}

export type Session = {
  id: string;
  title: string;
  description: string | null;
  claude_session_id: string | null;
  pr_url: string | null;
  share_token: string | null;
  project_path: string | null;
  created_at: string;
  updated_at: string;
};

export type Message = {
  id: number;
  session_id: string;
  role: string;
  content: string;
  timestamp: string | null;
  message_index: number;
};

export type Diff = {
  id: number;
  session_id: string;
  filename: string | null;
  diff_content: string;
  diff_index: number;
};
