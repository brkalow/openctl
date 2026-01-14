# TODO

Minor issues noticed are logged here. Once resolved, remove them from the file.

---

## Figure out SSR

We should SSR pages if we have the data available. This would improve initial load time and SEO.

**Scope**: Significant architectural change. Would require:

- Server-side rendering of views with embedded data
- Hydration on client for interactivity
- Changes to routing approach

## Streaming

Support streaming instead of message by message for live chats.

**Note**: Live streaming via WebSocket is already implemented (message-by-message). This item may refer to token-by-token streaming for a typing effect, which would require:

- Daemon to emit partial messages
- API to support streaming content blocks
- Frontend to render incremental text

## Local command output should get folded in

The command is properly detected, but the output should be in the collapsible section, e.g.:

<local-command-stdout>## Context Usage

Model: claude-opus-4-5-20251101
Tokens: 41.4k / 200.0k (21%)

### Categories

Category Tokens Percentage
System prompt 3.0k 1.5%
System tools 16.8k 8.4%
Custom agents 152 0.1%
Memory files 453 0.2%
Skills 241 0.1%
Messages 20.7k 10.3%
Free space 113.6k 56.8%
Autocompact buffer 45.0k 22.5%

### Custom Agents

Agent Type Source Tokens
feature-dev:code-reviewer Plugin 52
feature-dev:code-explorer Plugin 47
feature-dev:code-architect Plugin 53

### Memory Files

Type Path Tokens
Project /Users/bryce/conductor/workspaces/archive/houston/CLAUDE.md 453

### Skills

Skill Source Tokens
save-plan-to-notion User 61
review User 46
ralph-loop:help Plugin 16
ralph-loop:cancel-ralph Plugin 12
ralph-loop:ralph-loop Plugin 14
feature-dev:feature-dev Plugin 25
frontend-design Plugin 67

</local-command-stdout>

## Display sub agents properly

Do we handle and display subagents and their output?

## Diffs get stuck

During live session, get stuck in "Loading diff..." view

## Claude is working...

When idle, we display "Claude is working..."
