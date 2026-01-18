import { parseArgs } from "util";
import { getServerUrl, isRepoAllowed, addAllowedRepo } from "../lib/config";
import { getClientId } from "../lib/client-id";
import { getRepoIdentifier, getRepoHttpsUrl } from "../lib/git";
import { getDaemonStatus } from "../daemon";
import { ApiClient } from "../daemon/api-client";
import { getAdapterForPath } from "../adapters";
import {
  addSharedSession,
  removeSharedSession,
  findSessionByUuid,
  findLatestSessionForProject,
  extractProjectPathFromSessionPath,
} from "../lib/shared-sessions";

export async function session(args: string[]): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case "list":
      return sessionList(args.slice(1));
    case "delete":
      return sessionDelete(args.slice(1));
    case "start":
      return sessionStart(args.slice(1));
    case "share":
      return sessionShare(args.slice(1));
    case "unshare":
      return sessionUnshare(args.slice(1));
    case "feedback":
      return sessionFeedback(args.slice(1));
    default:
      showHelp();
  }
}

function showHelp(): void {
  console.log(`
Usage: openctl session <subcommand> [options]

Subcommands:
  list              List sessions on the server
  delete <id>       Delete a session
  share [id]        Share a session (defaults to latest for current project)
  unshare [id]      Stop sharing a session
  feedback [id]     Check for pending feedback (outputs JSON)

Options for 'list':
  --mine            Only show sessions uploaded by this client
  --project <path>  Filter by project path
  --limit <n>       Number of sessions to show (default: 10)
  --json            Output as JSON
  --server <url>    Server URL (default: from config)

Options for 'delete':
  --force           Skip confirmation prompt
  --server <url>    Server URL (default: from config)

Options for 'share':
  --server <url>    Server URL (default: from config)

Options for 'unshare':
  --server <url>    Server URL to unshare from (default: all servers)

Options for 'feedback':
  --server <url>    Server URL (default: from config)
  Output: {} if no feedback, or {decision:"block",reason:"..."} if pending

Examples:
  openctl session list              # List recent sessions
  openctl session list --mine       # List only my sessions
  openctl session delete abc123     # Delete a session
  openctl session share             # Share current session (uses CLAUDE_SESSION_ID)
  openctl session share abc-123     # Share a specific session by UUID
  openctl session unshare abc-123   # Stop sharing a session
  `);
}

interface SessionResponse {
  id: string;
  title: string;
  created_at: string;
  project_path: string | null;
  status: string;
}

async function sessionList(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      mine: { type: "boolean" },
      project: { type: "string" },
      limit: { type: "string" },
      json: { type: "boolean" },
      server: { type: "string" },
    },
  });

  const serverUrl = getServerUrl(values.server);

  // Build query string
  const params = new URLSearchParams();
  if (values.mine) params.set("mine", "true");
  if (values.project) params.set("project", values.project);

  const url = `${serverUrl}/api/sessions${params.toString() ? `?${params}` : ""}`;

  const response = await fetch(url, {
    headers: {
      "X-Openctl-Client-ID": getClientId(),
    },
  });

  if (!response.ok) {
    console.error(`Failed to list sessions: ${response.status}`);
    process.exit(1);
  }

  const { sessions } = (await response.json()) as { sessions: SessionResponse[] };

  // Apply limit (client-side for now since API doesn't support it)
  const limit = values.limit ? parseInt(values.limit, 10) : 10;
  const limitedSessions = sessions.slice(0, limit);

  if (values.json) {
    console.log(JSON.stringify(limitedSessions, null, 2));
  } else {
    if (limitedSessions.length === 0) {
      console.log("No sessions found.");
      return;
    }

    // Format and display sessions
    for (const s of limitedSessions) {
      const date = new Date(s.created_at).toLocaleDateString();
      const status = s.status === "live" ? " [LIVE]" : "";
      console.log(`${s.id}  ${date}  ${s.title}${status}`);
    }

    if (sessions.length > limit) {
      console.log(`\n(showing ${limit} of ${sessions.length} sessions)`);
    }
  }
}

