<#
.SYNOPSIS
  Read-only capture of the Claude desktop window (PrintWindow): what a mod draws there, as the desktop draws it.
.DESCRIPTION
  computer-use is not granted Claude's own window, and the in-app browser does not act on local pages; this reads the
  window's pixels and sends it nothing. It captures whichever session the window shows, and refuses a minimized
  window. Each kept frame is saved as a PNG beside a crop of its lower part (-BottomShare), where the prompt and the
  bands are.
  -Frames above 1 captures that many frames -IntervalMs apart. With -Color, each frame counts that color's pixels
  (within 6 per channel) in the lower part, and only the first frame and frames without any are kept: whether a band
  drops out while the window redraws. Prints one JSON object.
.EXAMPLE
  & D:/agents/projects/claude-mods/scripts/Capture-ClaudeWindow.ps1
.EXAMPLE
  & D:/agents/projects/claude-mods/scripts/Capture-ClaudeWindow.ps1 -Frames 12 -Color '#d97757'
#>
param(
  [string]$OutDir = 'D:/Codex/temp/claude-mods/window-capture',
  [int]$Frames = 1,
  [int]$IntervalMs = 250,
  [string]$Color,
  [double]$BottomShare = 0.3
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
if (-not ('ClaudeModsCapture' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ClaudeModsCapture {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
}
'@
}
# Per-monitor aware, so the window's physical pixels are captured, not a scaled copy.
[void][ClaudeModsCapture]::SetProcessDpiAwarenessContext([IntPtr]::new(-4))
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$proc = @(Get-Process -Name 'claude' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero -and $_.Path -like '*WindowsApps*' })[0]
if (-not $proc) { throw 'no Claude desktop window found' }
$h = $proc.MainWindowHandle
if ([ClaudeModsCapture]::IsIconic($h)) { throw 'the Claude window is minimized' }
$rect = New-Object ClaudeModsCapture+RECT
[void][ClaudeModsCapture]::GetWindowRect($h, [ref]$rect)
$w = $rect.Right - $rect.Left
$ht = $rect.Bottom - $rect.Top
$top = [int]($ht * (1 - $BottomShare))
$target = if ($Color) { [System.Drawing.ColorTranslator]::FromHtml($Color) }

$shots = foreach ($i in 1..$Frames) {
  $bmp = New-Object System.Drawing.Bitmap $w, $ht
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $hdc = $g.GetHdc()
  $printed = [ClaudeModsCapture]::PrintWindow($h, $hdc, 2) # PW_RENDERFULLCONTENT: the composed content, not a blank client
  $g.ReleaseHdc($hdc)
  $g.Dispose()
  $hits = $null
  if ($target) {
    $hits = 0
    for ($y = $top; $y -lt $ht; $y++) {
      for ($x = 0; $x -lt $w; $x += 2) {
        $c = $bmp.GetPixel($x, $y)
        if ([Math]::Abs($c.R - $target.R) -le 6 -and [Math]::Abs($c.G - $target.G) -le 6 -and [Math]::Abs($c.B - $target.B) -le 6) { $hits++ }
      }
    }
  }
  $full = $bottom = $null
  if ($i -eq 1 -or -not $target -or $hits -eq 0) {
    $name = if ($Frames -gt 1) { 'frame-{0:d2}' -f $i } else { 'window' }
    $full = Join-Path $OutDir "$name.png"
    $bmp.Save($full, [System.Drawing.Imaging.ImageFormat]::Png)
    $crop = $bmp.Clone([System.Drawing.Rectangle]::new(0, $top, $w, $ht - $top), $bmp.PixelFormat)
    $bottom = Join-Path $OutDir "$name-bottom.png"
    $crop.Save($bottom, [System.Drawing.Imaging.ImageFormat]::Png)
    $crop.Dispose()
  }
  $bmp.Dispose()
  [pscustomobject]@{ frame = $i; at = (Get-Date).ToString('HH:mm:ss.fff'); printed = $printed; colorPixels = $hits; full = $full; bottom = $bottom }
  if ($i -lt $Frames) { Start-Sleep -Milliseconds $IntervalMs }
}
$status = if (@($shots | Where-Object { -not $_.printed }).Count) { 'printwindow-failed' } else { 'ok' }
[pscustomobject]@{ status = $status; title = $proc.MainWindowTitle; window = "${w}x${ht}"; frames = @($shots) } | ConvertTo-Json -Depth 4 -Compress
