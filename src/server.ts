import { initializeDatabase } from "./db/schema";
import { SessionRepository } from "./db/repository";
import { daemonConnections, type DaemonWebSocketData } from "./lib/daemon-connections";
import { spawnedSessionRegistry } from "./lib/spawned-session-registry";
import { createApiRoutes, addSessionSubscriber, removeSessionSubscriber, closeAllConnections, broadcastToSession } from "./routes/api";
import { createPageRoutes } from "./routes/pages";
import { handleBrowserMessage } from "./routes/browser-messages";
import { handleGetPendingFeedback, handleMarkFeedbackDelivered, handleGetPendingFeedbackByClaudeSession, handleMarkSessionInteractive, handleMarkSessionFinished } from "./routes/feedback-api";
import type { BrowserToServerMessage } from "./routes/websocket-types";
import type { DaemonToServerMessage } from "./types/daemon-ws";
import type { BrowserToServerMessage as SpawnedBrowserMessage } from "./types/browser-ws";
import { sessionLimitEnforcer, getLimitExceededMessage } from "./lib/session-limits";
import { sendInputLimiter, stopCleanupInterval } from "./lib/rate-limiter";
import { logSessionEnded, logPermissionDecision, logLimitExceeded, auditLogger } from "./lib/audit-log";

// Import HTML template - Bun will bundle CSS and JS referenced in this file
import homepage from "../public/index.html";

// Import install script as text
import installScript from "../install.sh" with { type: "text" };

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
const HOST = process.env.HOST || "0.0.0.0";

// Initialize database and repository
const db = initializeDatabase();
const repo = new SessionRepository(db);
const api = createApiRoutes(repo);
const pages = createPageRoutes(repo);

// WebSocket data attached to each connection
interface BrowserWebSocketData {
  type: "browser";
  sessionId: string;
}

type WebSocketData = BrowserWebSocketData | DaemonWebSocketData;

/**
 * Handle messages from daemon WebSocket connections.
 * These include connection announcements and session output.
 */
function handleDaemonMessage(
  ws: import("bun").ServerWebSocket<DaemonWebSocketData>,
  message: DaemonToServerMessage
): void {
  switch (message.type) {
    case "daemon_connected": {
      // Store the clientId in ws.data for later reference
      ws.data.clientId = message.client_id;

      daemonConnections.addDaemon(message.client_id, ws, message.capabilities);
      break;
    }

    case "session_output": {
      const session = spawnedSessionRegistry.getSession(message.session_id);
      if (!session) {
        console.warn(`[relay] Unknown session: ${message.session_id}`);
        return;
      }

      // Track output size and check limits
      const outputSize = JSON.stringify(message.messages).length;
      const limitCheck = sessionLimitEnforcer.recordOutput(message.session_id, outputSize);

      if (limitCheck.exceeded) {
        // Log the limit exceeded
        logLimitExceeded(message.session_id, limitCheck.exceeded);

        // End the session due to limit
        daemonConnections.sendToDaemon(session.daemonClientId, {
          type: "end_session",
          session_id: message.session_id,
        });

        broadcastToSession(message.session_id, {
          type: "limit_exceeded",
          limit: limitCheck.exceeded,
          message: getLimitExceededMessage(limitCheck.exceeded),
        });

        console.log(`[limits] Ending session ${message.session_id} due to ${limitCheck.exceeded}`);
        return;
      }

      // Update session status based on messages
      for (const msg of message.messages) {
        if (msg.type === "system" && msg.subtype === "init" && msg.session_id) {
          // Start tracking limits when session initializes
          sessionLimitEnforcer.startTracking(message.session_id);
          spawnedSessionRegistry.updateSession(message.session_id, {
            claudeSessionId: msg.session_id,
            status: "running",
          });
        }
        if (msg.type === "result") {
          spawnedSessionRegistry.updateSession(message.session_id, {
            status: "waiting",
          });
        }
        if (msg.type === "assistant") {
          spawnedSessionRegistry.updateSession(message.session_id, {
            status: "running",
          });
        }
      }

      // Broadcast to browser WebSocket subscribers
      broadcastToSession(message.session_id, {
        type: "message",
        messages: message.messages,
      });
      break;
    }

    case "session_ended": {
      spawnedSessionRegistry.updateSession(message.session_id, {
        status: "ended",
        endedAt: new Date(),
        exitCode: message.exit_code,
        error: message.error,
      });

      // Stop tracking limits
      sessionLimitEnforcer.stopTracking(message.session_id);

      // Log session end for audit
      logSessionEnded(
        message.session_id,
        message.reason || "completed",
        message.exit_code
      );

      // Unregister from daemon
      const clientId = ws.data.clientId;
      if (clientId) {
        daemonConnections.unregisterSpawnedSession(clientId, message.session_id);
      }

      // Broadcast to browsers
      broadcastToSession(message.session_id, {
        type: "complete",
        exit_code: message.exit_code,
        reason: message.reason,
        error: message.error,
      });
      break;
    }

    case "question_prompt": {
      // Relay AskUserQuestion to browser
      broadcastToSession(message.session_id, {
        type: "question_prompt",
        tool_use_id: message.tool_use_id,
        question: message.question,
        options: message.options,
      });
      break;
    }

    case "permission_prompt": {
      // Record the pending permission request
      spawnedSessionRegistry.setPendingPermission(message.session_id, {
        id: message.request_id,
        tool: message.tool,
        description: message.description,
        details: message.details,
      });

      // Relay permission request to browser
      broadcastToSession(message.session_id, {
        type: "permission_prompt",
        request_id: message.request_id,
        tool: message.tool,
        description: message.description,
        details: message.details,
      });
      break;
    }

    default:
      console.warn("[daemon-msg] Unknown message type:", (message as { type: string }).type);
  }
}

