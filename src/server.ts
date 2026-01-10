import { initializeDatabase } from "./db/schema";
import { SessionRepository } from "./db/repository";
import { createApiRoutes } from "./routes/api";
import { sessionListPage } from "./views/sessionList";
import { sessionDetailPage } from "./views/sessionDetail";
import { join } from "path";

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
const HOST = process.env.HOST || "localhost";

// Initialize database and repository
const db = initializeDatabase();
const repo = new SessionRepository(db);
const api = createApiRoutes(repo);

// Static file serving
async function serveStatic(pathname: string): Promise<Response | null> {
  const publicDir = join(import.meta.dir, "public");
  const filePath = join(publicDir, pathname);

  try {
    const file = Bun.file(filePath);
    if (await file.exists()) {
      const contentType = getContentType(pathname);
      return new Response(file, {
        headers: { "Content-Type": contentType },
      });
    }
  } catch {
    // File not found
  }

  return null;
}

function getContentType(pathname: string): string {
  if (pathname.endsWith(".css")) return "text/css";
  if (pathname.endsWith(".js")) return "application/javascript";
  if (pathname.endsWith(".json")) return "application/json";
  if (pathname.endsWith(".png")) return "image/png";
  if (pathname.endsWith(".ico")) return "image/x-icon";
  return "text/plain";
}

// HTML response helper
function html(content: string): Response {
  return new Response(content, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

// 404 response
function notFound(): Response {
  return new Response("Not Found", { status: 404 });
}

// Request handler
async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pathname = url.pathname;
  const method = req.method;

  // Static files
  if (pathname.startsWith("/css/") || pathname.startsWith("/js/")) {
    const staticResponse = await serveStatic(pathname);
    if (staticResponse) return staticResponse;
  }

  // API routes
  if (pathname.startsWith("/api/")) {
    // POST /api/sessions - Create session
    if (pathname === "/api/sessions" && method === "POST") {
      return api.createSession(req);
    }

    // POST /api/sessions/:id - Update session (with _method=PUT)
    const updateMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
    if (updateMatch && method === "POST") {
      return api.updateSession(req, updateMatch[1]);
    }

    // DELETE /api/sessions/:id
    if (updateMatch && method === "DELETE") {
      return api.deleteSession(updateMatch[1]);
    }

    // POST /api/sessions/:id/share
    const shareMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/share$/);
    if (shareMatch && method === "POST") {
      return api.shareSession(shareMatch[1]);
    }

    // GET /api/sessions/:id/export
    const exportMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/export$/);
    if (exportMatch && method === "GET") {
      return api.getSessionJson(exportMatch[1]);
    }

    return notFound();
  }

  // Page routes
  // GET / - Session list
  if (pathname === "/" && method === "GET") {
    const sessions = repo.getAllSessions();
    return html(sessionListPage(sessions));
  }

  // GET /sessions/:id - Session detail
  const sessionMatch = pathname.match(/^\/sessions\/([^/]+)$/);
  if (sessionMatch && method === "GET") {
    const sessionId = sessionMatch[1];
    const session = repo.getSession(sessionId);

    if (!session) {
      return notFound();
    }

    const messages = repo.getMessages(sessionId);
    const diffs = repo.getDiffs(sessionId);

    const shareUrl = session.share_token
      ? `${url.protocol}//${url.host}/s/${session.share_token}`
      : null;

    return html(sessionDetailPage(session, messages, diffs, shareUrl));
  }

  // GET /s/:shareToken - Shared session view
  const shareMatch = pathname.match(/^\/s\/([^/]+)$/);
  if (shareMatch && method === "GET") {
    const shareToken = shareMatch[1];
    const session = repo.getSessionByShareToken(shareToken);

    if (!session) {
      return notFound();
    }

    const messages = repo.getMessages(session.id);
    const diffs = repo.getDiffs(session.id);

    const shareUrl = `${url.protocol}//${url.host}/s/${session.share_token}`;

    return html(sessionDetailPage(session, messages, diffs, shareUrl));
  }

  return notFound();
}

// Start server
const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  fetch: handleRequest,
});

console.log(`🚀 Claude Session Archive running at http://${HOST}:${server.port}`);
