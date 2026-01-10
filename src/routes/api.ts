import { SessionRepository } from "../db/repository";
import type { Message, Diff } from "../db/schema";

export function createApiRoutes(repo: SessionRepository) {
  return {
    // Create session
    async createSession(req: Request): Promise<Response> {
      try {
        const formData = await req.formData();

        const title = formData.get("title") as string;
        if (!title) {
          return new Response(JSON.stringify({ error: "Title is required" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const id = generateId();
        const session = repo.createSession({
          id,
          title,
          description: (formData.get("description") as string) || null,
          claude_session_id: (formData.get("claude_session_id") as string) || null,
          pr_url: (formData.get("pr_url") as string) || null,
          share_token: null,
          project_path: (formData.get("project_path") as string) || null,
        });

        // Process session data
        const sessionFile = formData.get("session_file") as File | null;
        const sessionData = formData.get("session_data") as string;

        let messages: Omit<Message, "id">[] = [];

        if (sessionFile && sessionFile.size > 0) {
          const content = await sessionFile.text();
          messages = parseSessionData(content, id);
        } else if (sessionData) {
          messages = parseSessionData(sessionData, id);
        }

        if (messages.length > 0) {
          repo.addMessages(messages);
        }

        // Process diff data
        const diffFile = formData.get("diff_file") as File | null;
        const diffData = formData.get("diff_data") as string;

        let diffs: Omit<Diff, "id">[] = [];

        if (diffFile && diffFile.size > 0) {
          const content = await diffFile.text();
          diffs = parseDiffData(content, id);
        } else if (diffData) {
          diffs = parseDiffData(diffData, id);
        }

        if (diffs.length > 0) {
          repo.addDiffs(diffs);
        }

        // Redirect to the new session
        return new Response(null, {
          status: 303,
          headers: { Location: `/sessions/${session.id}` },
        });
      } catch (error) {
        console.error("Error creating session:", error);
        return new Response(JSON.stringify({ error: "Failed to create session" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    },

    // Update session
    async updateSession(req: Request, sessionId: string): Promise<Response> {
      try {
        const existing = repo.getSession(sessionId);
        if (!existing) {
          return new Response(JSON.stringify({ error: "Session not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          });
        }

        const formData = await req.formData();

        const title = formData.get("title") as string;
        if (!title) {
          return new Response(JSON.stringify({ error: "Title is required" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        repo.updateSession(sessionId, {
          title,
          description: (formData.get("description") as string) || null,
          claude_session_id: (formData.get("claude_session_id") as string) || null,
          pr_url: (formData.get("pr_url") as string) || null,
          project_path: (formData.get("project_path") as string) || null,
        });

        // Process session data
        const sessionFile = formData.get("session_file") as File | null;
        const sessionData = formData.get("session_data") as string;

        let messages: Omit<Message, "id">[] = [];

        if (sessionFile && sessionFile.size > 0) {
          const content = await sessionFile.text();
          messages = parseSessionData(content, sessionId);
        } else if (sessionData) {
          messages = parseSessionData(sessionData, sessionId);
        }

        if (messages.length > 0) {
          repo.clearMessages(sessionId);
          repo.addMessages(messages);
        }

        // Process diff data
        const diffFile = formData.get("diff_file") as File | null;
        const diffData = formData.get("diff_data") as string;

        let diffs: Omit<Diff, "id">[] = [];

        if (diffFile && diffFile.size > 0) {
          const content = await diffFile.text();
          diffs = parseDiffData(content, sessionId);
        } else if (diffData) {
          diffs = parseDiffData(diffData, sessionId);
        }

        if (diffs.length > 0) {
          repo.clearDiffs(sessionId);
          repo.addDiffs(diffs);
        }

        return new Response(null, {
          status: 303,
          headers: { Location: `/sessions/${sessionId}` },
        });
      } catch (error) {
        console.error("Error updating session:", error);
        return new Response(JSON.stringify({ error: "Failed to update session" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    },

    // Delete session
    deleteSession(sessionId: string): Response {
      const deleted = repo.deleteSession(sessionId);
      if (!deleted) {
        return new Response(JSON.stringify({ error: "Session not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },

    // Create share link
    shareSession(sessionId: string): Response {
      const session = repo.getSession(sessionId);
      if (!session) {
        return new Response(JSON.stringify({ error: "Session not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (session.share_token) {
        return new Response(JSON.stringify({ share_token: session.share_token }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      const shareToken = generateShareToken();
      repo.updateSession(sessionId, { share_token: shareToken });

      return new Response(JSON.stringify({ share_token: shareToken }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },

    // Get session as JSON (for export)
    getSessionJson(sessionId: string): Response {
      const session = repo.getSession(sessionId);
      if (!session) {
        return new Response(JSON.stringify({ error: "Session not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      const messages = repo.getMessages(sessionId);
      const diffs = repo.getDiffs(sessionId);

      return new Response(JSON.stringify({ session, messages, diffs }, null, 2), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="${session.title.replace(/[^a-zA-Z0-9]/g, "_")}.json"`,
        },
      });
    },
  };
}

function generateId(): string {
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`;
}

function generateShareToken(): string {
  return `${Math.random().toString(36).substring(2, 10)}${Math.random().toString(36).substring(2, 10)}`;
}

function parseSessionData(content: string, sessionId: string): Omit<Message, "id">[] {
  const messages: Omit<Message, "id">[] = [];

  // Try to detect if it's JSONL (Claude Code native format) or JSON array
  const trimmed = content.trim();

  if (trimmed.startsWith("[")) {
    // JSON array format
    try {
      const data = JSON.parse(trimmed);
      if (Array.isArray(data)) {
        data.forEach((item, index) => {
          const msg = extractMessage(item, sessionId, index);
          if (msg) messages.push(msg);
        });
      }
    } catch (e) {
      console.error("Failed to parse JSON:", e);
    }
  } else {
    // JSONL format (one JSON object per line)
    const lines = trimmed.split("\n");
    let messageIndex = 0;

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const item = JSON.parse(line);
        const msg = extractMessage(item, sessionId, messageIndex);
        if (msg) {
          messages.push(msg);
          messageIndex++;
        }
      } catch (e) {
        // Skip invalid lines
      }
    }
  }

  return messages;
}

function extractMessage(
  item: Record<string, unknown>,
  sessionId: string,
  index: number
): Omit<Message, "id"> | null {
  // Handle various Claude session formats
  let role: string | null = null;
  let content: string | null = null;
  let timestamp: string | null = null;

  // Direct role/content format
  if (item.role && typeof item.role === "string") {
    role = item.role === "human" ? "user" : item.role;
  }

  if (item.content) {
    if (typeof item.content === "string") {
      content = item.content;
    } else if (Array.isArray(item.content)) {
      // Handle content array format (like Claude API format)
      content = item.content
        .map((c: Record<string, unknown>) => {
          if (c.type === "text" && typeof c.text === "string") return c.text;
          if (c.type === "tool_use") return `[Tool: ${c.name}]`;
          if (c.type === "tool_result") return `[Tool Result]`;
          return "";
        })
        .filter(Boolean)
        .join("\n");
    }
  }

  // Handle message wrapper format
  if (item.message && typeof item.message === "object") {
    const msg = item.message as Record<string, unknown>;
    if (msg.role && typeof msg.role === "string") {
      role = msg.role === "human" ? "user" : msg.role;
    }
    if (msg.content) {
      if (typeof msg.content === "string") {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        content = (msg.content as Array<Record<string, unknown>>)
          .map((c) => {
            if (c.type === "text" && typeof c.text === "string") return c.text;
            return "";
          })
          .filter(Boolean)
          .join("\n");
      }
    }
  }

  // Handle type-based format
  if (item.type === "human" || item.type === "user") {
    role = "user";
    if (typeof item.text === "string") content = item.text;
  } else if (item.type === "assistant") {
    role = "assistant";
    if (typeof item.text === "string") content = item.text;
  }

  // Timestamp handling
  if (item.timestamp) {
    timestamp = String(item.timestamp);
  } else if (item.created_at) {
    timestamp = String(item.created_at);
  }

  if (role && content) {
    return {
      session_id: sessionId,
      role,
      content,
      timestamp,
      message_index: index,
    };
  }

  return null;
}

function parseDiffData(content: string, sessionId: string): Omit<Diff, "id">[] {
  const diffs: Omit<Diff, "id">[] = [];
  const trimmed = content.trim();

  if (!trimmed) return diffs;

  // Split by "diff --git" to handle multiple files
  const parts = trimmed.split(/(?=diff --git)/);

  parts.forEach((part, index) => {
    const partTrimmed = part.trim();
    if (!partTrimmed) return;

    // Extract filename from diff header
    let filename: string | null = null;
    const filenameMatch = partTrimmed.match(/diff --git a\/(.+?) b\//);
    if (filenameMatch) {
      filename = filenameMatch[1];
    } else {
      // Try to get filename from +++ line
      const plusMatch = partTrimmed.match(/\+\+\+ [ab]\/(.+)/);
      if (plusMatch) {
        filename = plusMatch[1];
      }
    }

    diffs.push({
      session_id: sessionId,
      filename,
      diff_content: partTrimmed,
      diff_index: index,
    });
  });

  // If no "diff --git" markers, treat as single diff
  if (diffs.length === 0 && trimmed) {
    diffs.push({
      session_id: sessionId,
      filename: null,
      diff_content: trimmed,
      diff_index: 0,
    });
  }

  return diffs;
}
