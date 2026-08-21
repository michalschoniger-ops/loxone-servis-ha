param(
  [string]$HubUrl = "",
  [string]$PairingCode = "",
  [string]$AgentName = $env:COMPUTERNAME
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if (-not $HubUrl) { $HubUrl = Read-Host "Evora Smart Hub HTTPS URL" }
if (-not $PairingCode) { $PairingCode = Read-Host "One-time pairing code from Settings" }

$source = Join-Path $PSScriptRoot "EvoraConfigLauncher.ps1"
if (-not (Test-Path -LiteralPath $source)) {
  throw "EvoraConfigLauncher.ps1 must be in the same folder as this installer."
}

$installDirectory = Join-Path $env:LOCALAPPDATA "EvoraSmartHub\ConfigLauncher"
$installedScript = Join-Path $installDirectory "EvoraConfigLauncher.ps1"
New-Item -ItemType Directory -Path $installDirectory -Force | Out-Null
Copy-Item -LiteralPath $source -Destination $installedScript -Force

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installedScript -HubUrl $HubUrl -PairingCode $PairingCode -AgentName $AgentName -PairOnly
if ($LASTEXITCODE -ne 0) { throw "Pairing failed." }

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
Write-Host "Evora Config Launcher was installed and started."
