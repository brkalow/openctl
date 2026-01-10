import { layout, escapeHtml } from "./layout";
import type { Session, Message, Diff } from "../db/schema";

export function sessionDetailPage(
  session: Session,
  messages: Message[],
  diffs: Diff[],
  shareUrl: string | null = null
): string {
  const hasDiffs = diffs.length > 0;
  const containerClass = hasDiffs ? "split-view" : "single-view";

  const resumeCommand = session.claude_session_id
    ? `claude --resume ${session.claude_session_id}`
    : session.project_path
    ? `cd ${session.project_path} && claude --continue`
    : "claude --continue";

  const content = `
    <div class="session-header">
      <div class="session-title-row">
        <h1>${escapeHtml(session.title)}</h1>
        <div class="session-actions">
          ${session.pr_url ? `<a href="${escapeHtml(session.pr_url)}" target="_blank" class="btn btn-secondary">View PR</a>` : ""}
          <button class="btn btn-secondary" onclick="shareSession('${escapeHtml(session.id)}')">Share</button>
          <a href="/api/sessions/${escapeHtml(session.id)}/export" class="btn btn-secondary">Export</a>
        </div>
      </div>
      ${session.description ? `<p class="session-description">${escapeHtml(session.description)}</p>` : ""}
      <div class="resume-command">
        <span class="label">Resume:</span>
        <code>${escapeHtml(resumeCommand)}</code>
        <button class="btn-copy" onclick="copyToClipboard('${escapeHtml(resumeCommand)}')" title="Copy command">
          📋
        </button>
      </div>
      ${shareUrl ? `
        <div class="share-url">
          <span class="label">Share URL:</span>
          <input type="text" value="${escapeHtml(shareUrl)}" readonly id="share-url-input" />
          <button class="btn-copy" onclick="copyShareUrl()" title="Copy URL">📋</button>
        </div>
      ` : ""}
    </div>

    <div class="${containerClass}">
      <div class="chat-panel">
        <div class="panel-header">
          <h2>Conversation</h2>
          <span class="message-count">${messages.length} messages</span>
        </div>
        <div class="messages">
          ${messages.map(msg => messageBlock(msg)).join("")}
        </div>
      </div>
      ${hasDiffs ? `
        <div class="diff-panel">
          <div class="panel-header">
            <h2>Code Changes</h2>
            <span class="file-count">${diffs.length} file${diffs.length !== 1 ? "s" : ""}</span>
          </div>
          <div class="diffs">
            ${diffs.map(diff => diffBlock(diff)).join("")}
          </div>
        </div>
      ` : ""}
    </div>
  `;

  return layout(session.title, content, `<link rel="stylesheet" href="/css/diff.css">`);
}

function messageBlock(message: Message): string {
  const roleClass = message.role === "user" ? "user" : "assistant";
  const roleLabel = message.role === "user" ? "You" : "Claude";

  return `
    <div class="message ${roleClass}">
      <div class="message-header">
        <span class="role">${roleLabel}</span>
        ${message.timestamp ? `<span class="timestamp">${escapeHtml(message.timestamp)}</span>` : ""}
      </div>
      <div class="message-content">${formatMessageContent(message.content)}</div>
    </div>
  `;
}

function formatMessageContent(content: string): string {
  // Basic markdown-like formatting
  let formatted = escapeHtml(content);

  // Code blocks
  formatted = formatted.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    '<pre><code class="language-$1">$2</code></pre>'
  );

  // Inline code
  formatted = formatted.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Bold
  formatted = formatted.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  // Line breaks
  formatted = formatted.replace(/\n/g, "<br>");

  return formatted;
}

function diffBlock(diff: Diff): string {
  const filename = diff.filename || "Unknown file";
  const lines = diff.diff_content.split("\n");

  const formattedLines = lines.map(line => {
    let lineClass = "";
    if (line.startsWith("+") && !line.startsWith("+++")) {
      lineClass = "addition";
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      lineClass = "deletion";
    } else if (line.startsWith("@@")) {
      lineClass = "hunk-header";
    } else if (line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("---") || line.startsWith("+++")) {
      lineClass = "meta";
    }
    return `<div class="diff-line ${lineClass}">${escapeHtml(line)}</div>`;
  }).join("");

  return `
    <div class="diff-file">
      <div class="diff-file-header">
        <span class="filename">${escapeHtml(filename)}</span>
      </div>
      <div class="diff-content">
        ${formattedLines}
      </div>
    </div>
  `;
}
