import type { ComponentResult, EventHandler } from "./base";
import { escapeHtml } from "./base";
import { Layout } from "./Layout";
import type { Session, Message, Diff } from "../db/schema";

export interface SessionDetailProps {
  session: Session;
  messages: Message[];
  diffs: Diff[];
  shareUrl: string | null;
}

export function SessionDetail({ session, messages, diffs, shareUrl }: SessionDetailProps): ComponentResult {
  const hasDiffs = diffs.length > 0;

  const resumeCommand = session.claude_session_id
    ? `claude --resume ${session.claude_session_id}`
    : session.project_path
    ? `cd ${session.project_path} && claude --continue`
    : "claude --continue";

  const handlers: EventHandler[] = [
    // Copy resume command
    {
      selector: "[data-copy-resume]",
      event: "click",
      handler: `
        const command = document.getElementById('resume-command')?.textContent;
        if (command) window.copyToClipboard(command);
      `,
    },
    // Copy share URL
    {
      selector: "[data-copy-share]",
      event: "click",
      handler: `
        const input = document.getElementById('share-url-input');
        if (input) window.copyToClipboard(input.value);
      `,
    },
    // Share session
    {
      selector: "[data-share-session]",
      event: "click",
      handler: `
        const sessionId = this.dataset.shareSession;
        fetch('/api/sessions/' + encodeURIComponent(sessionId) + '/share', { method: 'POST' })
          .then(res => {
            if (res.ok) {
              window.location.reload();
            } else {
              window.showToast('Failed to create share link', 'error');
            }
          })
          .catch(() => window.showToast('Failed to create share link', 'error'));
      `,
    },
    // Initialize diffs
    {
      selector: "[data-diff-content]",
      event: "DOMContentLoaded",
      handler: "", // Will be handled by script below
    },
  ];

  const html = `
    <div class="space-y-6">
      <!-- Header -->
      <div class="space-y-4">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <h1 class="text-2xl font-semibold">${escapeHtml(session.title)}</h1>
          <div class="flex items-center gap-2">
            ${session.pr_url ? `
              <a href="${escapeHtml(session.pr_url)}" target="_blank" rel="noopener noreferrer" class="btn">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                View PR
              </a>
            ` : ""}
            <button class="btn" data-share-session="${escapeHtml(session.id)}">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
              Share
            </button>
            <a href="/api/sessions/${escapeHtml(session.id)}/export" class="btn">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Export
            </a>
          </div>
        </div>

        ${session.description ? `
          <p class="text-text-secondary">${escapeHtml(session.description)}</p>
        ` : ""}

        <!-- Resume command -->
        <div class="flex items-center gap-3 bg-bg-secondary rounded-lg px-4 py-3">
          <span class="text-sm text-text-muted shrink-0">Resume:</span>
          <code id="resume-command" class="flex-1 text-sm text-accent-primary font-mono truncate">
            ${escapeHtml(resumeCommand)}
          </code>
          <button class="btn p-1.5" data-copy-resume title="Copy command">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </button>
        </div>

        ${shareUrl ? `
          <div class="flex items-center gap-3 bg-bg-secondary rounded-lg px-4 py-3">
            <span class="text-sm text-text-muted shrink-0">Share URL:</span>
            <input
              type="text"
              id="share-url-input"
              value="${escapeHtml(shareUrl)}"
              readonly
              class="flex-1 bg-transparent text-sm text-accent-addition font-mono truncate border-none outline-none"
            />
            <button class="btn p-1.5" data-copy-share title="Copy URL">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </button>
          </div>
        ` : ""}
      </div>

      <!-- Content panels -->
      <div class="${hasDiffs ? "grid lg:grid-cols-2 gap-6" : ""}">
        <!-- Chat panel -->
        <div class="panel">
          <div class="panel-header">
            <h2 class="font-medium">Conversation</h2>
            <span class="text-sm text-text-muted">${messages.length} messages</span>
          </div>
          <div class="divide-y divide-bg-elevated">
            ${messages.map(msg => MessageBlock({ message: msg })).join("")}
          </div>
        </div>

        ${hasDiffs ? `
          <!-- Diff panel -->
          <div class="panel">
            <div class="panel-header">
              <h2 class="font-medium">Code Changes</h2>
              <span class="text-sm text-text-muted">${diffs.length} file${diffs.length !== 1 ? "s" : ""}</span>
            </div>
            <div class="divide-y divide-bg-elevated" id="diffs-container">
              ${diffs.map(diff => DiffBlock({ diff })).join("")}
            </div>
          </div>
        ` : ""}
      </div>
    </div>

    <!-- Initialize diffs library -->
    <script type="module">
      import { renderDiff } from '/js/diff-renderer.js';

      document.querySelectorAll('[data-diff-content]').forEach(async (el) => {
        const content = el.dataset.diffContent;
        const filename = el.dataset.filename || 'file';
        try {
          const rendered = await renderDiff(content, filename);
          el.innerHTML = rendered;
        } catch (err) {
          console.error('Failed to render diff:', err);
        }
      });
    </script>
  `;

  return Layout({
    title: session.title,
    content: { html, handlers },
  });
}

