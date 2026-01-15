# Interactive Sessions: Plugin Approach

## Overview

This spec explores using a Claude Code plugin as an alternative to the PTY wrapper for enabling interactive sessions between Conductor and Claude Code.

## Background

### Current PTY Wrapper Approach

The current implementation uses a PTY (pseudo-terminal) wrapper that:
1. Spawns Claude Code in a pseudo-terminal
2. Detects state via pattern matching on terminal output (spinners, prompts)
3. Maintains a WebSocket connection to the Archive server
4. Injects remote feedback as text into Claude's input field

**Pros:**
- Works with standard Claude Code (no configuration required)
- User retains full control (messages appear in input, user presses Enter)
- Preserves the TUI experience

**Cons:**
- Fragile state detection (relies on pattern matching terminal output)
- POSIX-only (Bun.Terminal not available on Windows)
- Additional process layer between Conductor and Claude
- Can't access Claude's internal state (tool calls, errors, etc.)

### Plugin Capabilities

Claude Code plugins can include:
- **Slash commands**: Custom shortcuts for operations
- **Subagents**: Purpose-built agents for specialized tasks
- **MCP servers**: Tools Claude can call via Model Context Protocol
- **Hooks**: Event handlers that fire at key points in Claude's workflow

Key hooks relevant to interactive sessions:
- `SessionStart`: Fires when a session begins
- `UserPromptSubmit`: Fires before Claude processes a user prompt (can inject context)
- `PreToolUse` / `PostToolUse`: Fires before/after tool execution
- `Notification`: Fires when Claude needs user input
- `Stop`: Fires when Claude finishes its response

## The Challenge

The fundamental issue with a plugin approach is that Claude Code's extension points are **pull-based**, not **push-based**:

| PTY Wrapper | Plugin |
|-------------|--------|
| Can inject text at any time | Hooks only fire on internal events |
| Detects "waiting" state | No built-in "waiting for input" event |
| Bypasses Claude entirely | Must work within Claude's framework |

Claude Code has no native mechanism for:
- Receiving messages pushed from an external system
- Blocking/waiting for external input
- Having tools called asynchronously by external triggers

## Plugin Design Options

### Option A: Polling MCP Tool

Create an MCP server with a `get_remote_feedback` tool that Claude calls periodically.

```
┌──────────────┐
│   Browser    │
└──────┬───────┘
       │ WebSocket
       ↓
┌──────────────┐
│   Server     │ Stores pending feedback
└──────┬───────┘
       │ HTTP (when Claude calls tool)
       ↓
┌──────────────┐
│  MCP Server  │ get_remote_feedback tool
└──────┬───────┘
       │ MCP Protocol
       ↓
┌──────────────┐
│ Claude Code  │ Calls tool to check for feedback
└──────────────┘
```

**Implementation:**
- MCP server exposes `get_remote_feedback(session_id)` tool
- Tool makes HTTP request to Archive server for pending messages
- Claude instructed to call this tool after completing tasks

**Pros:**
- Simple implementation
- Works within MCP framework
- Cross-platform

**Cons:**
- Requires Claude to actively poll (not real-time)
- Claude might forget to check or check at wrong times
- Adds latency between feedback sent and received
- Relies on prompt engineering to ensure Claude checks

### Option B: Blocking Wait Tool

Create an MCP tool that blocks until feedback arrives (long-polling).

```typescript
// MCP tool implementation
async function waitForFeedback(sessionId: string): Promise<string> {
  // Long-poll the Archive server
  const response = await fetch(`${ARCHIVE_URL}/api/sessions/${sessionId}/feedback/wait`, {
    timeout: 30000  // 30 second timeout
  });
  return response.json();
}
```

**Implementation:**
- MCP server exposes `wait_for_feedback(session_id)` tool
- Tool blocks until feedback arrives or timeout
- Claude instructed to call this when ready for input

**Pros:**
- More real-time than polling
- Claude explicitly enters "waiting" state
- Clean handoff point

**Cons:**
- Still requires Claude to call the tool
- Long-running tool calls may have issues
- Timeout handling complexity
- Claude might not call at appropriate times

### Option C: Hook-based Context Injection

Use hooks to inject pending feedback into Claude's context at key moments.

```json
{
  "hooks": {
    "UserPromptSubmit": [{
      "hooks": [{
        "type": "command",
        "command": "archive-feedback-injector --check-pending"
      }]
    }],
    "Stop": [{
      "hooks": [{
        "type": "command",
        "command": "archive-feedback-injector --notify-if-pending"
      }]
    }]
  }
}
```

**Implementation:**
- `UserPromptSubmit` hook checks for pending feedback, injects as additional context
- `Stop` hook notifies user if feedback is waiting
- Feedback shows up in Claude's context on next prompt

**Pros:**
- Automatic (no action required from Claude)
- Uses official hook system
- Can add rich context beyond just messages

