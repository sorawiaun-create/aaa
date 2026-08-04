@echo off
chcp 65001 >nul
title TikTok Live Puzzle Alert
cd /d "%~dp0"

REM --- Install libraries automatically on first run ---
python -c "import cv2, mss, requests" 2>nul
if errorlevel 1 (
    echo Installing required libraries for the first time, please wait...
    python -m pip install -r requirements.txt
)

python app.py
pause
