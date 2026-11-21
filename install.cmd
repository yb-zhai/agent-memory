@echo off
chcp 65001 >nul
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
set "CODE=%ERRORLEVEL%"
echo.
if not "%CODE%"=="0" echo 安装失败，退出码 %CODE%。
pause
exit /b %CODE%
