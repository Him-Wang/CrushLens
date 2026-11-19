@echo off
chcp 65001 >nul
title 心动镜 · 本机连接助手（扩大扫描范围）
cd /d "%~dp0"

if not exist "连接助手.ps1" (
  echo.
  echo   [!] 找不到 连接助手.ps1，请和本文件放在同一个文件夹。
  echo.
  pause
  exit /b 1
)

echo.
echo   ============================================
echo      心动镜 · 本机连接助手（扩大扫描范围）
echo   ============================================
echo.
echo   [!] 这个模式除了「文档\心动镜导入」，还会扫描：
echo         下载 / 桌面 / 文档 三个文件夹里的 txt、json、csv、md
echo       只读取文件名与内容用来判断"像不像聊天记录"，
echo       不会修改、不会删除、不会上传。
echo.
echo   不想让它翻这些文件夹，请改用「启动助手.bat」。
echo.
pause

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0连接助手.ps1" -ScanUserFolders

echo.
echo   助手已退出。可以关掉这个窗口了。
pause
