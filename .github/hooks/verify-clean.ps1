#requires -Version 7
# Final guard: at session end, verify the workspace is formatted and lint-clean.
$ErrorActionPreference = "Continue"

try {
    $raw = [Console]::In.ReadToEnd()
    $payload = if ([string]::IsNullOrWhiteSpace($raw)) { $null } else { $raw | ConvertFrom-Json }
}
catch {
    $payload = $null
}

$reason = if ($payload -and $payload.reason) { $payload.reason } else { "complete" }
if ($reason -ne "complete") { exit 0 }

if (-not (Test-Path -LiteralPath "package.json")) { exit 0 }

Write-Host "[hooks] Running final format:check + lint..."
& npm run --silent format:check
if ($LASTEXITCODE -ne 0) { Write-Host "[hooks] format:check FAILED" }

& npm run --silent lint
if ($LASTEXITCODE -ne 0) { Write-Host "[hooks] lint FAILED" }

exit 0
