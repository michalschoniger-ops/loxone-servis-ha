param(
  [string]$HubUrl = "",
  [string]$PairingCode = "",
  [string]$AgentName = $env:COMPUTERNAME,
  [switch]$NonInteractive
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)

$source = Join-Path $PSScriptRoot "EvoraConfigLauncher.ps1"
$restartSource = Join-Path $PSScriptRoot "Restart-EvoraConfigLauncher.ps1"
if (-not (Test-Path -LiteralPath $source)) {
  throw "EvoraConfigLauncher.ps1 must be in the same folder as this installer."
}
if (-not (Test-Path -LiteralPath $restartSource)) {
  throw "Restart-EvoraConfigLauncher.ps1 must be in the same folder as this installer."
}

$sourceText = Get-Content -LiteralPath $source -Raw
$versionMatch = [Regex]::Match($sourceText, '(?m)^\$HelperVersion\s*=\s*"([0-9]+(?:\.[0-9]+){3})"\s*$')
if (-not $versionMatch.Success) { throw "The Launcher package does not declare a valid helper version." }
$expectedVersion = $versionMatch.Groups[1].Value

$installDirectory = Join-Path $env:LOCALAPPDATA "EvoraSmartHub\ConfigLauncher"
$installedScript = Join-Path $installDirectory "EvoraConfigLauncher.ps1"
$installedRestartScript = Join-Path $installDirectory "Restart-EvoraConfigLauncher.ps1"
$configPath = Join-Path $installDirectory "config.json"
$runtimePath = Join-Path $installDirectory "runtime.json"
$stopRequestPath = Join-Path $installDirectory "stop.request"
$rollbackDirectory = Join-Path $installDirectory "install-rollback"
$rollbackScript = Join-Path $rollbackDirectory "EvoraConfigLauncher.ps1"
$rollbackRestartScript = Join-Path $rollbackDirectory "Restart-EvoraConfigLauncher.ps1"
$rollbackConfig = Join-Path $rollbackDirectory "config.json"
$scheduledTaskName = "Evora Smart Hub Config Launcher"
$startupDirectory = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
$shortcutPath = Join-Path $startupDirectory "Evora Config Launcher.lnk"
$hasHubUrl = -not [string]::IsNullOrWhiteSpace($HubUrl)
$hasPairingCode = -not [string]::IsNullOrWhiteSpace($PairingCode)

if ($hasHubUrl -xor $hasPairingCode) {
  throw "HubUrl and PairingCode must be supplied together."
}

$reuseExistingPairing = (Test-Path -LiteralPath $configPath) -and -not $hasHubUrl -and -not $hasPairingCode
if (-not $reuseExistingPairing -and -not $hasHubUrl -and -not $hasPairingCode) {
  if ($NonInteractive) { throw "HubUrl and PairingCode are required for the first installation." }
  $HubUrl = Read-Host "Evora Smart Hub HTTPS URL"
  $PairingCode = Read-Host "One-time pairing code from Settings"
  $hasHubUrl = -not [string]::IsNullOrWhiteSpace($HubUrl)
  $hasPairingCode = -not [string]::IsNullOrWhiteSpace($PairingCode)
  if (-not $hasHubUrl -or -not $hasPairingCode) {
    throw "HubUrl and PairingCode are required for the first installation."
  }
}

function Get-TrustedLauncherProcess([string]$ScriptPath) {
  if (-not (Test-Path -LiteralPath $runtimePath)) { return $null }
  try {
    $state = Get-Content -LiteralPath $runtimePath -Raw | ConvertFrom-Json
    if ([IO.Path]::GetFullPath([string]$state.scriptPath) -ine [IO.Path]::GetFullPath($ScriptPath)) { return $null }
    $process = Get-Process -Id ([int]$state.pid) -ErrorAction Stop
    if ($process.ProcessName -notin @("powershell", "pwsh")) { return $null }
    if ($process.StartTime.ToUniversalTime().Ticks -ne [Int64]$state.processStartUtcTicks) { return $null }
    return $process
  } catch {
    return $null
  }
}

