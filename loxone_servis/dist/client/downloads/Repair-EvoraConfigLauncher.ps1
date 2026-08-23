param(
  [string]$HubUrl = "",
  [string]$PairingCode = "",
  [string]$AgentName = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$installer = Join-Path $PSScriptRoot "Install-EvoraConfigLauncher.ps1"
$configPath = Join-Path $env:LOCALAPPDATA "EvoraSmartHub\ConfigLauncher\config.json"

if (-not (Test-Path -LiteralPath $installer)) {
  throw "Install-EvoraConfigLauncher.ps1 must be in the same extracted folder."
}
if (-not (Test-Path -LiteralPath $configPath)) {
  throw "Existing launcher pairing was not found. Run Install-EvoraConfigLauncher.ps1 instead."
}

$configuration = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$storedHubUrl = [string]$configuration.hubUrl
if ([string]::IsNullOrWhiteSpace($storedHubUrl)) {
  throw "Existing launcher configuration does not contain the Hub URL."
}
if ([string]::IsNullOrWhiteSpace($HubUrl)) {
  $enteredHubUrl = Read-Host "Hub HTTPS URL (Enter keeps $storedHubUrl)"
  $HubUrl = if ([string]::IsNullOrWhiteSpace($enteredHubUrl)) { $storedHubUrl } else { $enteredHubUrl }
}
if ($HubUrl -notmatch '^[a-zA-Z][a-zA-Z0-9+.-]*://') {
  $HubUrl = "https://$($HubUrl.Trim().TrimEnd('/'))"
}
$storedAgentName = [string]$configuration.agentName
if ([string]::IsNullOrWhiteSpace($AgentName)) {
  $AgentName = if ([string]::IsNullOrWhiteSpace($storedAgentName)) { $env:COMPUTERNAME } else { $storedAgentName }
}

if ([string]::IsNullOrWhiteSpace($PairingCode)) {
  $PairingCode = Read-Host "New one-time pairing code from Evora Smart Hub Settings"
}
if ([string]::IsNullOrWhiteSpace($PairingCode)) {
  throw "A new pairing code is required."
}

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $installer `
  -HubUrl $HubUrl -PairingCode $PairingCode.Trim() -AgentName $AgentName
if ($LASTEXITCODE -ne 0) {
  throw "Re-pairing failed. The previous configuration was left in place."
}

Write-Host "Evora Config Launcher was paired again and restarted."
