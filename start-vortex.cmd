@echo off
rem Vortex Android Recorder - double-click to start. Settings: copy vortex.config.example.cmd to vortex.config.cmd.
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 24 LTS from https://nodejs.org ^(or: winget install OpenJS.NodeJS.LTS^),
  echo then close this window and double-click start-vortex.cmd again.
  pause
  exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)"
if errorlevel 1 (
  echo Note: this Node.js is older than 22.18. MobileWright runs, reports and benchmarks need Node.js 22.18 or newer.
)
set VORTEX_ARGS=
if exist "vortex.config.cmd" call "vortex.config.cmd"
echo Checking the setup (read-only)...
node src\doctor.js
echo.
echo Starting Vortex Android Recorder. Keep this window open; close it to stop the recorder.
node src\server.js %VORTEX_ARGS% %*
pause
