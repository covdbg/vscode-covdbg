#!/usr/bin/env bash
# Auto-format files just after Copilot's `edit` / `create` tool calls.
# Reads the postToolUse JSON payload from stdin, extracts the file path
# from toolArgs, and runs Prettier on it if the path is supported.
set -euo pipefail

INPUT=$(cat)

# Only act on file-mutating tools.
TOOL_NAME=$(printf '%s' "$INPUT" | jq -r '.toolName // empty')
case "$TOOL_NAME" in
    edit | create | str_replace | multi_replace_string_in_file | replace_string_in_file | create_file)
        ;;
    *)
        exit 0
        ;;
esac

# Only run on successful tool calls.
RESULT_TYPE=$(printf '%s' "$INPUT" | jq -r '.toolResult.resultType // "success"')
if [ "$RESULT_TYPE" != "success" ]; then
    exit 0
fi

# Extract candidate paths from toolArgs (handle different argument shapes).
PATHS=$(printf '%s' "$INPUT" \
    | jq -r '.toolArgs' \
    | jq -r '
        [
            .filePath?,
            .file_path?,
            .path?,
            (.replacements? // [] | .[]?.filePath?)
        ]
        | map(select(. != null and . != ""))
        | unique
        | .[]'
)

if [ -z "$PATHS" ]; then
    exit 0
fi

while IFS= read -r raw_path; do
    [ -z "$raw_path" ] && continue
    # Skip files outside the repo or that no longer exist.
    if [ ! -f "$raw_path" ]; then
        continue
    fi
    case "$raw_path" in
        *.ts | *.tsx | *.js | *.cjs | *.mjs | *.json | *.jsonc | *.md | *.yml | *.yaml | *.html | *.css)
            npx --no-install prettier --write --log-level warn "$raw_path" >&2 || true
            ;;
    esac
done <<< "$PATHS"

exit 0
