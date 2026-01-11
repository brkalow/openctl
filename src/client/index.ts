import { Router } from "./router";
import { renderSessionList, renderSessionDetail, renderNotFound } from "./views";
import type { Session, Message, Diff } from "../db/schema";
// Import @pierre/diffs - this registers the web component and provides FileDiff class
import { FileDiff, getSingularPatch } from "@pierre/diffs";

// Initialize router
const router = new Router();

// Toast notification system
declare global {
  interface Window {
    showToast: (message: string, type?: "success" | "error") => void;
    copyToClipboard: (text: string) => Promise<void>;
  }
}

window.showToast = (message: string, type = "success") => {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(1rem)";
    setTimeout(() => toast.remove(), 200);
  }, 3000);
};

window.copyToClipboard = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    window.showToast("Copied to clipboard");
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
    window.showToast("Copied to clipboard");
  }
};

// API helpers
async function fetchSessions(): Promise<Session[]> {
  const res = await fetch("/api/sessions");
  if (!res.ok) return [];
  const data = await res.json();
  return data.sessions || [];
}

interface SessionDetailData {
  session: Session;
  messages: Message[];
  diffs: Diff[];
  shareUrl: string | null;
}

async function fetchSessionDetail(id: string): Promise<SessionDetailData | null> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`);
  if (!res.ok) return null;
  return res.json();
}

async function fetchSharedSession(shareToken: string): Promise<SessionDetailData | null> {
  const res = await fetch(`/api/s/${encodeURIComponent(shareToken)}`);
  if (!res.ok) return null;
  return res.json();
}

// Route handlers
router.on("/", async () => {
  const app = document.getElementById("app")!;
  app.innerHTML = '<div class="text-center py-8 text-text-muted">Loading...</div>';

  const sessions = await fetchSessions();
  app.innerHTML = renderSessionList(sessions);
  attachSessionListHandlers();
});

router.on("/sessions/:id", async (params) => {
  const app = document.getElementById("app")!;
  app.innerHTML = '<div class="text-center py-8 text-text-muted">Loading...</div>';

  const data = await fetchSessionDetail(params.id);
  if (!data) {
    app.innerHTML = renderNotFound();
    return;
  }

  app.innerHTML = renderSessionDetail(data);
  attachSessionDetailHandlers(data.session.id);
});

router.on("/s/:shareToken", async (params) => {
  const app = document.getElementById("app")!;
  app.innerHTML = '<div class="text-center py-8 text-text-muted">Loading...</div>';

  const data = await fetchSharedSession(params.shareToken);
  if (!data) {
    app.innerHTML = renderNotFound();
    return;
  }

  app.innerHTML = renderSessionDetail(data);
  attachSessionDetailHandlers(data.session.id);
});

// Event handler attachments
function attachSessionListHandlers() {
  const searchInput = document.getElementById("search-input") as HTMLInputElement;
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      const query = (e.target as HTMLInputElement).value.toLowerCase();
      document.querySelectorAll("[data-session-card]").forEach((card) => {
        const el = card as HTMLElement;
        const title = card.querySelector("[data-title]")?.textContent?.toLowerCase() || "";
        const description = card.querySelector("[data-description]")?.textContent?.toLowerCase() || "";
        const project = card.querySelector("[data-project]")?.textContent?.toLowerCase() || "";
        const matches = title.includes(query) || description.includes(query) || project.includes(query);
        el.style.display = matches ? "" : "none";
      });
    });
  }
}

function attachSessionDetailHandlers(sessionId: string) {
  // Copy resume command
  document.querySelectorAll("[data-copy-resume]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const command = document.getElementById("resume-command")?.textContent;
      if (command) window.copyToClipboard(command.trim());
    });
  });

  // Copy share URL
  document.querySelectorAll("[data-copy-share]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = document.getElementById("share-url-input") as HTMLInputElement;
      if (input) window.copyToClipboard(input.value);
    });
  });

  // Share session
  document.querySelectorAll("[data-share-session]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/share`, {
          method: "POST",
        });
        if (res.ok) {
          router.navigate(window.location.pathname);
        } else {
          window.showToast("Failed to create share link", "error");
        }
      } catch {
        window.showToast("Failed to create share link", "error");
      }
    });
  });

  // Initialize diff rendering
  initializeDiffs();
}

// Track FileDiff instances for cleanup
const diffInstances: FileDiff[] = [];

function initializeDiffs() {
  // Clean up previous instances
  diffInstances.forEach((instance) => instance.cleanUp());
  diffInstances.length = 0;

  document.querySelectorAll("[data-diff-content]").forEach((el) => {
    const htmlEl = el as HTMLElement;
    const content = htmlEl.dataset.diffContent;
    const filename = htmlEl.dataset.filename || "file";

    if (content) {
      try {
        // Parse the patch to get FileDiffMetadata
        const fileDiff = getSingularPatch(content);

        // Create FileDiff instance with options
        const diffInstance = new FileDiff({
          theme: { dark: "pierre-dark", light: "pierre-light" },
          themeType: "dark",
          diffStyle: "unified",
          diffIndicators: "classic",
          disableFileHeader: true,
          overflow: "scroll",
        });

        // Create a container element
        const container = document.createElement("diffs-container");
        htmlEl.innerHTML = "";
        htmlEl.appendChild(container);

        // Render the diff
        diffInstance.render({
          fileDiff,
          fileContainer: container,
        });

        diffInstances.push(diffInstance);
      } catch (err) {
        console.error("Failed to render diff:", err);
        htmlEl.innerHTML = `<pre class="p-3 text-diff-del text-sm">Failed to render diff</pre>`;
      }
    }
  });
}

// Start the router
router.start();
