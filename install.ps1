# install.ps1 — install or safely upgrade Memory Nebula in a DSH profile.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Profile desktop
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -HindsightDir "<你的 Hindsight 根目录>"
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -DryRun
#
# Upgrade transaction:
#   stop old sidecar -> verified backup -> staged code swap -> health check
#   any failure after the swap restores code, config, manifest and memory data.
#
# 不要手动「只拷文件夹」安装：
#   把目录放进 profiles/<profile>/node_modules 只是复制了代码，
#   DSH 还要求该项目登记在 profile package.json 的 dependencies 里
#   （本脚本见「在 profile 清单里登记这个插件」那一段）。
#   少了登记，DSH 不会加载它，面板与插件都不会出现。
#   要么用 dsh plugin --profile <p> add ...，要么用本脚本。

[CmdletBinding()]
param(
    [string]$Profile = $(if ($env:DSH_PROFILE) { $env:DSH_PROFILE } else { 'desktop' }),
    [string]$DshHome = $env:DSH_HOME,
    [string]$HindsightDir = $env:MEMORY_NEBULA_HINDSIGHT_DIR,
    [string]$DataDir = $env:MEMORY_NEBULA_DATA_DIR,
    [string]$RuntimePath = $(if ($env:DSH_NODE) { $env:DSH_NODE } else { $env:DSH_EXECUTABLE }),
    [ValidateRange(1, 20)][int]$KeepBackups = 5,
    [ValidateRange(5, 120)][int]$HealthTimeoutSec = 30,
    [switch]$DryRun,
    [switch]$AllowRunning,
    [switch]$SelfUpdate,
    [switch]$SkipSelfUpdate
)

