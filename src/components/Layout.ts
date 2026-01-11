import type { ComponentResult, EventHandler } from "./base";
import { escapeHtml, generateClientScript } from "./base";

export interface LayoutProps {
  title: string;
  content: ComponentResult;
}

export function Layout({ title, content }: LayoutProps): ComponentResult {
  // Collect all handlers from child content plus layout-level handlers
  const allHandlers: EventHandler[] = [
    ...content.handlers,
    // Toast system handler
    {
      selector: "[data-toast-trigger]",
      event: "click",
      handler: `
        const message = this.dataset.toastMessage || 'Action completed';
        const type = this.dataset.toastType || 'success';
        window.showToast(message, type);
      `,
    },
  ];

  const html = `<!DOCTYPE html>
<html lang="en" class="antialiased">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} - Claude Session Archive</title>
  <link rel="stylesheet" href="/css/main.css">
</head>
<body class="min-h-screen bg-bg-primary text-text-primary">
  <header class="sticky top-0 z-50 bg-bg-secondary/95 backdrop-blur-sm border-b border-bg-elevated">
    <nav class="container flex items-center justify-between h-14">
      <a href="/" class="text-lg font-semibold text-text-primary hover:text-accent-primary transition-colors">
        Claude Session Archive
      </a>
    </nav>
  </header>

  <main class="container py-8">
    ${content.html}
  </main>

  <script type="module">
    // Toast notification system
    window.showToast = function(message, type = 'success') {
      const existing = document.querySelector('.toast');
      if (existing) existing.remove();

      const toast = document.createElement('div');
      toast.className = 'toast toast-' + type;
      toast.textContent = message;
      document.body.appendChild(toast);

      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(1rem)';
        setTimeout(() => toast.remove(), 200);
      }, 3000);
    };

    // Copy to clipboard utility
    window.copyToClipboard = async function(text) {
      try {
        await navigator.clipboard.writeText(text);
        window.showToast('Copied to clipboard');
      } catch {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        window.showToast('Copied to clipboard');
      }
    };
  </script>
  ${generateClientScript(allHandlers)}
</body>
</html>`;

  return { html, handlers: [] }; // Handlers already rendered
}
