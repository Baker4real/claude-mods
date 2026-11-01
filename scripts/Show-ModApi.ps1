<#
.SYNOPSIS
  Prints what the engine's mod API types declare under a name, each declaration with its doc comment.
.DESCRIPTION
  The API file runs to about 16,000 lines; reading slices of it is what made API lookups expensive. This prints
  only the declarations named -Name: an event ('tool.call', or 'classic.Stop', found as the SDK's StopHookInput that
  is its e), a member of $ (surfaces, or session.surfaces), a type or interface (ToolCallResult, McpToolInputs) or an
  element (Pane). A block longer than -MaxLines is shown as an outline of its members; -Full prints all of it.
  EngineEventOf outlines every event the engine raises, OpEventOf every call on $.
  The default file is the running build's API: the newest
  D:/Codex/temp/claude/bundled-skills/<version>/<hash>/plugin-authoring/types/claude-code.d.ts, which the
  plugin-authoring skill writes each time it loads. Without one it is <mod>/.claude-plugin/types/claude-code/index.d.ts,
  which the engine lays only in a mod folder it hot-reloads. Pass -TypesPath for another copy.
.EXAMPLE
  & D:/agents/projects/claude-mods/scripts/Show-ModApi.ps1 tool.call
.EXAMPLE
  & D:/agents/projects/claude-mods/scripts/Show-ModApi.ps1 Pane -Full