$ErrorActionPreference = 'Stop'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$source = $PSScriptRoot
if (-not $source) { $source = Split-Path -Parent $MyInvocation.MyCommand.Path }
$source = [System.IO.Path]::GetFullPath($source).TrimEnd('\')
# ---- 自更新：让旧版安装器也能用上新逻辑 ------------------------------------
# 背景：install.ps1 本身不会自更新，用户手上的旧版永远只有旧校验。
# 这里在**做任何校验之前**先检查脚本自身是否落后于 git 仓库，落后则提示或
# （显式加 -SelfUpdate 时）拉取新版并重新执行。
#
# 设计约束：
#   - 默认只提示，不擅自改动工作区；-SelfUpdate 才真的 pull。
#   - 需要 $source 是 git 工作树，否则跳过（zip 安装的用户不受影响）。
#   - 任何异常都不阻断原流程：自更新是增强项，不是安装的前置条件。
function Invoke-SelfUpdateCheck {
    param([string]$Dir, [switch]$DoUpdate)

    $gitDir = Join-Path $Dir '.git'
    if (-not (Test-Path -LiteralPath $gitDir)) {
        return @{ Status = 'not-git' }
    }
    $git = Get-Command git -ErrorAction SilentlyContinue
    if (-not $git) {
        return @{ Status = 'no-git' }
    }

    # 只在干净工作树上操作，避免覆盖用户本地改动
    $dirty = & $git.Source -C $Dir status --porcelain 2>$null
    if ($LASTEXITCODE -ne 0) { return @{ Status = 'git-error' } }
    if ($dirty) {
        return @{ Status = 'dirty'; Detail = (@($dirty) -join '; ') }
    }

    & $git.Source -C $Dir fetch --quiet origin 2>$null
    if ($LASTEXITCODE -ne 0) { return @{ Status = 'fetch-failed' } }

    $branch = (& $git.Source -C $Dir rev-parse --abbrev-ref HEAD 2>$null)
    if ($LASTEXITCODE -ne 0 -or -not $branch) { return @{ Status = 'no-branch' } }
    if ($branch -eq 'HEAD') { return @{ Status = 'detached' } }

    $local = (& $git.Source -C $Dir rev-parse HEAD 2>$null)
    $remote = (& $git.Source -C $Dir rev-parse "origin/$branch" 2>$null)
    if (-not $local -or -not $remote) { return @{ Status = 'git-error' } }
    if ($local -eq $remote) { return @{ Status = 'up-to-date' } }

    # 是否真的落后（remote 包含 local 的全部提交）
    & $git.Source -C $Dir merge-base --is-ancestor $local $remote 2>$null
    $behind = ($LASTEXITCODE -eq 0)

    $changedSelf = (& $git.Source -C $Dir diff --name-only "$local..$remote" -- install.ps1 2>$null)

    if ($DoUpdate -and $behind) {
        & $git.Source -C $Dir pull --ff-only --quiet 2>$null
        if ($LASTEXITCODE -ne 0) {
            return @{ Status = 'pull-failed'; Local = $local; Remote = $remote }
        }
        return @{ Status = 'updated'; Local = $local; Remote = $remote;
                  SelfChanged = [bool]$changedSelf }
    }
    return @{ Status = $(if ($behind) { 'behind' } else { 'diverged' });
              Local = $local; Remote = $remote; SelfChanged = [bool]$changedSelf }
}

$selfUpdateReexec = $false
if (-not $SkipSelfUpdate -and $source) {
    try {
        $su = Invoke-SelfUpdateCheck -Dir $source -DoUpdate:$SelfUpdate
        switch ($su.Status) {
            'updated' {
                Write-Host '[自更新] 已拉取新版本。' -ForegroundColor Green
                if (-not $su.SelfChanged) {
                    Write-Host '         install.ps1 本身未变化，继续使用当前逻辑。' -ForegroundColor DarkGray
                } else {
                    Write-Host '         install.ps1 已更新，将用新版重新执行。' -ForegroundColor Green
                }
            }
            'behind' {
                Write-Host '[自更新] 检测到安装器版本落后于仓库。' -ForegroundColor Yellow
                if ($su.SelfChanged) {
                    Write-Host '         仓库中的 install.ps1 有更新，建议先更新再安装：' -ForegroundColor Yellow
                } else {
                    Write-Host '         安装逻辑本身未变化，可继续安装；如需最新代码请先更新：' -ForegroundColor Yellow
                }
                Write-Host "         git -C `"$source`" pull" -ForegroundColor Yellow
                Write-Host '         或本次直接加 -SelfUpdate 让安装器自动拉取。' -ForegroundColor Yellow
            }
            'diverged' {
                Write-Host '[自更新] 本地与远程已分叉，跳过自动更新以免覆盖改动。' -ForegroundColor DarkYellow
            }
            'dirty' {
                Write-Host '[自更新] 工作区有未提交改动，跳过自动更新。' -ForegroundColor DarkGray
            }
            'fetch-failed' {
                Write-Host '[自更新] 无法连接远程仓库，跳过（不影响安装）。' -ForegroundColor DarkGray
            }
            'no-git' {
                Write-Host '[自更新] 未安装 git，跳过自更新检查。' -ForegroundColor DarkGray
            }
            'not-git' {
                # 压缩包安装：静默跳过，不打扰用户
            }
            'detached' {
                Write-Host '[自更新] 当前处于 detached HEAD，跳过自更新。' -ForegroundColor DarkGray
            }
        }
        if ($su.Status -eq 'updated' -and $su.SelfChanged) { $selfUpdateReexec = $true }
    } catch {
        Write-Host "[自更新] 检查失败（不影响安装）：$($_.Exception.Message)" -ForegroundColor DarkGray
    }
}

# 拉到了新版自身：用新脚本重新执行，其余参数原样透传
if ($selfUpdateReexec) {
    Write-Host '[自更新] 以新版 install.ps1 重新执行...' -ForegroundColor Green
    $reexecArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath, '-SkipSelfUpdate')
    foreach ($kv in @{
        Profile = $Profile; DshHome = $DshHome; HindsightDir = $HindsightDir
        DataDir = $DataDir; RuntimePath = $RuntimePath
        KeepBackups = $KeepBackups; HealthTimeoutSec = $HealthTimeoutSec
    }.GetEnumerator()) {
        if ($kv.Value) { $reexecArgs += @("-$($kv.Key)", [string]$kv.Value) }
    }
    if ($DryRun) { $reexecArgs += '-DryRun' }
    if ($AllowRunning) { $reexecArgs += '-AllowRunning' }
    & $PSCommandPath @reexecArgs
    exit $LASTEXITCODE
}


if (-not $DshHome) { $DshHome = Join-Path $env:USERPROFILE '.dsh' }
$DshHome = [System.IO.Path]::GetFullPath($DshHome).TrimEnd('\')
$profileDir = Join-Path $DshHome (Join-Path 'profiles' $Profile)
$manifestPath = Join-Path $profileDir 'package.json'
$installRoot = Join-Path $DshHome 'plugins\dsh-nebula-memory'
$moduleDir = Join-Path $profileDir 'node_modules\dsh-nebula-memory'
$configPath = Join-Path $DshHome 'memory-nebula.json'
$backupBase = Join-Path $DshHome 'backups\memory-nebula'

function Test-SameOrChild([string]$child, [string]$parent) {
    $c = [System.IO.Path]::GetFullPath($child).TrimEnd('\') + '\'
    $p = [System.IO.Path]::GetFullPath($parent).TrimEnd('\') + '\'
    return $c.StartsWith($p, [System.StringComparison]::OrdinalIgnoreCase)
}

function Assert-UnderDshHome([string]$path) {
    if (-not (Test-SameOrChild $path $DshHome)) { throw "拒绝操作 DSH_HOME 之外的路径：$path" }
}

# Remove a directory, but never follow a root junction/symlink to its target.
function Remove-PluginDir([string]$target) {
    if (-not (Test-Path -LiteralPath $target)) { return }
    Assert-UnderDshHome $target
    $item = Get-Item -LiteralPath $target -Force
    if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
        $item.Delete()
    } else {
        Remove-Item -LiteralPath $target -Recurse -Force
    }
}

function Remove-MemoryDir([string]$target) {
    $resolved = [System.IO.Path]::GetFullPath($target).TrimEnd('\')
    if ($resolved -ne $DataDir) { throw "记忆目录路径校验失败：$target" }
    if ($resolved -eq $dataRoot -or $resolved -eq $DshHome -or $resolved -eq $env:USERPROFILE) {
        throw "拒绝删除非专用记忆目录：$resolved"
    }
    if (-not (Test-Path -LiteralPath $resolved)) { return }
    $item = Get-Item -LiteralPath $resolved -Force
    if (-not $item.PSIsContainer) { throw "拒绝删除非目录对象：$resolved" }
    if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
        $item.Delete()
    } else {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}

function Copy-TreeVerified([string]$from, [string]$to, [string]$kind) {
    $from = [System.IO.Path]::GetFullPath($from).TrimEnd('\')
    $to = [System.IO.Path]::GetFullPath($to).TrimEnd('\')
    if (-not (Test-Path -LiteralPath $from -PathType Container)) { throw "备份源目录不存在：$from" }
    if (Test-Path -LiteralPath $to) { throw "复制目标已存在：$to" }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $to) | Out-Null
    Copy-Item -LiteralPath $from -Destination $to -Recurse -Force

    $sourceFiles = @(Get-ChildItem -LiteralPath $from -Recurse -File -Force)
    $targetFiles = @(Get-ChildItem -LiteralPath $to -Recurse -File -Force)
    if ($sourceFiles.Count -ne $targetFiles.Count) {
        throw "$kind 文件数校验失败：源 $($sourceFiles.Count)，目标 $($targetFiles.Count)"
    }
    $records = @()
    [int64]$totalBytes = 0
    foreach ($file in $sourceFiles) {
        $relative = $file.FullName.Substring($from.Length).TrimStart('\')
        $copied = Join-Path $to $relative
        if (-not (Test-Path -LiteralPath $copied -PathType Leaf)) { throw "$kind 缺少文件：$relative" }
        $sourceHash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
        $targetHash = (Get-FileHash -LiteralPath $copied -Algorithm SHA256).Hash
        if ($sourceHash -ne $targetHash) { throw "$kind SHA256 校验失败：$relative" }
        $totalBytes += $file.Length
        $records += [pscustomobject]@{ path = $relative; bytes = $file.Length; sha256 = $sourceHash }
    }
    return [pscustomobject]@{
        kind = $kind; source = $from; destination = $to
        fileCount = $sourceFiles.Count; totalBytes = $totalBytes; files = $records
    }
}

function Copy-FileVerified([string]$from, [string]$to, [string]$kind) {
    if (-not (Test-Path -LiteralPath $from -PathType Leaf)) { throw "备份源文件不存在：$from" }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $to) | Out-Null
    Copy-Item -LiteralPath $from -Destination $to -Force
    $sourceHash = (Get-FileHash -LiteralPath $from -Algorithm SHA256).Hash
    $targetHash = (Get-FileHash -LiteralPath $to -Algorithm SHA256).Hash
    if ($sourceHash -ne $targetHash) { throw "$kind SHA256 校验失败" }
    $item = Get-Item -LiteralPath $from
    return [pscustomobject]@{
        kind = $kind; source = $from; destination = $to
        fileCount = 1; totalBytes = $item.Length
        files = @([pscustomobject]@{ path = $item.Name; bytes = $item.Length; sha256 = $sourceHash })
    }
}

function Get-OwnedServers {
    # Only installer-managed Node/Electron sidecars qualify: the executable must
    # be a known runtime and server.js must be the first argument after it.
    # Merely opening/editing/referencing server.js must never get a process killed.
    $found = @()
    $processes = @(Get-CimInstance Win32_Process -ErrorAction Stop)
    foreach ($process in $processes) {
        $image = if ($process.ExecutablePath) { [System.IO.Path]::GetFileName($process.ExecutablePath) } else { $process.Name }
        if ($image -notin @('node.exe', 'DeepSeek Harness.exe')) { continue }
        $command = [string]$process.CommandLine
        if (-not $command) { continue }
        $match = [regex]::Match($command, '^\s*(?:"[^"]+"|\S+)\s+(?:"(?<entry>[^"]+)"|(?<entry>\S+))(?:\s+|$)')
        if (-not $match.Success) { continue }
        $entry = $match.Groups['entry'].Value
        try {
            if (-not [System.IO.Path]::IsPathRooted($entry)) { continue }
            $entry = [System.IO.Path]::GetFullPath($entry)
        } catch { continue }
        if ($entry -notmatch 'dsh-nebula-memory[\\/]server\.js$') { continue }
        if (Test-SameOrChild $entry $DshHome) { $found += $process }
    }
    return @($found)
}

function Stop-OwnedServers {
    $servers = @(Get-OwnedServers)
    foreach ($server in $servers) {
        Stop-Process -Id $server.ProcessId -Force -ErrorAction Stop
        Write-Host "已停止旧面板服务 PID $($server.ProcessId)"
    }
    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    while ([DateTime]::UtcNow -lt $deadline) {
        if (@(Get-OwnedServers).Count -eq 0) { return }
        Start-Sleep -Milliseconds 250
    }
    $remaining = @(Get-OwnedServers)
    if ($remaining.Count) { throw "旧面板服务未完全退出：PID $($remaining.ProcessId -join ', ')" }
}

function Resolve-Runtime([string]$explicit) {
    $candidates = @($explicit, $env:DSH_EXECUTABLE)
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            return [System.IO.Path]::GetFullPath($candidate)
        }
    }
    $node = Get-Command node -ErrorAction SilentlyContinue
    if ($node -and $node.Source) { return $node.Source }
    $running = Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($running -and $running.Path -and (Test-Path -LiteralPath $running.Path)) { return $running.Path }

    $uninstallKeys = @(
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
    )
    foreach ($key in $uninstallKeys) {
        foreach ($entry in @(Get-ItemProperty $key -ErrorAction SilentlyContinue)) {
            if ($entry.DisplayName -notlike 'DeepSeek Harness*') { continue }
            if ($entry.DisplayIcon) {
                $icon = ([string]$entry.DisplayIcon).Split(',')[0].Trim().Trim('"')
                if (Test-Path -LiteralPath $icon -PathType Leaf) { return $icon }
            }
            if ($entry.InstallLocation) {
                $exe = Join-Path ([string]$entry.InstallLocation) 'DeepSeek Harness.exe'
                if (Test-Path -LiteralPath $exe -PathType Leaf) { return $exe }
            }
        }
    }
    throw '找不到可用于健康检查的 Node.js 或 DeepSeek Harness 可执行文件。请用 -RuntimePath 指定 node.exe 或 DeepSeek Harness.exe。'
}

function Get-FreePort {
    $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 0)
    $listener.Start()
    $port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
    $listener.Stop()
    return $port
}

function Invoke-HealthCheck([string]$runtime, [string]$serverPath, [string]$logDir, [string]$expectedVersion) {
    $port = Get-FreePort
    $stdout = Join-Path $logDir 'health.stdout.log'
    $stderr = Join-Path $logDir 'health.stderr.log'
    $names = @(
        'ELECTRON_RUN_AS_NODE', 'MEMORY_NEBULA_PORT', 'MEMORY_NEBULA_DATA_DIR',
        'MEMORY_NEBULA_HINDSIGHT_DIR', 'MEMORY_NEBULA_DISABLE_HINDSIGHT', 'DSH_HOME'
    )
    $oldEnv = @{}
    foreach ($name in $names) { $oldEnv[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
    $process = $null
    try {
        [Environment]::SetEnvironmentVariable('ELECTRON_RUN_AS_NODE', '1', 'Process')
        [Environment]::SetEnvironmentVariable('MEMORY_NEBULA_PORT', [string]$port, 'Process')
        [Environment]::SetEnvironmentVariable('MEMORY_NEBULA_DATA_DIR', $DataDir, 'Process')
        [Environment]::SetEnvironmentVariable('MEMORY_NEBULA_HINDSIGHT_DIR', $HindsightDir, 'Process')
        [Environment]::SetEnvironmentVariable('MEMORY_NEBULA_DISABLE_HINDSIGHT', '1', 'Process')
        [Environment]::SetEnvironmentVariable('DSH_HOME', $DshHome, 'Process')
        $process = Start-Process -FilePath $runtime -ArgumentList ('"{0}"' -f $serverPath) `
            -WorkingDirectory $installRoot -PassThru -WindowStyle Hidden `
            -RedirectStandardOutput $stdout -RedirectStandardError $stderr

        $health = $null
        $deadline = [DateTime]::UtcNow.AddSeconds($HealthTimeoutSec)
        while ([DateTime]::UtcNow -lt $deadline) {
            if ($process.HasExited) { break }
            try {
                $candidate = Invoke-RestMethod "http://127.0.0.1:$port/healthz" -TimeoutSec 2
                if ($candidate.service -eq 'dsh-nebula-memory' -and $candidate.ready -eq $true) { $health = $candidate; break }
            } catch { Start-Sleep -Milliseconds 250 }
        }
        if (-not $health) {
            $errorTail = ''
            if (Test-Path -LiteralPath $stderr) { $errorTail = (Get-Content -LiteralPath $stderr -Tail 20 -ErrorAction SilentlyContinue) -join "`n" }
            throw "新版健康检查失败（进程退出或超时）。$errorTail"
        }
        if (-not $health.ok -or -not $health.ready -or $health.service -ne 'dsh-nebula-memory') { throw '新版健康检查返回了无效或未就绪的服务状态。' }
        if ([string]$health.version -ne [string]$expectedVersion) {
            throw "新版健康检查版本不符：期望 $expectedVersion，实际 $($health.version)。"
        }
        if ($health.mode -ne 'local') { throw "健康检查应使用隔离的 local 模式，实际为 $($health.mode)。" }
        return [pscustomobject]@{
            ok = $true; service = $health.service; version = $health.version; mode = $health.mode
            units = [int64]$health.counts.units; links = [int64]$health.counts.links
            checkedAt = (Get-Date).ToString('o')
        }
    } finally {
        if ($process -and -not $process.HasExited) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        }
        foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $oldEnv[$name], 'Process') }
    }
}

