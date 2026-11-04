# What a session loads from a mod folder. Dot-sourced by Publish-Mod.ps1, Test-Mod.ps1 and Test-BandLayout.ps1.

# The folders a session loads beside .claude-plugin/plugin.json. Tests, tsconfig, README and the engine-laid
# .claude-plugin/types stay behind.
$ModRuntimeFolders = 'hooks', 'types', 'assets', 'commands', 'agents', 'skills'

function Get-RelativeFiles([string]$Dir) {
  @(Get-ChildItem -LiteralPath $Dir -Recurse -File -Force | ForEach-Object { [IO.Path]::GetRelativePath($Dir, $_.FullName).Replace('\', '/') })
}

# The runtime files under a mod folder, relative to it, with forward slashes.
function Get-ModRuntime([string]$Dir) {
  @('.claude-plugin/plugin.json') + @(foreach ($sub in $ModRuntimeFolders) {
    $path = Join-Path $Dir $sub
    if (Test-Path -LiteralPath $path) { Get-RelativeFiles $path | ForEach-Object { "$sub/$_" } }
  })
}

# Whether a path relative to a mod folder is one Get-ModRuntime would list.
function Test-ModRuntimePath([string]$Rel) {
  $Rel -eq '.claude-plugin/plugin.json' -or [bool]@($ModRuntimeFolders | Where-Object { $Rel.StartsWith("$_/") }).Count
}
