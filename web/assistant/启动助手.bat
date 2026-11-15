@echo off
chcp 65001 >nul
title 心动镜 · 本机连接助手
cd /d "%~dp0"

if not exist "连接助手.ps1" (
  echo.
  echo   [!] 找不到 连接助手.ps1
  echo       请把压缩包里的两个文件解压到同一个文件夹后再运行。
  echo.
  pause
  exit /b 1
)

echo.
echo   ============================================
echo      心动镜 · 本机连接助手
echo   ============================================
echo.
echo   正在启动，请稍等 2 秒...
echo   这个窗口要一直开着，关掉就等于断开连接。
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0连接助手.ps1"

echo.
echo   助手已退出。可以关掉这个窗口了。
pause
