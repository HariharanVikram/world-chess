@echo off
setlocal
cd /d "%~dp0"

for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
  powershell -NoProfile -Command "try { Stop-Process -Id %%P -Force -ErrorAction Stop } catch {}"
  goto afterkill
)
:afterkill

where.exe node >nul 2>nul
if %errorlevel%==0 (
  for /f "delims=" %%N in ('where.exe node') do (
    "%%N" server.js
    exit /b %errorlevel%
  )
)

set "WINDOWSAPP_NODE=C:\Program Files\WindowsApps\OpenAI.Codex_26.422.2437.0_x64__2p2nqsd0c76g0\app\resources\node.exe"
if exist "%WINDOWSAPP_NODE%" (
  "%WINDOWSAPP_NODE%" server.js
  exit /b %errorlevel%
)

set "CODEX_NODE=%LOCALAPPDATA%\OpenAI\Codex\bin\node.exe"
if exist "%CODEX_NODE%" (
  "%CODEX_NODE%" server.js
  exit /b %errorlevel%
)

echo Node.js was not found.
echo Install Node.js from https://nodejs.org/ and reopen this terminal.
pause
exit /b 1
