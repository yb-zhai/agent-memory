# uninstall.ps1 — remove Brain Nebula from a DeepSeek Harness profile.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\uninstall.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\uninstall.ps1 -KeepSource

[CmdletBinding()]
param(
    [string]$Profile = $(if ($env:DSH_PROFILE) { $env:DSH_PROFILE } else { 'desktop' }),
    [string]$DshHome = $env:DSH_HOME,
    [switch]$KeepSource,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

if (-not $DshHome) { $DshHome = Join-Path $env:USERPROFILE '.dsh' }
$DshHome = [System.IO.Path]::GetFullPath($DshHome).TrimEnd('\')
$profileDir = Join-Path $DshHome (Join-Path 'profiles' $Profile)
$manifestPath = Join-Path $profileDir 'package.json'
$installRoot = Join-Path $DshHome 'plugins\dsh-memory-nebula'
$moduleDir = Join-Path $profileDir 'node_modules\dsh-memory-nebula'

Write-Host ''
Write-Host '记忆星云 / Memory Nebula 卸载器' -ForegroundColor Cyan
Write-Host "  profile: $profileDir"
Write-Host ''

function Remove-PluginDir([string]$target) {
    if (-not (Test-Path -LiteralPath $target)) { return }
    $item = Get-Item -LiteralPath $target -Force
    if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
        $item.Delete()
    } else {
        Remove-Item -LiteralPath $target -Recurse -Force
    }
}

if ($DryRun) {
    Write-Host '[DryRun] 未改动任何文件。将移除：' -ForegroundColor Yellow
    Write-Host "  - $moduleDir"
    if (-not $KeepSource) { Write-Host "  - $installRoot" }
    Write-Host "  - $manifestPath 中的 dependencies['dsh-memory-nebula'] 与 bundles 条目"
    exit 0
}

# ---- stop the panel server -------------------------------------------------
$servers = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -match 'dsh-memory-nebula[\\/]server\.js' }
foreach ($server in $servers) {
    try {
        Stop-Process -Id $server.ProcessId -Force -ErrorAction Stop
        Write-Host "已停止面板服务进程 PID $($server.ProcessId)"
    } catch {
        Write-Warning "无法停止 PID $($server.ProcessId)：$($_.Exception.Message)"
    }
}

# ---- remove files ----------------------------------------------------------
Remove-PluginDir $moduleDir
Write-Host "已移除 $moduleDir"
if (-not $KeepSource) {
    Remove-PluginDir $installRoot
    Write-Host "已移除 $installRoot"
}

# ---- update profile manifest ----------------------------------------------
if (Test-Path -LiteralPath $manifestPath) {
    Copy-Item -LiteralPath $manifestPath -Destination ("$manifestPath.bak-brain-nebula-" + (Get-Date -Format 'yyyyMMdd-HHmmss')) -Force
    $manifest = [System.IO.File]::ReadAllText($manifestPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json

    if ($manifest.dependencies -and $manifest.dependencies.PSObject.Properties['dsh-memory-nebula']) {
        $manifest.dependencies.PSObject.Properties.Remove('dsh-memory-nebula')
    }
    if ($manifest.dsh -and $manifest.dsh.profile -and $manifest.dsh.profile.bundles) {
        $manifest.dsh.profile.bundles = @($manifest.dsh.profile.bundles | Where-Object { $_ -ne 'dsh-memory-nebula' })
    }

    [System.IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 20), $utf8NoBom)
    Write-Host '已从 profile package.json 移除依赖与 bundle（原文件已备份）'
} else {
    Write-Warning "找不到 $manifestPath，跳过清单清理。"
}

Write-Host ''
Write-Host '卸载完成。请重新启动 DeepSeek Harness。' -ForegroundColor Green
Write-Host '如需保留源码副本，下次可加 -KeepSource；配置文件 %DSH_HOME%\memory-nebula.json 不会被删除。'
Write-Host '本地记忆目录 memory-nebula-data 与 backups\memory-nebula 升级备份也不会被删除。'
Write-Host ''