function Remove-ExactDirectory([string]$path) {
    if (-not (Test-Path -LiteralPath $path)) { return }
    $resolved = [System.IO.Path]::GetFullPath($path).TrimEnd('\')
    if ($resolved -eq [System.IO.Path]::GetPathRoot($resolved).TrimEnd('\')) { throw "拒绝删除根目录：$resolved" }
    $item = Get-Item -LiteralPath $resolved -Force
    if (-not $item.PSIsContainer) { throw "拒绝删除非目录对象：$resolved" }
    if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
        $item.Delete()
    } else {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}

function Restore-MemoryFromBackup([string]$target, [string]$backup) {
    $target = [System.IO.Path]::GetFullPath($target).TrimEnd('\')
    if ($target -ne $DataDir) { throw "记忆恢复目标校验失败：$target" }
    $parent = Split-Path -Parent $target
    $leaf = Split-Path $target -Leaf
    $suffix = [guid]::NewGuid().ToString('N')
    $stage = Join-Path $parent "$leaf.restore-$suffix"
    $preserve = Join-Path $parent "$leaf.pre-rollback-$suffix"
    $incomplete = Join-Path $parent "$leaf.incomplete-$suffix"
    foreach ($path in @($stage, $preserve, $incomplete)) {
        if (Test-Path -LiteralPath $path) { throw "恢复临时路径已存在：$path" }
    }

    # The working store is not touched until a complete verified restore copy exists.
    try {
        Copy-TreeVerified $backup $stage 'rollback-memory-data-stage' | Out-Null
    } catch {
        try { Remove-ExactDirectory $stage } catch {}
        throw
    }

    $movedOriginal = $false
    try {
        if (Test-Path -LiteralPath $target) {
            $item = Get-Item -LiteralPath $target -Force
            if (-not $item.PSIsContainer) { throw "恢复目标不是目录：$target" }
            Move-Item -LiteralPath $target -Destination $preserve
            $movedOriginal = $true
        }
        Move-Item -LiteralPath $stage -Destination $target
    } catch {
        $restoreError = $_.Exception.Message
        try {
            if ($movedOriginal -and (Test-Path -LiteralPath $preserve)) {
                if (Test-Path -LiteralPath $target) { Move-Item -LiteralPath $target -Destination $incomplete }
                Move-Item -LiteralPath $preserve -Destination $target
            }
        } catch {
            throw "$restoreError；原目录归位也失败：$($_.Exception.Message)。原目录保留在 $preserve"
        }
        throw $restoreError
    } finally {
        try { Remove-ExactDirectory $stage } catch {}
    }

    # The restored store is already in place; cleanup failure must not roll it back.
    if (Test-Path -LiteralPath $preserve) {
        try { Remove-ExactDirectory $preserve } catch { Write-Warning "旧工作库临时副本清理失败：$preserve" }
    }
}

function Restore-Directory([string]$target, [string]$rollback, [bool]$existed, [string]$backup) {
    if (Test-Path -LiteralPath $rollback) {
        if (Test-Path -LiteralPath $target) { Remove-PluginDir $target }
        Move-Item -LiteralPath $rollback -Destination $target
        return
    }
    if (Test-Path -LiteralPath $target) { Remove-PluginDir $target }
    if ($existed -and (Test-Path -LiteralPath $backup)) {
        Copy-TreeVerified $backup $target 'rollback-code' | Out-Null
    }
}

# ---- validate the bundle and existing profile ------------------------------
$pkgPath = Join-Path $source 'package.json'
if (-not (Test-Path -LiteralPath $pkgPath)) { throw "找不到 $pkgPath，请在解压后的插件目录中运行本脚本。" }
$pkg = [System.IO.File]::ReadAllText($pkgPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
if ($pkg.name -ne 'dsh-nebula-memory') { throw "package.json 的 name 不是 dsh-nebula-memory：$($pkg.name)" }

# ---- 前置校验：版本号单一真源必须是可用的 -----------------------------------
# 1.3.14 起版本号只有一处权威来源：package.json 的 version。
# server.js 在启动时读 package.json 得到 VERSION，不再写死常量。
# 这从根上消除了 1.3.9/1.3.10 那种「package.json 改了、server.js 常量没改」
# 导致健康检查判定失败、升级被静默回滚的问题。
#
# 这里在**修改任何文件之前**确认两件事：
#   1. package.json 的 version 是合法的 SemVer；
#   2. server.js 确实从 package.json 读取版本（而不是残留的写死常量）。
$pkgVersion = [string]$pkg.version
if ([string]::IsNullOrWhiteSpace($pkgVersion)) {
    throw "package.json 缺少 version 字段，包不完整。请在官方仓库重新下载发布包。"
}
# SemVer 2.0.0：MAJOR.MINOR.PATCH，可带预发布(-beta.1)与构建元数据(+sha)
$semverPattern = '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$'
if ($pkgVersion -notmatch $semverPattern) {
    throw "package.json 的 version 不是合法的 SemVer：$pkgVersion。应为 MAJOR.MINOR.PATCH，例如 1.3.14 或 1.4.0-beta.1。"
}

$serverJsPath = Join-Path $source 'server.js'
if (-not (Test-Path -LiteralPath $serverJsPath)) {
    throw "包内缺少 server.js，包不完整。请在官方仓库重新下载发布包。"
}
$serverJsText = [System.IO.File]::ReadAllText($serverJsPath, [System.Text.Encoding]::UTF8)

# 不能出现写死的 VERSION 常量（那种双源正是历史问题的来源）
if ($serverJsText -match "export\s+const\s+VERSION\s*=\s*['`"][0-9]") {
    $msg = @(
        '包内 server.js 仍写死 VERSION 常量，与「版本号单一真源」约定冲突，安装已中止（未修改任何文件）。',
        "  package.json version : $pkgVersion",
        '  1.3.14 起 server.js 应在运行时读取 package.json 的 version。',
        '继续安装可能出现健康检查版本不符并回滚。',
        '处理办法：到官方仓库重新下载该版本的发布包（推荐）。'
    ) -join "`n"
    throw $msg
}

# 必须确实从 package.json 取版本
if ($serverJsText -notmatch 'package\.json') {
    $msg = @(
        '包内 server.js 未从 package.json 读取版本，包可能已损坏，安装已中止（未修改任何文件）。',
        '处理办法：到官方仓库重新下载该版本的发布包（推荐）。'
    ) -join "`n"
    throw $msg
}

foreach ($f in @('index.js', 'client.js', 'server.js', 'panel.html', 'cordis.patch.yml')) {
    if (-not (Test-Path -LiteralPath (Join-Path $source $f))) { throw "插件文件缺失：$f" }
}
if (-not (Test-Path -LiteralPath $manifestPath)) {
    throw "找不到 profile 清单 $manifestPath。请先启动一次 DeepSeek Harness，确认 profile '$Profile' 已创建。"
}

$config = [pscustomobject]@{}
if (Test-Path -LiteralPath $configPath) {
    $config = [System.IO.File]::ReadAllText($configPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
}
if (-not $HindsightDir -and $config.PSObject.Properties['hindsightDir']) { $HindsightDir = [string]$config.hindsightDir }
if (-not $HindsightDir) { $HindsightDir = Join-Path $DshHome 'hindsight' }
$HindsightDir = [System.IO.Path]::GetFullPath($HindsightDir).TrimEnd('\')
if (-not $DataDir -and $config.PSObject.Properties['dataDir']) { $DataDir = [string]$config.dataDir }
if (-not $DataDir) { $DataDir = Join-Path $DshHome 'memory-nebula-data' }
$DataDir = [System.IO.Path]::GetFullPath($DataDir).TrimEnd('\')
if (Test-Path -LiteralPath $DataDir) {
    $dataItem = Get-Item -LiteralPath $DataDir -Force
    if (-not $dataItem.PSIsContainer) { throw "记忆目录路径已被普通文件占用，已中止且不会删除该文件：$DataDir" }
    if ($dataItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
        throw '记忆目录不能是目录联接或符号链接；请改用真实目标目录，避免备份/回滚改变链接语义。'
    }
}

$dataRoot = [System.IO.Path]::GetPathRoot($DataDir).TrimEnd('\')
if ($DataDir -eq $dataRoot -or $DataDir -eq $DshHome -or $DataDir -eq $env:USERPROFILE) {
    throw "记忆目录不能是磁盘根目录、DSH_HOME 或用户主目录：$DataDir"
}
if ((Test-SameOrChild $DataDir $installRoot) -or (Test-SameOrChild $DataDir $moduleDir) -or
    (Test-SameOrChild $installRoot $DataDir) -or (Test-SameOrChild $moduleDir $DataDir)) {
    throw '记忆目录不能位于插件代码目录内，也不能是代码目录的父目录，避免升级/回滚删除或交换其他文件。'
}
foreach ($reserved in @('plugins', 'profiles', 'sessions', 'backups')) {
    $reservedDir = Join-Path $DshHome $reserved
    if ((Test-SameOrChild $DataDir $reservedDir) -or (Test-SameOrChild $reservedDir $DataDir)) {
        throw "记忆目录不能与 DSH 的 $reserved 目录相同、互为父子目录：$DataDir"
    }
}
if ((Test-SameOrChild $DataDir $backupBase) -or (Test-SameOrChild $backupBase $DataDir)) {
    throw '记忆目录与备份目录不能互相包含。'
}

$running = Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue
if ($running -and -not $DryRun -and -not $AllowRunning) {
    throw 'DeepSeek Harness 正在运行。请先完全退出（含托盘图标），再执行安装；装好后重新启动即可加载插件。'
}

$manifest = [System.IO.File]::ReadAllText($manifestPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
$bundles = @()
if ($manifest.dsh -and $manifest.dsh.profile -and $manifest.dsh.profile.bundles) { $bundles = @($manifest.dsh.profile.bundles) }
$fileSpec = 'file:' + ($installRoot -replace '\\', '/')
$oldVersion = $null
foreach ($oldPkg in @((Join-Path $installRoot 'package.json'), (Join-Path $moduleDir 'package.json'))) {
    if (Test-Path -LiteralPath $oldPkg) {
        try { $oldVersion = ([System.IO.File]::ReadAllText($oldPkg, [System.Text.Encoding]::UTF8) | ConvertFrom-Json).version } catch {}
        if ($oldVersion) { break }
    }
}

Write-Host ''
Write-Host '记忆星云 / Memory Nebula 安全安装与升级' -ForegroundColor Cyan
Write-Host "  source : $source"
Write-Host "  profile: $profileDir"
Write-Host "  files  : $installRoot"
Write-Host "  config : $configPath"
Write-Host "  data   : $DataDir"
Write-Host "  Hindsight: $HindsightDir"
if ($oldVersion) { Write-Host "  upgrade: $oldVersion -> $($pkg.version)" } else { Write-Host "  install: $($pkg.version)" }
Write-Host ''

if ($DryRun) {
    Write-Host '[DryRun] 未停止进程、未改动任何文件。实际执行将：' -ForegroundColor Yellow
    Write-Host '  1. 停止当前 DSH_HOME 对应的旧面板服务'
    Write-Host "  2. 备份并逐文件校验记忆、配置、清单和旧代码到 $backupBase"
    Write-Host '  3. 通过暂存目录替换两份插件代码'
    Write-Host '  4. 用独立端口启动新版并检查 /healthz'
    Write-Host "  5. 失败则恢复代码、配置、清单和记忆；成功后保留最近 $KeepBackups 份备份"
    exit 0
}

$runtime = Resolve-Runtime $RuntimePath
Write-Host "  health runtime: $runtime"

$hadDataDir = Test-Path -LiteralPath $DataDir -PathType Container
$hadConfig = Test-Path -LiteralPath $configPath -PathType Leaf
$hadInstallRoot = Test-Path -LiteralPath $installRoot -PathType Container
$hadModuleDir = Test-Path -LiteralPath $moduleDir -PathType Container
$stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
$backupDir = Join-Path $backupBase "upgrade-$stamp-$PID"
$dataBackup = Join-Path $backupDir 'data'
$configBackup = Join-Path $backupDir 'memory-nebula.json'
$manifestBackup = Join-Path $backupDir 'profile-package.json'
$installBackup = Join-Path $backupDir 'code\plugin'
$moduleBackup = Join-Path $backupDir 'code\profile-module'
$suffix = [guid]::NewGuid().ToString('N')
$stageInstall = "$installRoot.stage-$suffix"
$stageModule = "$moduleDir.stage-$suffix"
$rollbackInstall = "$installRoot.rollback-$suffix"
$rollbackModule = "$moduleDir.rollback-$suffix"
$changesStarted = $false

try {
    Stop-OwnedServers

    # Backup is completed and verified before any code/config/data is replaced.
    New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
    $backupRecords = @()
    if ($hadDataDir) { $backupRecords += Copy-TreeVerified $DataDir $dataBackup 'memory-data' }
    if ($hadConfig) { $backupRecords += Copy-FileVerified $configPath $configBackup 'user-config' }
    $backupRecords += Copy-FileVerified $manifestPath $manifestBackup 'profile-manifest'
    if ($hadInstallRoot) { $backupRecords += Copy-TreeVerified $installRoot $installBackup 'installed-code' }
    if ($hadModuleDir) { $backupRecords += Copy-TreeVerified $moduleDir $moduleBackup 'profile-code' }
    $backupInfo = [ordered]@{
        status = 'backup-complete'; createdAt = (Get-Date).ToString('o')
        oldVersion = $oldVersion; newVersion = $pkg.version
        dshHome = $DshHome; profile = $Profile; dataDir = $DataDir
        hadDataDir = $hadDataDir; hadConfig = $hadConfig
        hadInstallRoot = $hadInstallRoot; hadModuleDir = $hadModuleDir
        items = $backupRecords
    }
    [System.IO.File]::WriteAllText((Join-Path $backupDir 'backup-info.json'), ($backupInfo | ConvertTo-Json -Depth 8), $utf8NoBom)
    Write-Host "备份及 SHA256 校验完成：$backupDir" -ForegroundColor Green

    # Stage and verify both new directories before swapping anything live.
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $installRoot) | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $profileDir 'node_modules') | Out-Null
    Copy-TreeVerified $source $stageInstall 'staged-plugin' | Out-Null
    Copy-TreeVerified $stageInstall $stageModule 'staged-profile-plugin' | Out-Null

    $changesStarted = $true
    foreach ($path in @($stageInstall, $stageModule, $rollbackInstall, $rollbackModule, $installRoot, $moduleDir)) { Assert-UnderDshHome $path }
    if ($hadInstallRoot) { Move-Item -LiteralPath $installRoot -Destination $rollbackInstall }
    Move-Item -LiteralPath $stageInstall -Destination $installRoot
    if ($hadModuleDir) { Move-Item -LiteralPath $moduleDir -Destination $rollbackModule }
    Move-Item -LiteralPath $stageModule -Destination $moduleDir
    Write-Host '新版代码已暂存并替换。'

    # Preserve all other user settings; persist the resolved paths so later DSH
    # launches and upgrades use the same Hindsight and memory directories.
    $config | Add-Member -NotePropertyName hindsightDir -NotePropertyValue $HindsightDir -Force
    $config | Add-Member -NotePropertyName dataDir -NotePropertyValue $DataDir -Force
    [System.IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 20), $utf8NoBom)

    # ── 在 profile 清单里登记这个插件 ──────────────────────────────────────
    # 只把文件夹拷进 node_modules 是**装不上的**：DSH 加载插件看的是 profile
    # package.json 的 dependencies 里有没有这一条（以及 dsh.profile.bundles）。
    # 只拷目录的话，插件不会出现在 DSH 的插件列表里，面板也就起不来。
    # 下面这段就是补上这一步；手动安装的人如果跳过了脚本，必须自己照做。
    if (-not $manifest.dependencies) {
        $manifest | Add-Member -NotePropertyName dependencies -NotePropertyValue ([pscustomobject]@{}) -Force
    }
    $manifest.dependencies | Add-Member -NotePropertyName 'dsh-nebula-memory' -NotePropertyValue $fileSpec -Force
    if (-not $manifest.dsh) {
        $manifest | Add-Member -NotePropertyName dsh -NotePropertyValue ([pscustomobject]@{ profile = [pscustomobject]@{ bundles = @() } }) -Force
    }
    if (-not $manifest.dsh.profile) {
        $manifest.dsh | Add-Member -NotePropertyName profile -NotePropertyValue ([pscustomobject]@{ bundles = @() }) -Force
    }
    if (-not ($bundles -contains 'dsh-nebula-memory')) { $bundles += 'dsh-nebula-memory' }
    $manifest.dsh.profile | Add-Member -NotePropertyName bundles -NotePropertyValue @($bundles) -Force
    [System.IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 20), $utf8NoBom)

    $health = Invoke-HealthCheck $runtime (Join-Path $installRoot 'server.js') $backupDir $pkg.version
    [System.IO.File]::WriteAllText((Join-Path $backupDir 'health.json'), ($health | ConvertTo-Json -Depth 5), $utf8NoBom)
    Write-Host "新版健康检查通过：version=$($health.version)，units=$($health.units)，links=$($health.links)" -ForegroundColor Green

    foreach ($path in @($rollbackInstall, $rollbackModule, $stageInstall, $stageModule)) {
        try { Remove-PluginDir $path } catch { Write-Warning "临时目录清理失败：$path；$($_.Exception.Message)" }
    }

    # Retention is best-effort and never deletes the backup just created.
    try {
        $oldBackups = @(Get-ChildItem -LiteralPath $backupBase -Directory -Force |
            Where-Object { $_.Name -like 'upgrade-*' } | Sort-Object Name -Descending | Select-Object -Skip $KeepBackups)
        foreach ($old in $oldBackups) {
            if ($old.Parent.FullName -eq $backupBase -and $old.FullName -ne $backupDir) { Remove-PluginDir $old.FullName }
        }
    } catch { Write-Warning "旧备份清理失败：$($_.Exception.Message)" }

    Write-Host ''
    Write-Host '安装/升级完成，本地记忆未替换。' -ForegroundColor Green
    Write-Host "备份保留在：$backupDir"

    # ---- 没有 Hindsight 时的明确提示（只提示，不阻断安装）------------------
    # 纯本地模式下面板能打开，但本地库不会自动积累记忆：不说明一句，
    # 用户第一次打开看到满屏 0 会以为插件坏了。
    $hsOk = $false
    try {
        if ($HindsightDir -and (Test-Path -LiteralPath $HindsightDir)) {
            $probe = Invoke-WebRequest -Uri 'http://127.0.0.1:8888/health' -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
            $hsOk = ($probe.StatusCode -eq 200)
        }
    } catch { $hsOk = $false }
    if (-not $hsOk) {
        Write-Host ''
        Write-Host '提示：未检测到 Hindsight（127.0.0.1:8888 未响应，或 Hindsight 目录不存在）' -ForegroundColor Yellow
        Write-Host '      插件仍会正常安装，面板以「纯本地」模式运行；但本地库当前为空，只展示已有数据。'
        Write-Host '      要看到完整记忆：部署 Hindsight 后重跑本脚本并传 -HindsightDir <Hindsight 根目录>，'
        Write-Host '      或把记忆导入本地库（面板服务的 POST /remember）。'
    }

    Write-Host '请重新启动 DeepSeek Harness，然后在左侧栏「更多」中打开「记忆星云」。'
} catch {
    $original = $_.Exception.Message
    foreach ($path in @($stageInstall, $stageModule)) {
        try { Remove-PluginDir $path } catch {}
    }
    if (-not $changesStarted) { throw "安装/升级在修改前中止：$original。备份目录：$backupDir" }

    $rollbackErrors = @()
    try { Stop-OwnedServers } catch { $rollbackErrors += "停止服务：$($_.Exception.Message)" }
    try { Restore-Directory $installRoot $rollbackInstall $hadInstallRoot $installBackup } catch { $rollbackErrors += "恢复插件代码：$($_.Exception.Message)" }
    try { Restore-Directory $moduleDir $rollbackModule $hadModuleDir $moduleBackup } catch { $rollbackErrors += "恢复 profile 代码：$($_.Exception.Message)" }
    try {
        if ($hadConfig) { Copy-Item -LiteralPath $configBackup -Destination $configPath -Force }
        elseif (Test-Path -LiteralPath $configPath) { Remove-Item -LiteralPath $configPath -Force }
    } catch { $rollbackErrors += "恢复用户配置：$($_.Exception.Message)" }
    try { Copy-Item -LiteralPath $manifestBackup -Destination $manifestPath -Force } catch { $rollbackErrors += "恢复 profile 清单：$($_.Exception.Message)" }
    try {
        if ($hadDataDir) {
            Restore-MemoryFromBackup $DataDir $dataBackup
        } elseif (Test-Path -LiteralPath $DataDir) {
            Remove-MemoryDir $DataDir
        }
    } catch { $rollbackErrors += "恢复记忆数据：$($_.Exception.Message)" }

    $rollbackInfo = [ordered]@{
        failedAt = (Get-Date).ToString('o'); error = $original
        rollbackComplete = ($rollbackErrors.Count -eq 0); rollbackErrors = $rollbackErrors
    }
    try { [System.IO.File]::WriteAllText((Join-Path $backupDir 'rollback.json'), ($rollbackInfo | ConvertTo-Json -Depth 5), $utf8NoBom) } catch {}
    if ($rollbackErrors.Count) {
        throw "安装/升级失败：$original。回滚未完全成功：$($rollbackErrors -join '；')}。备份保留在 $backupDir"
    }
    throw "安装/升级失败：$original。已恢复旧代码、配置、profile 清单和记忆数据。备份保留在 $backupDir"
}
