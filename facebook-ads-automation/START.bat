@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title Facebook Ads Automation - run on this PC
cd /d "%~dp0"

echo ==================================================
echo    Facebook Ads Automation - run on this PC
echo ==================================================
echo.

REM ---------- 1) find Python ----------
set "PY="
where python >nul 2>nul && set "PY=python"
if not defined PY ( where py >nul 2>nul && set "PY=py" )
if not defined PY (
  echo [X] ไม่พบ Python ในเครื่องนี้
  echo.
  echo     กรุณาติดตั้ง Python ก่อน โหลดที่:
  echo     https://www.python.org/downloads/
  echo.
  echo     ** สำคัญมาก: ตอนติดตั้ง ให้ติ๊กช่อง "Add python.exe to PATH" ที่ด้านล่างด้วย **
  echo     ติดตั้งเสร็จแล้ว ปิด-เปิดคอมหรือดับเบิลคลิกไฟล์นี้ใหม่อีกครั้ง
  echo.
  pause
  exit /b 1
)

REM ---------- 2) เตรียมไฟล์ token.txt ----------
if not exist "token.txt" (
  echo PASTE_YOUR_FACEBOOK_TOKEN_HERE> token.txt
  echo [*] สร้างไฟล์ token.txt ให้แล้ว
  echo     กำลังเปิด Notepad ให้... ให้ลบข้อความเดิมในนั้นออก
  echo     แล้ววาง Facebook access token ของคุณลงไปบรรทัดเดียว จากนั้นเซฟ แล้วปิด
  echo     เสร็จแล้วดับเบิลคลิกไฟล์นี้ใหม่อีกครั้ง
  notepad token.txt
  pause
  exit /b 1
)

set /p FBTOKEN=<token.txt
if "!FBTOKEN!"=="PASTE_YOUR_FACEBOOK_TOKEN_HERE" (
  echo [X] ยังไม่ได้ใส่โทเคนในไฟล์ token.txt
  echo     กำลังเปิด token.txt ให้ ... วางโทเคนแล้วเซฟ จากนั้นรันใหม่
  notepad token.txt
  pause
  exit /b 1
)
set "FB_ACCESS_TOKEN=!FBTOKEN!"

REM ---------- 3) ติดตั้งไลบรารีครั้งแรก ----------
if not exist ".venv" (
  echo [*] ติดตั้งครั้งแรก กำลังเตรียมระบบ... ใช้เวลาประมาณ 1-3 นาที รอสักครู่
  %PY% -m venv .venv
  call ".venv\Scripts\activate.bat"
  python -m pip install --upgrade pip >nul 2>nul
  pip install -r requirements.txt
  if errorlevel 1 (
    echo [X] ติดตั้งไลบรารีไม่สำเร็จ ลองเช็คอินเทอร์เน็ตแล้วรันใหม่
    pause
    exit /b 1
  )
) else (
  call ".venv\Scripts\activate.bat"
)

REM ---------- 4) เปิดหน้าโคม (เว็บในเครื่อง) + รันแอดทุก 10 นาที ----------
echo.
echo [OK] กำลังเปิดหน้าโคมในเบราว์เซอร์...
echo      หน้าตาเหมือนเว็บเดิมทุกอย่าง แต่ทำงานในเครื่องนี้
echo      ปล่อยหน้าต่างสีดำนี้เปิดไว้ตอนใช้งาน อย่าปิด
echo      ถ้าจะหยุด ปิดหน้าต่างนี้ หรือกด Ctrl+C
echo.
python local_web.py

echo.
echo ระบบหยุดทำงานแล้ว
pause
