param(
  [string]$HubUrl = "",
  [string]$PairingCode = "",
  [string]$AgentName = $env:COMPUTERNAME
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$source = Join-Path $PSScriptRoot "EvoraConfigLauncher.ps1"
if (-not (Test-Path -LiteralPath $source)) {
  throw "EvoraConfigLauncher.ps1 must be in the same folder as this installer."
}

$installDirectory = Join-Path $env:LOCALAPPDATA "EvoraSmartHub\ConfigLauncher"
$installedScript = Join-Path $installDirectory "EvoraConfigLauncher.ps1"
$configPath = Join-Path $installDirectory "config.json"
$hasHubUrl = -not [string]::IsNullOrWhiteSpace($HubUrl)
$hasPairingCode = -not [string]::IsNullOrWhiteSpace($PairingCode)

if ($hasHubUrl -xor $hasPairingCode) {
  throw "HubUrl and PairingCode must be supplied together."
}

$reuseExistingPairing = (Test-Path -LiteralPath $configPath) -and -not $hasHubUrl -and -not $hasPairingCode
if (-not $reuseExistingPairing -and -not $hasHubUrl -and -not $hasPairingCode) {
  $HubUrl = Read-Host "Evora Smart Hub HTTPS URL"
  $PairingCode = Read-Host "One-time pairing code from Settings"
  $hasHubUrl = -not [string]::IsNullOrWhiteSpace($HubUrl)
  $hasPairingCode = -not [string]::IsNullOrWhiteSpace($PairingCode)
  if (-not $hasHubUrl -or -not $hasPairingCode) {
    throw "HubUrl and PairingCode are required for the first installation."
  }
}

function Stop-InstalledLauncher([string]$ScriptPath) {
  $escapedPath = [Regex]::Escape($ScriptPath)
  $pathPattern = '(?i)(?:^|[\s"]){0}(?=$|[\s"])' -f $escapedPath
  $currentUser = [string]$env:USERNAME
  $currentDomain = [string]$env:USERDOMAIN
  $processes = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -in @("powershell.exe", "pwsh.exe") -and $_.CommandLine -match $pathPattern }

  foreach ($process in $processes) {
    $owner = Invoke-CimMethod -InputObject $process -MethodName GetOwner -ErrorAction SilentlyContinue
    if ($null -eq $owner -or $owner.ReturnValue -ne 0) { continue }
    if ([string]$owner.User -ine $currentUser) { continue }
    if ($currentDomain -and $owner.Domain -and [string]$owner.Domain -ine $currentDomain) { continue }
    Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction Stop
  }
}

if (-not $reuseExistingPairing) {
  # Verify the new Hub URL and token before touching the working installation.
  # The Hub retires the old token only after the newly paired helper sends its
  # first authenticated heartbeat.
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $source -HubUrl $HubUrl -PairingCode $PairingCode -AgentName $AgentName -PairOnly
  if ($LASTEXITCODE -ne 0) { throw "Pairing failed. The previous installation and pairing were left in place." }
}

Stop-InstalledLauncher $installedScript
New-Item -ItemType Directory -Path $installDirectory -Force | Out-Null
Copy-Item -LiteralPath $source -Destination $installedScript -Force

$startupDirectory = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
$shortcutPath = Join-Path $startupDirectory "Evora Config Launcher.lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$installedScript`""
$shortcut.WorkingDirectory = $installDirectory
$shortcut.Description = "Evora Smart Hub - Loxone Config Launcher"
$shortcut.Save()

Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$installedScript`"")
if ($reuseExistingPairing) {
  Write-Host "Evora Config Launcher was updated and started. Existing pairing was preserved."
} else {
  Write-Host "Evora Config Launcher was installed, paired, and started."
}
