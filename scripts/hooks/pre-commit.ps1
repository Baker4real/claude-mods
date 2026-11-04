# What a commit to claude-mods must pass; git runs it through pre-commit beside it. Each mod whose files the commit
# stages, beyond its *.md, gets scripts/Test-Mod.ps1 -Staged (the mod's checks, and its dist staged as the same
# content); a commit staging a *.md gets the OKF lint, which holds README and docs frontmatter to
# .okf-frontmatter.json. "Staged" is the index git commits from: the shared one, or the private one
# commit_exact_files.py builds and names in GIT_INDEX_FILE.
$PSNativeCommandUseErrorActionPreference = $false
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$staged = @(git -C $root diff --cached --name-only --no-renames)
$mods = @($staged | Where-Object { $_ -notlike '*.md' } | ForEach-Object {
    $parts = $_ -split '/'
    $name = if ($parts[0] -eq 'dist' -and $parts.Count -gt 2) { $parts[1] } else { $parts[0] }
    if (Test-Path -LiteralPath (Join-Path $root "$name/.claude-plugin/plugin.json")) { $name }
  } | Sort-Object -Unique)

$failed = @()
foreach ($mod in $mods) {
  $global:LASTEXITCODE = 0
  & (Join-Path $root 'scripts/Test-Mod.ps1') $mod -Staged
  if ($LASTEXITCODE -ne 0) { $failed += $mod }
}
if ($staged | Where-Object { $_ -like '*.md' }) {
  '== OKF lint'
  $okf = 'D:/Codex/.codex/skills/okf-frontmatter/scripts/run.ps1'
  if (-not (Test-Path -LiteralPath $okf)) { "FAIL: the OKF lint is not at $okf"; exit 1 }
  $global:LASTEXITCODE = 0
  $output = @(& $okf --repo $root lint --ci 2>&1 | ForEach-Object { "$_" })
  if ($LASTEXITCODE -ne 0) {
    $output | Select-Object -Last 40
    $failed += 'OKF lint'
  } else { 'ok' }
}
if ($failed.Count) { "FAIL: $($failed -join ', '); nothing is committed"; exit 1 }
