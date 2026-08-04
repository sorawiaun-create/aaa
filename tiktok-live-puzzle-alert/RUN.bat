@echo off
chcp 65001 >nul
title TikTok Live Puzzle Alert
cd /d "%~dp0"

REM --- ถ้ายังไม่ได้ติดตั้งไลบรารี ให้ติดตั้งอัตโนมัติครั้งแรก ---
python -c "import cv2, mss, requests" 2>nul
if errorlevel 1 (
    echo กำลังติดตั้งไลบรารีที่จำเป็นครั้งแรก... รอสักครู่
    python -m pip install -r requirements.txt
)

python app.py
pause
