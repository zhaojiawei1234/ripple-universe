# ============================================================
# 设置 Windows 开机自启
# 以管理员身份运行此脚本
# ============================================================
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  🌌 涟漪宇宙 · 开机自启设置" -ForegroundColor White
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$watchdogScript = Join-Path $scriptDir "start-watchdog.ps1"
$taskName = "RippleUniverse"

# Remove old task if exists
try {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Stop
    Write-Host "[*] 已删除旧任务" -ForegroundColor Yellow
} catch {
    Write-Host "[*] 未找到旧任务" -ForegroundColor DarkGray
}

# Create scheduled task
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$watchdogScript`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 999 -RestartInterval (New-Timespan -Minutes 1) -ExecutionTimeLimit (New-Timespan -Days 365)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "涟漪宇宙 · Ripple Universe - 开机自启看门狗" -Force

Write-Host ""
Write-Host "  ✓ 开机自启已设置成功！" -ForegroundColor Green
Write-Host ""
Write-Host "  任务名称: $taskName" -ForegroundColor White
Write-Host "  脚本路径: $watchdogScript" -ForegroundColor White
Write-Host ""
Write-Host "  现在做什么:" -ForegroundColor Cyan
Write-Host "  1. 重启电脑 → 自动启动" -ForegroundColor White
Write-Host "  2. 或者立即启动: Start-ScheduledTask -TaskName '$taskName'" -ForegroundColor White
Write-Host "  3. 查看状态: Get-ScheduledTask -TaskName '$taskName'" -ForegroundColor White
Write-Host "  4. 删除自启: Unregister-ScheduledTask -TaskName '$taskName'" -ForegroundColor White
Write-Host ""