function MessageBlock({ message }: { message: Message }): string {
  const isUser = message.role === "user";
  const roleLabel = isUser ? "You" : "Claude";
  const bgClass = isUser ? "bg-bg-tertiary/50" : "";

  return `
    <div class="p-4 ${bgClass}">
      <div class="flex items-center gap-2 mb-2">
        <span class="text-sm font-medium ${isUser ? "text-accent-primary" : "text-accent-addition"}">
          ${roleLabel}
        </span>
        ${message.timestamp ? `
          <span class="text-xs text-text-muted">${escapeHtml(message.timestamp)}</span>
        ` : ""}
      </div>
      <div class="prose prose-invert prose-sm max-w-none">
        ${formatMessageContent(message.content)}
      </div>
    </div>
  `;
}

function formatMessageContent(content: string): string {
  let formatted = escapeHtml(content);

  // Code blocks with syntax highlighting class
  formatted = formatted.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    '<pre class="bg-bg-primary rounded-md p-3 overflow-x-auto"><code class="text-sm font-mono">$2</code></pre>'
  );

  // Inline code
  formatted = formatted.replace(
    /`([^`]+)`/g,
    '<code class="bg-bg-tertiary px-1.5 py-0.5 rounded text-accent-primary text-sm">$1</code>'
  );

  // Bold
  formatted = formatted.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  // Line breaks
  formatted = formatted.replace(/\n/g, "<br>");

  return formatted;
}

function DiffBlock({ diff }: { diff: Diff }): string {
  const filename = diff.filename || "Unknown file";
  const lines = diff.diff_content.split("\n");

  // Count additions and deletions
  let additions = 0;
  let deletions = 0;
  lines.forEach(line => {
    if (line.startsWith("+") && !line.startsWith("+++")) additions++;
    else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
  });

  return `
    <div class="diff-file">
      <div class="flex items-center justify-between px-4 py-2 bg-bg-tertiary border-b border-bg-elevated">
        <span class="text-sm font-mono text-text-primary truncate">${escapeHtml(filename)}</span>
        <div class="flex items-center gap-2 text-xs shrink-0">
          ${additions > 0 ? `<span class="text-accent-addition">+${additions}</span>` : ""}
          ${deletions > 0 ? `<span class="text-accent-deletion">-${deletions}</span>` : ""}
        </div>
      </div>
      <div
        class="diff-content font-mono text-sm overflow-x-auto"
        data-diff-content="${escapeHtml(diff.diff_content)}"
        data-filename="${escapeHtml(filename)}"
      >
        ${renderFallbackDiff(lines)}
      </div>
    </div>
  `;
}

function renderFallbackDiff(lines: string[]): string {
  return `<div class="p-2">
    ${lines.map((line, i) => {
      let lineClass = "text-text-secondary";
      let bgClass = "";
      let indicator = " ";
      let displayLine = line;

      if (line.startsWith("+") && !line.startsWith("+++")) {
        lineClass = "text-accent-addition";
        bgClass = "bg-accent-addition/10";
        indicator = "+";
        displayLine = line.slice(1);
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        lineClass = "text-accent-deletion";
        bgClass = "bg-accent-deletion/10";
        indicator = "-";
        displayLine = line.slice(1);
      } else if (line.startsWith("@@")) {
        lineClass = "text-accent-primary";
        bgClass = "bg-accent-primary/5";
      } else if (line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("---") || line.startsWith("+++")) {
        lineClass = "text-text-muted";
      } else if (line.startsWith(" ")) {
        // Context line - remove the leading space for display
        displayLine = line.slice(1);
      }

      return `<div class="flex ${bgClass}">
        <span class="select-none w-10 text-right pr-3 text-text-muted shrink-0">${i + 1}</span>
        <span class="select-none w-5 text-center ${lineClass} shrink-0">${indicator}</span>
        <span class="${lineClass} whitespace-pre">${escapeHtml(displayLine)}</span>
      </div>`;
    }).join("")}
  </div>`;
}
