# MooseClaw Dashboard — daily unattended update.
# Runs Claude Code headlessly against scripts/daily-dashboard-prompt.md and logs the result.
# Scheduled via Windows Task Scheduler (see scripts/register-scheduled-tasks.ps1).

$ErrorActionPreference = "Stop"

$repoRoot = "C:\Users\rcamo\Documents\Claude\lm3dptfy"
$promptFile = Join-Path $repoRoot "scripts\daily-dashboard-prompt.md"
$logDir = Join-Path $repoRoot "scripts\logs"
$claudeExe = "C:\Users\rcamo\.local\bin\claude.exe"

if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

$timestamp = Get-Date -Format "yyyy-MM-dd_HHmmss"
$logFile = Join-Path $logDir "daily-$timestamp.log"

Set-Location $repoRoot

"=== MooseClaw daily update started: $(Get-Date) ===" | Out-File -FilePath $logFile -Encoding utf8

try {
    $promptContent = Get-Content $promptFile -Raw
    $promptContent | & $claudeExe -p --permission-mode bypassPermissions --allowedTools "WebSearch WebFetch Read Edit Write Bash Glob Grep" 2>&1 |
        Tee-Object -FilePath $logFile -Append

    "=== Exit code: $LASTEXITCODE ===" | Out-File -FilePath $logFile -Append -Encoding utf8
} catch {
    "=== ERROR: $($_.Exception.Message) ===" | Out-File -FilePath $logFile -Append -Encoding utf8
    throw
}

# Keep only the last 30 days of logs.
Get-ChildItem $logDir -Filter "daily-*.log" |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
    Remove-Item -Force -ErrorAction SilentlyContinue
