# What a session loads from a mod folder, and the license that travels with it. Dot-sourced by Publish-Mod.ps1,
# Test-Mod.ps1 and Test-BandLayout.ps1.

# The folders a session loads beside .claude-plugin/plugin.json. Tests, tsconfig, README and the engine-laid
# .claude-plugin/types stay behind.
$ModRuntimeFolders = 'hooks', 'types', 'assets', 'commands', 'agents', 'skills'

function Get-RelativeFiles([string]$Dir) {
  @(Get-ChildItem -LiteralPath $Dir -Recurse -File -Force | ForEach-Object { [IO.Path]::GetRelativePath($Dir, $_.FullName).Replace('\', '/') })
}

# The runtime files under a mod folder, relative to it, with forward slashes. A LICENSE at the mod root ships too
# when the mod has one: a third-party license such as MIT asks every copy to carry its notice, and an install
# copies dist/<mod> alone.
function Get-ModRuntime([string]$Dir) {
  @('.claude-plugin/plugin.json') + @(if (Test-Path -LiteralPath (Join-Path $Dir 'LICENSE') -PathType Leaf) { 'LICENSE' }) + @(foreach ($sub in $ModRuntimeFolders) {
    $path = Join-Path $Dir $sub
    if (Test-Path -LiteralPath $path) { Get-RelativeFiles $path | ForEach-Object { "$sub/$_" } }
  })
}

# Whether a path relative to a mod folder is one Get-ModRuntime would list.
function Test-ModRuntimePath([string]$Rel) {
  $Rel -in '.claude-plugin/plugin.json', 'LICENSE' -or [bool]@($ModRuntimeFolders | Where-Object { $Rel.StartsWith("$_/") }).Count
}
