# Token Atlas installer for Windows.
#   irm https://raw.githubusercontent.com/graemevip/token-atlas/main/install.ps1 | iex
#
# Downloads a single self-contained .exe. No Node, npm or Deno required.
$ErrorActionPreference = "Stop"

$repo  = "graemevip/token-atlas"
$asset = "token-atlas-windows.exe"
$dir   = Join-Path $env:LOCALAPPDATA "TokenAtlas"
$exe   = Join-Path $dir "token-atlas.exe"

New-Item -ItemType Directory -Force -Path $dir | Out-Null

$url = "https://github.com/$repo/releases/latest/download/$asset"
Write-Host "Downloading Token Atlas..."
try {
  Invoke-WebRequest -Uri $url -OutFile $exe -UseBasicParsing
} catch {
  Write-Host "Download failed. Check https://github.com/$repo/releases" -ForegroundColor Red
  exit 1
}

# Mark-of-the-Web makes SmartScreen challenge the file on first run.
Unblock-File -Path $exe -ErrorAction SilentlyContinue

# Put it on PATH for future terminals (user scope, no admin rights needed).
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$dir*") {
  [Environment]::SetEnvironmentVariable("Path", "$userPath;$dir", "User")
  Write-Host "Added $dir to your PATH (new terminals will pick it up)."
}
$env:Path = "$env:Path;$dir"

Write-Host ""
Write-Host "  Installed to $exe" -ForegroundColor Green
Write-Host "  Run it with:  token-atlas"
Write-Host ""
Write-Host "Starting Token Atlas..."
& $exe
