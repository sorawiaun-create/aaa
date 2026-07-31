@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo    TikTok Ads Automation - Starting
echo ============================================
echo.
echo [1/3] Checking Node.js...
node -v
if errorlevel 1 (
  echo.
  echo *** Node.js is NOT installed on this computer. ***
  echo.
  echo Please install it first:
  echo   1. Open https://nodejs.org
  echo   2. Click the big green LTS button, download and install
  echo   3. Close this window, then double-click "start" again
  echo.
  pause
  exit /b
)
echo Node.js OK.
echo.

if not exist node_modules (
  echo [2/3] First-time setup, installing components...
  echo       This can take 2-3 minutes. Please wait.
  call npm install
  if errorlevel 1 (
    echo.
    echo *** Install failed. Check your internet connection and try again. ***
    pause
    exit /b
  )
) else (
  echo [2/3] Components already installed. OK.
)
echo.

echo [3/3] Preparing the app...
call npm run build
if errorlevel 1 (
  echo.
  echo *** Build failed. Please screenshot this window and send it. ***
  pause
  exit /b
)

echo.
echo ============================================
echo    READY!  Open your browser and go to:
echo        http://localhost:3000
echo.
echo    Keep this window open while you use it.
echo    Closing it will stop the system.
echo ============================================
echo.
call npm start
