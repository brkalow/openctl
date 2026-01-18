#!/bin/bash
# Stop hook - checks for pending feedback and blocks if any

# Logging
LOG_DIR="${TMPDIR:-/tmp}/openctl"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/plugin.log"

log() {
  echo "[$(date -Iseconds)] [stop] $1" >> "$LOG_FILE"
}

# Read stdin (Claude Code passes JSON with session_id)
INPUT=$(cat)
log "Received input: $INPUT"

# Extract session_id using simple parsing
SESSION_ID=$(echo "$INPUT" | grep -o '"session_id":"[^"]*"' | cut -d'"' -f4)

# No session_id - allow stop
if [ -z "$SESSION_ID" ]; then
  log "No session_id found, allowing stop"
  echo '{}'
  exit 0
fi

# Check for pending feedback using the CLI
# The CLI outputs JSON: {} or {"decision":"block","reason":"..."}
log "Checking for pending feedback for session: $SESSION_ID"
RESULT=$(openctl session feedback "$SESSION_ID" 2>/dev/null) || RESULT='{}'
log "Feedback result: $RESULT"

echo "$RESULT"
exit 0
