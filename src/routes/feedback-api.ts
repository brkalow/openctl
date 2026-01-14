/**
 * API endpoints for the Archive plugin to retrieve pending feedback.
 *
 * Unlike the WebSocket-based PTY wrapper approach, the plugin polls this
 * endpoint when Claude's Stop hook fires.
 */

import type { SessionRepository } from "../db/repository";

export interface PendingFeedbackResponse {
  pending: boolean;
  messages: Array<{
    id: string;
    content: string;
    type: string;
    source?: string;
    created_at: string;
    context?: {
      file: string;
      line: number;
    };
  }>;
  session_id: string;
}

/**
 * GET /api/sessions/:id/feedback/pending
 *
 * Returns pending feedback messages for a session.
 * Used by the Stop hook to check if there's feedback to inject.
 */
export function handleGetPendingFeedback(
  sessionId: string,
  repo: SessionRepository
): Response {
  const session = repo.getSession(sessionId);

  if (!session) {
    return new Response(JSON.stringify({ error: "Session not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Get pending (undelivered) feedback messages
  const pending = repo.getPendingFeedback(sessionId);

  const response: PendingFeedbackResponse = {
    pending: pending.length > 0,
    messages: pending.map((m) => ({
      id: m.id,
      content: m.content,
      type: m.type,
      source: m.source ?? undefined,
      created_at: m.created_at,
      context: m.context,
    })),
    session_id: sessionId,
  };

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * POST /api/sessions/:id/feedback/:messageId/delivered
 *
 * Mark a feedback message as delivered.
 * Called by the Stop hook after successfully injecting feedback.
 */
export function handleMarkFeedbackDelivered(
  sessionId: string,
  messageId: string,
  repo: SessionRepository
): Response {
  const session = repo.getSession(sessionId);

  if (!session) {
    return new Response(JSON.stringify({ error: "Session not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Update feedback status to delivered
  repo.updateFeedbackStatus(messageId, "delivered");

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * GET /api/sessions/by-claude-session/:claudeSessionId/feedback/pending
 *
 * Returns pending feedback messages for a session, looking up by Claude session ID.
 * This allows the plugin to find the Archive session without needing the Archive
 * session ID to be set as an environment variable.
 */
export function handleGetPendingFeedbackByClaudeSession(
  claudeSessionId: string,
  repo: SessionRepository
): Response {
  // Look up session by Claude session ID
  const session = repo.getSessionByClaudeSessionId(claudeSessionId);

  if (!session) {
    return new Response(
      JSON.stringify({ error: "Session not found for claude_session_id" }),
      {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // Get pending (undelivered) feedback messages
  const pending = repo.getPendingFeedback(session.id);

  const response: PendingFeedbackResponse = {
    pending: pending.length > 0,
    messages: pending.map((m) => ({
      id: m.id,
      content: m.content,
      type: m.type,
      source: m.source ?? undefined,
      created_at: m.created_at,
      context: m.context,
    })),
    session_id: session.id, // Return Archive session ID for marking delivered
  };

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * POST /api/sessions/by-claude-session/:claudeSessionId/interactive
 *
 * Mark a session as interactive (accepts browser feedback).
 * Called by the SessionStart hook when the plugin is loaded.
 */
export function handleMarkSessionInteractive(
  claudeSessionId: string,
  repo: SessionRepository
): Response {
  // Look up session by Claude session ID
  const session = repo.getSessionByClaudeSessionId(claudeSessionId);

  if (!session) {
    return new Response(
      JSON.stringify({ error: "Session not found for claude_session_id" }),
      {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // Mark session as interactive
  repo.setSessionInteractive(session.id, true);

  return new Response(
    JSON.stringify({ success: true, session_id: session.id }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}
