@echo off
"%~dp0bin\node.exe" "%~dp0scripts\backup-desktop-launcher.mjs"
if errorlevel 1 pause