/**
 * Handle messages from browser WebSocket connections for spawned sessions.
 * These include user input, interrupt, end session, and prompt responses.
 */
function handleSpawnedSessionMessage(
  sessionId: string,
  message: SpawnedBrowserMessage,
  sendError?: (error: { type: string; code: string; message: string }) => void
): void {
  switch (message.type) {
    case "user_message": {
      // Rate limit per session
      const rateCheck = sendInputLimiter.check(`input:${sessionId}`);
      if (!rateCheck.allowed) {
        // Send error back via WebSocket if callback provided
        if (sendError) {
          sendError({
            type: "error",
            code: "RATE_LIMITED",
            message: "Too many messages. Please wait.",
          });
        }
        return;
      }

      const session = spawnedSessionRegistry.getSession(sessionId);
      if (!session) {
        console.warn(`[ws] user_message for unknown spawned session: ${sessionId}`);
        return;
      }

      // Record activity for idle timeout
      sessionLimitEnforcer.recordActivity(sessionId);

      // Relay to daemon
      const sent = daemonConnections.sendToDaemon(session.daemonClientId, {
        type: "send_input",
        session_id: sessionId,
        content: message.content,
      });

      if (!sent) {
        console.error(`[ws] Failed to relay user_message to daemon`);
      }
      break;
    }

    case "interrupt": {
      const session = spawnedSessionRegistry.getSession(sessionId);
      if (!session) return;

      daemonConnections.sendToDaemon(session.daemonClientId, {
        type: "interrupt_session",
        session_id: sessionId,
      });
      break;
    }

    case "end_session": {
      const session = spawnedSessionRegistry.getSession(sessionId);
      if (!session) return;

      daemonConnections.sendToDaemon(session.daemonClientId, {
        type: "end_session",
        session_id: sessionId,
      });
      break;
    }

    case "question_response": {
      const session = spawnedSessionRegistry.getSession(sessionId);
      if (!session) return;

      daemonConnections.sendToDaemon(session.daemonClientId, {
        type: "question_response",
        session_id: sessionId,
        tool_use_id: message.tool_use_id,
        answer: message.answer,
      });
      break;
    }

    case "permission_response": {
      const session = spawnedSessionRegistry.getSession(sessionId);
      if (!session) return;

      // Record the permission decision
      const pendingRequest = session.pendingPermissionRequest;
      const tool = pendingRequest?.tool || "unknown";

      spawnedSessionRegistry.recordPermissionDecision(sessionId, {
        id: message.request_id,
        tool,
        description: pendingRequest?.description || "Permission decision",
        decision: message.allow ? "allowed" : "denied",
      });

      // Log permission decision for audit
      logPermissionDecision(sessionId, tool, message.allow, {
        type: "browser",
      });

      // Relay to daemon
      daemonConnections.sendToDaemon(session.daemonClientId, {
        type: "permission_response",
        session_id: sessionId,
        request_id: message.request_id,
        allow: message.allow,
      });
      break;
    }

    default:
      // Not a spawned session message, ignore
      break;
  }
}

