import type { ComponentResult, EventHandler } from "./base";
import { escapeHtml } from "./base";
import { Layout } from "./Layout";
import type { Session } from "../db/schema";

export interface SessionListProps {
  sessions: Session[];
}

export function SessionList({ sessions }: SessionListProps): ComponentResult {
  const handlers: EventHandler[] = [
    // Search functionality
    {
      selector: "#search-input",
      event: "input",
      handler: `
        const query = e.target.value.toLowerCase();
        document.querySelectorAll('[data-session-card]').forEach(card => {
          const title = card.querySelector('[data-title]')?.textContent?.toLowerCase() || '';
          const description = card.querySelector('[data-description]')?.textContent?.toLowerCase() || '';
          const project = card.querySelector('[data-project]')?.textContent?.toLowerCase() || '';
          const matches = title.includes(query) || description.includes(query) || project.includes(query);
          card.style.display = matches ? '' : 'none';
        });
      `,
    },
  ];

  const content = sessions.length === 0
    ? EmptyState()
    : SessionGrid({ sessions });

  const html = `
    <div class="space-y-6">
      <div class="flex items-center justify-between gap-4">
        <h1 class="text-2xl font-semibold">Sessions</h1>
        <div class="w-full max-w-xs">
          <input
            type="search"
            id="search-input"
            placeholder="Search sessions..."
            class="w-full bg-bg-secondary border border-bg-elevated rounded-md px-4 py-2 text-sm focus:outline-none focus:border-accent-primary transition-colors"
          />
        </div>
      </div>
      ${content}
    </div>
  `;

  return Layout({
    title: "Sessions",
    content: { html, handlers },
  });
}

function EmptyState(): string {
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

function SessionGrid({ sessions }: { sessions: Session[] }): string {
  return `
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      ${sessions.map(session => SessionCard({ session })).join("")}
    </div>
  `;
}

function SessionCard({ session }: { session: Session }): string {
  const date = new Date(session.created_at).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return `
    <a
      href="/sessions/${escapeHtml(session.id)}"
      class="block bg-bg-secondary rounded-lg p-5 hover:bg-bg-tertiary transition-colors group"
      data-session-card
    >
      <div class="flex items-start justify-between gap-3 mb-3">
        <h3 class="font-medium text-text-primary group-hover:text-accent-primary transition-colors line-clamp-2" data-title>
          ${escapeHtml(session.title)}
        </h3>
        ${session.pr_url ? `
          <span class="shrink-0 px-2 py-0.5 bg-accent-primary/10 text-accent-primary text-xs font-medium rounded">
            PR
          </span>
        ` : ""}
      </div>
      ${session.description ? `
        <p class="text-sm text-text-secondary mb-3 line-clamp-2" data-description>
          ${escapeHtml(session.description)}
        </p>
      ` : ""}
      <div class="flex items-center gap-3 text-xs text-text-muted">
        <span>${date}</span>
        ${session.project_path ? `
          <span class="truncate" data-project>${escapeHtml(session.project_path)}</span>
        ` : ""}
      </div>
    </a>
  `;
}
