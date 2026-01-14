# Interactive Sessions: Claude Code Plugin

> **Spec reference:** [specs/interactive_plugin.md](../specs/interactive_plugin.md)

## Overview

This plan implements a Claude Code plugin that replaces the PTY wrapper for interactive sessions. The plugin uses a Stop hook to check for pending remote feedback whenever Claude finishes a task, blocking Claude from stopping and injecting the feedback as a continuation message.

## Why Replace the PTY Wrapper?

| Aspect | PTY Wrapper | Plugin (Stop Hook) |
|--------|-------------|-------------------|
| State detection | Fragile pattern matching | Official hook event |
| Cross-platform | POSIX only | Yes |
| Claude awareness | None (terminal layer) | Full (receives message) |
| Maintenance | Output patterns may change | Stable hook API |

## Dependencies

- Existing browser feedback UI (`src/components/SessionDetail.ts`)
- Existing feedback message storage (`src/db/repository.ts`)
- Existing browser WebSocket handling (`src/routes/browser-messages.ts`)

## Goals

1. Stop hook that checks for pending feedback on the Archive server
2. Server endpoint for pending feedback retrieval
3. Session initialization that configures the hooks
4. Browser UI updates for plugin-based sessions

## Architecture

```
Browser → WebSocket → Server (stores feedback)
                         ↑
                         │ HTTP GET /api/sessions/by-claude-session/:claudeSessionId/feedback/pending
                         │
                    Stop Hook (in Claude Code)
                         │ (reads session_id from stdin, provided by Claude Code)
                         │
                         ↓ {"decision": "block", "reason": "..."}
                    Claude Code (receives feedback, continues)
```

### Session ID Inference

The plugin **infers the session ID** from Claude Code rather than requiring it as an environment variable:

1. Claude Code passes JSON to hooks via stdin, including `session_id`
2. The plugin reads this stdin input to get the Claude session ID
3. The plugin calls `/api/sessions/by-claude-session/:claudeSessionId/feedback/pending`
4. The server looks up the Archive session by `claude_session_id` field
5. Returns pending feedback with the Archive session ID for marking delivered

This means:
- `ARCHIVE_SESSION_ID` is **not required** as an env var
- Only `ARCHIVE_SERVER_URL` and `ARCHIVE_TOKEN` need to be set
- Sessions are matched by the `claude_session_id` stored when the session was created

## Directory Structure

```
plugins/claude-code/
  archive-interactive/
    hooks/
      stop.ts                # Main Stop hook script
    lib/
      api.ts                 # API client for Archive server
      config.ts              # Configuration loading
    CLAUDE.md                # Instructions for Claude
    .claude-plugin/
      manifest.json          # Plugin metadata
    package.json             # Dependencies
    tsconfig.json            # TypeScript config

src/
  routes/
    feedback-api.ts          # New: GET /api/sessions/:id/feedback/pending
    browser-messages.ts      # Update: Store feedback for plugin retrieval
```

## Tasks

### 1. Create Plugin Directory Structure

Set up the plugin package.

**File:** `plugins/claude-code/archive-interactive/package.json`

```json
{
  "name": "@archive/interactive-plugin",
  "version": "0.1.0",
  "description": "Claude Code plugin for Conductor interactive sessions",
  "main": "hooks/stop.ts",
  "scripts": {
    "build": "bun build hooks/stop.ts --outdir dist --target bun",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {},
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.0.0"
  }
}
```

**File:** `plugins/claude-code/archive-interactive/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

### 2. Create Plugin Manifest

**File:** `plugins/claude-code/archive-interactive/.claude-plugin/manifest.json`

```json
{
  "name": "Archive Interactive",
  "description": "Enables remote feedback from Conductor during Claude Code sessions",
  "version": "0.1.0",
  "hooks": {
    "Stop": [
      {
        "type": "command",
        "command": "bun ${PLUGIN_DIR}/hooks/stop.ts"
      }
    ]
  }
}
```

### 3. Create API Client

**File:** `plugins/claude-code/archive-interactive/lib/api.ts`

```typescript
export interface PendingFeedback {
  id: string;
  content: string;
  type: "message" | "diff_comment" | "suggested_edit";
  source?: string;
  created_at: string;
  context?: {
    file: string;
    line: number;
  };
}

