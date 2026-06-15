# ============================================================
# 🌌 涟漪宇宙 · 看门狗启动脚本
# 自动启动服务器和隧道，任意一个崩溃就自动重启
# ============================================================
$ErrorActionPreference = "SilentlyContinue"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  🌌 涟漪宇宙 · Ripple Universe" -ForegroundColor White
Write-Host "  看门狗模式 - 永不掉线" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$serverProcess = $null
$tunnelProcess = $null
$cloudflaredPath = Join-Path $scriptDir "cloudflared.exe"

# Check if cloudflared exists, if not download it
if (-not (Test-Path $cloudflaredPath)) {
    Write-Host "[*] 下载 Cloudflare Tunnel..." -ForegroundColor Yellow
    try {
        Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile $cloudflaredPath -UseBasicParsing
        Write-Host "[✓] Cloudflared 下载完成" -ForegroundColor Green
    } catch {
        Write-Host "[✗] 下载失败: $_" -ForegroundColor Red
        Write-Host "[!] 隧道功能将不可用，仅启动本地服务器" -ForegroundColor Yellow
    }
}

function Start-Server {
    Write-Host "[*] 启动 Node.js 服务器..." -ForegroundColor Yellow
    $global:serverProcess = Start-Process -FilePath "node" -ArgumentList "server.js" -PassThru -NoNewWindow -RedirectStandardOutput "$scriptDir\logs\server.log" -RedirectStandardError "$scriptDir\logs\server-error.log"
    Start-Sleep 2
    if ($global:serverProcess.HasExited) {
        Write-Host "[✗] 服务器启动失败！查看 logs/server-error.log" -ForegroundColor Red
        return $false
    }
    Write-Host "[✓] 服务器已启动 (PID: $($global:serverProcess.Id))" -ForegroundColor Green
    return $true
}

function Start-Tunnel {
    if (-not (Test-Path $cloudflaredPath)) {
        Write-Host "[!] Cloudflared 未找到，跳过隧道" -ForegroundColor Yellow
        return $false
    }
    Write-Host "[*] 启动 Cloudflare 隧道..." -ForegroundColor Yellow
    $global:tunnelProcess = Start-Process -FilePath $cloudflaredPath -ArgumentList "tunnel --url http://localhost:3000 --no-autoupdate" -PassThru -NoNewWindow -RedirectStandardOutput "$scriptDir\logs\tunnel.log" -RedirectStandardError "$scriptDir\logs\tunnel-error.log"
    Start-Sleep 6
    if ($global:tunnelProcess.HasExited) {
        Write-Host "[✗] 隧道启动失败！查看 logs/tunnel-error.log" -ForegroundColor Red
        return $false
    }
    Write-Host "[✓] 隧道已启动 (PID: $($global:tunnelProcess.Id))" -ForegroundColor Green

    # Extract URL from log
    Start-Sleep 2
    $logContent = Get-Content "$scriptDir\logs\tunnel.log" -Raw -ErrorAction SilentlyContinue
    if ($logContent -match 'https://[a-z0-9-]+\.trycloudflare\.com') {
        $url = $matches[0]
        Write-Host ""
        Write-Host "  ★━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━★" -ForegroundColor Cyan
        Write-Host "  🌍 公网访问地址:" -ForegroundColor White
        Write-Host "  $url" -ForegroundColor Green
        Write-Host "  ★━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━★" -ForegroundColor Cyan
        Write-Host ""

        # Save URL to desktop
        $desktopPath = [Environment]::GetFolderPath("Desktop")
        $urlFile = Join-Path $desktopPath "涟漪宇宙_公网链接.txt"
        @"
🌌 涟漪宇宙 · Ripple Universe 公网访问地址
============================================
主页: $url
后台: $url/admin
密码: zhaojiawei123
============================================
隧道类型: Cloudflare Tunnel (全球CDN)
启动时间: $(Get-Date)
"@ | Out-File -FilePath $urlFile -Encoding UTF8
        Write-Host "[✓] 链接已保存到桌面: 涟漪宇宙_公网链接.txt" -ForegroundColor Green
    }
    return $true
}

function Stop-All {
    Write-Host "[*] 正在停止所有服务..." -ForegroundColor Yellow
    if ($global:serverProcess -and !$global:serverProcess.HasExited) {
        $global:serverProcess.Kill()
        Write-Host "[✓] 服务器已停止" -ForegroundColor Green
    }
    if ($global:tunnelProcess -and !$global:tunnelProcess.HasExited) {
        $global:tunnelProcess.Kill()
        Write-Host "[✓] 隧道已停止" -ForegroundColor Green
    }
}

# Create logs directory
New-Item -ItemType Directory -Force -Path "$scriptDir\logs" | Out-Null

# Clean up on exit
Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action { Stop-All } | Out-Null

# Main watchdog loop
$serverRestartCount = 0
$tunnelRestartCount = 0
$maxRestarts = 100

Write-Host "[*] 看门狗已启动，按 Ctrl+C 停止" -ForegroundColor White
Write-Host ""

# Start initial processes
$serverOk = Start-Server
$tunnelOk = Start-Tunnel

# Watchdog loop
while ($true) {
    Start-Sleep 5

    # Check server
    if ($serverOk -and $global:serverProcess.HasExited) {
        $serverRestartCount++
        if ($serverRestartCount -gt $maxRestarts) {
            Write-Host "[✗] 服务器重启次数超过限制，停止监控" -ForegroundColor Red
            break
        }
        Write-Host "[!] 服务器已崩溃 (第 $serverRestartCount 次重启)..." -ForegroundColor Red
        $serverOk = Start-Server
    }

    # Check tunnel
    if ($tunnelOk -and $global:tunnelProcess.HasExited) {
        $tunnelRestartCount++
        if ($tunnelRestartCount -gt $maxRestarts) {
            Write-Host "[✗] 隧道重启次数超过限制，停止监控" -ForegroundColor Red
            break
        }
        Write-Host "[!] 隧道已断开 (第 $tunnelRestartCount 次重启)..." -ForegroundColor Yellow
        $tunnelOk = Start-Tunnel
    }

    # Heartbeat
    if ((Get-Date).Second -eq 0) {
        Write-Host "[♥] $(Get-Date -Format 'HH:mm:ss') - 服务器: $(if($serverOk){'✓'}else{'✗'}) | 隧道: $(if($tunnelOk){'✓'}else{'✗'}) | 重启次数: 服务器$serverRestartCount 隧道$tunnelRestartCount" -ForegroundColor DarkGray
    }
}
