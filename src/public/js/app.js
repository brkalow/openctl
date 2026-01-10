// Search functionality
const searchInput = document.getElementById("search");
if (searchInput) {
  searchInput.addEventListener("input", (e) => {
    const query = e.target.value.toLowerCase();
    const cards = document.querySelectorAll(".session-card");

    cards.forEach((card) => {
      const title = card.querySelector("h3")?.textContent?.toLowerCase() || "";
      const description = card.querySelector(".session-description")?.textContent?.toLowerCase() || "";
      const matches = title.includes(query) || description.includes(query);
      card.style.display = matches ? "" : "none";
    });
  });
}

// Copy to clipboard
function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast("Copied to clipboard!");
  }).catch(() => {
    // Fallback for older browsers
    const textarea = document.createElement("textarea");
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
    showToast("Copied to clipboard!");
  });
}

function copyShareUrl() {
  const input = document.getElementById("share-url-input");
  if (input) {
    copyToClipboard(input.value);
  }
}

// Share session
async function shareSession(sessionId) {
  try {
    const response = await fetch(`/api/sessions/${sessionId}/share`, {
      method: "POST",
    });

    if (response.ok) {
      const data = await response.json();
      // Reload the page to show the share URL
      window.location.reload();
    } else {
      showToast("Failed to create share link", "error");
    }
  } catch (error) {
    showToast("Failed to create share link", "error");
  }
}

// Toast notifications
function showToast(message, type = "success") {
  const existing = document.querySelector(".toast");
  if (existing) {
    existing.remove();
  }

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: ${type === "error" ? "var(--accent-danger)" : "var(--accent-success)"};
    color: #fff;
    padding: 0.75rem 1.25rem;
    border-radius: var(--radius);
    font-size: 0.875rem;
    z-index: 1000;
    animation: slideIn 0.3s ease;
  `;

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = "slideOut 0.3s ease";
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Add animation styles
const style = document.createElement("style");
style.textContent = `
  @keyframes slideIn {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
  @keyframes slideOut {
    from {
      transform: translateX(0);
      opacity: 1;
    }
    to {
      transform: translateX(100%);
      opacity: 0;
    }
  }
`;
document.head.appendChild(style);