**Cons:**
- Only injects on user prompt submission (not truly real-time)
- Can't inject feedback while Claude is working
- User must submit something to trigger the hook

### Option D: Hybrid Approach (MCP + Hooks + Instructions)

Combine multiple extension points for a more robust solution.

```
Plugin Package:
├── mcp-server/          # Remote feedback tools
│   ├── get_feedback     # Poll for pending feedback
│   ├── send_status      # Report session state
│   └── mark_received    # Acknowledge feedback
├── hooks/
│   ├── session_start    # Register session, inject instructions
│   ├── stop             # Check for pending feedback, notify
│   └── notification     # Alert on remote feedback
├── commands/
│   └── /feedback        # Manual check for feedback
└── CLAUDE.md            # Instructions for Claude
```

**CLAUDE.md Instructions:**
```markdown
## Remote Feedback

This session is connected to Conductor for remote collaboration.

When you complete a task or are waiting for user direction:
1. Call `mcp__archive__get_feedback()` to check for remote input
2. If feedback is pending, incorporate it into your response
3. Acknowledge receipt with `mcp__archive__mark_received()`
```

**Pros:**
- Multiple fallback mechanisms
- Works with Claude's existing patterns
- Rich integration possibilities

**Cons:**
- Complex setup
- Still not truly real-time
- Relies on instructions being followed

### Option E: Stop Hook with Blocking (Recommended)

**Key Insight**: The Stop hook can **block Claude from stopping** and inject a message that forces continuation. This creates automatic polling at exactly the right moment.

```
┌──────────────┐
│   Browser    │ User sends feedback
└──────┬───────┘
       │ WebSocket
       ↓
┌──────────────┐
│   Server     │ Stores pending feedback
└──────────────┘
       ↑
       │ HTTP (when Stop hook fires)
       │
┌──────────────┐
│  Stop Hook   │ Checks for pending feedback
└──────┬───────┘
       │ If feedback: {"decision": "block", "reason": "<message>"}
       │ If none: exit 0
       ↓
┌──────────────┐
│ Claude Code  │ Receives feedback, continues working
└──────────────┘
```

**How It Works:**

1. Claude finishes a task and attempts to stop
2. Stop hook fires before Claude actually stops
3. Hook script checks Archive server for pending remote feedback
4. **If feedback exists:**
   - Return JSON: `{"decision": "block", "reason": "Remote feedback: <message>"}`
   - Claude receives the message and continues working
5. **If no feedback:**
   - Exit with code 0 (or return nothing)
   - Claude stops normally, waits for local user input

**Implementation:**

```typescript
// stop-hook.ts - executed when Claude tries to stop
const sessionId = process.env.ARCHIVE_SESSION_ID;
const serverUrl = process.env.ARCHIVE_SERVER_URL;

async function main() {
  if (!sessionId || !serverUrl) {
    process.exit(0); // Not a Archive session, allow stop
  }

  try {
    const response = await fetch(`${serverUrl}/api/sessions/${sessionId}/feedback/pending`);
    const data = await response.json();

    if (data.pending && data.messages.length > 0) {
      // Block stop and inject the feedback
      const feedback = data.messages[0];
      const output = {
        decision: "block",
        reason: `[Remote feedback from ${feedback.source}]: ${feedback.content}`
      };
      // Output to stderr for Claude to receive
      console.error(JSON.stringify(output));
      process.exit(2); // Exit code 2 = block
    }
  } catch (e) {
    // Network error - allow stop, don't block user
  }

  process.exit(0); // No feedback, allow stop
}

main();
```

**Plugin Configuration:**

```json
{
  "hooks": {
    "Stop": [{
      "hooks": [{
        "type": "command",
        "command": "bun run /path/to/archive-plugin/stop-hook.ts"
      }]
    }],
    "SessionStart": [{
      "hooks": [{
        "type": "command",
        "command": "archive-session-init"
      }]
    }]
  }
}
```

**Why This Is Better Than PTY Wrapper:**

| Aspect | PTY Wrapper | Stop Hook |
|--------|-------------|-----------|
| State detection | Fragile pattern matching | Official hook event |
| Cross-platform | POSIX only | Yes (Bun/Node) |
| Claude awareness | None (terminal layer) | Full (receives message) |
| Timing | Polls output continuously | Fires at exact right moment |
| Maintenance | Output patterns may change | Stable hook API |
| User control | Text in input field | Claude processes directly |

**The Key Insight:**

The Stop hook fires at exactly the same moment the PTY wrapper detects a "waiting" state - when Claude has finished working and is about to return control. But instead of:
- Pattern matching terminal output (fragile)
- Injecting text into an input field (hacky)

We use official APIs to:
- Detect the "done" state (Stop hook)
- Inject feedback as a structured message (JSON response)
- Force continuation (decision: block)

**Pros:**
- Uses official Claude Code APIs
- Cross-platform (no PTY required)
- Claude is aware of the feedback source
- Automatic - no reliance on Claude calling tools
- Fires at exactly the right moment
- Structured messages instead of raw text

