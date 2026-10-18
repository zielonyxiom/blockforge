@echo off
title BlockForge
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto :nonode

if not exist node_modules (
  echo Installing BlockForge - first run only, takes a minute...
  call npm install --no-audit --no-fund --loglevel=error
  if errorlevel 1 goto :npmfail
)

if not exist .env (
  copy .env.example .env >nul
  echo Created .env - add your free keys in the app under Settings.
)

echo.
echo   BlockForge is running at http://localhost:5177
echo   Keep this window open while you use it. Close it to stop BlockForge.
echo.
start "" http://localhost:5177
node server\server.js
pause
exit /b 0

:nonode
echo.
echo   BlockForge needs Node.js, which is not installed yet.
where winget >nul 2>nul
if errorlevel 1 goto :manualnode
choice /c YN /m "  Install Node.js LTS now with winget"
if errorlevel 2 goto :manualnode
winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
echo.
echo   Node.js installed. Close this window and double-click start.bat again.
pause
exit /b 0

:manualnode
echo   Download the LTS version from https://nodejs.org, install it, then run start.bat again.
start "" https://nodejs.org
pause
exit /b 1

:npmfail
echo.
echo   Installing dependencies failed. Check your internet connection and try again.
pause
exit /b 1
