@echo off
setlocal
title Evora Smart Hub - oprava parovani
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Repair-EvoraConfigLauncher.ps1"
if errorlevel 1 (
  echo.
  echo Parovani se nepodarilo. Puvodni konfigurace zustala zachovana.
  pause
  exit /b 1
)
echo.
echo Launcher byl znovu sparovan a spusten.
pause
