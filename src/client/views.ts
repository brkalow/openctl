import type { Session, Message, Diff } from "../db/schema";

// HTML escaping utility
export function escapeHtml(str: string): string {
  const htmlEscapes: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return str.replace(/[&<>"']/g, (char) => htmlEscapes[char]);
}

// Session List View
export function renderSessionList(sessions: Session[]): string {
  const content = sessions.length === 0 ? renderEmptyState() : renderSessionGrid(sessions);

  return `
    <div class="space-y-4">
      <div class="flex items-center justify-between gap-4">
        <h1 class="text-lg font-semibold text-text-primary">Sessions</h1>
        <div class="w-full max-w-xs">
          <input
            type="search"
            id="search-input"
            placeholder="Search sessions..."
            class="w-full bg-bg-secondary border border-bg-elevated rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-primary transition-colors"
          />
        </div>
      </div>
      ${content}
    </div>
  `;
}

function renderEmptyState(): string {
  return `
    <div class="flex flex-col items-center justify-center py-16 text-center">
      <div class="w-16 h-16 mb-4 rounded-full bg-bg-secondary flex items-center justify-center">
        <svg class="w-8 h-8 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      </div>
      <h2 class="text-lg font-medium text-text-secondary mb-2">No sessions yet</h2>
      <p class="text-sm text-text-muted max-w-sm">
        Sessions can be uploaded via the API at <code class="bg-bg-tertiary px-1.5 py-0.5 rounded text-accent-primary">POST /api/sessions</code>
      </p>
    </div>
  `;
}

function renderSessionGrid(sessions: Session[]): string {
  return `
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      ${sessions.map(renderSessionCard).join("")}
    </div>
  `;
}

function renderSessionCard(session: Session): string {
  const date = new Date(session.created_at).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return `
    <a
      href="/sessions/${escapeHtml(session.id)}"
      class="block bg-bg-secondary border border-bg-elevated rounded-lg p-4 hover:bg-bg-tertiary hover:border-bg-hover transition-colors group"
      data-session-card
    >
      <div class="flex items-start justify-between gap-3 mb-2">
        <h3 class="text-sm font-medium text-text-primary group-hover:text-accent-primary transition-colors line-clamp-2" data-title>
          ${escapeHtml(session.title)}
        </h3>
        ${
          session.pr_url
            ? `<span class="shrink-0 px-1.5 py-0.5 bg-accent-primary/10 text-accent-primary text-xs font-medium rounded">PR</span>`
            : ""
        }
      </div>
      ${
        session.description
          ? `<p class="text-sm text-text-secondary mb-2 line-clamp-2" data-description>${escapeHtml(session.description)}</p>`
          : ""
      }
      <div class="flex items-center gap-2 text-xs text-text-muted">
        <span>${date}</span>
        ${
          session.project_path
            ? `<span class="truncate font-mono text-[11px]" data-project>${escapeHtml(session.project_path)}</span>`
            : ""
        }
      </div>
    </a>
  `;
}

// Session Detail View
interface SessionDetailData {
  session: Session;
  messages: Message[];
  diffs: Diff[];
  shareUrl: string | null;
}

export function renderSessionDetail({ session, messages, diffs, shareUrl }: SessionDetailData): string {
  const hasDiffs = diffs.length > 0;

  const resumeCommand = session.claude_session_id
    ? `claude --resume ${session.claude_session_id}`
    : session.project_path
      ? `cd ${session.project_path} && claude --continue`
      : "claude --continue";

  return `
    <div class="space-y-6">
      <!-- Header -->
      <div class="space-y-3">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <h1 class="text-xl font-semibold text-text-primary">${escapeHtml(session.title)}</h1>
          <div class="flex items-center gap-2">
            ${
              session.pr_url
                ? `
              <a href="${escapeHtml(session.pr_url)}" target="_blank" rel="noopener noreferrer"
                 class="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-text-primary bg-bg-tertiary hover:bg-bg-elevated border border-bg-elevated rounded-lg transition-colors">
                View PR
              </a>
            `
                : ""
            }
            <button data-share-session="${escapeHtml(session.id)}"
                    class="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-text-primary bg-bg-tertiary hover:bg-bg-elevated border border-bg-elevated rounded-lg transition-colors">
              Share
            </button>
            <a href="/api/sessions/${escapeHtml(session.id)}/export"
               class="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-text-primary bg-bg-tertiary hover:bg-bg-elevated border border-bg-elevated rounded-lg transition-colors">
              Export
            </a>
          </div>
        </div>

        ${
          session.description
            ? `<p class="text-sm text-text-secondary">${escapeHtml(session.description)}</p>`
            : ""
        }

        <!-- Resume command -->
        <div class="flex items-center gap-3 bg-bg-secondary border border-bg-elevated rounded-lg px-3 py-2">
          <span class="text-xs text-text-muted shrink-0 uppercase tracking-wide">Resume</span>
          <code id="resume-command" class="flex-1 text-sm text-accent-primary truncate">
            ${escapeHtml(resumeCommand)}
          </code>
          <button data-copy-resume title="Copy command"
                  class="p-1 text-text-muted hover:text-text-primary transition-colors">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </button>
        </div>

        ${
          shareUrl
            ? `
          <div class="flex items-center gap-3 bg-bg-secondary border border-bg-elevated rounded-lg px-3 py-2">
            <span class="text-xs text-text-muted shrink-0 uppercase tracking-wide">Share</span>
            <input type="text" id="share-url-input" value="${escapeHtml(shareUrl)}" readonly
                   class="flex-1 text-sm text-diff-add bg-transparent truncate border-none outline-none" />
            <button data-copy-share title="Copy URL"
                    class="p-1 text-text-muted hover:text-text-primary transition-colors">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </button>
          </div>
        `
            : ""
        }
      </div>

      <!-- Content panels -->
      <div class="${hasDiffs ? "grid grid-cols-1 lg:grid-cols-[1fr_2fr] gap-4" : ""}">
        <!-- Conversation panel -->
        <div class="bg-bg-secondary border border-bg-elevated rounded-lg overflow-hidden">
          <div class="flex items-center justify-between px-3 py-2 bg-bg-tertiary border-b border-bg-elevated">
            <h2 class="text-sm font-medium text-text-primary">Conversation</h2>
            <span class="text-xs text-text-muted">${messages.length} messages</span>
          </div>
          <div class="divide-y divide-bg-elevated max-h-[70vh] overflow-y-auto">
            ${messages.map(renderMessageBlock).join("")}
          </div>
        </div>

        ${
          hasDiffs
            ? `
          <!-- Code Changes panel -->
          <div class="bg-bg-secondary border border-bg-elevated rounded-lg overflow-hidden">
            <div class="flex items-center justify-between px-3 py-2 bg-bg-tertiary border-b border-bg-elevated">
              <h2 class="text-sm font-medium text-text-primary">Code Changes</h2>
              <span class="text-xs text-text-muted">${diffs.length} file${diffs.length !== 1 ? "s" : ""}</span>
            </div>
            <div id="diffs-container" class="max-h-[70vh] overflow-y-auto">
              ${diffs.map(renderDiffBlock).join("")}
            </div>
          </div>
        `
            : ""
        }
      </div>
    </div>
  `;
}

function renderMessageBlock(message: Message): string {
  const isUser = message.role === "user";
  const roleLabel = isUser ? "You" : "Claude";
  const bgClass = isUser ? "" : "bg-bg-tertiary";
  const roleColor = isUser ? "text-role-user" : "text-role-assistant";

  return `
    <div class="px-3 py-3 ${bgClass}">
      <div class="mb-1">
        <span class="text-xs font-semibold uppercase tracking-wider ${roleColor}">
          ${roleLabel}
        </span>
      </div>
      <div class="text-sm text-text-primary leading-relaxed">
        ${formatMessageContent(message.content)}
      </div>
    </div>
  `;
}

function formatMessageContent(content: string): string {
  let formatted = escapeHtml(content);

  // Code blocks
  formatted = formatted.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    '<pre class="my-2 p-3 bg-bg-primary rounded-md overflow-x-auto"><code class="text-[13px]">$2</code></pre>'
  );

  // Inline code
  formatted = formatted.replace(
    /`([^`]+)`/g,
    '<code class="px-1.5 py-0.5 bg-bg-elevated rounded text-accent-primary text-[13px]">$1</code>'
  );

  // Bold
  formatted = formatted.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  // Line breaks
  formatted = formatted.replace(/\n/g, "<br>");

  return formatted;
}

function renderDiffBlock(diff: Diff): string {
  const filename = diff.filename || "Unknown file";
  const lines = diff.diff_content.split("\n");

  // Count additions and deletions
  let additions = 0;
  let deletions = 0;
  lines.forEach((line) => {
    if (line.startsWith("+") && !line.startsWith("+++")) additions++;
    else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
  });

  return `
    <div class="border-b border-bg-elevated last:border-b-0">
      <div class="flex items-center justify-between px-3 py-2 bg-bg-tertiary border-b border-bg-elevated">
        <span class="text-[13px] font-mono text-text-primary truncate">${escapeHtml(filename)}</span>
        <div class="flex items-center gap-2 text-xs font-mono shrink-0">
          ${deletions > 0 ? `<span class="text-diff-del">-${deletions}</span>` : ""}
          ${additions > 0 ? `<span class="text-diff-add">+${additions}</span>` : ""}
        </div>
      </div>
      <div class="overflow-x-auto"
           data-diff-content="${escapeHtml(diff.diff_content)}"
           data-filename="${escapeHtml(filename)}">
        <div class="p-4 text-text-muted text-sm">Loading diff...</div>
      </div>
    </div>
  `;
}

// Not Found View
export function renderNotFound(): string {
  return `
    <div class="flex flex-col items-center justify-center py-16 text-center">
      <h1 class="text-2xl font-semibold mb-2">Not Found</h1>
      <p class="text-text-muted mb-4">The page or session you're looking for doesn't exist.</p>
      <a href="/" class="btn btn-primary">Go Home</a>
    </div>
  `;
}
