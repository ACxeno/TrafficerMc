@echo off
title  My Dev xeno
color 0A

echo ================================
echo        STARTING PROJECT
echo ================================
echo.

echo  Installing dependencies...
call npm install
if %errorlevel% neq 0 (
    echo  Install failed!
    pause
    exit /b
)

echo.
echo  Running development server...
call npm run dev
if %errorlevel% neq 0 (
    echo  Dev server failed!
    pause
    exit /b
)

echo.
echo  Done!
pause