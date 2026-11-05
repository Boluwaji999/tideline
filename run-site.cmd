@echo off
rem Opens the Tideline app in Chrome, where MetaMask can connect to it.
rem Double-click this file. Close this window to stop the site.
cd /d "%~dp0tideline"
start "" cmd /c "timeout /t 2 >nul & start chrome http://localhost:5180/app.html"
echo Tideline is running at http://localhost:5180/app.html
echo Close this window to stop it.
python -m http.server 5180 --bind 127.0.0.1
