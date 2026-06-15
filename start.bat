@echo off
chcp 65001 >nul
title Ripple Universe Watchdog
cd /d "%~dp0"

echo ========================================
echo   Ripple Universe - Watchdog Mode
echo ========================================
echo.

if not exist "logs" mkdir logs

:START_SERVER
echo [%time%] Starting Node.js server...
start /B "" node server.js > logs\server.log 2>&1
timeout /t 3 /nobreak >nul
echo [%time%] Server started.

:START_TUNNEL
if not exist "cloudflared.exe" (
    echo [!] cloudflared.exe not found, downloading...
    powershell -Command "Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile 'cloudflared.exe'" >nul 2>&1
    if not exist "cloudflared.exe" (
        echo [X] Download failed. Tunnel disabled.
        goto SKIP_TUNNEL
    )
)

echo [%time%] Starting Cloudflare tunnel...
start /B "" cloudflared.exe tunnel --url http://localhost:3000 --no-autoupdate > logs\tunnel.log 2>&1
timeout /t 5 /nobreak >nul
echo [%time%] Tunnel started.

:SKIP_TUNNEL
echo.
echo [%time%] Watchdog active. Auto-restart on crash.
echo [%time%] Close this window to stop.
echo.

:WATCHDOG_LOOP
timeout /t 10 /nobreak >nul

REM Check server
tasklist /FI "IMAGENAME eq node.exe" 2>nul | find /I "node.exe" >nul
if %ERRORLEVEL% neq 0 (
    echo [!] Server crashed! Restarting...
    goto START_SERVER
)

REM Check tunnel if cloudflared exists
if exist "cloudflared.exe" (
    tasklist /FI "IMAGENAME eq cloudflared.exe" 2>nul | find /I "cloudflared.exe" >nul
    if %ERRORLEVEL% neq 0 (
        echo [!] Tunnel disconnected! Restarting...
        goto START_TUNNEL
    )
)

goto WATCHDOG_LOOP
