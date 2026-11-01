<#
.SYNOPSIS
  Starts a fresh headless Claude Code session and checks from its system/init that a plugin loads.
.DESCRIPTION
  Before the child starts, every process variable named CLAUDE* is cleared, then restored right after: a child
  started from a desktop session's tool shell inherits the host's variables and reports Not logged in.
  Output goes to fixed files under -OutDir through Start-Process; capturing it into a variable inside the
  checked PowerShell entry once hung for 241 s.
  -InitOnly ends the child as soon as system/init arrives, so no model request is made; without it the turn
  runs to its end and its result must not be an error.
  -WithoutPlugin turns <Plugin>@<Marketplace> off for this run only (--settings) and expects it absent.
  The last line is PASS or FAIL: <reasons>; the exit code is 0 or 1.
.EXAMPLE
  & D:/agents/projects/claude-mods/scripts/Test-FreshSession.ps1 -InitOnly -ExpectTools mcp__handoff-status__hand_off,mcp__handoff-status__close_handoff
#>
param(
  [string]$Plugin = 'handoff-status',
  [string]$Marketplace = 'claude-mods',
  [string[]]$ExpectTools = @(),
  [switch]$WithoutPlugin,
  [switch]$InitOnly,
  [string]$Prompt = 'Reply with exactly ok',
  [string]$WorkingDirectory = (Split-Path -Parent $PSScriptRoot),
  [int]$TimeoutSeconds = 150,
  [string]$OutDir = 'D:/Codex/temp/claude-mods/fresh-session'
)
$PSNativeCommandUseErrorActionPreference = $false
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Read-Events([string]$Path) {
  # The child still holds the file open while it writes, so read with sharing; a half-written line is skipped.
  try {
    $stream = [IO.File]::Open($Path, 'Open', 'Read', 'ReadWrite')
    try { $text = [IO.StreamReader]::new($stream, [Text.UTF8Encoding]::new($false)).ReadToEnd() } finally { $stream.Dispose() }
  } catch { return @() }
  @(foreach ($line in $text -split "`n") { if ($line.Trim()) { try { $line | ConvertFrom-Json -Depth 50 } catch { } } })
}

# pwsh -File cannot bind an array, so one comma-separated string works too.
$ExpectTools = @($ExpectTools | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
$exe = (Get-Command claude -CommandType Application | Select-Object -First 1).Source
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$out = Join-Path $OutDir 'stdout.jsonl'
$err = Join-Path $OutDir 'stderr.txt'
$arguments = "-p `"$Prompt`" --output-format stream-json --verbose"
if ($WithoutPlugin) {
  $settings = Join-Path $OutDir 'settings.json'
  @{ enabledPlugins = @{ "$Plugin@$Marketplace" = $false } } | ConvertTo-Json -Compress | Set-Content -LiteralPath $settings -Encoding utf8NoBOM
  $arguments += " --settings `"$settings`""
}

$saved = @{}
foreach ($name in @(Get-ChildItem Env: | Where-Object Name -match '^CLAUDE' | ForEach-Object Name)) {
  $saved[$name] = [Environment]::GetEnvironmentVariable($name)
  [Environment]::SetEnvironmentVariable($name, $null)
}
$started = Get-Date
try {
  $p = Start-Process -FilePath $exe -ArgumentList $arguments -WorkingDirectory $WorkingDirectory -RedirectStandardOutput $out -RedirectStandardError $err -NoNewWindow -PassThru
} finally {
  foreach ($name in $saved.Keys) { [Environment]::SetEnvironmentVariable($name, $saved[$name]) }
}
$null = $p.Handle

