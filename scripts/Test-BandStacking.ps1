<#
.SYNOPSIS
  Checks that a mod's band hooks stack on what other mods draw there.
.DESCRIPTION
  AbovePrompt and BelowPrompt hold every mod's bands, and a ui.render hook's tree replaces what the hooks beneath it
  drew, so a band hook that returns only its own tree hides the other mods' bands (handoff-status 0.1.0 hid
  context-bar-zh's this way). Each hooks file that names one of the two must call stackBands from hooks/bands.ts on
  next(e)'s tree. Exits 1 and lists each file that draws a band without it; Publish-Mod.ps1 runs this before it
  publishes.
.EXAMPLE
  & D:/agents/projects/claude-mods/scripts/Test-BandStacking.ps1 D:/agents/projects/claude-mods/handoff-status
#>
param([Parameter(Mandatory, Position = 0)][string]$Path)
$ErrorActionPreference = 'Stop'

$hooks = Join-Path $Path 'hooks'
$files = @(if (Test-Path -LiteralPath $hooks) { Get-ChildItem -LiteralPath $hooks -Recurse -File -Include *.ts, *.tsx, *.js, *.jsx, *.mjs })
$unstacked = @(foreach ($file in $files) {
  $text = Get-Content -LiteralPath $file.FullName -Raw
  $bands = @([regex]::Matches($text, '[''"](AbovePrompt|BelowPrompt)[''"]') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique)
  # A call, not bands.ts's own declaration of it.
  if ($bands.Count -and $text -notmatch '(?<!function\s+)\bstackBands\(') { "$($file.FullName) draws $($bands -join ' and ') without stackBands" }
})
if ($unstacked.Count) {
  $unstacked
  'FAIL: take const rest = await next(e) and return stackBands(rest, ...) from hooks/bands.ts (copy it from handoff-status), so the bands other mods draw there stay'
  exit 1
}
"ok: $($files.Count) hooks file(s), no band drawn without stackBands"
