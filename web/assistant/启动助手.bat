@echo off
chcp 65001 >nul
title 心动镜 · 本机连接助手
cd /d "%~dp0"

if not exist "连接助手.ps1" (
  echo.
  echo   [!] 找不到 连接助手.ps1
  echo       请把「启动助手.bat」和「连接助手.ps1」放在同一个文件夹里再运行。
  echo.
  pause
  exit /b 1
)

echo.
echo   ============================================
echo      心动镜 · 本机连接助手 v2
echo   ============================================
echo.
echo   正在启动，请稍等 2 秒...
echo.
echo   启动后会显示一个 6 位「配对码」，
echo   回到网页的「直连本机」页面填进去即可。
echo.
echo   这个窗口要一直开着，关掉就等于断开连接。
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0连接助手.ps1"

echo.
echo   助手已退出。可以关掉这个窗口了。
pause
