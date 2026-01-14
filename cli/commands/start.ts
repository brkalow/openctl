/**
 * Start an interactive Claude Code session with PTY support.
 *
 * This command spawns Claude Code (or any command) in a pseudo-terminal,
 * enabling remote feedback injection while preserving the full TUI experience.
 *
 * The server connection is optional - Claude will start immediately and
 * attempt to connect to the server in the background.
 *
 * Usage:
 *   archive start [options] -- <command> [args...]
 *   archive start -- claude
 *   archive start --title "Auth feature" -- claude "implement user auth"
 */

import { parseArgs } from "util";
import { loadConfig } from "../lib/config";
import { startWrapper } from "../wrapper";
import { getClientId } from "../lib/client-id";

function showHelp(): void {
  console.log(`
Usage: archive start [options] -- <command> [args...]

Starts an interactive Claude Code session with PTY support.
Enables remote feedback injection while preserving the TUI.

The server connection is optional - Claude starts immediately and
connects to the Archive server in the background when available.

Options:
  --server <url>       Archive server URL (default: from config)
  --title <text>       Session title
  --approval <mode>    Approval mode: ask (default), auto, reject
                       - ask: prompt user before injecting remote messages
                       - auto: automatically inject remote messages
                       - reject: ignore all remote messages
  --debug              Enable debug logging
  --help               Show this help

Examples:
  archive start -- claude
  archive start -- claude --resume abc123
  archive start --title "Auth feature" -- claude "implement user auth"
  archive start --approval auto -- claude "fix the tests"
  `);
}

export async function start(args: string[]): Promise<void> {
  // Check for help flag before processing (since it might be before or after --)
  if (args.includes("--help") || args.includes("-h")) {
    showHelp();
    return;
  }

  // Find -- separator or just use remaining args
  const dashIndex = args.indexOf("--");
  const startArgs = dashIndex >= 0 ? args.slice(0, dashIndex) : [];
  const command = dashIndex >= 0 ? args.slice(dashIndex + 1) : args;

  // Parse start args
  const { values } = parseArgs({
    args: startArgs,
    options: {
      server: { type: "string" },
      title: { type: "string" },
      approval: { type: "string" },
      debug: { type: "boolean" },
    },
    allowPositionals: false,
  });

  if (command.length === 0) {
    showHelp();
    return;
  }

  const config = loadConfig();
  const serverUrl = values.server || config.server || "http://localhost:3000";
  const approvalMode = (values.approval as "ask" | "auto" | "reject") || "ask";

  // Validate approval mode
  if (!["ask", "auto", "reject"].includes(approvalMode)) {
    console.error(`Invalid approval mode: ${approvalMode}`);
    console.error("Valid modes: ask, auto, reject");
    process.exit(1);
  }

  const cwd = process.cwd();
  const title = values.title || `Interactive: ${command.join(" ").slice(0, 50)}`;

  // Start the wrapper - it will handle server connection in the background
  const exitCode = await startWrapper({
    command,
    cwd,
    serverUrl,
    title,
    approvalMode,
    clientId: getClientId(),
    debug: values.debug,
  });

  process.exit(exitCode);
}
