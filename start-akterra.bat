@echo off
setlocal
cd /d "%~dp0"

set "AKTERRA_NODE="
for /f "delims=" %%P in ('where.exe node.exe 2^>nul') do if not defined AKTERRA_NODE set "AKTERRA_NODE=%%P"

if not defined AKTERRA_NODE (
  for /f "usebackq delims=" %%P in (`powershell.exe -NoProfile -Command "$p=Get-AppxPackage -Name 'OpenAI.CodexPrimaryRuntime' | Select-Object -First 1 -ExpandProperty InstallLocation; if($p){Join-Path $p 'dependencies\node\bin\node.exe'}" 2^>nul`) do if not defined AKTERRA_NODE set "AKTERRA_NODE=%%P"
)

if not defined AKTERRA_NODE (
  echo Node.js was not found. Install Node.js 18 or newer, then run this file again.
  echo https://nodejs.org/
  pause
  exit /b 1
)

echo Starting Akterra. Keep the server window open while using the app.
start "Akterra Server" /D "%~dp0" "%AKTERRA_NODE%" "%~dp0server.js"
echo Waiting for the local server to respond...
for /l %%I in (1,1,20) do (
  curl.exe --noproxy "*" --silent --fail http://127.0.0.1:3000/ >nul 2>&1
  if not errorlevel 1 goto :server_ready
  timeout /t 1 /nobreak >nul
)

echo Akterra did not respond on port 3000. Check the Akterra Server window for an error.
pause
exit /b 1

:server_ready
start "" "http://127.0.0.1:3000/"
echo Akterra is ready at http://127.0.0.1:3000/
