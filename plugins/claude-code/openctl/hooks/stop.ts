#!/usr/bin/env bun
import { loadConfig, readStdinInput } from "../lib/config";
import {
  fetchPendingFeedbackByClaudeSession,
  markFeedbackDelivered,
  type PendingFeedback,
} from "../lib/api";

interface StopHookResponse {
  decision?: "block";
  reason?: string;
}

const TIMEOUT_MS = 3000;

// Log to stderr for debugging (visible in verbose mode ctrl+o)
function log(msg: string): void {
  console.error(`[openctl:stop] ${msg}`);
}

// Output JSON response to stdout and exit
function respond(response: StopHookResponse): never {
  console.log(JSON.stringify(response));
  process.exit(0);
}

async function main(): Promise<void> {
  const stdinInput = await readStdinInput();

  if (!stdinInput?.session_id) {
    log("No session_id in stdin");
    respond({});
  }

  const config = loadConfig();

  if (!config) {
    log("No OPENCTL_SERVER_URL set");
    respond({});
  }

  try {
    log(`Checking ${config.serverUrl} for session ${stdinInput.session_id.slice(0, 8)}...`);

    const response = await Promise.race([
      fetchPendingFeedbackByClaudeSession(config.serverUrl, stdinInput.session_id),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Timeout")), TIMEOUT_MS)
      ),
    ]);

    if (!response.pending || response.messages.length === 0) {
      log("No pending feedback");
      respond({});
    }

    log(`Found ${response.messages.length} pending message(s)`);

    // Batch all pending messages into a single injection
    const reason = formatBatchedFeedback(response.messages);

    // Mark all as delivered
    await Promise.all(
      response.messages.map((m) =>
        markFeedbackDelivered(config.serverUrl, response.session_id, m.id)
      )
    );

    log("Blocking stop to inject feedback");
    respond({ decision: "block", reason });
  } catch (err) {
    log(`Error: ${err}`);
    respond({});
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

main();