function Get-OwnedLauncherProcesses([string]$ScriptPath) {
  $fullScriptPath = [IO.Path]::GetFullPath($ScriptPath)
  $escapedPath = [Regex]::Escape($fullScriptPath)
  $pathPattern = '(?i)(?:^|[\s"])' + $escapedPath + '(?=$|[\s"])'
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  $result = @()
  $processes = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -in @("powershell.exe", "pwsh.exe") -and $_.CommandLine -match $pathPattern }
  foreach ($process in $processes) {
    $owner = Invoke-CimMethod -InputObject $process -MethodName GetOwner -ErrorAction SilentlyContinue
    if ($null -eq $owner -or $owner.ReturnValue -ne 0) { continue }
    $ownerIdentity = if ([string]::IsNullOrWhiteSpace([string]$owner.Domain)) {
      [string]$owner.User
    } else {
      "{0}\{1}" -f $owner.Domain, $owner.User
    }
    if ($ownerIdentity -ine $identity) { continue }
    $result += $process
  }
  return @($result)
}

function Stop-InstalledLauncher([string]$ScriptPath) {
  New-Item -ItemType Directory -Path $installDirectory -Force | Out-Null
  Set-Content -LiteralPath $stopRequestPath -Value ((Get-Date).ToUniversalTime().ToString("o")) -Encoding ASCII
  $trustedProcess = Get-TrustedLauncherProcess $ScriptPath
  if ($null -ne $trustedProcess) {
    $deadline = (Get-Date).AddSeconds(10)
    do {
      Start-Sleep -Milliseconds 200
      $trustedProcess = Get-TrustedLauncherProcess $ScriptPath
    } while ($null -ne $trustedProcess -and (Get-Date) -lt $deadline)
    if ($null -ne $trustedProcess) {
      Stop-Process -Id $trustedProcess.Id -Force -ErrorAction Stop
    }
    return
  }

  # Compatibility fallback for versions that predate runtime.json. The exact
  # installed path and current Windows identity are both verified before stopping.
  foreach ($process in @(Get-OwnedLauncherProcesses $ScriptPath)) {
    Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction Stop
  }

  $deadline = (Get-Date).AddSeconds(5)
  do {
    if (@(Get-OwnedLauncherProcesses $ScriptPath).Count -eq 0) { return }
    Start-Sleep -Milliseconds 200
  } while ((Get-Date) -lt $deadline)
  throw "The previous Launcher process did not stop safely."
}

function Register-LauncherWatchdog([string]$ScriptPath) {
  $powerShellPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
  $arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ScriptPath`""
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  $action = New-ScheduledTaskAction -Execute $powerShellPath -Argument $arguments -WorkingDirectory $installDirectory
  $logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
  $watchdogTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650)
  $principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero)
  Register-ScheduledTask -TaskName $scheduledTaskName -Action $action -Trigger @($logonTrigger, $watchdogTrigger) `
    -Principal $principal -Settings $settings -Description "Keeps Evora Config Launcher online while this Windows user is signed in." -Force | Out-Null
  Enable-ScheduledTask -TaskName $scheduledTaskName | Out-Null
}

function Save-StartupShortcut([string]$ScriptPath) {
  New-Item -ItemType Directory -Path $startupDirectory -Force | Out-Null
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
  $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ScriptPath`""
  $shortcut.WorkingDirectory = $installDirectory
  $shortcut.Description = "Evora Smart Hub - Loxone Config Launcher"
  $shortcut.Save()
}

function Start-InstalledLauncher([string]$ScriptPath) {
  Remove-Item -LiteralPath $stopRequestPath -Force -ErrorAction SilentlyContinue
  Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$ScriptPath`"")
}

function Wait-LauncherHealthy([string]$ScriptPath, [string]$Version, [int]$TimeoutSeconds = 45) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $process = Get-TrustedLauncherProcess $ScriptPath
    if ($null -ne $process) {
      try {
        $state = Get-Content -LiteralPath $runtimePath -Raw | ConvertFrom-Json
        if ([string]$state.helperVersion -eq $Version -and -not [string]::IsNullOrWhiteSpace([string]$state.connectedAt)) {
          return $true
        }
      } catch { }
    }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  return $false
}

