#!/bin/bash
# UserPromptSubmit hook - detects /openctl:share and /openctl:collaborate commands

set -e

# Logging
LOG_DIR="${TMPDIR:-/tmp}/openctl"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/plugin.log"

log() {
  echo "[$(date -Iseconds)] [user-prompt-submit] $1" >> "$LOG_FILE"
}

# Read stdin (Claude Code passes JSON with session_id and user_prompt)
INPUT=$(cat)
log "Received input: $INPUT"

# Extract fields using simple parsing
# NOTE: This grep/cut approach is fragile and will fail if values contain escaped
# quotes or special characters. We avoid requiring jq since it may not be installed.
# For our use case, session_id is a UUID (safe) and we only need the prompt prefix.
SESSION_ID=$(echo "$INPUT" | grep -o '"session_id":"[^"]*"' | cut -d'"' -f4)
USER_PROMPT=$(echo "$INPUT" | grep -o '"prompt":"[^"]*"' | cut -d'"' -f4)

# Exit if no session_id
if [ -z "$SESSION_ID" ]; then
  exit 0
fi

# Check if prompt starts with /openctl:share or /openctl:collaborate
log "Checking prompt: '$USER_PROMPT'"
case "$USER_PROMPT" in
  "/openctl:share"*|"/openctl:collaborate"*)
    log "Matched share/collaborate command, triggering session share"

    # Share the session using the CLI (starts daemon automatically if needed)
    SHARE_OUTPUT=$(openctl session share "$SESSION_ID" 2>&1) && SHARE_EXIT_CODE=0 || SHARE_EXIT_CODE=$?
    log "Session share output: $SHARE_OUTPUT"
    log "Session share exit code: $SHARE_EXIT_CODE"

    # If repository not allowed, allow it and retry
    if echo "$SHARE_OUTPUT" | grep -q "Repository not allowed"; then
      log "Repository not allowed, attempting to allow it"
      ALLOW_OUTPUT=$(openctl repo allow 2>&1) && ALLOW_EXIT_CODE=0 || ALLOW_EXIT_CODE=$?
      log "Repo allow output: $ALLOW_OUTPUT"
      log "Repo allow exit code: $ALLOW_EXIT_CODE"

      if [ "$ALLOW_EXIT_CODE" -eq 0 ]; then
        log "Repository allowed, retrying session share"
        SHARE_OUTPUT=$(openctl session share "$SESSION_ID" 2>&1) && SHARE_EXIT_CODE=0 || SHARE_EXIT_CODE=$?
        log "Retry session share output: $SHARE_OUTPUT"
        log "Retry session share exit code: $SHARE_EXIT_CODE"
      fi
    fi
    ;;
  *)
    log "No match for share/collaborate"
    ;;
esac

exit 0
