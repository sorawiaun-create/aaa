@echo off
REM VoiceClone AI — one-command launcher (Windows)
cd /d "%~dp0"

if not exist ".venv" (
  echo ==^> Creating virtual environment (.venv)...
  python -m venv .venv
)

call .venv\Scripts\activate.bat

echo ==^> Installing dependencies (first run only, may take a while)...
python -m pip install --upgrade pip >nul
pip install -r requirements.txt

echo ==^> Starting VoiceClone AI at http://127.0.0.1:8000
python app.py
pause
