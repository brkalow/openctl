import { layout, escapeHtml } from "./layout";
import type { Session } from "../db/schema";

export function sessionListPage(sessions: Session[]): string {
  const sessionCards = sessions.length === 0
    ? `<div class="empty-state">
        <h2>No sessions yet</h2>
        <p>Sessions can be uploaded via the API at <code>POST /api/sessions</code></p>
      </div>`
    : `<div class="session-grid">
        ${sessions.map(session => sessionCard(session)).join("")}
      </div>`;

  const content = `
    <div class="page-header">
      <h1>Sessions</h1>
      <div class="search-bar">
        <input type="text" id="search" placeholder="Search sessions..." />
      </div>
    </div>
    ${sessionCards}
  `;

  return layout("Sessions", content);
}

function sessionCard(session: Session): string {
  const date = new Date(session.created_at).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return `
    <a href="/sessions/${escapeHtml(session.id)}" class="session-card">
      <div class="session-card-header">
        <h3>${escapeHtml(session.title)}</h3>
        ${session.pr_url ? `<span class="badge badge-pr">PR</span>` : ""}
      </div>
      ${session.description ? `<p class="session-description">${escapeHtml(session.description)}</p>` : ""}
      <div class="session-meta">
        <span class="date">${date}</span>
        ${session.project_path ? `<span class="project">${escapeHtml(session.project_path)}</span>` : ""}
      </div>
    </a>
  `;
}
