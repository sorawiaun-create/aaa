@echo off
REM VoiceClone AI - one-command launcher (Windows)
cd /d "%~dp0"

if not exist ".venv\Scripts\activate.bat" goto makevenv
goto runapp

:makevenv
echo Creating virtual environment .venv ...
python -m venv .venv
if errorlevel 1 goto error

:runapp
call .venv\Scripts\activate.bat

echo Installing dependencies. First run only - this may take several minutes...
python -m pip install --upgrade pip
pip install -r requirements.txt
if errorlevel 1 goto error

echo.
echo ================================================================
echo  VoiceClone AI is starting.
echo  Open this address in your browser:  http://127.0.0.1:8000
echo  Press Ctrl+C in this window to stop.
echo ================================================================
echo.
python app.py
goto end

:error
echo.
echo Something went wrong. Please copy the messages above for help.

:end
pause
