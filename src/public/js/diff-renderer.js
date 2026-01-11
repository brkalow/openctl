/**
 * Diff Renderer using the diffs library
 * This module renders git diffs with syntax highlighting
 */

// For SSR/client rendering, we'll use a simplified approach
// that matches the Pierre aesthetic without requiring full Shiki setup

export async function renderDiff(content, filename) {
  const lines = content.split('\n');
  const extension = filename.split('.').pop() || '';

  let html = '<div class="diff-lines">';

  let lineNumOld = 0;
  let lineNumNew = 0;

  for (const line of lines) {
    const type = getLineType(line);

    // Parse hunk header for line numbers
    if (type === 'hunk') {
      const match = line.match(/@@ -(\d+),?\d* \+(\d+),?\d* @@/);
      if (match) {
        lineNumOld = parseInt(match[1], 10) - 1;
        lineNumNew = parseInt(match[2], 10) - 1;
      }
    }

    // Track line numbers
    let oldNum = '';
    let newNum = '';

    if (type === 'addition') {
      lineNumNew++;
      newNum = lineNumNew;
    } else if (type === 'deletion') {
      lineNumOld++;
      oldNum = lineNumOld;
    } else if (type === 'context') {
      lineNumOld++;
      lineNumNew++;
      oldNum = lineNumOld;
      newNum = lineNumNew;
    }

    html += renderLine(line, type, oldNum, newNum);
  }

  html += '</div>';
  return html;
}

function getLineType(line) {
  if (line.startsWith('+++') || line.startsWith('---')) return 'meta';
  if (line.startsWith('+')) return 'addition';
  if (line.startsWith('-')) return 'deletion';
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('diff ') || line.startsWith('index ')) return 'meta';
  return 'context';
}

function renderLine(line, type, oldNum, newNum) {
  const styles = {
    addition: {
      bg: 'background: rgba(0, 202, 177, 0.1);',
      text: 'color: #00cab1;',
      indicator: '+'
    },
    deletion: {
      bg: 'background: rgba(255, 46, 63, 0.1);',
      text: 'color: #ff2e3f;',
      indicator: '-'
    },
    context: {
      bg: '',
      text: 'color: #adadb1;',
      indicator: ' '
    },
    hunk: {
      bg: 'background: rgba(0, 159, 255, 0.05);',
      text: 'color: #009fff;',
      indicator: ''
    },
    meta: {
      bg: '',
      text: 'color: #84848a;',
      indicator: ''
    }
  };

  const style = styles[type] || styles.context;
  const content = type === 'addition' || type === 'deletion' ? line.slice(1) : line;

  return `
    <div class="diff-line" style="display: flex; ${style.bg}">
      <span class="line-num" style="width: 40px; text-align: right; padding-right: 8px; color: #84848a; user-select: none; flex-shrink: 0;">
        ${oldNum}
      </span>
      <span class="line-num" style="width: 40px; text-align: right; padding-right: 8px; color: #84848a; user-select: none; flex-shrink: 0;">
        ${newNum}
      </span>
      <span class="indicator" style="width: 16px; text-align: center; ${style.text} user-select: none; flex-shrink: 0;">
        ${style.indicator}
      </span>
      <span class="line-content" style="${style.text} white-space: pre; padding-right: 16px;">
        ${escapeHtml(content)}
      </span>
    </div>
  `;
}

function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };
  return text.replace(/[&<>"']/g, char => map[char]);
}