// Start server
const server = Bun.serve({
  port: PORT,
  hostname: HOST,

  // Enable development mode for HMR and better error messages
  development: process.env.NODE_ENV !== "production",

  routes: {
    // HTML routes - all pages use the same template with client-side routing
    "/": homepage,
    "/sessions": homepage,
    "/sessions/:id": homepage,
    "/s/:shareToken": homepage,
    "/_components": homepage,

    // Server-rendered stats page
    "/stats": {
      GET: (req) => pages.statsPage(req),
    },

    // Install script for CLI setup
    "/setup/install.sh": () => new Response(installScript, {
      headers: { "Content-Type": "text/x-shellscript" },
    }),

    // API routes for data
    "/api/sessions": {
      GET: (req) => api.getSessions(req),
      POST: (req) => api.createSession(req),
    },

    "/api/sessions/:id": {
      GET: (req) => {
        const url = new URL(req.url);
        const baseUrl = `${url.protocol}//${url.host}`;
        return api.getSessionDetail(req.params.id, baseUrl);
      },
      POST: (req) => api.updateSession(req, req.params.id),
      PATCH: (req) => api.patchSession(req, req.params.id),
      DELETE: (req) => api.deleteSession(req.params.id, req),
    },

    "/api/sessions/:id/share": {
      POST: (req) => api.shareSession(req.params.id),
    },

    "/api/sessions/:id/export": {
      GET: (req) => api.getSessionJson(req.params.id),
    },

    "/api/sessions/:id/diffs": {
      GET: (req) => api.getSessionDiffs(req.params.id),
    },

    "/api/sessions/:id/annotations": {
      GET: (req) => api.getAnnotations(req.params.id),
    },

    "/api/s/:shareToken": {
      GET: (req) => {
        const url = new URL(req.url);
        const baseUrl = `${url.protocol}//${url.host}`;
        return api.getSharedSessionDetail(req.params.shareToken, baseUrl);
      },
    },

    // Live streaming endpoints
    "/api/sessions/live": {
      GET: () => api.getLiveSessions(),
      POST: (req) => api.createLiveSession(req),
    },

    "/api/sessions/:id/messages": {
      POST: (req) => api.pushMessages(req, req.params.id),
    },

    "/api/sessions/:id/tool-results": {
      POST: (req) => api.pushToolResults(req, req.params.id),
    },

    "/api/sessions/:id/diff": {
      PUT: (req) => api.updateDiff(req, req.params.id),
    },

    "/api/sessions/:id/complete": {
      POST: (req) => api.completeSession(req, req.params.id),
    },

    "/api/sessions/:id/interactive": {
      POST: (req) => api.markInteractive(req, req.params.id),
      DELETE: (req) => api.disableInteractive(req, req.params.id),
    },

    // Feedback API endpoints for plugin-based interactive sessions
    // Note: by-claude-session route must come before :id routes to avoid matching conflicts
    "/api/sessions/by-claude-session/:claudeSessionId/feedback/pending": {
      GET: (req) => handleGetPendingFeedbackByClaudeSession(req.params.claudeSessionId, repo),
    },

    "/api/sessions/by-claude-session/:claudeSessionId/interactive": {
      POST: (req) => handleMarkSessionInteractive(req.params.claudeSessionId, repo),
    },

    "/api/sessions/by-claude-session/:claudeSessionId/finished": {
      POST: (req) => handleMarkSessionFinished(req.params.claudeSessionId, repo),
    },

    "/api/sessions/:id/feedback/pending": {
      GET: (req) => handleGetPendingFeedback(req.params.id, repo),
    },

    "/api/sessions/:id/feedback/:messageId/delivered": {
      POST: (req) => handleMarkFeedbackDelivered(req.params.id, req.params.messageId, repo),
    },

    // Analytics Stats endpoints
    "/api/stats": {
      GET: (req) => api.getStats(req),
    },

    "/api/stats/timeseries": {
      GET: (req) => api.getStatsTimeseries(req),
    },

    "/api/stats/tools": {
      GET: (req) => api.getStatsTools(req),
    },

    "/api/stats/dashboard": {
      GET: (req) => api.getDashboardStats(req),
    },

    // Daemon status endpoints
    "/api/daemon/status": {
      GET: () => api.getDaemonStatus(),
    },

    "/api/daemon/repos": {
      GET: () => api.getDaemonRepos(),
    },

    "/api/daemon/list": {
      GET: () => api.listConnectedDaemons(),
    },

    // Spawned session endpoints
    "/api/sessions/spawn": {
      POST: (req) => api.spawnSession(req),
    },

    "/api/sessions/spawned": {
      GET: () => api.getSpawnedSessions(),
    },

    "/api/sessions/:id/info": {
      GET: (req) => api.getSessionInfo(req.params.id),
    },

    // Health check endpoint
    "/api/health": {
      GET: () => api.getHealth(),
    },
  },

  fetch(req, server) {
    const url = new URL(req.url);

    // Handle WebSocket upgrade for daemon connections
    if (url.pathname === "/api/daemon/ws") {
      const clientIdHeader = req.headers.get("X-Openctl-Client-ID");

      const upgraded = server.upgrade<DaemonWebSocketData>(req, {
        data: {
          type: "daemon",
          clientId: clientIdHeader || undefined,
        },
      });

      if (upgraded) {
        return undefined; // Bun handles the upgrade
      }

      return new Response("WebSocket upgrade failed", { status: 500 });
    }

    // Handle WebSocket upgrade for live session subscriptions (browser clients)
    const wsMatch = url.pathname.match(/^\/api\/sessions\/([^\/]+)\/ws$/);
    if (wsMatch) {
      const sessionId = wsMatch[1];
      const session = repo.getSession(sessionId);

      if (!session) {
        return new Response("Session not found", { status: 404 });
      }

      // Only allow WebSocket connections for live sessions
      // Once a session is complete/archived, use the regular API to fetch static data
      if (session.status !== "live") {
        return new Response("WebSocket only available for live sessions", { status: 410 });
      }

      const upgraded = server.upgrade<BrowserWebSocketData>(req, {
        data: { type: "browser", sessionId },
      });

      if (upgraded) {
        return undefined; // Bun handles the upgrade
      }

      return new Response("WebSocket upgrade failed", { status: 500 });
    }

    return new Response("Not Found", { status: 404 });
  },

  websocket: {
    open(ws) {
      const data = ws.data as WebSocketData;

      // Handle daemon connections
      if (data.type === "daemon") {
        // Daemon connections are fully handled in the message handler
        // after receiving daemon_connected message
        console.log("[ws] Daemon WebSocket opened, awaiting daemon_connected");
        return;
      }

      // Handle browser connections
      // Add to subscriber list
      addSessionSubscriber(data.sessionId, ws as unknown as WebSocket);

      // Send connected message with current state including interactive info
      const session = repo.getSession(data.sessionId);
      const messageCount = repo.getMessageCount(data.sessionId);
      const lastIndex = repo.getLastMessageIndex(data.sessionId);

      ws.send(JSON.stringify({
        type: "connected",
        session_id: data.sessionId,
        status: session?.status || "unknown",
        message_count: messageCount,
        last_index: lastIndex,
        interactive: session?.interactive ?? false,
        claude_state: "unknown" as const,
      }));
    },

    message(ws, message) {
      const data = ws.data as WebSocketData;

      try {
        const msg = JSON.parse(message.toString());

        // Handle daemon messages
        if (data.type === "daemon") {
          handleDaemonMessage(ws as unknown as import("bun").ServerWebSocket<DaemonWebSocketData>, msg as DaemonToServerMessage);
          return;
        }

        // Handle browser messages for spawned sessions
        // Check if this session is a spawned session first
        if (spawnedSessionRegistry.isSpawnedSession(data.sessionId)) {
          handleSpawnedSessionMessage(
            data.sessionId,
            msg as SpawnedBrowserMessage,
            (error) => ws.send(JSON.stringify(error))
          );
          // Also handle standard browser messages (subscribe, ping)
          if (msg.type === "subscribe" || msg.type === "ping") {
            handleBrowserMessage(
              data.sessionId,
              msg as BrowserToServerMessage,
              repo,
              (response) => ws.send(JSON.stringify(response))
            );
          }
          return;
        }

        // Handle browser messages for regular (plugin-based) sessions
        handleBrowserMessage(
          data.sessionId,
          msg as BrowserToServerMessage,
          repo,
          (response) => ws.send(JSON.stringify(response))
        );
      } catch {
        // Invalid message, ignore
      }
    },

    close(ws) {
      const data = ws.data as WebSocketData;

      // Handle daemon disconnection
      if (data.type === "daemon" && data.clientId) {
        daemonConnections.removeDaemon(data.clientId);
        return;
      }

      // Handle browser disconnection
      if (data.type === "browser") {
        removeSessionSubscriber(data.sessionId, ws as unknown as WebSocket);
      }
    },

    error(ws, error) {
      console.error("WebSocket error:", error);
      const data = ws.data as WebSocketData;

      // Handle daemon error
      if (data.type === "daemon" && data.clientId) {
        daemonConnections.removeDaemon(data.clientId);
        return;
      }

      // Handle browser error
      if (data.type === "browser") {
        removeSessionSubscriber(data.sessionId, ws as unknown as WebSocket);
      }
    },
  },
});

