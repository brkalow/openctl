# Daemon Command Detection

> **STATUS: ABANDONED**
>
> After review, we're sticking with the plugin hook approach (`user-prompt-submit.sh`). The hook is simpler, more reliable (gets session ID directly from stdin), and works immediately when the user types the command. The daemon approach would add complexity without significant benefit for the current use case.
>
> If cross-agent support becomes a priority, this spec can be revisited.

---

Automatically detect `/openctl:share` and `/openctl:collaborate` commands in session files and share sessions without requiring per-agent plugin hooks.

## Problem

Currently, detecting share/collaborate commands requires implementing hooks in each agent plugin:
- Claude Code plugin needs a `user-prompt-submit` hook
- Other agents (Cursor, Windsurf, etc.) would need similar hooks
- Each implementation parses stdin differently, duplicating logic

## Solution

Add a "command watcher" mode to the daemon that monitors all session files for share commands, regardless of whether they're already shared.

## Architecture

### Directory-Level Watching

```
~/.claude/projects/
├── -Users-alice-project-a/
│   ├── abc-123.jsonl  <- watch for changes
│   └── def-456.jsonl
├── -Users-alice-project-b/
│   └── ghi-789.jsonl
└── ...
```

The daemon watches the entire `~/.claude/projects/` directory tree using native OS APIs:
- **macOS**: FSEvents
- **Linux**: inotify
- **Windows**: ReadDirectoryChangesW

### Detection Flow

1. **File change event** - OS notifies daemon that a `.jsonl` file was modified
2. **Debounce** - Wait 100ms for rapid successive writes to settle
3. **Read tail** - Read last 10 lines of the file (efficient, no full parse)
4. **Pattern match** - Look for `/openctl:share` or `/openctl:collaborate` at line start
5. **Check processed** - Skip if we've already processed this command for this file
6. **Auto-share** - Call `openctl session share --no-poll` for the session

### Command Pattern

```regex
^\/openctl:(?:share|collaborate)
```

Matches:
- `/openctl:share`
- `/openctl:collaborate`
- `/openctl:share with some additional text`

### State Tracking

Track processed commands to avoid re-detecting on every file change:

```typescript
interface CommandState {
  // Map of session file path -> set of detected command positions
  processed: Map<string, Set<number>>; // line number where command was found
}
```

State is ephemeral (in-memory only). If daemon restarts, it may re-detect commands, but `session share` is idempotent so this is harmless.

## Implementation

### New Module: `cli/daemon/command-watcher.ts`

```typescript
export class CommandWatcher {
  private watcher: FSWatcher;
  private debounceTimers: Map<string, Timer>;
  private processedCommands: Map<string, Set<number>>;

  constructor(
    private serverUrl: string,
    private onShare: (sessionPath: string, sessionUuid: string) => Promise<void>
  ) {}

  start(): void;
  stop(): void;

  private handleFileChange(filePath: string): void;
  private checkForCommands(filePath: string): Promise<void>;
  private readTail(filePath: string, lines: number): Promise<string[]>;
}
```

### Daemon Integration

Update `cli/daemon/index.ts`:

```typescript
// In startDaemon():
const commandWatcher = new CommandWatcher(serverUrl, async (path, uuid) => {
  // Check repo allowlist
  const projectPath = extractProjectPathFromSessionPath(path);
  const repoId = await getRepoIdentifier(projectPath);

  if (!repoId || !isRepoAllowed(serverUrl, repoId)) {
    console.log(`Skipping auto-share: repo not in allowlist`);
    return;
  }

  // Add to shared sessions and start tracking
  await addSharedSession(uuid, path, serverUrl);
  console.log(`Auto-shared session: ${uuid.slice(0, 8)}...`);
});

commandWatcher.start();
```

### Configuration

Add optional flag to enable/disable command watching:

```bash
openctl daemon start --watch-commands  # Enable (default: on)
openctl daemon start --no-watch-commands  # Disable
```

## Edge Cases

### 1. Session already shared
- `addSharedSession` is idempotent
- If already in shared-sessions.json, no-op

### 2. Repo not in allowlist
- Log message but don't prompt (daemon is non-interactive)
- User must run `openctl repo allow` first

### 3. Multiple commands in same session
- Track by line number to avoid re-processing
- Both `/openctl:share` and `/openctl:collaborate` trigger same action

### 4. Historical sessions
- Old sessions with commands will be detected on daemon start
- This is acceptable - they'll be shared, which is likely desired
- User can unshare if not wanted

### 5. Rapid file changes
- Debounce prevents excessive processing
- 100ms delay allows writes to complete

## Migration

### Phase 1: Add command watcher (this spec)
- Implement in daemon
- Keep plugin hooks as fallback

### Phase 2: Simplify plugins
- Remove share command detection from hooks
- Keep hooks for session-end and feedback only

### Phase 3: Cross-agent support
- Document that daemon handles share commands automatically
- Other agents just need session file in standard location

## Testing

1. **Unit tests**
   - Pattern matching
   - Tail reading
   - Debounce behavior

2. **Integration tests**
   - Start daemon with command watching
   - Write command to session file
   - Verify session gets shared

3. **Manual tests**
   - Type `/openctl:share` in Claude Code
   - Verify session appears in server UI