async function sessionDelete(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      force: { type: "boolean" },
      server: { type: "string" },
    },
    allowPositionals: true,
  });

  const sessionId = positionals[0];
  if (!sessionId) {
    console.error("Error: Session ID is required");
    console.log("Usage: openctl session delete <session-id> [--force]");
    process.exit(1);
  }

  const serverUrl = getServerUrl(values.server);

  // Confirm unless --force
  if (!values.force) {
    process.stdout.write(`Delete session ${sessionId}? This cannot be undone. [y/N] `);
    const response = await readLine();
    if (response.toLowerCase() !== "y") {
      console.log("Cancelled.");
      return;
    }
  }

  const response = await fetch(`${serverUrl}/api/sessions/${sessionId}`, {
    method: "DELETE",
    headers: {
      "X-Openctl-Client-ID": getClientId(),
    },
  });

  if (response.status === 403) {
    console.error("Error: Permission denied");
    console.error("This session was uploaded from a different device.");
    process.exit(1);
  }

  if (response.status === 404) {
    console.error(`Error: Session not found`);
    console.error(`No session with ID '${sessionId}' exists on this server.`);
    process.exit(1);
  }

  if (!response.ok) {
    console.error(`Failed to delete session: ${response.status}`);
    process.exit(1);
  }

  console.log(`Session ${sessionId} deleted.`);
}

async function readLine(): Promise<string> {
  // Simple stdin reader for confirmation
  const decoder = new TextDecoder();
  const reader = Bun.stdin.stream().getReader();
  const { value } = await reader.read();
  reader.releaseLock();
  // Handle EOF (value is undefined when stdin is closed)
  if (!value) {
    return "";
  }
  return decoder.decode(value).trim();
}

async function sessionStart(_args: string[]): Promise<void> {
  console.error("Error: 'session start' is not yet implemented.");
  console.error("Use Claude Code directly and upload sessions with 'openctl upload'.");
  process.exit(1);
}

async function sessionShare(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      server: { type: "string", short: "s" },
    },
    allowPositionals: true,
  });

  // 1. Get session UUID and path
  let sessionUuid = positionals[0] || Bun.env.CLAUDE_SESSION_ID;
  let sessionPath: string | null = null;
  let projectPath: string | null = null;

  if (sessionUuid) {
    // Explicit session ID provided - find its path
    sessionPath = await findSessionByUuid(sessionUuid);
    if (!sessionPath) {
      console.error(`Error: Session not found: ${sessionUuid}`);
      process.exit(1);
    }
    projectPath = extractProjectPathFromSessionPath(sessionPath);
  } else {
    // No session ID - find latest session for current project
    const cwd = process.cwd();
    const latest = await findLatestSessionForProject(cwd);
    if (!latest) {
      console.error("Error: No session found for current project.");
      console.error("Make sure you're in a project directory with an active Claude Code session.");
      process.exit(1);
    }
    sessionUuid = latest.uuid;
    sessionPath = latest.filePath;
    projectPath = cwd;
    console.log(`Found session: ${sessionUuid.slice(0, 8)}...`);
  }

  // 2. Get server URL
  const serverUrl = getServerUrl(values.server);

  // 3. Check repo allowlist
  const repoId = await getRepoIdentifier(projectPath || process.cwd());
  if (!repoId) {
    console.error("Error: Could not determine repository identifier.");
    console.error("Make sure you're in a git repository or the session is from a git project.");
    process.exit(2);
  }

  if (!isRepoAllowed(serverUrl, repoId)) {
    // Interactive: prompt to allow
    if (process.stdin.isTTY) {
      console.log(`This repository hasn't been allowed for sharing with ${serverUrl}.`);
      process.stdout.write("Allow this repository? [y/N] ");
      const response = await readLine();
      if (response.toLowerCase() === "y") {
        addAllowedRepo(serverUrl, repoId);
        console.log("Repository allowed.");
      } else {
        console.error("Aborted: Repository not allowed.");
        console.error("Run: openctl repo allow");
        process.exit(2);
      }
    } else {
      console.error("Error: Repository not allowed. Run: openctl repo allow");
      process.exit(2);
    }
  }

  // 4. Get adapter for session info
  const adapter = getAdapterForPath(sessionPath);
  if (!adapter) {
    console.error("Error: No adapter found for session file.");
    process.exit(3);
  }

  const sessionInfo = adapter.getSessionInfo(sessionPath);
  const repoUrl = await getRepoHttpsUrl(projectPath || process.cwd());

  // 5. Create session on server immediately
  console.log(`Creating session on ${serverUrl}...`);
  const api = new ApiClient(serverUrl);

  let serverSession;
  try {
    serverSession = await api.createLiveSession({
      title: "Live Session",
      project_path: sessionInfo.projectPath,
      harness_session_id: sessionInfo.harnessSessionId,
      harness: adapter.id,
      model: sessionInfo.model,
      repo_url: repoUrl ?? undefined,
    });
  } catch (err) {
    console.error(`Error: Failed to create session on server: ${err}`);
    process.exit(4);
  }

  const sessionUrl = `${serverUrl}/sessions/${serverSession.id}`;

  // 6. Add to shared sessions with server session info (for daemon to pick up)
  await addSharedSession(sessionUuid, sessionPath, serverUrl, {
    sessionId: serverSession.id,
  });

  // 7. Ensure daemon is running (for live streaming)
  const status = await getDaemonStatus();
  if (!status.running) {
    console.log("Starting daemon for live streaming...");
    await startDaemonBackground(serverUrl);
  }

  if (serverSession.resumed) {
    console.log(`Resumed existing session: ${sessionUrl}`);
  } else {
    console.log(`Session shared: ${sessionUrl}`);
  }
}

