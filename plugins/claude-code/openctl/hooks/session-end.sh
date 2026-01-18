#!/bin/bash
# SessionEnd hook - unshares the session so the daemon can properly complete it

set -e

# Logging
LOG_DIR="${TMPDIR:-/tmp}/openctl"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/plugin.log"

log() {
  echo "[$(date -Iseconds)] [session-end] $1" >> "$LOG_FILE"
}

# Read stdin (Claude Code passes JSON with session_id)
INPUT=$(cat)
log "Received input: $INPUT"

# Extract session_id using simple parsing
SESSION_ID=$(echo "$INPUT" | grep -o '"session_id":"[^"]*"' | cut -d'"' -f4)

# Exit if no session_id
if [ -z "$SESSION_ID" ]; then
  log "No session_id found, exiting"
  exit 0
fi

# Unshare the session - this removes it from shared-sessions.json
# The daemon will detect this change and properly complete the session
log "Unsharing session: $SESSION_ID"
UNSHARE_OUTPUT=$(openctl session unshare "$SESSION_ID" 2>&1) && UNSHARE_EXIT_CODE=0 || UNSHARE_EXIT_CODE=$?
log "Unshare output: $UNSHARE_OUTPUT"
log "Unshare exit code: $UNSHARE_EXIT_CODE"

exit 0