console.log(`openctl running at http://${HOST}:${server.port}`);

// Idle timeout checker - runs every minute
const idleTimeoutInterval = setInterval(() => {
  const idleSessions = sessionLimitEnforcer.checkAllIdleTimeouts();
  for (const sessionId of idleSessions) {
    const session = spawnedSessionRegistry.getSession(sessionId);
    if (session && session.status !== "ended" && session.status !== "failed") {
      console.log(`[limits] Ending idle session: ${sessionId}`);

      // Log the idle timeout
      logLimitExceeded(sessionId, "idle_timeout");

      // End the session
      daemonConnections.sendToDaemon(session.daemonClientId, {
        type: "end_session",
        session_id: sessionId,
      });

      // Notify browser subscribers
      broadcastToSession(sessionId, {
        type: "limit_exceeded",
        limit: "idle_timeout",
        message: getLimitExceededMessage("idle_timeout"),
      });
    }
  }
}, 60_000); // Check every minute

// Graceful shutdown handling
let isShuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (isShuttingDown) {
    console.log("Shutdown already in progress...");
    return;
  }
  isShuttingDown = true;

  console.log(`\nReceived ${signal}, shutting down gracefully...`);

  // Stop intervals
  console.log("Stopping intervals...");
  clearInterval(idleTimeoutInterval);
  stopCleanupInterval();

  // Close all WebSocket connections
  console.log("Closing WebSocket connections...");
  closeAllConnections();

  // Stop accepting new connections and close existing ones
  console.log("Stopping server...");
  server.stop();

  // Flush audit logs
  console.log("Flushing audit logs...");
  await auditLogger.close();

  // Close database connection
  console.log("Closing database...");
  db.close();

  console.log("Shutdown complete.");
  process.exit(0);
}

// Handle termination signals
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
