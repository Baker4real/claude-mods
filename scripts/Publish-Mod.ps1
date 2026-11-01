<#
.SYNOPSIS
  Publishes a mod from its working copy to dist/<mod>, the folder the installed plugin reads.
.DESCRIPTION
  First runs claude plugin validate, claude plugin test, tsc --noEmit and scripts/Test-BandStacking.ps1 (band hooks
  stack on other mods' bands) on the working copy; if any fails the script exits 1 and dist is left as it was.
  When all pass, the files a session loads (.claude-plugin/plugin.json, hooks/, types/, and assets/, commands/,
  agents/, skills/ when present) are copied into dist/<mod>, after the files already there are copied over
  dist/.previous/<mod>. dist is then validated, and restored from that copy if it fails.
  Nothing is deleted: when dist holds a file the working copy no longer has, the script refuses and lists it;
  move it out with the managed recycle entry, then run again.
  A version names one content: when dist already holds the working copy's version, changed runtime files are
  refused until the version is bumped. Sessions load dist itself (README.md, under 发布, has the desktop's evidence);
  an install also keeps a copy named for its version (installPath in installed_plugins.json under the config
  directory), which the script brings in step with dist by running claude plugin update, then checks against dist.
  Sessions opened after a publish load the new version, and open desktop sessions were seen taking it up without
  reopening (README.md, under 发布); check a headless one with scripts/Test-FreshSession.ps1.
.EXAMPLE
  & D:/agents/projects/claude-mods/scripts/Publish-Mod.ps1 handoff-status
#>
param([Parameter(Mandatory, Position = 0)][string]$Mod)
$PSNativeCommandUseErrorActionPreference = $false
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$root = Split-Path -Parent $PSScriptRoot
$src = [IO.Path]::GetFullPath((Join-Path $root $Mod))
$dist = [IO.Path]::GetFullPath((Join-Path $root "dist/$Mod"))
$previous = [IO.Path]::GetFullPath((Join-Path $root "dist/.previous/$Mod"))
if (-not (Test-Path -LiteralPath (Join-Path $src '.claude-plugin/plugin.json'))) { throw "not a mod folder: $src" }

function Get-RelativeFiles([string]$Dir) {
  @(Get-ChildItem -LiteralPath $Dir -Recurse -File -Force | ForEach-Object { [IO.Path]::GetRelativePath($Dir, $_.FullName).Replace('\', '/') })
}
# The runtime files $Dir lacks or holds otherwise than $From.
function Get-Mismatch([string]$Dir, [string]$From) {
  $runtime | Where-Object {
    $copy = Join-Path $Dir $_
    -not (Test-Path -LiteralPath $copy) -or (Get-FileHash -LiteralPath $copy).Hash -ne (Get-FileHash -LiteralPath (Join-Path $From $_)).Hash
  }
}
# The mod's installs, one per scope.
$installedFile = Join-Path $(if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME '.claude' }) 'plugins/installed_plugins.json'
function Get-Installs {
  if (-not (Test-Path -LiteralPath $installedFile)) { return }
  $plugins = (Get-Content -LiteralPath $installedFile -Raw | ConvertFrom-Json).plugins
  $plugins.PSObject.Properties | Where-Object Name -eq "$Mod@claude-mods" | ForEach-Object { $_.Value }
}

# What a session loads. Tests, tsconfig and the engine-laid .claude-plugin/types stay behind.
$runtime = @('.claude-plugin/plugin.json') + @(foreach ($sub in 'hooks', 'types', 'assets', 'commands', 'agents', 'skills') {
  $path = Join-Path $src $sub
  if (Test-Path -LiteralPath $path) { Get-RelativeFiles $path | ForEach-Object { "$sub/$_" } }
})

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
if ($failed.Count) { "FAIL: $($failed -join ', ') did not pass; dist is unchanged"; exit 1 }

$existing = @(if (Test-Path -LiteralPath $dist) { Get-RelativeFiles $dist })
$extra = @($existing | Where-Object { $runtime -notcontains $_ })
if ($extra.Count) {
  $extra | ForEach-Object { "extra in dist: $_" }
  "FAIL: dist holds files the working copy no longer has; move them out with the managed recycle entry, then publish again"
  exit 1
}

# A version names one content: sessions and checks report the version loaded, and claude plugin update skips a
# version already installed (an unchanged one reports up_to_date).
$version = (Get-Content -LiteralPath (Join-Path $src '.claude-plugin/plugin.json') -Raw | ConvertFrom-Json).version
$manifest = Join-Path $dist '.claude-plugin/plugin.json'
$published = if (Test-Path -LiteralPath $manifest) { (Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json).version }
$unbumped = @(if ($published -eq $version) { Get-Mismatch $dist $src })
if ($unbumped.Count) {
  $unbumped | ForEach-Object { "changed under published ${version}: $_" }
  "FAIL: dist already holds $Mod $version and these files changed; bump version in $Mod/.claude-plugin/plugin.json, then publish again; dist is unchanged"
  exit 1
}

foreach ($rel in $existing) {
  $target = Join-Path $previous $rel
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
  Copy-Item -LiteralPath (Join-Path $dist $rel) -Destination $target -Force
}
foreach ($rel in $runtime) {
  $target = Join-Path $dist $rel
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
  Copy-Item -LiteralPath (Join-Path $src $rel) -Destination $target -Force
}

"== claude plugin validate (dist)"
$global:LASTEXITCODE = 0
$output = @(claude plugin validate $dist 2>&1 | ForEach-Object { "$_" })
$code = $LASTEXITCODE
$mismatch = @(Get-Mismatch $dist $src)
if ($code -ne 0 -or $mismatch.Count) {
  $output | Select-Object -Last 40
  $mismatch | ForEach-Object { "differs from the working copy: $_" }
  if ($existing.Count) {
    foreach ($rel in $existing) { Copy-Item -LiteralPath (Join-Path $previous $rel) -Destination (Join-Path $dist $rel) -Force }
    $added = @($runtime | Where-Object { $existing -notcontains $_ })
    $added | ForEach-Object { "left in dist by this run: $_" }
    'FAIL: dist did not validate; its previous files are restored from dist/.previous'
  } else {
    'FAIL: dist did not validate; this was its first publish, so there is no previous version to restore'
  }
  exit 1
}
'ok'

$marketplace = Get-Content -LiteralPath (Join-Path $root '.claude-plugin/marketplace.json') -Raw | ConvertFrom-Json
$listed = $marketplace.plugins | Where-Object name -eq $Mod | Select-Object -First 1
if (-not $listed) {
  "PASS: $Mod $version published to $dist ($($runtime.Count) files), but .claude-plugin/marketplace.json does not list $Mod, so no session loads it"
  exit 0
}
if ($listed.source -ne "./dist/$Mod") {
  "PASS: $Mod $version published to $dist ($($runtime.Count) files), but the marketplace entry points at $($listed.source), so the installed plugin does not read dist"
  exit 0
}
$installs = @(Get-Installs)
if (-not $installs.Count) {
  "PASS: $Mod $version published to $dist ($($runtime.Count) files), but $Mod@claude-mods is not installed: claude plugin install $Mod@claude-mods"
  exit 0
}
foreach ($install in @($installs | Where-Object version -ne $version)) {
  "== claude plugin update $Mod@claude-mods --scope $($install.scope) ($($install.version) -> $version)"
  $global:LASTEXITCODE = 0
  $output = @(claude plugin update "$Mod@claude-mods" --scope $install.scope --json 2>&1 | ForEach-Object { "$_" })
  $code = $LASTEXITCODE
  $output | Select-Object -Last 10
  if ($code -ne 0) { "FAIL: dist is published, but claude plugin update exited $code; the $($install.scope) install is still $($install.version)"; exit 1 }
}
# Read back: each install is this version and holds dist's files.
$stale = @(foreach ($install in Get-Installs) {
  if ($install.version -ne $version) { "the $($install.scope) install is still $($install.version)" }
  else { Get-Mismatch $install.installPath $dist | ForEach-Object { "differs from dist: $(Join-Path $install.installPath $_)" } }
})
if ($stale.Count) { $stale; 'FAIL: dist is published, but the installed copy does not match it'; exit 1 }
"PASS: $Mod $version published to $dist and the installed copy $(@(Get-Installs).installPath -join ', ') ($($runtime.Count) files); sessions opened from now on load it, and open desktop sessions were seen taking it up too"
exit 0
