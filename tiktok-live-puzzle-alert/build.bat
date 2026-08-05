@echo off
chcp 65001 >nul
title Build PuzzleAlert.exe
cd /d "%~dp0"

echo ============================================
echo   Building PuzzleAlert.exe
echo   (one time only, takes about 2-5 minutes)
echo ============================================
echo.

REM --- Check Python first ---
python --version >nul 2>&1
if errorlevel 1 (
    echo [!] Python not found.
    echo     Please install Python 3.10+ once to build the .exe
    echo     Download: https://www.python.org/downloads/
    echo     ** During install, tick "Add Python to PATH" **
    echo     Then close this window and double-click build.bat again.
    echo.
    pause
    exit /b 1
)

REM Create an isolated virtual environment
if not exist ".venv" (
    python -m venv .venv
)
call .venv\Scripts\activate

echo [1/3] Installing libraries...
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m pip install pyinstaller

echo.
echo [2/3] Building...
REM --windowed = no black console window (real app feel)
REM --add-data "source;dest"  (use ; on Windows)
pyinstaller --noconfirm --onefile --windowed --name PuzzleAlert ^
    --add-data "config.example.json;." ^
    gui.py

echo.
if exist "dist\PuzzleAlert.exe" (
    echo [3/3] Done!
    echo ----------------------------------------------
    echo File is at:  dist\PuzzleAlert.exe
    echo Copy it anywhere and double-click to run.
    echo config.json and templates will be created next to it.
    echo ----------------------------------------------
) else (
    echo [X] Build failed - PuzzleAlert.exe was not created.
    echo     Please copy the error messages above and send them for help.
)
pause
