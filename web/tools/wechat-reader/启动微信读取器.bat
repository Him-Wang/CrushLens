@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "SCRIPT="
for %%f in (*.ps1) do set "SCRIPT=%%~f"
if not defined SCRIPT (
  echo Main script not found.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0%SCRIPT%"
echo.
pause >nul
