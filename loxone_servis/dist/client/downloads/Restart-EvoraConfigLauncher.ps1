param(
  [int]$WaitForPid = 0,
  [string]$LauncherPath = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$expectedLauncherPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "EvoraConfigLauncher.ps1"))
if ([string]::IsNullOrWhiteSpace($LauncherPath)) { $LauncherPath = $expectedLauncherPath }
if ([IO.Path]::GetFullPath($LauncherPath) -ine $expectedLauncherPath) {
  throw "Restart target must be the installed Evora Config Launcher."
}

if ($WaitForPid -gt 0) {
  $deadline = (Get-Date).AddSeconds(45)
  do {
    $running = Get-Process -Id $WaitForPid -ErrorAction SilentlyContinue
    if ($null -eq $running) { break }
    Start-Sleep -Milliseconds 200
  } while ((Get-Date) -lt $deadline)
}

Remove-Item -LiteralPath (Join-Path $PSScriptRoot "stop.request") -Force -ErrorAction SilentlyContinue
Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$expectedLauncherPath`"")
