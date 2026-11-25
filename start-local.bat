@echo off
rem Run SmartFinTrack on http://localhost:5500 so Google sign-in works before you deploy.
cd /d "%~dp0"
echo.
echo  SmartFinTrack is starting at http://localhost:5500
echo  Keep this window open. Press Ctrl+C to stop.
echo.
start "" cmd /c "timeout /t 3 >nul & start http://localhost:5500"
py --version >nul 2>nul
if not errorlevel 1 goto usepy
python --version >nul 2>nul
if not errorlevel 1 goto usepython
goto useps
:usepy
py -m http.server 5500
goto end
:usepython
python -m http.server 5500
goto end
:useps
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"
:end
echo.
echo  The server stopped. If you did not stop it, copy any error shown above and send it to me.
pause