async function sessionUnshare(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      server: { type: "string", short: "s" },
    },
    allowPositionals: true,
  });

  const sessionUuid = positionals[0] || Bun.env.CLAUDE_SESSION_ID;
  if (!sessionUuid) {
    console.error("Error: Session ID required");
    process.exit(1);
  }

  const serverUrl = values.server; // undefined means all servers

  await removeSharedSession(sessionUuid, serverUrl);
  console.log(`Session unshared${serverUrl ? ` from ${serverUrl}` : ""}.`);
}

/**
 * Start daemon in background (detached process).
 */
async function startDaemonBackground(serverUrl: string): Promise<void> {
  // Find the CLI entry point
  const cliPath = new URL("../index.ts", import.meta.url).pathname;

  const proc = Bun.spawn(["bun", "run", cliPath, "daemon", "start", "--server", serverUrl], {
    stdout: "ignore",
    stderr: "ignore",
    stdin: "ignore",
  });
  proc.unref();
}

interface PendingFeedback {
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

interface PendingFeedbackResponse {
  pending: boolean;
  messages: PendingFeedback[];
  session_id: string;
}

/**
 * Check for pending feedback and output JSON for the stop hook.
 * If feedback is pending, outputs { decision: "block", reason: "..." }
 * Otherwise outputs {}
 */
async function sessionFeedback(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      server: { type: "string", short: "s" },
    },
    allowPositionals: true,
  });

  const sessionUuid = positionals[0] || Bun.env.CLAUDE_SESSION_ID;
  if (!sessionUuid) {
    // No session - allow stop
    console.log("{}");
    process.exit(0);
  }

  const serverUrl = getServerUrl(values.server);

  try {
    const url = `${serverUrl}/api/sessions/by-claude-session/${encodeURIComponent(sessionUuid)}/feedback/pending`;
    const response = await fetch(url);

    if (!response.ok) {
      // Session not found or error - allow stop
      console.log("{}");
      process.exit(0);
    }

    const data = (await response.json()) as PendingFeedbackResponse;

    if (!data.pending || data.messages.length === 0) {
      console.log("{}");
      process.exit(0);
    }

    // Format feedback messages
    const reason = formatBatchedFeedback(data.messages);

    // Mark all as delivered (errors are non-critical)
    await Promise.all(
      data.messages.map((m) =>
        fetch(`${serverUrl}/api/sessions/${data.session_id}/feedback/${m.id}/delivered`, {
          method: "POST",
        }).catch(() => {
          // Ignore errors - feedback was already formatted for delivery
        })
      )
    );

    // Output blocking response
    console.log(JSON.stringify({ decision: "block", reason }));
  } catch {
    // Network error - allow stop
    console.log("{}");
    process.exit(0);
  }
}

/**
 * Format multiple feedback messages into a single batched message.
 */
function formatBatchedFeedback(messages: PendingFeedback[]): string {
  if (messages.length === 1) {
    return formatSingleFeedback(messages[0]!);
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
