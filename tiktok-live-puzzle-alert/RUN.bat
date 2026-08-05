@echo off
chcp 65001 >nul
cd /d "%~dp0"

REM --- Install libraries automatically on first run (console visible only if needed) ---
python -c "import cv2, mss, requests" 2>nul
if errorlevel 1 (
    echo Installing required libraries for the first time, please wait...
    python -m pip install -r requirements.txt
)

REM Launch the GUI with pythonw = NO black console window
start "" pythonw gui.py
