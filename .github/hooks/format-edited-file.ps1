#requires -Version 7
# Auto-format files just after Copilot's `edit` / `create` tool calls.
# Reads the postToolUse JSON payload from stdin, extracts the file path,
# and runs Prettier on it if the path is supported.
$ErrorActionPreference = "Stop"

try {
    $raw = [Console]::In.ReadToEnd()
    if ([string]::IsNullOrWhiteSpace($raw)) { exit 0 }
    $payload = $raw | ConvertFrom-Json
}
catch {
    exit 0
}

$editTools = @(
    "edit",
    "create",
    "str_replace",
    "replace_string_in_file",
    "multi_replace_string_in_file",
    "create_file"
)
if ($editTools -notcontains $payload.toolName) { exit 0 }

if ($payload.toolResult -and $payload.toolResult.resultType -and
    $payload.toolResult.resultType -ne "success") {
    exit 0
}

try {
    $args = $payload.toolArgs | ConvertFrom-Json
}
catch {
    exit 0
}

$paths = New-Object System.Collections.Generic.HashSet[string]
foreach ($key in @("filePath", "file_path", "path")) {
    $value = $args.$key
    if ($value) { [void]$paths.Add([string]$value) }
}
if ($args.replacements) {
    foreach ($r in $args.replacements) {
        if ($r.filePath) { [void]$paths.Add([string]$r.filePath) }
    }
}

if ($paths.Count -eq 0) { exit 0 }

$supported = @(
    ".ts", ".tsx", ".js", ".cjs", ".mjs",
    ".json", ".jsonc", ".md", ".yml", ".yaml",
    ".html", ".css"
)

foreach ($p in $paths) {
    if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { continue }
    $ext = [System.IO.Path]::GetExtension($p).ToLowerInvariant()
    if ($supported -notcontains $ext) { continue }
    try {
        npx --no-install prettier --write --log-level warn $p 2>&1 | Out-Host
    }
    catch {
        # Never fail the hook on formatter errors.
    }
}

exit 0
