@echo off
chcp 65001 >nul
title Build PuzzleAlert.exe
cd /d "%~dp0"

echo ============================================
echo   กำลังสร้างไฟล์ PuzzleAlert.exe
echo   (ทำครั้งเดียว ใช้เวลาสัก 2-5 นาที)
echo ============================================
echo.

REM สร้าง virtual environment แยกไว้ กันชนกับของเครื่อง
if not exist ".venv" (
    python -m venv .venv
)
call .venv\Scripts\activate

echo [1/3] ติดตั้งไลบรารี...
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m pip install pyinstaller

echo.
echo [2/3] กำลัง build...
REM --add-data "ต้นทาง;ปลายทาง"  (บน Windows ใช้ ; คั่น)
pyinstaller --noconfirm --onefile --name PuzzleAlert ^
    --add-data "config.example.json;." ^
    app.py

echo.
echo [3/3] เสร็จแล้ว!
echo ----------------------------------------------
echo ไฟล์อยู่ที่:  dist\PuzzleAlert.exe
echo คัดลอกไฟล์นั้นไปไว้ที่ไหนก็ได้ แล้วดับเบิลคลิกเปิดได้เลย
echo (config.json กับ templates จะถูกสร้างข้างๆ ตัว .exe เอง)
echo ----------------------------------------------
pause
