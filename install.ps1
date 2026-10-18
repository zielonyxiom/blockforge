# BlockForge installer / updater for Windows.
#   irm https://raw.githubusercontent.com/zielonyxiom/blockforge/main/install.ps1 | iex
# Installs Node.js if needed (winget), downloads BlockForge to %USERPROFILE%\BlockForge,
# installs dependencies, adds Desktop + Start menu shortcuts and starts it.
# Running it again updates BlockForge and keeps your .env (keys) and projects.
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$Repo = 'zielonyxiom/blockforge'
$Dir = Join-Path $env:USERPROFILE 'BlockForge'

function Say($msg, $color = 'Cyan') { Write-Host "  $msg" -ForegroundColor $color }
Write-Host "`n  BlockForge installer`n" -ForegroundColor White

# 1) Node.js
function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Say 'Node.js not found - installing Node.js LTS with winget...'
    winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
    Refresh-Path
  }
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Say 'Please install Node.js LTS from https://nodejs.org, then run this installer again.' 'Yellow'
    Start-Process 'https://nodejs.org'
    return
  }
}
Say "Node.js $(node --version) found." 'Green'

# 2) Download the latest version (keeps .env and projects when updating)
$tmp = Join-Path $env:TEMP ("blockforge-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp | Out-Null
Say 'Downloading BlockForge...'
$zip = Join-Path $tmp 'blockforge.zip'
Invoke-WebRequest "https://github.com/$Repo/archive/refs/heads/main.zip" -OutFile $zip -UseBasicParsing
Expand-Archive $zip -DestinationPath $tmp -Force
$src = Get-ChildItem $tmp -Directory | Where-Object { $_.Name -like 'blockforge-*' } | Select-Object -First 1
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
Get-ChildItem $src.FullName -Force | Where-Object { $_.Name -notin @('.env', 'projects') } |
  ForEach-Object { Copy-Item $_.FullName -Destination $Dir -Recurse -Force }
Remove-Item $tmp -Recurse -Force

# 3) Dependencies + settings
Push-Location $Dir
Say 'Installing dependencies (first time takes a minute)...'
npm install --no-audit --no-fund --loglevel=error
if (-not (Test-Path '.env')) { Copy-Item '.env.example' '.env' }
Pop-Location

# 4) Shortcuts
$shell = New-Object -ComObject WScript.Shell
foreach ($folder in @([Environment]::GetFolderPath('Desktop'), (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'))) {
  $lnk = $shell.CreateShortcut((Join-Path $folder 'BlockForge.lnk'))
  $lnk.TargetPath = Join-Path $Dir 'start.bat'
  $lnk.WorkingDirectory = $Dir
  $lnk.Description = 'BlockForge - picture to Roblox model'
  $lnk.Save()
}

Say "Installed to $Dir" 'Green'
Say 'Starting BlockForge - use the "BlockForge" shortcut on your Desktop next time.' 'Green'
Start-Process (Join-Path $Dir 'start.bat') -WorkingDirectory $Dir
