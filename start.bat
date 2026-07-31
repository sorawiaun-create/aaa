@echo off
REM Double-click this file on Windows to run the TikTok Ads Automation tool.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo ----------------------------------------------
  echo  ไม่พบ Node.js
  echo  กรุณาติดตั้งก่อนที่ https://nodejs.org  (เลือกปุ่ม LTS)
  echo ----------------------------------------------
  pause
  exit /b
)

if not exist node_modules (
  echo กำลังติดตั้งส่วนประกอบครั้งแรก (อาจใช้เวลา 2-3 นาที)...
  call npm install
  if errorlevel 1 ( echo ติดตั้งไม่สำเร็จ & pause & exit /b )
)

echo กำลังเตรียมระบบ...
call npm run build
if errorlevel 1 ( echo build ไม่สำเร็จ & pause & exit /b )

echo.
echo ----------------------------------------------
echo  ระบบพร้อมแล้ว! เปิดเบราว์เซอร์ไปที่:
echo     http://localhost:3000
echo  (ปิดหน้าต่างนี้ = หยุดระบบ)
echo ----------------------------------------------
echo.
call npm start
