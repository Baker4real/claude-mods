<#
.SYNOPSIS
  Lays out a mod's bands offline the way the desktop does, and fails when a truncating Text runs past one line or a
  band overflows its width.
.DESCRIPTION
  claude plugin test compares trees and lays nothing out, so a band that wraps or spills on the desktop passes it.
  The mod's tests/layout.dump.tsx mounts its bands at chosen bodyColumns and prints each drawn tree as one line,
  DUMP:<case>-<bodyColumns>:<tree>. It is not named *.test.tsx, so claude plugin test on the mod skips it (tests have
  no environment variables to switch it with); this script copies the mod's runtime files and that file, renamed,
  into <OutDir>/probe and runs it alone there. scripts/render-band-trees.mjs then draws the trees with the desktop's
  Box, Text and Svg style rules (docs/desktop-rendering.md), each band <bodyColumns> * -ColumnPx wide, and headless
  Edge reports, per case, the truncating Text that runs past one line and how far the band overflows.
  Fonts, spacing tokens and -ColumnPx are stand-ins, so a pass is a lead, not proof; the real desktop has the last
  word (scripts/Capture-ClaudeWindow.ps1). -Screenshot also saves band-light.png and band-dark.png.
  Exits 1 on a wrap, an overflow, or a driver that prints no tree.
.EXAMPLE
  & D:/agents/projects/claude-mods/scripts/Test-BandLayout.ps1 context-bar-zh -Screenshot
#>
param(
  [Parameter(Mandatory, Position = 0)][string]$Mod,
  [double]$ColumnPx = 7.8, # one bodyColumn in CSS px: the desktop counts columns in its code font's advance
  [string]$OutDir,
  [switch]$Screenshot
)
$PSNativeCommandUseErrorActionPreference = $false
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
. (Join-Path $PSScriptRoot 'ModFiles.ps1')

$root = Split-Path -Parent $PSScriptRoot
$src = [IO.Path]::GetFullPath((Join-Path $root $Mod))
$driver = Join-Path $src 'tests/layout.dump.tsx'
if (-not (Test-Path -LiteralPath $driver)) { throw "no layout driver: $driver (see this script's help)" }
if (-not $OutDir) { $OutDir = "D:/Codex/temp/claude-mods/band-layout/$Mod" }
$OutDir = [IO.Path]::GetFullPath($OutDir)
$probe = Join-Path $OutDir 'probe'
$edge = @("${env:ProgramFiles(x86)}/Microsoft/Edge/Application/msedge.exe", "$env:ProgramFiles/Microsoft/Edge/Application/msedge.exe") | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $edge) { throw 'Microsoft Edge not found' }

# The copy is overwritten, never cleared: a file the mod dropped stays behind, unused unless hooks.json names it.
foreach ($rel in @(Get-ModRuntime $src) + 'tests/layout.dump.test.tsx') {
  $from = if ($rel -eq 'tests/layout.dump.test.tsx') { $driver } else { Join-Path $src $rel }
  $target = Join-Path $probe $rel
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
  Copy-Item -LiteralPath $from -Destination $target -Force
}
"== layout driver ($probe)"
$global:LASTEXITCODE = 0
$output = @(claude plugin test $probe 2>&1 | ForEach-Object { "$_" })
$code = $LASTEXITCODE
$dumps = @($output | Where-Object { $_ -match '^DUMP:' })
if ($code -ne 0 -or -not $dumps.Count) {
  $output | Where-Object { $_ -notmatch '^DUMP:' } | Select-Object -Last 30
  "FAIL: the layout driver exited $code and printed $($dumps.Count) trees"
  exit 1
}
$trees = Join-Path $OutDir 'trees.txt'
[IO.File]::WriteAllLines($trees, [string[]]$dumps, [Text.UTF8Encoding]::new($false))
"$($dumps.Count) trees"

$global:LASTEXITCODE = 0
$pages = @(node (Join-Path $PSScriptRoot 'render-band-trees.mjs') $trees $OutDir $ColumnPx 2>&1 | ForEach-Object { "$_" })
if ($LASTEXITCODE -ne 0) { $pages; 'FAIL: render-band-trees.mjs failed'; exit 1 }
$edgeProfile = Join-Path $OutDir 'edge-profile'
$url = { param($theme) 'file:///' + (Join-Path $OutDir "band-$theme.html").Replace('\', '/') }

# Edge is a GUI program: PowerShell waits for it only when its output goes down a pipeline (with 2>$null and no
# pipeline it returns at once, with nothing).
$dom = @(& $edge --headless=new --disable-gpu --no-first-run "--user-data-dir=$edgeProfile" --dump-dom (& $url 'light') 2>&1 | ForEach-Object { "$_" }) -join "`n"
$found = [regex]::Match($dom, '<pre id="metrics"[^>]*>([A-Za-z0-9+/=]+)</pre>')
if (-not $found.Success) { 'FAIL: Edge returned no layout metrics'; exit 1 }
$metrics = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($found.Groups[1].Value)) | ConvertFrom-Json

"== layout at $ColumnPx px per column"
$metrics.cases | ForEach-Object {
  [pscustomobject]@{ case = $_.name; width = $_.width; height = $_.height; overflow = $_.overflow; wrapped = (@($_.wrapped) -join ' | ') }
} | Format-Table -AutoSize | Out-String -Width 220 | ForEach-Object { $_.TrimEnd() }

if ($Screenshot) {
  foreach ($theme in 'light', 'dark') {
    $png = Join-Path $OutDir "band-$theme.png"
    & $edge --headless=new --disable-gpu --no-first-run "--user-data-dir=$edgeProfile" --hide-scrollbars --force-device-scale-factor=2 "--window-size=$($metrics.page.width),$($metrics.page.height)" "--screenshot=$png" (& $url $theme) 2>&1 | Out-Null
    if (-not (Test-Path -LiteralPath $png)) { "FAIL: no screenshot at $png"; exit 1 }
    $png
  }
}

$bad = @($metrics.cases | Where-Object { $_.overflow -gt 0 -or @($_.wrapped).Count })
if ($bad.Count) { "FAIL: $($bad.Count) of $(@($metrics.cases).Count) cases wrap a truncating Text or overflow: $(@($bad.name) -join ', ')"; exit 1 }
"PASS: $(@($metrics.cases).Count) cases, no truncating Text past one line, no overflow"
