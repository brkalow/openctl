/**
 * Mock server for testing the wrapper's remote message injection.
 *
 * Usage:
 *   1. Run this: bun tests/wrapper/mock-server.ts
 *   2. In another terminal: bun cli/index.ts start --server http://localhost:4567 -- claude
 *   3. The mock server will send a test message after 5 seconds
 */

const sessions = new Map<string, WebSocket>();

const server = Bun.serve({
  port: 4567,
  async fetch(req) {
    const url = new URL(req.url);

    // Create live session endpoint
    if (url.pathname === "/api/sessions/live" && req.method === "POST") {
      const sessionId = `test_${Date.now()}`;
      const streamToken = "test_token";

      console.log(`[Mock] Created session: ${sessionId}`);

      return Response.json({
        id: sessionId,
        stream_token: streamToken,
        url: `http://localhost:4567/sessions/${sessionId}`,
      });
    }

    // WebSocket upgrade for wrapper connection
    const wrapperMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/wrapper$/);
    if (wrapperMatch && server.upgrade(req, { data: { sessionId: wrapperMatch[1] } })) {
      return;
    }

    return new Response("Not found", { status: 404 });
  },

  websocket: {
    open(ws) {
      const { sessionId } = ws.data as { sessionId: string };
      console.log(`[Mock] Wrapper connected for session: ${sessionId}`);
      sessions.set(sessionId, ws);

      // Send a test message after 5 seconds
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          console.log(`[Mock] Sending test inject message...`);
          ws.send(JSON.stringify({
            type: "inject",
            content: "This is a test remote message! Press 'y' to approve or 'n' to reject.",
            source: "test-server",
            message_id: `msg_${Date.now()}`,
          }));
        }
      }, 5000);
    },

    message(ws, message) {
      const data = JSON.parse(message.toString());
      console.log(`[Mock] Received from wrapper:`, data);

      if (data.type === "auth") {
        console.log(`[Mock] Authenticated with token: ${data.token}`);
      } else if (data.type === "output") {
        // Just log first 100 chars of output
        const preview = data.data.slice(0, 100).replace(/\n/g, "\\n");
        console.log(`[Mock] Output: ${preview}${data.data.length > 100 ? "..." : ""}`);
      } else if (data.type === "state") {
        console.log(`[Mock] State changed to: ${data.state}`);
      } else if (data.type === "feedback_status") {
        console.log(`[Mock] Feedback ${data.message_id}: ${data.status}`);
      }
    },

    close(ws) {
      const { sessionId } = ws.data as { sessionId: string };
      console.log(`[Mock] Wrapper disconnected for session: ${sessionId}`);
      sessions.delete(sessionId);
    },
  },
});

console.log(`[Mock] Server running on http://localhost:4567`);
console.log(`[Mock] To test:`);
console.log(`  1. Keep this running`);
console.log(`  2. In another terminal: bun cli/index.ts start --server http://localhost:4567 -- claude`);
console.log(`  3. Wait 5 seconds for the test message to appear`);
console.log(`  4. Press 'y' to approve or 'n' to reject`);