$deadline = $started.AddSeconds($TimeoutSeconds)
while (-not $p.HasExited -and (Get-Date) -lt $deadline) {
  if ($InitOnly -and @(Read-Events $out | Where-Object { $_.type -eq 'system' -and $_.subtype -eq 'init' }).Count) { break }
  Start-Sleep -Milliseconds 250
}
$stopped = -not $p.HasExited
$leftRunning = @()
if ($stopped) {
  # taskkill reports children that are already exiting as errors, so the tree is recorded first and checked after.
  # A parent id is never cleared, so an older process whose dead parent's id our child reused would look like a
  # child: only processes created after this run started count.
  $all = @(Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, Name, CreationDate | Where-Object { $_.CreationDate -ge $started.AddSeconds(-1) })
  $tree = [Collections.Generic.List[object]]::new()
  $queue = [Collections.Generic.Queue[int]]::new()
  $queue.Enqueue($p.Id)
  while ($queue.Count) {
    $parent = $queue.Dequeue()
    foreach ($child in @($all | Where-Object ParentProcessId -eq $parent)) { $tree.Add($child); $queue.Enqueue([int]$child.ProcessId) }
  }
  & taskkill.exe /PID $p.Id /T /F 2>&1 | Out-Null
  $null = $p.WaitForExit(5000)
  $until = (Get-Date).AddSeconds(5)
  do {
    $leftRunning = @($tree | Where-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue })
    if ($leftRunning.Count) { Start-Sleep -Milliseconds 250 }
  } while ($leftRunning.Count -and (Get-Date) -lt $until)
}
$seconds = [Math]::Round(((Get-Date) - $started).TotalSeconds, 1)

$events = Read-Events $out
$init = $events | Where-Object { $_.type -eq 'system' -and $_.subtype -eq 'init' } | Select-Object -First 1
$result = $events | Where-Object { $_.type -eq 'result' } | Select-Object -First 1
$entry = if ($init) { $init.plugins | Where-Object name -eq $Plugin | Select-Object -First 1 }
$ownTools = @(if ($init) { $init.tools | Where-Object { $_ -like "mcp__${Plugin}__*" } })

"run: cleared $($saved.Count) CLAUDE* variables; $seconds s; " + $(if ($stopped) { 'child tree ended by this script' } else { "exit $($p.ExitCode)" })
if ($leftRunning.Count) { 'still running after the stop: ' + (($leftRunning | ForEach-Object { "$($_.Name) $($_.ProcessId)" }) -join ', ') }
if ($init) { "init: claude $($init.claude_code_version); cwd $($init.cwd)" }
'plugin: ' + $(if ($entry) { "$($entry.name) $($entry.version) from $($entry.path)" } else { "$Plugin absent" })
'tools: ' + $(if ($ownTools.Count) { $ownTools -join ', ' } else { "no mcp__${Plugin}__* tool" })
if ($result) { "result: subtype=$($result.subtype) is_error=$($result.is_error) text=$($result.result)" }

$problems = [Collections.Generic.List[string]]::new()
if (-not $init) {
  $problems.Add("no system/init within $seconds s (stderr: $err)")
} elseif ($WithoutPlugin) {
  if ($entry) { $problems.Add("$Plugin still loads with $Plugin@$Marketplace turned off") }
  foreach ($tool in $ExpectTools) { if ($init.tools -contains $tool) { $problems.Add("$tool still present") } }
} else {
  if (-not $entry) { $problems.Add("$Plugin is not in plugins") }
  foreach ($tool in $ExpectTools) { if ($init.tools -notcontains $tool) { $problems.Add("$tool is not in tools") } }
}
if (-not $InitOnly) {
  if (-not $result) { $problems.Add($(if ($stopped) { "the turn did not end within $TimeoutSeconds s" } else { 'no result event' })) }
  elseif ($result.is_error) { $problems.Add("result is an error: $($result.result)") }
}
if ($problems.Count) {
  Get-Content -LiteralPath $err -ErrorAction SilentlyContinue | Select-Object -First 10 | ForEach-Object { "stderr: $_" }
  'FAIL: ' + ($problems -join '; ')
  exit 1
}
'PASS'
exit 0