**Cons:**
- Slight latency (feedback must wait for Claude to finish current task)
- Known bug with plugins + exit code 2 (may need direct hook installation)
- Can't interrupt Claude mid-task (feedback waits until Stop)

**Handling the Plugin Bug:**

There's a [known issue](https://github.com/anthropics/claude-code/issues/10412) where Stop hooks with exit code 2 don't work correctly when installed via plugins. Workarounds:
1. Install hooks directly in `.claude/settings.json` instead of via plugin
2. Use a SessionStart hook to copy hook config to the right location
3. Wait for the bug to be fixed (it's been reported)

## Comparison Matrix

| Aspect | PTY Wrapper | Stop Hook (Option E) | Hybrid (Option D) |
|--------|-------------|---------------------|-------------------|
| **Real-time** | Yes (terminal injection) | Near real-time (on stop) | No (requires action) |
| **Reliability** | Medium (pattern matching) | High (official hook) | Medium (instructions) |
| **Cross-platform** | No (POSIX only) | Yes | Yes |
| **Setup complexity** | Low (single binary) | Low (hook config) | Medium (plugin) |
| **Claude awareness** | None (terminal layer) | Full (receives message) | Full (integrated) |
| **State detection** | Pattern matching | Official Stop event | Tool-based reporting |
| **TUI preservation** | Yes | Yes | Yes |
| **Maintenance** | High (output patterns) | Low (stable API) | Low (official APIs) |
| **Mid-task interrupt** | Yes | No (waits for stop) | No |

## Recommendation

**Primary: Option E (Stop Hook with Blocking)**

The Stop hook approach is recommended because:
1. Uses official Claude Code APIs (stable, supported)
2. Cross-platform (works on Windows, macOS, Linux)
3. Claude is fully aware of remote feedback (not just injected text)
4. Automatic polling at exactly the right moment
5. Simpler than PTY wrapper (no pattern matching, no pseudo-terminal)

**Tradeoff**: Cannot interrupt Claude mid-task. Feedback waits until Claude finishes current work.

**Fallback: PTY Wrapper for Mid-Task Interrupts**

If mid-task interruption is critical, keep the PTY wrapper as an optional enhancement. But for most use cases, waiting until Claude's next stop is acceptable.

## Proposed Architecture (Option E)

```
┌──────────────────────────────────────────────────────────────┐
│                        Conductor                              │
└──────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              │                               │
              ↓                               ↓
       ┌────────────┐                  ┌────────────┐
       │  Browser   │                  │   Server   │
       │    UI      │                  │  (Archive) │
       └─────┬──────┘                  └─────┬──────┘
             │                               │
             │ WebSocket                     │ HTTP (pending feedback)
             │                               │
             └───────────────┬───────────────┘
                             │
                             ↓
                      ┌────────────┐
                      │ Stop Hook  │ Checks for feedback when Claude stops
                      └─────┬──────┘
                            │
                            │ {"decision": "block", "reason": "..."}
                            ↓
                      ┌────────────┐
                      │Claude Code │ Receives feedback, continues
                      └────────────┘
```

**Flow:**
1. Browser sends feedback via WebSocket
2. Server stores feedback in database
3. Claude finishes current task, triggers Stop hook
4. Hook fetches pending feedback from server
5. If feedback exists: block stop, inject message, Claude continues
6. If no feedback: allow stop, Claude waits for local input

## Plugin Structure

```
archive-plugin/
├── hooks/
│   └── stop.ts              # Check for pending feedback
├── commands/
│   └── archive-status.ts  # /archive-status slash command
├── .claude-plugin/
│   └── manifest.json        # Plugin metadata
└── CLAUDE.md                # Instructions for Claude
```

## Next Steps

1. **Prototype the Stop hook** - Verify the blocking mechanism works
2. **Test the plugin bug** - Confirm if hooks must be installed directly
3. **Add server endpoint** - `GET /api/sessions/:id/feedback/pending`
4. **Build the plugin package** - For easy installation
5. **Update browser UI** - Show "feedback will be delivered when Claude stops"

## Design Decisions

1. ~~Can we trigger Claude to check for input after each response?~~ **Yes, via Stop hook!**
2. **SubagentStop**: No - only handle main Stop hook, not subagents
3. **Timeout**: 3 second timeout for network requests to avoid blocking the user
4. **Batching**: All pending messages are batched into a single injection
5. **Plugin bug**: Test if it's actually an issue; use direct hook installation as fallback
6. **UX**: Show "queued" status for feedback that arrives while Claude is working

## References

- [Claude Code Plugins](https://claude.com/blog/claude-code-plugins)
- [Hooks Reference](https://code.claude.com/docs/en/hooks)
- [MCP Documentation](https://code.claude.com/docs/en/mcp)
- [Current PTY Wrapper Implementation](../cli/wrapper/)