New-Item -ItemType Directory -Path $installDirectory -Force | Out-Null
Remove-Item -LiteralPath $rollbackDirectory -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $rollbackDirectory -Force | Out-Null
$hadInstalledScript = Test-Path -LiteralPath $installedScript
$hadInstalledRestart = Test-Path -LiteralPath $installedRestartScript
$hadConfig = Test-Path -LiteralPath $configPath
$hadShortcut = Test-Path -LiteralPath $shortcutPath
if ($hadInstalledScript) { Copy-Item -LiteralPath $installedScript -Destination $rollbackScript -Force }
if ($hadInstalledRestart) { Copy-Item -LiteralPath $installedRestartScript -Destination $rollbackRestartScript -Force }
if ($hadConfig) { Copy-Item -LiteralPath $configPath -Destination $rollbackConfig -Force }

if (-not $reuseExistingPairing) {
  # Pair before stopping the working helper. The Hub keeps the former token
  # valid until the replacement sends its first authenticated heartbeat.
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $source -HubUrl $HubUrl -PairingCode $PairingCode -AgentName $AgentName -PairOnly
  if ($LASTEXITCODE -ne 0) {
    if ($hadConfig -and (Test-Path -LiteralPath $rollbackConfig)) {
      Copy-Item -LiteralPath $rollbackConfig -Destination $configPath -Force
    } elseif (-not $hadConfig) {
      Remove-Item -LiteralPath $configPath -Force -ErrorAction SilentlyContinue
    }
    Remove-Item -LiteralPath $rollbackDirectory -Recurse -Force -ErrorAction SilentlyContinue
    throw "Pairing failed. The previous installation and pairing were left in place."
  }
}

try {
  Disable-ScheduledTask -TaskName $scheduledTaskName -ErrorAction SilentlyContinue | Out-Null
  Stop-InstalledLauncher $installedScript
  Copy-Item -LiteralPath $source -Destination $installedScript -Force
  Copy-Item -LiteralPath $restartSource -Destination $installedRestartScript -Force
  Register-LauncherWatchdog $installedScript
  Save-StartupShortcut $installedScript
  Start-InstalledLauncher $installedScript
  if (-not (Wait-LauncherHealthy $installedScript $expectedVersion)) {
    throw "The installed Launcher did not confirm an authenticated Hub heartbeat within 45 seconds."
  }
  Remove-Item -LiteralPath $rollbackDirectory -Recurse -Force -ErrorAction SilentlyContinue
} catch {
  $failure = $_.Exception.Message
  try { Disable-ScheduledTask -TaskName $scheduledTaskName -ErrorAction SilentlyContinue | Out-Null } catch { }
  try { Stop-InstalledLauncher $installedScript } catch { }
  if ($hadInstalledScript) { Copy-Item -LiteralPath $rollbackScript -Destination $installedScript -Force }
  else { Remove-Item -LiteralPath $installedScript -Force -ErrorAction SilentlyContinue }
  if ($hadInstalledRestart) { Copy-Item -LiteralPath $rollbackRestartScript -Destination $installedRestartScript -Force }
  else { Remove-Item -LiteralPath $installedRestartScript -Force -ErrorAction SilentlyContinue }
  if ($hadConfig) { Copy-Item -LiteralPath $rollbackConfig -Destination $configPath -Force }
  else { Remove-Item -LiteralPath $configPath -Force -ErrorAction SilentlyContinue }
  $restoredAndStarted = $false
  if ($hadInstalledScript -and $hadConfig) {
    try { Register-LauncherWatchdog $installedScript } catch { }
    try { Save-StartupShortcut $installedScript } catch { }
    try {
      Start-InstalledLauncher $installedScript
      $restoredAndStarted = $true
    } catch { }
  } else {
    try { Unregister-ScheduledTask -TaskName $scheduledTaskName -Confirm:$false -ErrorAction SilentlyContinue } catch { }
    if (-not $hadShortcut) { Remove-Item -LiteralPath $shortcutPath -Force -ErrorAction SilentlyContinue }
  }
  Remove-Item -LiteralPath $rollbackDirectory -Recurse -Force -ErrorAction SilentlyContinue
  if ($restoredAndStarted) {
    throw "Installation failed: $failure The previous working installation was restored and restarted."
  }
  throw "Installation failed: $failure Previous files and pairing were restored, but the Launcher could not be restarted automatically."
}

if ($reuseExistingPairing) {
  Write-Host "Evora Config Launcher $expectedVersion was updated, verified online, and protected by the watchdog. Existing pairing was preserved."
} else {
  Write-Host "Evora Config Launcher $expectedVersion was installed, paired, verified online, and protected by the watchdog."
}
