@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Starting serveo tunnel...
ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -R 80:localhost:3000 serveo.net > logs\tunnel-url.txt 2>&1
