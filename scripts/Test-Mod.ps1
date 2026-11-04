<#
.SYNOPSIS
  Runs a mod's checks on its working copy: claude plugin validate, claude plugin test, tsc --noEmit and
  scripts/Test-BandStacking.ps1.
.DESCRIPTION
  Publish-Mod.ps1 runs these before it publishes, and the pre-commit hook (scripts/hooks/pre-commit.ps1) runs them
  with -Staged before a commit that stages the mod's files. -Staged also holds what git stages (the index, or the one
  GIT_INDEX_FILE names) to one content: each runtime file staged under <mod>/ must be staged under dist/<mod>/ as the
  same blob, and dist/<mod>/ must stage nothing else. So a commit carries a mod's source only with the dist published
  from it, and no dist edited by hand. The other checks read the working copy, which may hold edits the commit
  leaves out. Exits 1 when any check fails.
.EXAMPLE
  & D:/agents/projects/claude-mods/scripts/Test-Mod.ps1 context-bar-zh
#>
param([Parameter(Mandatory, Position = 0)][string]$Mod, [switch]$Staged)
$PSNativeCommandUseErrorActionPreference = $false
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
. (Join-Path $PSScriptRoot 'ModFiles.ps1')

$root = Split-Path -Parent $PSScriptRoot
$src = [IO.Path]::GetFullPath((Join-Path $root $Mod))
if (-not (Test-Path -LiteralPath (Join-Path $src '.claude-plugin/plugin.json'))) { throw "not a mod folder: $src" }

$failed = @()
foreach ($check in @(
  @{ label = 'claude plugin validate'; run = { claude plugin validate $src } },
  @{ label = 'claude plugin test'; run = { claude plugin test $src } },
  @{ label = 'tsc --noEmit'; run = { tsc -p $src --noEmit } },
  @{ label = 'band hooks stack'; run = { & (Join-Path $PSScriptRoot 'Test-BandStacking.ps1') $src } }
)) {
  "== $($check.label)"
  $global:LASTEXITCODE = 0
  $output = @(& $check.run 2>&1 | ForEach-Object { "$_" })
  if ($LASTEXITCODE -ne 0) {
    $output | Select-Object -Last 40
    "exit=$LASTEXITCODE"
    $failed += $check.label
  } else { 'ok' }
}

if ($Staged) {
  "== staged dist/$Mod"
  $source = @{}
  $published = @{}
  foreach ($line in @(git -C $root ls-files -s -- $Mod "dist/$Mod")) {
    $meta, $path = $line -split "`t", 2 # <mode> <blob> <stage>, then the path
    $blob = ($meta -split ' ')[1]
    if ($path.StartsWith("dist/$Mod/")) { $published[$path.Substring("dist/$Mod/".Length)] = $blob }
    elseif (Test-ModRuntimePath $path.Substring("$Mod/".Length)) { $source[$path.Substring("$Mod/".Length)] = $blob }
  }
  $mismatch = @(
    foreach ($rel in $source.Keys) {
      if (-not $published.ContainsKey($rel)) { "staged in $Mod but not in dist/${Mod}: $rel" }
      elseif ($published[$rel] -ne $source[$rel]) { "staged differently in $Mod and dist/${Mod}: $rel" }
    }
    foreach ($rel in $published.Keys) { if (-not $source.ContainsKey($rel)) { "staged in dist/$Mod but not in ${Mod}: $rel" } }
  )
  if ($mismatch.Count) {
    $mismatch | Sort-Object
    "publish with scripts/Publish-Mod.ps1 $Mod, then stage $Mod and dist/$Mod together"
    $failed += "staged dist/$Mod"
  } else { 'ok' }
}

if ($failed.Count) { "FAIL: $Mod did not pass: $($failed -join ', ')"; exit 1 }
"PASS: $Mod"