export interface PendingFeedbackResponse {
  pending: boolean;
  messages: PendingFeedback[];
  session_id: string; // Archive session ID for marking delivered
}

/**
 * Fetch pending feedback by Claude session ID.
 * The server looks up the Archive session using claude_session_id field.
 */
export async function fetchPendingFeedbackByClaudeSession(
  serverUrl: string,
  claudeSessionId: string,
  token: string
): Promise<PendingFeedbackResponse> {
  const url = `${serverUrl}/api/sessions/by-claude-session/${encodeURIComponent(claudeSessionId)}/feedback/pending`;

  const response = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch feedback: ${response.status}`);
  }

  return response.json();
}

/**
 * Mark a feedback message as delivered.
 * Uses the Archive session ID returned from fetchPendingFeedbackByClaudeSession.
 */
export async function markFeedbackDelivered(
  serverUrl: string,
  archiveSessionId: string,
  messageId: string,
  token: string
): Promise<void> {
  const url = `${serverUrl}/api/sessions/${archiveSessionId}/feedback/${messageId}/delivered`;

  await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
}
```

### 4. Create Configuration Loader

**File:** `plugins/claude-code/archive-interactive/lib/config.ts`

```typescript
export interface ArchiveConfig {
  serverUrl: string;
  token: string;
}

export interface StopHookInput {
  session_id: string;
  transcript_path?: string;
  cwd?: string;
  hook_event_name?: string;
}

/**
 * Load Archive configuration from environment variables.
 * Note: Session ID is NOT loaded from env vars - it's read from stdin.
 */
export function loadConfig(): ArchiveConfig | null {
  const serverUrl = process.env.ARCHIVE_SERVER_URL;
  const token = process.env.ARCHIVE_TOKEN;

  if (!serverUrl || !token) {
    return null;
  }

  return { serverUrl, token };
}

/**
 * Read and parse the hook input from stdin.
 * Claude Code passes JSON to hooks via stdin containing session_id.
 */
export async function readStdinInput(): Promise<StopHookInput | null> {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const input = Buffer.concat(chunks).toString("utf-8").trim();
    if (!input) return null;
    return JSON.parse(input) as StopHookInput;
  } catch {
    return null;
  }
}
```

### 5. Create Stop Hook

The main hook that checks for pending feedback when Claude tries to stop.

**File:** `plugins/claude-code/archive-interactive/hooks/stop.ts`

```typescript
#!/usr/bin/env bun
import { loadConfig, readStdinInput } from "../lib/config";
import { fetchPendingFeedbackByClaudeSession, markFeedbackDelivered, type PendingFeedback } from "../lib/api";

interface StopHookResponse {
  decision: "block";
  reason: string;
}

const TIMEOUT_MS = 3000; // 3 second timeout

async function main(): Promise<void> {
  // Read stdin first to get Claude session ID
  const stdinInput = await readStdinInput();
  if (!stdinInput?.session_id) {
    process.exit(0); // No session ID from Claude Code
  }

  const config = loadConfig();

  // Not an Archive session (no env vars set) - allow Claude to stop
  if (!config) {
    process.exit(0);
  }

  try {
    // Fetch using Claude session ID from stdin
    const response = await Promise.race([
      fetchPendingFeedbackByClaudeSession(config.serverUrl, stdinInput.session_id, config.token),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Timeout")), TIMEOUT_MS)
      ),
    ]);

    if (!response.pending || response.messages.length === 0) {
      process.exit(0); // No pending feedback
    }

    // Batch all pending messages into a single injection
    const reason = formatBatchedFeedback(response.messages);

    // Mark all as delivered using Archive session ID from response
    await Promise.all(
      response.messages.map((m) =>
        markFeedbackDelivered(config.serverUrl, response.session_id, m.id, config.token)
      )
    );

    // Block Claude from stopping and inject the feedback
    const output: StopHookResponse = {
      decision: "block",
      reason,
    };

    console.error(JSON.stringify(output));
    process.exit(2); // Exit code 2 = block
  } catch {
    // Network error, timeout, or server unavailable
    process.exit(0);
  }
}

/**
 * Format multiple feedback messages into a single batched message.
 */
function formatBatchedFeedback(messages: PendingFeedback[]): string {
  if (messages.length === 1) {
    return formatSingleFeedback(messages[0]);
  }

  const header = `[${messages.length} remote feedback messages]`;
  const formatted = messages.map((m, i) => {
    const num = i + 1;
    return `--- Feedback ${num} ---\n${formatSingleFeedback(m)}`;
  });

  return `${header}\n\n${formatted.join("\n\n")}\n\nPlease address all feedback above.`;
}

/**
 * Format a single feedback message.
 */
function formatSingleFeedback(feedback: PendingFeedback): string {
  if (feedback.type === "diff_comment" && feedback.context) {
    return `[Feedback on ${feedback.context.file}:${feedback.context.line}]

${feedback.content}`;
  }

  if (feedback.type === "suggested_edit" && feedback.context) {
    return `[Suggested edit for ${feedback.context.file}]

${feedback.content}`;
  }

  const source = feedback.source ? ` from ${feedback.source}` : "";
  return `[Remote feedback${source}]

${feedback.content}`;
}

main();
```

### 6. Create CLAUDE.md Instructions

**File:** `plugins/claude-code/archive-interactive/CLAUDE.md`

```markdown
# Archive Interactive Session

This session is connected to Conductor for remote collaboration.

## Remote Feedback

Remote reviewers can send you feedback while you work. When feedback arrives, you'll receive it automatically after completing your current task.

Feedback may include:
- **User messages**: General questions or directions
- **Diff comments**: Feedback on specific lines of code you've changed
- **Suggested edits**: Proposed code changes to review

When you receive remote feedback:
1. Acknowledge it briefly
2. Address the feedback or explain why you're taking a different approach
3. Continue with your work

## Session Info

- Remote viewers can see your work in real-time
- Your responses will be visible to the team
- Be clear and explain your reasoning
```

### 7. Create Server Endpoint for Pending Feedback

**File:** `src/routes/feedback-api.ts`

```typescript
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
  repo: SessionRepository,
  authToken: string | null
): Response {
  const session = repo.getSession(sessionId);

  if (!session) {
    return new Response(JSON.stringify({ error: "Session not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Verify auth token matches session's stream token
  if (!authToken || authToken !== session.stream_token) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
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
      source: m.source,
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
  repo: SessionRepository,
  authToken: string | null
): Response {
  const session = repo.getSession(sessionId);

  if (!session) {
    return new Response(JSON.stringify({ error: "Session not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!authToken || authToken !== session.stream_token) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
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
```

### 8. Update Database Schema

Add `delivered` status to feedback messages.

**File:** `src/db/schema.ts` (additions)

```typescript
// In feedback_messages table, status enum should include:
// "pending" | "delivered" | "approved" | "rejected"
//
// "delivered" is the new status for plugin-based delivery
// (vs "approved" which was for PTY wrapper approval flow)
```

**Migration:**

```sql
-- No schema change needed if status is TEXT
-- Just need to handle new status value in code
```

### 9. Update Repository

Add methods for plugin-based feedback handling.

**File:** `src/db/repository.ts` (additions)

```typescript
/**
 * Get pending (undelivered) feedback messages for a session.
 * Orders by created_at to ensure FIFO delivery.
 */
getPendingFeedback(sessionId: string): FeedbackMessage[] {
  return this.db
    .query<FeedbackMessage, [string]>(
      `SELECT * FROM feedback_messages
       WHERE session_id = ? AND status = 'pending'
       ORDER BY created_at ASC`
    )
    .all(sessionId);
}

/**
 * Update feedback message status.
 */
updateFeedbackStatus(messageId: string, status: string): void {
  this.db.run(
    `UPDATE feedback_messages SET status = ? WHERE id = ?`,
    [status, messageId]
  );
}
```

### 10. Register New Routes

**File:** `src/routes/index.ts` (additions)

```typescript
import { handleGetPendingFeedback, handleMarkFeedbackDelivered } from "./feedback-api";

// In route handler:
if (pathname.match(/^\/api\/sessions\/[^/]+\/feedback\/pending$/)) {
  const sessionId = pathname.split("/")[3];
  const authToken = req.headers.get("Authorization")?.replace("Bearer ", "");
  return handleGetPendingFeedback(sessionId, repo, authToken);
}

if (pathname.match(/^\/api\/sessions\/[^/]+\/feedback\/[^/]+\/delivered$/)) {
  const parts = pathname.split("/");
  const sessionId = parts[3];
  const messageId = parts[5];
  const authToken = req.headers.get("Authorization")?.replace("Bearer ", "");
  return handleMarkFeedbackDelivered(sessionId, messageId, repo, authToken);
}
```

### 11. Update Browser Messages Handler

Store feedback for plugin retrieval instead of immediate WebSocket delivery.

**File:** `src/routes/browser-messages.ts` (updates)

```typescript
/**
 * Handle a user message for plugin-based sessions.
 * Instead of sending to wrapper WebSocket, just store for later retrieval.
 */
function handleUserMessageForPlugin(
  sessionId: string,
  content: string,
  repo: SessionRepository,
  sendToBrowser: (msg: ServerToBrowserMessage) => void
): void {
  const session = repo.getSession(sessionId);

  if (!session?.interactive) {
    sendToBrowser({
      type: "error",
      code: "NOT_INTERACTIVE",
      message: "This session does not accept feedback",
    });
    return;
  }

  // Check rate limit
  const rateCheck = checkRateLimit(sessionId, "message");
  if (!rateCheck.allowed) {
    sendToBrowser({
      type: "error",
      code: "RATE_LIMITED",
      message: `Rate limit exceeded. Try again in ${rateCheck.retryAfter} seconds.`,
    });
    return;
  }

  // Create feedback message record (status: pending)
  const feedback = repo.createFeedbackMessage(sessionId, content, "message");

  // Get queue position
  const pending = repo.getPendingFeedback(sessionId);
  const position = pending.findIndex((m) => m.id === feedback.id) + 1;

  // Notify browser - feedback will be delivered when Claude stops
  sendToBrowser({
    type: "feedback_queued",
    message_id: feedback.id,
    position,
    delivery_mode: "on_stop", // New field to indicate plugin-based delivery
  });

  // Note: No sendToWrapper() call - plugin will poll for this
}
```

### 12. Update Browser UI

Show appropriate status for plugin-based feedback delivery.

**File:** `src/components/SessionDetail.ts` (updates)

```typescript
// In FeedbackInput component, update the placeholder/helper text:

function getInputPlaceholder(session: Session): string {
  if (session.delivery_mode === "plugin") {
    return "Send feedback (delivered when Claude finishes current task)";
  }
  return "Send feedback to Claude...";
}

// In feedback status display:
function renderFeedbackStatus(status: FeedbackStatus): string {
  if (status.delivery_mode === "on_stop") {
    if (status.position === 1) {
      return "Will be delivered when Claude finishes current task";
    }
    return `Queued (position ${status.position}). Will be delivered when Claude finishes.`;
  }
  // Existing PTY wrapper status
  return `Queued (position ${status.position})`;
}
```

### 13. Session Initialization (Conductor-side)

How Conductor starts a Claude Code session with the plugin configured.

**Usage by Conductor:**

```typescript
// When starting a Claude Code session, Conductor should:
// 1. Create the session on Archive server with claude_session_id
// 2. Set environment variables for the plugin (server URL and token only)
// 3. Start Claude Code with the plugin installed

// Note: ARCHIVE_SESSION_ID is NOT needed - the plugin reads it from stdin
const env = {
  ARCHIVE_SERVER_URL: archiveServerUrl,
  ARCHIVE_TOKEN: streamToken,
};

// Create session with claude_session_id that matches Claude Code's session
const session = await createSession({
  title: "My Session",
  claude_session_id: claudeCodeSessionId, // From Claude Code's session
  interactive: true,
});

// Start Claude with plugin
spawn("claude", args, {
  env: { ...process.env, ...env },
  // Plugin should be pre-installed via:
  // claude /plugin install /path/to/archive-interactive
});
```

**Key point:** The `claude_session_id` field in the Archive session must match the session ID that Claude Code passes to hooks via stdin. This allows the plugin to find the correct Archive session without needing it as an environment variable.

### 14. Plugin Installation Script

**File:** `plugins/claude-code/archive-interactive/install.sh`

```bash
#!/bin/bash
# Install the Conductor interactive plugin for Claude Code

PLUGIN_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Installing Archive Interactive plugin..."

# Option 1: Via plugin command (if available)
if claude /plugin install "$PLUGIN_DIR" 2>/dev/null; then
  echo "Plugin installed via Claude Code plugin system"
  exit 0
fi

# Option 2: Direct hook installation in settings
# This is the workaround for the known bug with plugins + exit code 2
SETTINGS_FILE="$HOME/.claude/settings.json"

if [ ! -f "$SETTINGS_FILE" ]; then
  echo '{}' > "$SETTINGS_FILE"
fi

# Use jq to add hooks if available, otherwise manual instructions
if command -v jq &>/dev/null; then
  jq --arg dir "$PLUGIN_DIR" '.hooks.Stop = [{"hooks": [{"type": "command", "command": "bun run " + $dir + "/hooks/stop.ts"}]}]' "$SETTINGS_FILE" > "${SETTINGS_FILE}.tmp" && mv "${SETTINGS_FILE}.tmp" "$SETTINGS_FILE"
  echo "Plugin hooks installed in $SETTINGS_FILE"
else
  echo "Please manually add the following to $SETTINGS_FILE:"
  echo ""
  echo '  "hooks": {'
  echo '    "Stop": [{'
  echo '      "hooks": [{'
  echo '        "type": "command",'
  echo "        \"command\": \"bun run $PLUGIN_DIR/hooks/stop.ts\""
  echo '      }]'
  echo '    }]'
  echo '  }'
fi
```

## Testing

### Unit Tests

**File:** `tests/plugin/stop-hook.test.ts`

```typescript
import { describe, it, expect, mock, beforeEach } from "bun:test";

describe("Stop Hook", () => {
  beforeEach(() => {
    // Reset environment
    delete process.env.ARCHIVE_SERVER_URL;
    delete process.env.ARCHIVE_SESSION_ID;
    delete process.env.ARCHIVE_TOKEN;
  });

  it("exits 0 when not a Archive session", async () => {
    // No env vars set
    const { loadConfig } = await import("../../plugins/claude-code/archive-interactive/lib/config");
    expect(loadConfig()).toBeNull();
  });

  it("loads config from environment", async () => {
    process.env.ARCHIVE_SERVER_URL = "http://localhost:3000";
    process.env.ARCHIVE_SESSION_ID = "test-session";
    process.env.ARCHIVE_TOKEN = "test-token";

    const { loadConfig } = await import("../../plugins/claude-code/archive-interactive/lib/config");
    const config = loadConfig();

    expect(config).toEqual({
      serverUrl: "http://localhost:3000",
      sessionId: "test-session",
      token: "test-token",
    });
  });
});
```

### Integration Test

**File:** `tests/integration/plugin-feedback.test.ts`

```typescript
import { describe, it, expect, beforeAll, afterAll } from "bun:test";

describe("Plugin Feedback Flow", () => {
  let server: ReturnType<typeof Bun.serve>;
  let sessionId: string;
  let streamToken: string;

  beforeAll(async () => {
    // Start test server
    // Create interactive session
    // Get session ID and token
  });

  afterAll(() => {
    server?.stop();
  });

  it("returns pending feedback from API", async () => {
    // Send feedback via browser WebSocket
    // Call GET /api/sessions/:id/feedback/pending
    // Verify feedback is returned
  });

  it("marks feedback as delivered", async () => {
    // Send feedback
    // Call POST /api/sessions/:id/feedback/:messageId/delivered
    // Verify feedback no longer returned as pending
  });

  it("handles multiple pending messages in order", async () => {
    // Send multiple feedback messages
    // Verify they're returned in FIFO order
    // Mark first as delivered
    // Verify second is now first
  });
});
```

### Manual Testing

```bash
# 1. Start Archive server
cd /Users/bryce/conductor/workspaces/archive/houston
bun run dev

# 2. Create an interactive session
curl -X POST http://localhost:3000/api/sessions/live \
  -H "Content-Type: application/json" \
  -d '{"title": "Test Plugin Session", "interactive": true}'

# Note the session_id and stream_token from response

# 3. Set environment variables
export ARCHIVE_SERVER_URL="http://localhost:3000"
export ARCHIVE_SESSION_ID="<session_id>"
export ARCHIVE_TOKEN="<stream_token>"

# 4. Install plugin hooks
./plugins/claude-code/archive-interactive/install.sh

# 5. Start Claude Code
claude "Hello, this is a test"

# 6. In browser, open session and send feedback
# Feedback should be delivered when Claude finishes

# 7. Verify feedback appears in Claude's context
```

## Migration from PTY Wrapper

For existing deployments using the PTY wrapper:

1. **Parallel operation**: Both approaches can coexist
   - PTY wrapper checks for feedback via WebSocket
   - Plugin checks for feedback via HTTP polling

2. **Gradual migration**:
   - Add plugin support alongside wrapper
   - Sessions can indicate preferred delivery mode
   - Eventually deprecate wrapper

3. **Compatibility**:
   - Server stores feedback the same way for both
   - Only delivery mechanism differs

## Checklist

- [ ] Create `plugins/claude-code/archive-interactive/package.json`
- [ ] Create `plugins/claude-code/archive-interactive/tsconfig.json`
- [ ] Create `plugins/claude-code/archive-interactive/.claude-plugin/manifest.json`
- [ ] Create `plugins/claude-code/archive-interactive/lib/api.ts`
- [ ] Create `plugins/claude-code/archive-interactive/lib/config.ts`
- [ ] Create `plugins/claude-code/archive-interactive/hooks/stop.ts`
- [ ] Create `plugins/claude-code/archive-interactive/CLAUDE.md`
- [ ] Create `plugins/claude-code/archive-interactive/install.sh`
- [ ] Create `src/routes/feedback-api.ts`
- [ ] Update `src/db/repository.ts` with getPendingFeedback, updateFeedbackStatus
- [ ] Update `src/routes/index.ts` to register new routes
- [ ] Update `src/routes/browser-messages.ts` for plugin-based storage
- [ ] Update `src/components/SessionDetail.ts` for plugin status UI
- [ ] Add unit tests for config and API client
- [ ] Add integration tests for feedback flow
- [ ] Manual testing with real Claude Code session
- [ ] Document plugin installation for Conductor

## Design Decisions

1. **SubagentStop**: No - only handle main Stop hook
2. **Timeout**: Yes - ~3 second timeout for network requests to avoid blocking
3. **Multiple feedback**: Batch all pending messages into a single injection
4. **Plugin bug**: Test if it's actually an issue; use direct hook installation as fallback