#>
param(
  [Parameter(Mandatory, Position = 0)][string]$Name,
  [string]$Mod = 'handoff-status',
  [string]$TypesPath,
  [int]$MaxLines = 60,
  [int]$MaxMatches = 8,
  [switch]$Full
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

if (-not $TypesPath) {
  # Highest version first, then the copy written last; the folder under the version is a per-process hash.
  $bundled = 'D:/Codex/temp/claude/bundled-skills'
  $TypesPath = @(if (Test-Path -LiteralPath $bundled) {
    Get-ChildItem -LiteralPath $bundled -Directory | Where-Object { $_.Name -as [version] } | Sort-Object { [version]$_.Name } -Descending |
      ForEach-Object { Get-ChildItem -Path (Join-Path $_.FullName '*/plugin-authoring/types/claude-code.d.ts') -File | Sort-Object LastWriteTime -Descending }
  }) | Select-Object -First 1 | ForEach-Object FullName
  if (-not $TypesPath) { $TypesPath = Join-Path (Split-Path -Parent $PSScriptRoot) "$Mod/.claude-plugin/types/claude-code/index.d.ts" }
}
if (-not (Test-Path -LiteralPath $TypesPath)) {
  throw "no API types at $TypesPath; the engine lays them only in a mod folder it hot-reloads, so pass -TypesPath"
}
$TypesPath = (Resolve-Path -LiteralPath $TypesPath).ProviderPath
$lines = [IO.File]::ReadAllLines($TypesPath)
# Quoted event names and '$.session.surfaces' work as typed.
$Name = $Name.Trim() -replace '^[''"]|[''"]$' -replace '^\$\.'
# A classic hook's e is the Agent SDK's <Event>HookInput (ClassicHookInputs), but classic.PreToolUse's is ToolCallEnvelope.
if ($Name -match '^classic\.(\w+)$') {
  $Name = if ($Matches[1] -eq 'PreToolUse') { 'ToolCallEnvelope' } else { "$($Matches[1])HookInput" }
  "classic.$($Matches[1]): e is $Name"
}

# Comment lines, doc-comment examples included, never count as declarations or brackets.
$isComment = [bool[]]::new($lines.Count)
$open = $false
for ($i = 0; $i -lt $lines.Count; $i++) {
  $t = $lines[$i].Trim()
  if ($open -or $t.StartsWith('/*')) { $isComment[$i] = $true; $open = -not $t.Contains('*/') }
  elseif ($t.StartsWith('//')) { $isComment[$i] = $true }
}

function Get-Depth([int]$Index) {
  if ($isComment[$Index]) { return 0 }
  # Brackets inside string literals and trailing comments do not count.
  $code = $lines[$Index] -replace '''[^'']*''|"[^"]*"', "''" -replace '/\*.*?\*/|//.*$'
  ([regex]::Matches($code, '[{(\[]')).Count - ([regex]::Matches($code, '[})\]]')).Count
}
function Get-End([int]$Start) {
  $depth = 0
  for ($j = $Start; $j -lt $lines.Count; $j++) {
    $depth += Get-Depth $j
    $t = $lines[$j].TrimEnd()
    if ($depth -le 0 -and -not $isComment[$j] -and ($t.EndsWith(';') -or $t.EndsWith('}') -or $t.EndsWith(','))) { return $j }
  }
  $lines.Count - 1
}
function Get-Chain([int]$Start) {
  # The enclosing blocks: each earlier line, less indented than the last one found, that opens a block.
  $indent = $lines[$Start].Length - $lines[$Start].TrimStart().Length
  $chain = @()
  for ($k = $Start - 1; $k -ge 0 -and $indent -gt 0; $k--) {
    if ($isComment[$k]) { continue }
    $t = $lines[$k].Trim()
    if (-not $t) { continue }
    $ind = $lines[$k].Length - $lines[$k].TrimStart().Length
    if ($ind -lt $indent -and $t.EndsWith('{')) {
      $label = $t.TrimEnd('{').Trim()
      if ($label.Length -gt 70) { $label = $label.Substring(0, 70) + '...' }
      $chain = @($label) + $chain
      $indent = $ind
    }
  }
  $chain -join ' > '
}
function Find-Declarations([string]$Wanted) {
  $q = [regex]::Escape($Wanted)
  $declaration = [regex]::new("^\s*(export\s+)?(declare\s+)?(interface|type|class|enum|namespace|function|const|let|var)\s+$q\b")
  $member = [regex]::new("^\s*(readonly\s+)?(['""]$q['""]|$q)\??\s*[:(<]")
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if (-not $isComment[$i] -and ($declaration.IsMatch($lines[$i]) -or $member.IsMatch($lines[$i]))) { $i }
  }
}

$found = @(Find-Declarations $Name)
if ($Name.Contains('.')) {
  # session.surfaces also names the member surfaces of a block opened by session: (within any blocks named before it).
  $parts = $Name.Split('.')
  $found = @(@($found) + @(Find-Declarations $parts[-1] | Where-Object {
    $chain = Get-Chain $_
    -not @($parts[0..($parts.Count - 2)] | Where-Object { $chain -notmatch "(^| > )(readonly\s+)?['""]?$([regex]::Escape($_))['""]?\??:" }).Count
  }) | Sort-Object -Unique)
}
if (-not $found.Count) { "no declaration named '$Name' in $TypesPath; search the text instead: rg -n -F '$Name' '$TypesPath'"; exit 1 }

"types: $TypesPath"
foreach ($start in @($found | Select-Object -First $MaxMatches)) {
  $end = Get-End $start
  $docStart = $start
  if ($start -gt 0 -and $isComment[$start - 1] -and $lines[$start - 1].Trim().EndsWith('*/')) {
    $docStart = $start - 1
    while ($docStart -gt 0 -and -not $lines[$docStart].Trim().StartsWith('/*')) { $docStart-- }
  }
  $chain = Get-Chain $start
  ''
  "== line $($start + 1)" + $(if ($chain) { "  in $chain" })
  if ($docStart -lt $start) { $lines[$docStart..($start - 1)] }
  $length = $end - $start + 1
  if ($Full -or $length -le $MaxLines) {
    $lines[$start..$end]
  } else {
    # The block's own lines: its members and the separators of a union, without doc comments or nested blocks.
    $lines[$start]
    $depth = Get-Depth $start
    for ($j = $start + 1; $j -lt $end; $j++) {
      if ($depth -le 1 -and -not $isComment[$j] -and $lines[$j].Trim()) {
        $t = $lines[$j].TrimEnd()
        if ($t.Length -gt 110) { $t = $t.Substring(0, 110) + '...' }
        $t
      }
      $depth += Get-Depth $j
    }
    $lines[$end]
    "   (outline of $length lines without doc comments or nested blocks; -Full prints them all)"
  }
}
if ($found.Count -gt $MaxMatches) { ''; "$($found.Count - $MaxMatches) more matches not shown; raise -MaxMatches" }
