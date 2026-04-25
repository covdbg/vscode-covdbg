#!/usr/bin/env bash
# Final guard: at session end, verify the workspace is formatted and lint-clean.
# This is informational only — Copilot ignores the output but the agent will
# see the failure in the session log.
set -euo pipefail

INPUT=$(cat || true)
REASON=$(printf '%s' "$INPUT" | jq -r '.reason // "complete"')

if [ "$REASON" != "complete" ]; then
    # Don't run heavy checks on aborted/timed-out/error sessions.
    exit 0
fi

if [ ! -f package.json ]; then
    exit 0
fi

echo "[hooks] Running final format:check + lint..." >&2
npm run --silent format:check >&2 || echo "[hooks] format:check FAILED" >&2
npm run --silent lint >&2         || echo "[hooks] lint FAILED" >&2

exit 0
