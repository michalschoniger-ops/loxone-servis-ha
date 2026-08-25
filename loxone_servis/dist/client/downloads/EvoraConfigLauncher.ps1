param(
  [string]$HubUrl = "",
  [string]$PairingCode = "",
  [string]$AgentName = $env:COMPUTERNAME,
  [switch]$PairOnly,
  [switch]$SelfTest,
  [switch]$CompleteUpdate,
  [int]$WaitForPid = 0,
  [string]$ExpectedVersion = ""
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
Set-StrictMode -Version Latest
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$HelperVersion = "3.0.0.12"
$AppDirectory = Join-Path $env:LOCALAPPDATA "EvoraSmartHub\ConfigLauncher"
$ConfigPath = Join-Path $AppDirectory "config.json"
$LogPath = Join-Path $AppDirectory "launcher.log"
$RuntimeStatePath = Join-Path $AppDirectory "runtime.json"
$StopRequestPath = Join-Path $AppDirectory "stop.request"
$RestartWrapperPath = Join-Path $AppDirectory "Restart-EvoraConfigLauncher.vbs"
$HiddenWrapperPath = Join-Path $AppDirectory "Run-EvoraConfigLauncher.vbs"
$ScheduledTaskName = "Evora Smart Hub Config Launcher"
$StartupShortcutPath = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup\Evora Config Launcher.lnk"
$MutexName = "Local\EvoraSmartHubConfigLauncher"
$script:LauncherPhase = "startup"
$script:HubConnectionVerified = $false
$script:AutomaticUpdateState = "passed"
$script:AutomaticUpdateMessage = "Updates use an authenticated SHA-256 manifest, an atomic replacement, authenticated health verification, and automatic rollback."
$script:PairingRejectedNoticeShown = $false
$script:TrayIcon = $null
$script:TrayIconImage = $null
$script:TrayStatusItem = $null
$script:TrayState = ""
$script:TrayExitRequested = $false
$script:ForceLauncherScan = $false
$script:TrayHubUrl = ""
$script:NextTrayOwnerCheckAt = [DateTime]::MinValue

function Write-SafeLog([string]$Message) {
  if (-not (Test-Path -LiteralPath $AppDirectory)) {
    New-Item -ItemType Directory -Path $AppDirectory -Force | Out-Null
  }
  $line = "{0} {1}" -f (Get-Date).ToUniversalTime().ToString("o"), $Message
  Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
  if ((Get-Item -LiteralPath $LogPath -ErrorAction SilentlyContinue).Length -gt 1048576) {
    $tail = Get-Content -LiteralPath $LogPath -Tail 500
    Set-Content -LiteralPath $LogPath -Value $tail -Encoding UTF8
  }
}

function Install-HiddenLauncherEntrypoints {
  try {
    $expectedScriptPath = [IO.Path]::GetFullPath((Join-Path $AppDirectory "EvoraConfigLauncher.ps1"))
    if ([IO.Path]::GetFullPath($PSCommandPath) -ine $expectedScriptPath) { return }
    $wrapper = @'
Option Explicit

Dim shell, fileSystem, installDirectory, powerShellPath, launcherPath, command
Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")
installDirectory = fileSystem.GetParentFolderName(WScript.ScriptFullName)
powerShellPath = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"
launcherPath = fileSystem.BuildPath(installDirectory, "EvoraConfigLauncher.ps1")
command = Chr(34) & powerShellPath & Chr(34) & " -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Chr(34) & launcherPath & Chr(34)
shell.Run command, 0, False
'@
    Set-Content -LiteralPath $HiddenWrapperPath -Value $wrapper -Encoding Unicode
    $restartWrapper = @'
Option Explicit

Dim shell, fileSystem, installDirectory, powerShellPath, launcherPath, command, waitPid, expectedVersion
If WScript.Arguments.Count <> 2 Then WScript.Quit 2
Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")
installDirectory = fileSystem.GetParentFolderName(WScript.ScriptFullName)
powerShellPath = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"
launcherPath = fileSystem.BuildPath(installDirectory, "EvoraConfigLauncher.ps1")
waitPid = CLng(WScript.Arguments(0))
expectedVersion = CStr(WScript.Arguments(1))
command = Chr(34) & powerShellPath & Chr(34) & " -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Chr(34) & launcherPath & Chr(34) & " -CompleteUpdate -WaitForPid " & CStr(waitPid) & " -ExpectedVersion " & Chr(34) & expectedVersion & Chr(34)
shell.Run command, 0, False
'@
    Set-Content -LiteralPath $RestartWrapperPath -Value $restartWrapper -Encoding Unicode
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $task = Get-ScheduledTask -TaskName $ScheduledTaskName -ErrorAction SilentlyContinue
    if ($null -ne $task -and [string]$task.Principal.UserId -ieq $identity) {
      $actions = @($task.Actions)
      $ownsTask = $actions.Count -eq 1 -and (
        ([string]$actions[0].Execute -match '(?i)(?:^|\\)powershell\.exe$' -and [string]$actions[0].Arguments -like "*$expectedScriptPath*") -or
        ([string]$actions[0].Execute -match '(?i)(?:^|\\)wscript\.exe$' -and [string]$actions[0].Arguments -like "*$HiddenWrapperPath*")
      )
      if ($ownsTask) {
        $action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\wscript.exe" `
          -Argument "//B //Nologo `"$HiddenWrapperPath`"" -WorkingDirectory $AppDirectory
        Set-ScheduledTask -TaskName $ScheduledTaskName -Action $action | Out-Null
      }
    }
    $startupDirectory = Split-Path -Parent $StartupShortcutPath
    New-Item -ItemType Directory -Path $startupDirectory -Force | Out-Null
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($StartupShortcutPath)
    $shortcut.TargetPath = "$env:SystemRoot\System32\wscript.exe"
    $shortcut.Arguments = "//B //Nologo `"$HiddenWrapperPath`""
    $shortcut.WorkingDirectory = $AppDirectory
    $shortcut.Description = "Evora Smart Hub - Loxone Config Launcher"
    $shortcut.Save()
    Write-SafeLog "Hidden launcher entrypoints are installed."
  } catch {
    Write-SafeLog "Hidden launcher entrypoints could not be installed safely."
  }
}

function Write-LauncherRuntime([bool]$Connected = $false) {
  try {
    $process = Get-Process -Id $PID -ErrorAction Stop
    $state = [ordered]@{
      pid = $PID
      processStartUtcTicks = $process.StartTime.ToUniversalTime().Ticks
      scriptPath = [IO.Path]::GetFullPath($PSCommandPath)
      helperVersion = $HelperVersion
      startedAt = (Get-Date).ToUniversalTime().ToString("o")
      connectedAt = if ($Connected) { (Get-Date).ToUniversalTime().ToString("o") } else { $null }
    }
    $temporaryPath = "$RuntimeStatePath.$PID.tmp"
    Set-Content -LiteralPath $temporaryPath -Value (ConvertTo-Json $state -Compress) -Encoding UTF8
    Move-Item -LiteralPath $temporaryPath -Destination $RuntimeStatePath -Force
  } catch {
    Write-SafeLog "Runtime health state could not be updated."
  }
}

function Test-LauncherStopRequested {
  return Test-Path -LiteralPath $StopRequestPath
}

function New-LauncherFailure([string]$Code, [string]$Message) {
  $failure = New-Object System.Exception($Message)
  $failure.Data["EvoraCode"] = $Code
  return $failure
}

function Set-LauncherPhase([string]$Phase) {
  $script:LauncherPhase = $Phase
}

function Get-SafeExceptionFingerprint($ErrorRecord) {
  $exceptionType = if ($null -ne $ErrorRecord.Exception) { $ErrorRecord.Exception.GetType().FullName } else { "Unknown" }
  $hresult = if ($null -ne $ErrorRecord.Exception) { $ErrorRecord.Exception.HResult } else { 0 }
  $line = if ($null -ne $ErrorRecord.InvocationInfo) { $ErrorRecord.InvocationInfo.ScriptLineNumber } else { 0 }
  return "phase=$script:LauncherPhase type=$exceptionType hresult=$hresult line=$line"
}

function Get-SafeFailureMessage([string]$Code) {
  switch ($Code) {
    "CONFIG_NOT_RUNNING" { return "The requested Loxone Config version is not already open." }
    "CONFIG_WINDOW_TIMEOUT" { return "Loxone Config did not finish opening in time." }
    "CONFIG_HOME_NOT_FOUND" { return "Loxone Config Home could not be opened safely." }
    "MANUAL_CONNECT_NOT_FOUND" { return "The verified Manual Connect action was not found." }
    "CONNECT_DIALOG_TIMEOUT" { return "The Manual Connect dialog did not open in time." }
    "CREDENTIAL_FIELDS_INVALID" { return "The verified login fields were not ready." }
    "CONNECT_BUTTON_DISABLED" { return "Loxone Config did not accept all login fields." }
    "CONNECTION_REJECTED" { return "Loxone Config rejected the Miniserver login." }
    "CONNECTION_DIALOG_TIMEOUT" { return "Loxone Config did not confirm the connection in time." }
    "HUB_STATUS_FAILED" { return "Windows Launcher could not confirm its progress to Evora Smart Hub." }
    default { return "Windows Launcher could not complete the verified UI Automation sequence." }
  }
}

function Show-LauncherNotice([string]$Title, [string]$Message, [string]$Url = "") {
  try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    if ($null -ne $script:TrayIcon) {
      $script:TrayIcon.BalloonTipTitle = $Title
      $script:TrayIcon.BalloonTipText = $Message
      $script:TrayIcon.ShowBalloonTip(8000)
      return
    }
    $notice = New-Object System.Windows.Forms.NotifyIcon
    $notice.Icon = [System.Drawing.SystemIcons]::Information
    $notice.Visible = $true
    $notice.BalloonTipTitle = $Title
    $notice.BalloonTipText = $Message
    $notice.ShowBalloonTip(8000)
    if ($Url) {
      $notice.add_BalloonTipClicked({ Start-Process $Url })
    }
    Start-Sleep -Seconds 9
    $notice.Dispose()
  } catch {
    Write-SafeLog "Windows notification could not be displayed."
  }
}

function New-EvoraTrayIconImage([string]$State = "starting") {
  Add-Type -AssemblyName System.Drawing
  if ($null -eq ("EvoraTrayNative" -as [type])) {
    Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class EvoraTrayNative {
  [DllImport("user32.dll", CharSet = CharSet.Auto)] public static extern bool DestroyIcon(IntPtr handle);
}
'@
  }
  $bitmap = [System.Drawing.Bitmap]::new(64, 64)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $path.AddArc(2, 2, 18, 18, 180, 90)
  $path.AddArc(44, 2, 18, 18, 270, 90)
  $path.AddArc(44, 44, 18, 18, 0, 90)
  $path.AddArc(2, 44, 18, 18, 90, 90)
  $path.CloseFigure()
  $green = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(86, 224, 56))
  $graphics.FillPath($green, $path)
  $font = [System.Drawing.Font]::new("Segoe UI", 39, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $white = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
  $format = [System.Drawing.StringFormat]::new()
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $graphics.DrawString("e", $font, $white, [System.Drawing.RectangleF]::new(0, -3, 64, 64), $format)
  $statusColor = switch ($State) {
    "online" { [System.Drawing.Color]::FromArgb(55, 203, 73) }
    "offline" { [System.Drawing.Color]::FromArgb(235, 70, 82) }
    "updating" { [System.Drawing.Color]::FromArgb(34, 151, 230) }
    default { [System.Drawing.Color]::FromArgb(244, 166, 35) }
  }
  $statusBrush = [System.Drawing.SolidBrush]::new($statusColor)
  $outline = [System.Drawing.Pen]::new([System.Drawing.Color]::White, 4)
  $graphics.FillEllipse($statusBrush, 42, 42, 20, 20)
  $graphics.DrawEllipse($outline, 42, 42, 20, 20)
  $handle = $bitmap.GetHicon()
  try {
    return ([System.Drawing.Icon]::FromHandle($handle).Clone())
  } finally {
    [EvoraTrayNative]::DestroyIcon($handle) | Out-Null
    $outline.Dispose()
    $statusBrush.Dispose()
    $format.Dispose()
    $white.Dispose()
    $font.Dispose()
    $green.Dispose()
    $path.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

function Get-LauncherLocalizedText([string]$AsciiText) {
  if ($null -eq $AsciiText) { return "" }
  return [System.Text.RegularExpressions.Regex]::Unescape($AsciiText)
}

function Set-LauncherTrayStatus([string]$State, [string]$Label) {
  if ($null -eq $script:TrayIcon) { return }
  if ($script:TrayState -ne $State) {
    $nextIcon = New-EvoraTrayIconImage $State
    $previousIcon = $script:TrayIconImage
    $script:TrayIconImage = $nextIcon
    $script:TrayIcon.Icon = $nextIcon
    $script:TrayState = $State
    if ($null -ne $previousIcon) { $previousIcon.Dispose() }
  }
  $localizedLabel = Get-LauncherLocalizedText $Label
  $tooltip = "Evora Config Launcher - $localizedLabel"
  $script:TrayIcon.Text = $tooltip.Substring(0, [Math]::Min(63, $tooltip.Length))
  if ($null -ne $script:TrayStatusItem) { $script:TrayStatusItem.Text = "Stav: $localizedLabel" }
}

function Initialize-LauncherTray([string]$BaseUrl) {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $script:TrayHubUrl = $BaseUrl
  $menu = [System.Windows.Forms.ContextMenuStrip]::new()
  $status = [System.Windows.Forms.ToolStripMenuItem]::new((Get-LauncherLocalizedText 'Stav: spou\u0161t\u00edm'))
  $status.Enabled = $false
  $openHub = [System.Windows.Forms.ToolStripMenuItem]::new((Get-LauncherLocalizedText 'Otev\u0159\u00edt Evora Smart Hub'))
  $refresh = [System.Windows.Forms.ToolStripMenuItem]::new((Get-LauncherLocalizedText 'Zkontrolovat p\u0159ipojen\u00ed a aktualizace'))
  $repair = [System.Windows.Forms.ToolStripMenuItem]::new((Get-LauncherLocalizedText 'Vytvo\u0159it nov\u00fd p\u00e1rovac\u00ed k\u00f3d'))
  $diagnostics = [System.Windows.Forms.ToolStripMenuItem]::new((Get-LauncherLocalizedText 'Otev\u0159\u00edt diagnostick\u00fd protokol'))
  $exit = [System.Windows.Forms.ToolStripMenuItem]::new((Get-LauncherLocalizedText 'Ukon\u010dit Launcher'))
  $openHub.add_Click({ if ($script:TrayHubUrl) { Start-Process $script:TrayHubUrl } })
  $refresh.add_Click({ $script:ForceLauncherScan = $true })
  $repair.add_Click({
    if ($script:TrayHubUrl) {
      $settingsUrl = $script:TrayHubUrl.TrimEnd("/") + "/?page=settings"
      Start-Process $settingsUrl
    }
  })
  $diagnostics.add_Click({
    if (-not (Test-Path -LiteralPath $LogPath)) { Write-SafeLog "Diagnostic log opened from the tray menu." }
    Start-Process explorer.exe -ArgumentList @("/select,`"$LogPath`"")
  })
  $exit.add_Click({ $script:TrayExitRequested = $true })
  [void]$menu.Items.Add($status)
  [void]$menu.Items.Add([System.Windows.Forms.ToolStripSeparator]::new())
  [void]$menu.Items.Add($openHub)
  [void]$menu.Items.Add($refresh)
  [void]$menu.Items.Add($repair)
  [void]$menu.Items.Add($diagnostics)
  [void]$menu.Items.Add([System.Windows.Forms.ToolStripSeparator]::new())
  [void]$menu.Items.Add($exit)
  $notify = [System.Windows.Forms.NotifyIcon]::new()
  $notify.ContextMenuStrip = $menu
  $notify.Visible = $true
  $notify.add_DoubleClick({ if ($script:TrayHubUrl) { Start-Process $script:TrayHubUrl } })
  $script:TrayIcon = $notify
  $script:TrayStatusItem = $status
  Set-LauncherTrayStatus -State "starting" -Label 'spou\u0161t\u00edm'
}

function Test-EvoraSmartMenuInstalled {
  $menuPath = Join-Path $env:LOCALAPPDATA "Evora\SmartMenu\EvoraSmartMenu.exe"
  return Test-Path -LiteralPath $menuPath -PathType Leaf
}

function Sync-LauncherTrayOwnership {
  if (Test-EvoraSmartMenuInstalled) {
    Dispose-LauncherTray
    return
  }
  if ($null -eq $script:TrayIcon) { Initialize-LauncherTray $script:TrayHubUrl }
}

function Wait-WithTrayEvents([int]$Milliseconds) {
  $deadline = [DateTime]::UtcNow.AddMilliseconds([Math]::Max(0, $Milliseconds))
  do {
    if ([DateTime]::UtcNow -ge $script:NextTrayOwnerCheckAt) {
      $script:NextTrayOwnerCheckAt = [DateTime]::UtcNow.AddSeconds(2)
      Sync-LauncherTrayOwnership
    }
    if ($null -ne $script:TrayIcon) { [System.Windows.Forms.Application]::DoEvents() }
    if ($script:TrayExitRequested -or (Test-LauncherStopRequested)) { return }
    Start-Sleep -Milliseconds 50
  } while ([DateTime]::UtcNow -lt $deadline)
}

function Dispose-LauncherTray {
  if ($null -ne $script:TrayIcon) {
    $script:TrayIcon.Visible = $false
    $script:TrayIcon.Dispose()
    $script:TrayIcon = $null
    $script:TrayStatusItem = $null
  }
  if ($null -ne $script:TrayIconImage) {
    $script:TrayIconImage.Dispose()
    $script:TrayIconImage = $null
  }
  $script:TrayState = ""
}

function Protect-LauncherToken([string]$Token) {
  Add-Type -AssemblyName System.Security
  $plain = [Text.Encoding]::UTF8.GetBytes($Token)
  try {
    $protected = [Security.Cryptography.ProtectedData]::Protect($plain, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    return [Convert]::ToBase64String($protected)
  } finally {
    [Array]::Clear($plain, 0, $plain.Length)
  }
}

function Unprotect-LauncherToken([string]$Encoded) {
  Add-Type -AssemblyName System.Security
  $protected = [Convert]::FromBase64String($Encoded)
  $plain = [Security.Cryptography.ProtectedData]::Unprotect($protected, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  try {
    return [Text.Encoding]::UTF8.GetString($plain)
  } finally {
    [Array]::Clear($plain, 0, $plain.Length)
  }
}

function Normalize-HubUrl([string]$Value) {
  $normalized = $Value.Trim().TrimEnd("/")
  if ($normalized -notmatch '^[a-zA-Z][a-zA-Z0-9+.-]*://') {
    $normalized = "https://$normalized"
  }
  $uri = $null
  if (-not [Uri]::TryCreate($normalized, [UriKind]::Absolute, [ref]$uri)) {
    throw "Hub URL is not valid."
  }
  $isLocalHttp = $uri.Scheme -eq "http" -and $uri.Host -in @("localhost", "127.0.0.1")
  if ($uri.Scheme -ne "https" -and -not $isLocalHttp) {
    throw "Hub must use HTTPS."
  }
  if ($uri.UserInfo -or $uri.Query -or $uri.Fragment) {
    throw "Hub URL must not contain credentials, query parameters, or a fragment."
  }
  return $normalized
}

function Resolve-HubUpdateUri([string]$BaseUrl, [string]$Path) {
  $updatePath = $Path.Trim()
  if ($updatePath -ne "/downloads/EvoraConfigLauncher.ps1") {
    throw "unsupported launcher update path"
  }
  # BaseUrl can be a Home Assistant ingress URL. Uri(base, "/downloads/...")
  # would silently discard that ingress prefix and download from the HA root.
  $baseUri = [Uri](Normalize-HubUrl $BaseUrl)
  $targetUri = [Uri]("$($baseUri.AbsoluteUri.TrimEnd('/'))$updatePath")
  $sameOrigin = $targetUri.IsAbsoluteUri -and
    $targetUri.Scheme -eq $baseUri.Scheme -and
    $targetUri.Host -ieq $baseUri.Host -and
    $targetUri.Port -eq $baseUri.Port -and
    -not $targetUri.UserInfo -and
    -not $targetUri.Query -and
    -not $targetUri.Fragment
  if (-not $sameOrigin) { throw "launcher update must stay on the paired Hub origin" }
  return $targetUri
}

function Test-HubPreflight([string]$BaseUrl) {
  $uri = [Uri]$BaseUrl
  $parsedAddress = $null
  $isIpAddress = [Net.IPAddress]::TryParse($uri.DnsSafeHost, [ref]$parsedAddress)
  if (-not $isIpAddress -and $uri.DnsSafeHost -ne "localhost") {
    try {
      $addresses = [Net.Dns]::GetHostAddresses($uri.DnsSafeHost)
      if ($null -eq $addresses -or $addresses.Count -eq 0) {
        throw "No address was returned."
      }
    } catch {
      throw "HUB_DNS_FAILED: Windows cannot resolve '$($uri.DnsSafeHost)'. Start Tailscale and verify MagicDNS, or enter another reachable HTTPS Hub URL."
    }
  }

  try {
    $health = Invoke-RestMethod -Uri "$BaseUrl/healthz" -Method GET -UseBasicParsing -TimeoutSec 12
  } catch {
    $webException = $_.Exception
    if ($webException -is [Net.WebException]) {
      if ($webException.Status -eq [Net.WebExceptionStatus]::NameResolutionFailure) {
        throw "HUB_DNS_FAILED: Windows cannot resolve '$($uri.DnsSafeHost)'. Start Tailscale and verify MagicDNS, or enter another reachable HTTPS Hub URL."
      }
      if ($webException.Status -eq [Net.WebExceptionStatus]::TrustFailure) {
        throw "HUB_TLS_FAILED: The HTTPS certificate for '$($uri.DnsSafeHost)' could not be verified."
      }
      if ($webException.Status -in @([Net.WebExceptionStatus]::ConnectFailure, [Net.WebExceptionStatus]::Timeout)) {
        throw "HUB_UNREACHABLE: '$BaseUrl' did not respond. Verify Tailscale, the Hub address, and firewall access."
      }
    }
    throw "HUB_PREFLIGHT_FAILED: '$BaseUrl/healthz' could not be verified. $($webException.Message)"
  }

  if ($null -eq $health -or [string]$health.status -ne "ok") {
    throw "HUB_IDENTITY_FAILED: The address responded, but it is not a healthy Evora Smart Hub."
  }
}

function Invoke-HubJson([string]$Method, [string]$BaseUrl, [string]$Path, $Body, [string]$Token = "") {
  $parameters = @{
    Uri = "$BaseUrl$Path"
    Method = $Method
    ContentType = "application/json; charset=utf-8"
    UseBasicParsing = $true
    TimeoutSec = 30
  }
  if ($null -ne $Body) {
    $json = ConvertTo-Json $Body -Compress -Depth 6
    $parameters.Body = [Text.Encoding]::UTF8.GetBytes($json)
  }
  if ($Token) {
    $parameters.Headers = @{ Authorization = "Bearer $Token" }
  }
  return Invoke-RestMethod @parameters
}

function Test-HubRejectedPairing($ErrorRecord) {
  try {
    return [int]$ErrorRecord.Exception.Response.StatusCode -eq 401
  } catch {
    return $false
  }
}

function Save-Pairing([string]$BaseUrl, [string]$Code, [string]$Name) {
  Test-HubPreflight $BaseUrl
  $paired = Invoke-HubJson "POST" $BaseUrl "/api/config-launcher/agent/pair" @{ code = $Code; name = $Name }
  $configuration = [ordered]@{
    hubUrl = $BaseUrl
    agentId = [string]$paired.agentId
    agentName = $Name
    tokenProtected = Protect-LauncherToken ([string]$paired.agentToken)
  }
  if (-not (Test-Path -LiteralPath $AppDirectory)) {
    New-Item -ItemType Directory -Path $AppDirectory -Force | Out-Null
  }
  $pendingConfigPath = "$ConfigPath.pending"
  try {
    Set-Content -LiteralPath $pendingConfigPath -Value (ConvertTo-Json $configuration -Compress) -Encoding UTF8
    Move-Item -LiteralPath $pendingConfigPath -Destination $ConfigPath -Force
  } finally {
    if (Test-Path -LiteralPath $pendingConfigPath) {
      Remove-Item -LiteralPath $pendingConfigPath -Force -ErrorAction SilentlyContinue
    }
  }
  Write-SafeLog "Launcher paired successfully."
}

function Get-ConfigExecutables {
  $roots = @(
    (Join-Path ${env:ProgramFiles(x86)} "Loxone"),
    (Join-Path $env:ProgramFiles "Loxone")
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -Unique
  $result = @()
  foreach ($root in $roots) {
    foreach ($file in Get-ChildItem -LiteralPath $root -Filter "LoxoneConfig.exe" -File -Recurse -ErrorAction SilentlyContinue) {
      $rawVersion = [string]$file.VersionInfo.FileVersion
      $match = [regex]::Match($rawVersion, "\d+(?:\.\d+){3}")
      if ($match.Success) {
        $result += [pscustomobject]@{ Version = $match.Value; Path = $file.FullName }
      }
    }
  }
  return @($result | Sort-Object Version, Path -Unique)
}

function New-DiagnosticCheck([string]$State, [string]$Message) {
  return [ordered]@{ state = $State; message = $Message }
}

function Get-LauncherDiagnostics($Executables) {
  $signature = try {
    $value = Get-AuthenticodeSignature -LiteralPath $PSCommandPath
    if ($value.Status -eq [System.Management.Automation.SignatureStatus]::Valid) {
      New-DiagnosticCheck "passed" "The launcher has a valid Authenticode signature."
    } elseif ($value.Status -eq [System.Management.Automation.SignatureStatus]::NotSigned) {
      New-DiagnosticCheck "warning" "The launcher is not Authenticode-signed; authenticated SHA-256 updates are still enforced."
    } else {
      New-DiagnosticCheck "failed" "Authenticode verification returned $($value.Status)."
    }
  } catch {
    New-DiagnosticCheck "failed" "Authenticode verification could not be completed."
  }

  $uiAutomation = try {
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    if ($null -eq [Windows.Automation.AutomationElement]::RootElement) { throw "missing" }
    New-DiagnosticCheck "passed" "Windows UI Automation is available in this user session."
  } catch {
    New-DiagnosticCheck "failed" "Windows UI Automation is unavailable in this user session."
  }

  $permissions = try {
    if (-not (Test-Path -LiteralPath $AppDirectory)) { New-Item -ItemType Directory -Path $AppDirectory -Force | Out-Null }
    $probe = Join-Path $AppDirectory "permission-test.tmp"
    [IO.File]::WriteAllText($probe, "ok", [Text.Encoding]::ASCII)
    Remove-Item -LiteralPath $probe -Force
    New-DiagnosticCheck "passed" "The current Windows user can read and write the launcher directory."
  } catch {
    New-DiagnosticCheck "failed" "The current Windows user cannot write the launcher directory."
  }

  $configCount = @($Executables).Count
  $configDiscovery = if ($configCount -gt 0) {
    New-DiagnosticCheck "passed" "$configCount installed Loxone Config executable(s) were identified by exact file version."
  } else {
    New-DiagnosticCheck "warning" "No installed Loxone Config executable was found."
  }
  $hubConnection = if ($script:HubConnectionVerified) {
    New-DiagnosticCheck "passed" "The authenticated connection to Evora Smart Hub is working."
  } else {
    New-DiagnosticCheck "warning" "The Hub connection has not yet been confirmed in this launcher session."
  }

  return [ordered]@{
    signature = $signature
    uiAutomation = $uiAutomation
    permissions = $permissions
    hubConnection = $hubConnection
    configDiscovery = $configDiscovery
    safeLogging = New-DiagnosticCheck "passed" "Diagnostic logs contain phases and error codes, never passwords or tokens."
    automaticUpdate = New-DiagnosticCheck $script:AutomaticUpdateState $script:AutomaticUpdateMessage
  }
}

function Get-TrustedUpdateRuntime([string]$LauncherPath) {
  if (-not (Test-Path -LiteralPath $RuntimeStatePath -PathType Leaf)) { return $null }
  try {
    $state = Get-Content -LiteralPath $RuntimeStatePath -Raw | ConvertFrom-Json
    if ([IO.Path]::GetFullPath([string]$state.scriptPath) -ine [IO.Path]::GetFullPath($LauncherPath)) { return $null }
    $process = Get-Process -Id ([int]$state.pid) -ErrorAction Stop
    if ($process.ProcessName -notin @("powershell", "pwsh")) { return $null }
    if ($process.StartTime.ToUniversalTime().Ticks -ne [Int64]$state.processStartUtcTicks) { return $null }
    return [pscustomobject]@{ Process = $process; State = $state }
  } catch {
    return $null
  }
}

function Start-HiddenLauncher {
  if (-not (Test-Path -LiteralPath $HiddenWrapperPath -PathType Leaf)) {
    throw "Hidden Launcher wrapper is missing."
  }
  Remove-Item -LiteralPath $StopRequestPath -Force -ErrorAction SilentlyContinue
  $wscriptPath = Join-Path $env:SystemRoot "System32\wscript.exe"
  Start-Process -FilePath $wscriptPath -ArgumentList @("//B", "//Nologo", "`"$HiddenWrapperPath`"") -WindowStyle Hidden
}

function Wait-LauncherUpdateHealthy([string]$LauncherPath, [string]$Version, [DateTime]$NotBefore, [int]$TimeoutSeconds = 45) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $runtime = Get-TrustedUpdateRuntime $LauncherPath
    if ($null -ne $runtime) {
      try {
        $connectedAt = [DateTime]::Parse([string]$runtime.State.connectedAt).ToUniversalTime()
        if ([string]$runtime.State.helperVersion -eq $Version -and $connectedAt -ge $NotBefore.AddSeconds(-2)) {
          return $true
        }
      } catch { }
    }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  return $false
}

function Complete-LauncherUpdate {
  $expectedLauncherPath = [IO.Path]::GetFullPath((Join-Path $AppDirectory "EvoraConfigLauncher.ps1"))
  if ([IO.Path]::GetFullPath($PSCommandPath) -ine $expectedLauncherPath) {
    throw "Update completion must run from the installed Launcher."
  }
  if ($ExpectedVersion -notmatch '^\d+(?:\.\d+){3}$' -or $ExpectedVersion -ne $HelperVersion) {
    throw "Update completion received an invalid version."
  }
  $backupPath = "$expectedLauncherPath.bak"
  $failedPath = "$expectedLauncherPath.failed"
  $startedAt = (Get-Date).ToUniversalTime()
  try {
    if ($WaitForPid -gt 0) {
      $deadline = (Get-Date).AddSeconds(45)
      do {
        $running = Get-Process -Id $WaitForPid -ErrorAction SilentlyContinue
        if ($null -eq $running) { break }
        Start-Sleep -Milliseconds 200
      } while ((Get-Date) -lt $deadline)
      if ($null -ne (Get-Process -Id $WaitForPid -ErrorAction SilentlyContinue)) {
        throw "Previous Launcher process did not stop in time."
      }
    }
    Start-HiddenLauncher
    if (-not (Wait-LauncherUpdateHealthy $expectedLauncherPath $ExpectedVersion $startedAt)) {
      throw "Replacement Launcher did not confirm an authenticated heartbeat."
    }
    Remove-Item -LiteralPath $backupPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $failedPath -Force -ErrorAction SilentlyContinue
    Write-SafeLog "Automatic update health check passed; rollback backup was removed."
    return $true
  } catch {
    $runtime = Get-TrustedUpdateRuntime $expectedLauncherPath
    if ($null -ne $runtime) {
      Stop-Process -Id $runtime.Process.Id -Force -ErrorAction SilentlyContinue
      Start-Sleep -Milliseconds 500
    }
    if (-not (Test-Path -LiteralPath $backupPath -PathType Leaf)) {
      Write-SafeLog "Automatic update failed and no rollback backup was available."
      return $false
    }
    Remove-Item -LiteralPath $failedPath -Force -ErrorAction SilentlyContinue
    [IO.File]::Replace($backupPath, $expectedLauncherPath, $failedPath, $true)
    Remove-Item -LiteralPath $failedPath -Force -ErrorAction SilentlyContinue
    $restoredText = Get-Content -LiteralPath $expectedLauncherPath -Raw
    $restoredVersionMatch = [Regex]::Match($restoredText, '(?m)^\$HelperVersion\s*=\s*"([0-9]+(?:\.[0-9]+){3})"\s*$')
    if (-not $restoredVersionMatch.Success) {
      Write-SafeLog "Automatic update rolled back, but the restored version marker was invalid."
      return $false
    }
    $rollbackStartedAt = (Get-Date).ToUniversalTime()
    Start-HiddenLauncher
    if (-not (Wait-LauncherUpdateHealthy $expectedLauncherPath $restoredVersionMatch.Groups[1].Value $rollbackStartedAt)) {
      Write-SafeLog "Automatic update rolled back, but the previous Launcher did not reconnect."
      return $false
    }
    Write-SafeLog "Automatic update failed health verification; the previous working Launcher was restored and reconnected."
    return $false
  }
}

function Install-LauncherUpdate($Update, [string]$BaseUrl) {
  if ($null -eq $Update -or -not $Update.version -or -not $Update.url -or -not $Update.sha256) { return $false }
  if ([string]$Update.version -eq $HelperVersion) { return $false }
  Set-LauncherPhase "automatic-update-download"
  $targetUri = Resolve-HubUpdateUri $BaseUrl ([string]$Update.url)
  $pendingPath = Join-Path $AppDirectory "EvoraConfigLauncher.pending.ps1"
  try {
    Invoke-WebRequest -Uri $targetUri.AbsoluteUri -OutFile $pendingPath -UseBasicParsing -TimeoutSec 45
    $actualHash = (Get-FileHash -LiteralPath $pendingPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $expectedHash = ([string]$Update.sha256).ToLowerInvariant()
    if ($actualHash -ne $expectedHash) {
      throw "hash mismatch"
    }
    $expectedVersionLine = '$HelperVersion = "' + [string]$Update.version + '"'
    if (-not (Select-String -LiteralPath $pendingPath -SimpleMatch $expectedVersionLine -Quiet)) { throw "version marker missing" }
    if ([IO.Path]::GetExtension($PSCommandPath) -ne ".ps1") { throw "unsupported launch path" }
    if (-not (Test-Path -LiteralPath $RestartWrapperPath -PathType Leaf)) {
      throw "hidden restart helper missing"
    }
    Set-LauncherPhase "automatic-update-install"
    $backupPath = "$PSCommandPath.bak"
    Remove-Item -LiteralPath $backupPath -Force -ErrorAction SilentlyContinue
    [IO.File]::Replace($pendingPath, $PSCommandPath, $backupPath, $true)
    Write-SafeLog "Launcher update installed after exact SHA-256 verification."
    $wscriptPath = Join-Path $env:SystemRoot "System32\wscript.exe"
    Start-Process -FilePath $wscriptPath -ArgumentList @("//B", "//Nologo", "`"$RestartWrapperPath`"", "$PID", "`"$([string]$Update.version)`"") -WindowStyle Hidden
    return $true
  } catch {
    $script:AutomaticUpdateState = "warning"
    $script:AutomaticUpdateMessage = "Automatic update failed safely; the existing launcher remains available."
    Write-SafeLog "Automatic update failed safely ($(Get-SafeExceptionFingerprint $_))."
    Remove-Item -LiteralPath $pendingPath -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath "$PSCommandPath.bak" -PathType Leaf) {
      Copy-Item -LiteralPath "$PSCommandPath.bak" -Destination $PSCommandPath -Force
      Remove-Item -LiteralPath "$PSCommandPath.bak" -Force -ErrorAction SilentlyContinue
    }
    return $false
  }
}

function Get-AutomationElementById($Root, [string]$AutomationId) {
  $condition = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::AutomationIdProperty, $AutomationId)
  return $Root.FindFirst([Windows.Automation.TreeScope]::Descendants, $condition)
}

function Get-ConfigAutomationRoot($Process) {
  try {
    $currentProcess = Get-Process -Id $Process.Id -ErrorAction Stop
    $currentProcess.Refresh()
    if ($currentProcess.MainWindowHandle -eq 0) { return $null }
    return [Windows.Automation.AutomationElement]::FromHandle($currentProcess.MainWindowHandle)
  } catch {
    return $null
  }
}

function Get-AutomationValue($Element, [string]$Label) {
  try {
    if ($null -eq $Element -or -not $Element.Current.IsEnabled) {
      throw "missing"
    }
    $pattern = $Element.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern)
    return [string]([Windows.Automation.ValuePattern]$pattern).Current.Value
  } catch {
    throw (New-LauncherFailure "CREDENTIAL_FIELDS_INVALID" "Expected $Label field does not support safe value verification.")
  }
}

function Set-AutomationValue($Element, [string]$Value, [string]$Label) {
  try {
    if ($null -eq $Element -or -not $Element.Current.IsEnabled) {
      throw "missing"
    }
    $pattern = $Element.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern)
    ([Windows.Automation.ValuePattern]$pattern).SetValue($Value)
  } catch {
    throw (New-LauncherFailure "CREDENTIAL_FIELDS_INVALID" "Expected $Label field does not support safe value entry.")
  }
}

function ConvertTo-SendKeysLiteral([string]$Value) {
  $builder = New-Object Text.StringBuilder
  foreach ($character in $Value.ToCharArray()) {
    $escaped = switch ($character) {
      '+' { '{+}'; break }
      '^' { '{^}'; break }
      '%' { '{%}'; break }
      '~' { '{~}'; break }
      '(' { '{(}'; break }
      ')' { '{)}'; break }
      '{' { '{{}'; break }
      '}' { '{}}'; break }
      '[' { '{[}'; break }
      ']' { '{]}'; break }
      default { [string]$character }
    }
    [void]$builder.Append($escaped)
  }
  return $builder.ToString()
}

function Normalize-AutomationLabel([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return "" }
  $decomposed = $Value.Normalize([Text.NormalizationForm]::FormD)
  $builder = New-Object Text.StringBuilder
  foreach ($character in $decomposed.ToCharArray()) {
    $category = [Globalization.CharUnicodeInfo]::GetUnicodeCategory($character)
    if ($category -notin @(
      [Globalization.UnicodeCategory]::NonSpacingMark,
      [Globalization.UnicodeCategory]::SpacingCombiningMark,
      [Globalization.UnicodeCategory]::EnclosingMark
    )) {
      [void]$builder.Append($character)
    }
  }
  return (($builder.ToString().ToLowerInvariant() -replace [char]0x2026, "...") -replace '[\.\s]+$', '').Trim()
}

function Set-AutomationTextByKeyboard($Element, [string]$Value, [string]$Label) {
  try {
    if ($null -eq $Element -or -not $Element.Current.IsEnabled -or -not $Element.Current.IsKeyboardFocusable) {
      throw "missing"
    }
    Add-Type -AssemblyName System.Windows.Forms
    $Element.SetFocus()
    Start-Sleep -Milliseconds 100
    [System.Windows.Forms.SendKeys]::SendWait("^a")
    [System.Windows.Forms.SendKeys]::SendWait("{BACKSPACE}")
    if ($Value.Length -gt 0) {
      [System.Windows.Forms.SendKeys]::SendWait((ConvertTo-SendKeysLiteral $Value))
    }
    Start-Sleep -Milliseconds 120
  } catch {
    throw (New-LauncherFailure "CREDENTIAL_FIELDS_INVALID" "Expected $Label field does not support verified keyboard entry.")
  }
}

function Click-AutomationElementCenter($Element) {
  if ($null -eq $Element -or -not $Element.Current.IsEnabled) {
    throw "Expected action is missing or disabled."
  }
  $targetProcessId = [uint32]$Element.Current.ProcessId
  $targetProcess = Get-Process -Id $targetProcessId -ErrorAction SilentlyContinue
  if ($null -eq $targetProcess) {
    throw "Expected action process is no longer available."
  }
  $targetProcess.Refresh()
  if ($targetProcess.MainWindowHandle -eq 0 -or
      -not [EvoraWin32]::ActivateWindow($targetProcess.MainWindowHandle, $targetProcessId)) {
    throw "Expected Config window could not be activated safely."
  }
  Start-Sleep -Milliseconds 80
  # Qt can expose child bounds relative to a background window and refresh
  # them to screen coordinates only after activation. Always read the live
  # bounds again, then translate only when the point is demonstrably local to
  # the exact main-window rectangle (multi-monitor/DPI safe).
  $bounds = $Element.Current.BoundingRectangle
  if ($bounds.Width -le 0 -or $bounds.Height -le 0 -or $Element.Current.IsOffscreen) {
    throw "Expected action is not visible."
  }
  $automationRoot = [Windows.Automation.AutomationElement]::FromHandle($targetProcess.MainWindowHandle)
  if ($null -eq $automationRoot) { throw "Expected Config window is unavailable." }
  $rootBounds = $automationRoot.Current.BoundingRectangle
  $centerX = [double]($bounds.X + $bounds.Width / 2)
  $centerY = [double]($bounds.Y + $bounds.Height / 2)
  $centerInsideRoot = $centerX -ge $rootBounds.X -and
    $centerX -le ($rootBounds.X + $rootBounds.Width) -and
    $centerY -ge $rootBounds.Y -and
    $centerY -le ($rootBounds.Y + $rootBounds.Height)
  if (-not $centerInsideRoot) {
    $looksLikeLocalPoint = $centerX -ge -4 -and $centerX -le ($rootBounds.Width + 4) -and
      $centerY -ge -4 -and $centerY -le ($rootBounds.Height + 4)
    if (-not $looksLikeLocalPoint) { throw "Expected action coordinates are outside the verified Config window." }
    $centerX += $rootBounds.X
    $centerY += $rootBounds.Y
  }
  $clickX = [int]$centerX
  $clickY = [int]$centerY
  if (-not [EvoraWin32]::SetCursorPos($clickX, $clickY) -or
      -not [EvoraWin32]::PointBelongsToProcess($clickX, $clickY, $targetProcessId)) {
    throw "Expected action point does not belong to the verified Config process."
  }
  if ([EvoraWin32]::ClickLeft() -ne 2) {
    throw "Expected Config click was not inserted safely."
  }
}

function Invoke-AutomationElement($Element) {
  if ($null -eq $Element -or -not $Element.Current.IsEnabled) {
    throw "Expected action is missing or disabled."
  }
  try {
    $invoke = $Element.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)
    ([Windows.Automation.InvokePattern]$invoke).Invoke()
    return
  } catch {
    # Qt exposes an Invoke pattern on the menu item, but some Config builds do
    # not execute it. The fallback clicks the center of the verified UIA item;
    # there are no fixed screen coordinates.
    Click-AutomationElementCenter $Element
  }
}

function Find-ExistingConfigProcess([string]$ExecutablePath) {
  foreach ($candidateProcess in @(Get-Process "LoxoneConfig" -ErrorAction SilentlyContinue | Sort-Object StartTime -Descending)) {
    try {
      $pathMatches = [string]::Equals([string]$candidateProcess.Path, $ExecutablePath, [StringComparison]::OrdinalIgnoreCase)
      if ($pathMatches -and $candidateProcess.MainWindowHandle -ne 0) {
        try { $candidateProcess.WaitForInputIdle(1500) | Out-Null } catch { }
        $candidateProcess.Refresh()
        if ($candidateProcess.MainWindowHandle -ne 0) { return $candidateProcess }
      }
    } catch { }
  }
  return $null
}

function Find-ReadyConfigProcess([int]$StartedProcessId, [string]$ExecutablePath, [DateTime]$NotBefore, [int]$TimeoutSeconds) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $candidates = @()
    $startedCandidate = Get-Process -Id $StartedProcessId -ErrorAction SilentlyContinue
    if ($null -ne $startedCandidate) { $candidates += $startedCandidate }
    $candidates += @(Get-Process "LoxoneConfig" -ErrorAction SilentlyContinue | Sort-Object StartTime -Descending)
    foreach ($candidateProcess in @($candidates | Select-Object -Unique)) {
      try {
        $pathMatches = [string]::Equals([string]$candidateProcess.Path, $ExecutablePath, [StringComparison]::OrdinalIgnoreCase)
        $belongsToNewLaunch = $candidateProcess.Id -eq $StartedProcessId -or $candidateProcess.StartTime.ToUniversalTime() -ge $NotBefore.AddSeconds(-2)
        if ($pathMatches -and $belongsToNewLaunch -and $candidateProcess.MainWindowHandle -ne 0) {
          try { $candidateProcess.WaitForInputIdle(1500) | Out-Null } catch { }
          $candidateProcess.Refresh()
          if ($candidateProcess.MainWindowHandle -ne 0) { return $candidateProcess }
        }
      } catch { }
    }
    Start-Sleep -Milliseconds 350
  } while ((Get-Date) -lt $deadline)
  throw (New-LauncherFailure "CONFIG_WINDOW_TIMEOUT" "Exact Loxone Config window did not become ready.")
}

function Find-ConnectDialog([int]$ProcessId, [int]$TimeoutSeconds) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $idCondition = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::AutomationIdProperty, "QApplication.CMsConnectDlg")
  $processCondition = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ProcessIdProperty, $ProcessId)
  $globalCondition = New-Object Windows.Automation.AndCondition($processCondition, $idCondition)
  do {
    $candidateProcess = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if ($null -ne $candidateProcess) {
      try {
        $candidateProcess.Refresh()
        if ($candidateProcess.MainWindowHandle -ne 0) {
          $processRoot = [Windows.Automation.AutomationElement]::FromHandle($candidateProcess.MainWindowHandle)
          if ($null -ne $processRoot) {
            if ($processRoot.Current.AutomationId -eq "QApplication.CMsConnectDlg") { return $processRoot }
            # Search from the desktop with both the exact process and exact
            # dialog identity. Traversing the entire Qt main-window tree while
            # a modal is open can block UI Automation indefinitely.
            $dialog = [Windows.Automation.AutomationElement]::RootElement.FindFirst(
              [Windows.Automation.TreeScope]::Descendants,
              $globalCondition
            )
            if ($null -ne $dialog -and $dialog.Current.ProcessId -eq $ProcessId) { return $dialog }
          }
        }
      } catch { }
    }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)
  return $null
}

function Find-ConfigMessageDialog([int]$ProcessId) {
  $condition = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::AutomationIdProperty, "QApplication.CLxMessageBox")
  $candidateProcess = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if ($null -eq $candidateProcess) { return $null }
  try {
    $candidateProcess.Refresh()
    if ($candidateProcess.MainWindowHandle -eq 0) { return $null }
    $processRoot = [Windows.Automation.AutomationElement]::FromHandle($candidateProcess.MainWindowHandle)
    if ($null -eq $processRoot) { return $null }
    if ($processRoot.Current.AutomationId -eq "QApplication.CLxMessageBox") { return $processRoot }
    return $processRoot.FindFirst([Windows.Automation.TreeScope]::Descendants, $condition)
  } catch {
    return $null
  }
}

function Get-ConfigMessageDialogText($Dialog) {
  if ($null -eq $Dialog) { return "" }
  $parts = New-Object Collections.Generic.List[string]
  try {
    $dialogName = [string]$Dialog.Current.Name
    if (-not [string]::IsNullOrWhiteSpace($dialogName)) { $parts.Add($dialogName) }
    # The exact CLxMessageBox is a small modal subtree. Reading only its own
    # exposed labels is bounded and avoids traversing the Qt main-window tree.
    $elements = $Dialog.FindAll(
      [Windows.Automation.TreeScope]::Descendants,
      [Windows.Automation.Condition]::TrueCondition
    )
    $limit = [Math]::Min($elements.Count, 64)
    for ($index = 0; $index -lt $limit; $index++) {
      $name = [string]$elements.Item($index).Current.Name
      if (-not [string]::IsNullOrWhiteSpace($name)) { $parts.Add($name) }
    }
  } catch { }
  return ($parts -join " ").Trim()
}

function Await-WindowsRuntimeOperation($Operation, [Type]$ResultType, [int]$TimeoutMilliseconds = 4000) {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object {
      $_.Name -eq "AsTask" -and
      $_.IsGenericMethodDefinition -and
      $_.GetParameters().Count -eq 1
    } |
    Select-Object -First 1
  if ($null -eq $asTask) { throw "Windows Runtime task adapter is unavailable." }
  $task = $asTask.MakeGenericMethod($ResultType).Invoke($null, @($Operation))
  if (-not $task.Wait($TimeoutMilliseconds)) { throw "Windows Runtime operation timed out." }
  return $task.Result
}

function Get-ConfigMessageDialogOcrText($Dialog) {
  if ($null -eq $Dialog) { return "" }
  $bitmap = $null
  $graphics = $null
  $memory = $null
  $randomAccessStream = $null
  $output = $null
  $writer = $null
  $softwareBitmap = $null
  try {
    Add-Type -AssemblyName System.Drawing
    $bounds = $Dialog.Current.BoundingRectangle
    $width = [Math]::Max(1, [int][Math]::Ceiling($bounds.Width))
    $height = [Math]::Max(1, [int][Math]::Ceiling($bounds.Height))
    if ($width -gt 1600 -or $height -gt 900) { return "" }
    $bitmap = New-Object Drawing.Bitmap($width, $height)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen([int]$bounds.X, [int]$bounds.Y, 0, 0, $bitmap.Size)
    $memory = New-Object IO.MemoryStream
    $bitmap.Save($memory, [Drawing.Imaging.ImageFormat]::Png)
    $bytes = $memory.ToArray()

    $randomAccessStream = New-Object 'Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime'
    $output = $randomAccessStream.GetOutputStreamAt(0)
    $writer = New-Object 'Windows.Storage.Streams.DataWriter, Windows.Storage.Streams, ContentType=WindowsRuntime'($output)
    $writer.WriteBytes($bytes)
    [void](Await-WindowsRuntimeOperation ($writer.StoreAsync()) ([UInt32]))
    [void](Await-WindowsRuntimeOperation ($writer.FlushAsync()) ([Boolean]))
    [void]$writer.DetachStream()
    $writer.Dispose()
    $writer = $null
    $output.Dispose()
    $output = $null
    $randomAccessStream.Seek(0)

    $decoderType = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
    $decoder = Await-WindowsRuntimeOperation ($decoderType::CreateAsync($randomAccessStream)) $decoderType
    $softwareBitmapType = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
    $softwareBitmap = Await-WindowsRuntimeOperation ($decoder.GetSoftwareBitmapAsync()) $softwareBitmapType
    $engine = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]::TryCreateFromUserProfileLanguages()
    if ($null -eq $engine) { return "" }
    $resultType = [Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType=WindowsRuntime]
    $result = Await-WindowsRuntimeOperation ($engine.RecognizeAsync($softwareBitmap)) $resultType
    return [string]$result.Text
  } catch {
    return ""
  } finally {
    if ($null -ne $softwareBitmap) { $softwareBitmap.Dispose() }
    if ($null -ne $writer) { $writer.Dispose() }
    if ($null -ne $output) { $output.Dispose() }
    if ($null -ne $randomAccessStream) { $randomAccessStream.Dispose() }
    if ($null -ne $memory) { $memory.Dispose() }
    if ($null -ne $graphics) { $graphics.Dispose() }
    if ($null -ne $bitmap) { $bitmap.Dispose() }
  }
}

function Test-RemoteConnectAlreadyActiveDialog($Dialog) {
  $text = Get-ConfigMessageDialogText $Dialog
  if (-not (Normalize-AutomationLabel $text).Contains("remote connect")) {
    $text = "$text $(Get-ConfigMessageDialogOcrText $Dialog)"
  }
  $normalized = Normalize-AutomationLabel $text
  if ([string]::IsNullOrWhiteSpace($normalized) -or
      -not $normalized.Contains("remote connect") -or
      -not $normalized.Contains("miniserver")) {
    return $false
  }
  return $normalized.Contains("jiz pripojen") -or
    $normalized.Contains("uz pripojen") -or
    $normalized.Contains("pojen") -or
    $normalized.Contains("already connected") -or
    ($normalized.Contains("bereits") -and $normalized.Contains("verbunden"))
}

function Open-ManualConnectDialog($Process, [bool]$OpenHomeFirst = $false) {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  if ($null -eq ("EvoraWin32" -as [type])) {
    Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class EvoraWin32 {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT {
    public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public UIntPtr dwExtraInfo;
  }
  [StructLayout(LayoutKind.Explicit)] public struct INPUTUNION {
    [FieldOffset(0)] public MOUSEINPUT mouse;
  }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT {
    public uint type; public INPUTUNION data;
  }
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int command);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr SetActiveWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr SetFocus(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT point);
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint count, INPUT[] inputs, int size);

  public static bool PointBelongsToProcess(int x, int y, uint expectedProcessId) {
    uint processId;
    GetWindowThreadProcessId(WindowFromPoint(new POINT { X = x, Y = y }), out processId);
    return processId == expectedProcessId;
  }

  public static uint ClickLeft() {
    var inputs = new INPUT[2];
    inputs[0].type = 0;
    inputs[0].data.mouse.dwFlags = 0x0002;
    inputs[1].type = 0;
    inputs[1].data.mouse.dwFlags = 0x0004;
    return SendInput(2, inputs, Marshal.SizeOf(typeof(INPUT)));
  }

  public static bool ActivateWindow(IntPtr target, uint expectedProcessId) {
    IntPtr foreground = GetForegroundWindow();
    uint ignored;
    uint foregroundThread = GetWindowThreadProcessId(foreground, out ignored);
    uint targetThread = GetWindowThreadProcessId(target, out ignored);
    uint currentThread = GetCurrentThreadId();
    if (foregroundThread != 0) AttachThreadInput(currentThread, foregroundThread, true);
    if (targetThread != 0 && targetThread != foregroundThread) AttachThreadInput(currentThread, targetThread, true);
    ShowWindowAsync(target, 9);
    BringWindowToTop(target);
    SetForegroundWindow(target);
    SetActiveWindow(target);
    SetFocus(target);
    if (targetThread != 0 && targetThread != foregroundThread) AttachThreadInput(currentThread, targetThread, false);
    if (foregroundThread != 0) AttachThreadInput(currentThread, foregroundThread, false);
    for (int attempt = 0; attempt < 20; attempt++) {
      uint foregroundProcessId;
      GetWindowThreadProcessId(GetForegroundWindow(), out foregroundProcessId);
      if (foregroundProcessId == expectedProcessId) return true;
      System.Threading.Thread.Sleep(50);
    }
    return false;
  }
}
'@
  }
  Set-LauncherPhase "manual-connect-existing-dialog"
  $existingDialog = Find-ConnectDialog $Process.Id 0
  if ($null -ne $existingDialog) { return $existingDialog }
  [EvoraWin32]::SetForegroundWindow($Process.MainWindowHandle) | Out-Null
  $root = [Windows.Automation.AutomationElement]::FromHandle($Process.MainWindowHandle)
  if ($null -eq $root) { throw (New-LauncherFailure "CONFIG_WINDOW_TIMEOUT" "Loxone Config main window was not found.") }
  $manualActionId = "QApplication.MainWindow.CentralWidget.CentralStack.ProjectsPage.CProjectManagementView.MenuScrollArea.qt_scrollarea_viewport.MenuPane.Item"
  $manualActionNames = @(
    "pripojit manualne",
    "pripojit rucne",
    "manualne pripojit",
    "rucne pripojit",
    "manualni pripojeni",
    "connect manually",
    "manual connect",
    "manually connect",
    "manuell verbinden"
  )

  $findManualAction = {
    param($SearchRoot)
    # All project-page actions share this AutomationId. Query only those 13
    # items and then require the exact normalized label and Qt label-button
    # identity. A full Qt descendant walk can take minutes or never return.
    $itemCondition = New-Object Windows.Automation.PropertyCondition(
      [Windows.Automation.AutomationElement]::AutomationIdProperty,
      $manualActionId
    )
    $items = $SearchRoot.FindAll([Windows.Automation.TreeScope]::Descendants, $itemCondition)
    $matches = @()
    for ($index = 0; $index -lt $items.Count; $index++) {
      $item = $items.Item($index)
      try {
        $normalizedName = Normalize-AutomationLabel ([string]$item.Current.Name)
        $controlType = [string]$item.Current.ControlType.ProgrammaticName
        $automationId = [string]$item.Current.AutomationId
        $className = [string]$item.Current.ClassName
        $bounds = $item.Current.BoundingRectangle
        $safeType = $controlType -match '\.(Button|ListItem|Hyperlink|Custom)$' -or
          ($controlType -eq "ControlType.Text" -and $className -eq "Lx::Config::CustomWidgets::CLabelButton")
        $verifiedIdentity = $automationId -eq $manualActionId -and $manualActionNames -contains $normalizedName
        if ($verifiedIdentity -and
            $safeType -and
            $item.Current.IsEnabled -and
            -not $item.Current.IsOffscreen -and
            $bounds.Width -gt 4 -and
            $bounds.Height -gt 4) {
          $matches += $item
        }
      } catch { }
    }
    if ($matches.Count -eq 1) { return $matches[0] }
    return $null
  }

  $openHomeAndFindAction = {
    param($SearchRoot)
    $alreadyAvailable = & $findManualAction $SearchRoot
    if ($null -ne $alreadyAvailable) { return $alreadyAvailable }
    $homeId = "QApplication.MainWindow.CentralWidget.CLxTitleBar.CTitleBarTabs.CTitleBarTabs::CHomeButton"
    $homeButton = Get-AutomationElementById $SearchRoot $homeId
    if ($null -eq $homeButton -or -not $homeButton.Current.IsEnabled -or $homeButton.Current.IsOffscreen) {
      throw (New-LauncherFailure "CONFIG_HOME_NOT_FOUND" "The verified Home action was not found.")
    }
    Set-LauncherPhase "manual-connect-open-home"
    # A real element-center click is the primary action for Qt. Several Config
    # builds advertise InvokePattern but acknowledge Invoke() without changing
    # the page. The click still targets only the exact verified Home UIA item.
    Click-AutomationElementCenter $homeButton
    $homeDeadline = (Get-Date).AddSeconds(6)
    $foundAction = $null
    do {
      Start-Sleep -Milliseconds 300
      $currentRoot = Get-ConfigAutomationRoot $Process
      if ($null -ne $currentRoot) { $foundAction = & $findManualAction $currentRoot }
    } while ($null -eq $foundAction -and (Get-Date) -lt $homeDeadline)
    if ($null -ne $foundAction) { return $foundAction }

    # Re-read the current main-window handle after navigation. Qt can replace
    # the top-level automation tree while keeping the same Config process.
    $currentRoot = Get-ConfigAutomationRoot $Process
    $homeButton = if ($null -ne $currentRoot) { Get-AutomationElementById $currentRoot $homeId } else { $null }
    if ($null -ne $homeButton -and $homeButton.Current.IsEnabled -and -not $homeButton.Current.IsOffscreen) {
      Invoke-AutomationElement $homeButton
      $clickDeadline = (Get-Date).AddSeconds(6)
      do {
        Start-Sleep -Milliseconds 300
        $currentRoot = Get-ConfigAutomationRoot $Process
        if ($null -ne $currentRoot) { $foundAction = & $findManualAction $currentRoot }
      } while ($null -eq $foundAction -and (Get-Date) -lt $clickDeadline)
    }
    return $foundAction
  }

  Set-LauncherPhase "manual-connect-find-action"
  $manualAction = if ($OpenHomeFirst) {
    & $openHomeAndFindAction $root
  } else {
    & $findManualAction $root
  }
  if ($null -eq $manualAction -and -not $OpenHomeFirst) {
    $manualAction = & $openHomeAndFindAction $root
  }
  if ($null -eq $manualAction) {
    throw (New-LauncherFailure "MANUAL_CONNECT_NOT_FOUND" "Manual connect action was not identified uniquely.")
  }

  Set-LauncherPhase "manual-connect-open-dialog"
  # Qt's InvokePattern can block synchronously until the modal closes. The
  # physical click is therefore the primary and only action here; it still
  # targets the uniquely verified live UIA element and never fixed coordinates.
  Click-AutomationElementCenter $manualAction
  $dialog = Find-ConnectDialog $Process.Id 10
  if ($null -eq $dialog) { throw (New-LauncherFailure "CONNECT_DIALOG_TIMEOUT" "Manual connect dialog did not open.") }
  return $dialog
}

function Wait-ForVerifiedCredentials($Dialog, $Job, [int]$TimeoutSeconds = 18) {
  $fieldBase = "QApplication.CMsConnectDlg.ContentContainer.CMsConnectDlg.m_frmCredentials."
  $localId = $fieldBase + "m_tbLocalAddress"
  $externalId = $fieldBase + "m_tbExternalAddress"
  $usernameId = $fieldBase + "m_tbUser"
  $passwordId = $fieldBase + "m_tbPassword"
  $connectId = "QApplication.CMsConnectDlg.ButtonContainer.QDialogButtonBox.QToolButton"
  $expectedSerial = [string]$Job.serial
  $expectedUsername = [string]$Job.username
  $expectedPassword = [string]$Job.password
  $processId = [int]$Dialog.Current.ProcessId
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $addressStableSince = $null
  $credentialsStableSince = $null
  $credentialsTypedAt = $null

  # Address changes trigger asynchronous credential clearing in Config. Set
  # the address first and wait for it to settle before entering login details.
  Set-LauncherPhase "credentials-address-entry"
  Set-AutomationValue (Get-AutomationElementById $Dialog $localId) "" "local address"
  Set-AutomationValue (Get-AutomationElementById $Dialog $externalId) $expectedSerial "external address"

  do {
    Start-Sleep -Milliseconds 250
    $currentDialog = Find-ConnectDialog $processId 0
    if ($null -eq $currentDialog) {
      throw (New-LauncherFailure "CONNECT_DIALOG_TIMEOUT" "Manual connect dialog closed before verification.")
    }
    $localField = Get-AutomationElementById $currentDialog $localId
    $externalField = Get-AutomationElementById $currentDialog $externalId
    $usernameField = Get-AutomationElementById $currentDialog $usernameId
    $passwordField = Get-AutomationElementById $currentDialog $passwordId
    $localValue = Get-AutomationValue $localField "local address"
    $externalValue = Get-AutomationValue $externalField "external address"

    if ($localValue -ne "" -or $externalValue -ne $expectedSerial) {
      Set-LauncherPhase "credentials-address-retry"
      Set-AutomationValue $localField "" "local address"
      $currentDialog = Find-ConnectDialog $processId 0
      if ($null -eq $currentDialog) {
        throw (New-LauncherFailure "CONNECT_DIALOG_TIMEOUT" "Manual connect dialog closed during address entry.")
      }
      Set-AutomationValue (Get-AutomationElementById $currentDialog $externalId) $expectedSerial "external address"
      $addressStableSince = $null
      $credentialsStableSince = $null
      $credentialsTypedAt = $null
      continue
    }
    if ($null -eq $addressStableSince) { $addressStableSince = Get-Date }
    if (((Get-Date) - $addressStableSince).TotalMilliseconds -lt 900) { continue }

    Set-LauncherPhase "credentials-login-entry"
    $usernameValue = Get-AutomationValue $usernameField "username"
    if ($null -eq $credentialsTypedAt -or $usernameValue -ne $expectedUsername) {
      # ValuePattern preserves exact casing and does not depend on Caps Lock or
      # the active Windows keyboard layout.
      Set-AutomationValue $usernameField $expectedUsername "username"
      $currentDialog = Find-ConnectDialog $processId 0
      if ($null -eq $currentDialog) {
        throw (New-LauncherFailure "CONNECT_DIALOG_TIMEOUT" "Manual connect dialog closed during credential entry.")
      }
      Set-AutomationValue (Get-AutomationElementById $currentDialog $passwordId) $expectedPassword "password"
      $credentialsTypedAt = Get-Date
      $credentialsStableSince = $null
      continue
    }

    $connectButton = Get-AutomationElementById $currentDialog $connectId
    $czechConnect = "P$([char]0x0159)ipojit"
    $buttonVerified = $false
    try {
      $buttonVerified = $null -ne $connectButton -and $connectButton.Current.Name -in @("Pripojit", $czechConnect, "Connect", "Verbinden") -and $connectButton.Current.IsEnabled -and -not $connectButton.Current.IsOffscreen
    } catch { $buttonVerified = $false }
    if (-not $buttonVerified) {
      $credentialsStableSince = $null
      if (((Get-Date) - $credentialsTypedAt).TotalSeconds -ge 2) {
        # Qt can rebuild or clear a credential edit after the address changes.
        # Re-enter both fields only after the previous attempt has settled.
        $credentialsTypedAt = $null
      }
      continue
    }
    if ($null -eq $credentialsStableSince) { $credentialsStableSince = Get-Date }
    if (((Get-Date) - $credentialsStableSince).TotalMilliseconds -ge 650) { return $connectButton }
  } while ((Get-Date) -lt $deadline)

  throw (New-LauncherFailure "CONNECT_BUTTON_DISABLED" "Login values did not remain verified long enough to enable Connect.")
}

function Post-JobStatus([string]$BaseUrl, [string]$Token, [string]$JobId, [string]$State, [string]$Message, [string]$ErrorCode = "") {
  $body = @{ state = $State; message = $Message; errorCode = if ($ErrorCode) { $ErrorCode } else { $null } }
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    try {
      Invoke-HubJson "POST" $BaseUrl "/api/config-launcher/agent/jobs/$JobId/status" $body $Token | Out-Null
      return
    } catch {
      if ($attempt -eq 3) {
        $statusCode = try { [int]$_.Exception.Response.StatusCode } catch { 0 }
        Write-SafeLog "Hub job status update failed (HTTP $statusCode)."
        throw (New-LauncherFailure "HUB_STATUS_FAILED" "The Hub did not accept the launcher status update.")
      }
      Start-Sleep -Milliseconds (300 * $attempt)
    }
  }
}

function Start-ConfigJob($Job, [string]$BaseUrl, [string]$Token, $Executables) {
  $jobId = [string]$Job.id
  $requiredVersion = [string]$Job.requiredVersion
  $candidate = @($Executables | Where-Object { $_.Version -eq $requiredVersion }) | Select-Object -First 1
  if ($null -eq $candidate) {
    Post-JobStatus $BaseUrl $Token $jobId "missing_config" "Loxone Config $requiredVersion is not installed." "CONFIG_VERSION_MISSING"
    Show-LauncherNotice "Evora Smart Hub" "Loxone Config $requiredVersion is not installed. Download link is available in the Hub." ([string]$Job.configUrl)
    return
  }

  $launchModeValue = if ($null -ne $Job.PSObject.Properties["launchMode"]) { [string]$Job.launchMode } else { "new_window" }
  $launchMode = if ($launchModeValue -eq "existing") { "existing" } else { "new_window" }
  $targetLabel = if ($launchMode -eq "existing") { "the already-open window" } else { "a new window" }
  if ($launchMode -eq "existing") {
    Set-LauncherPhase "find-existing-config"
    $process = Find-ExistingConfigProcess ([string]$candidate.Path)
    if ($null -eq $process) {
      throw (New-LauncherFailure "CONFIG_NOT_RUNNING" "The exact requested Loxone Config version is not already open.")
    }
    Post-JobStatus $BaseUrl $Token $jobId "launching" "Using already-open Loxone Config $requiredVersion."
  } else {
    Set-LauncherPhase "start-config"
    Post-JobStatus $BaseUrl $Token $jobId "launching" "Starting exact Loxone Config $requiredVersion in a new window."
    $startedAt = (Get-Date).ToUniversalTime()
    $started = Start-Process -FilePath $candidate.Path -PassThru
    Set-LauncherPhase "wait-config-window"
    $process = Find-ReadyConfigProcess $started.Id ([string]$candidate.Path) $startedAt 45
  }

  # The job is already in the launching state. Sending the same transition a
  # second time made older Hub builds reject the request before UI automation.
  Set-LauncherPhase "open-manual-connect"
  $dialog = Open-ManualConnectDialog $process ($launchMode -eq "existing")
  Set-LauncherPhase "fill-credentials"
  $connectButton = Wait-ForVerifiedCredentials $dialog $Job
  Post-JobStatus $BaseUrl $Token $jobId "connecting" "Credentials entered; connecting to the Miniserver."
  Set-LauncherPhase "submit-connect"
  Invoke-AutomationElement $connectButton

  # Some Qt builds expose InvokePattern but ignore Invoke(). If the exact
  # dialog remains open, click the re-verified button center once.
  Start-Sleep -Seconds 2
  $remainingDialog = Find-ConnectDialog $process.Id 0
  if ($null -ne $remainingDialog) {
    $connectId = "QApplication.CMsConnectDlg.ButtonContainer.QDialogButtonBox.QToolButton"
    $fallbackButton = Get-AutomationElementById $remainingDialog $connectId
    $czechConnect = "P$([char]0x0159)ipojit"
    if ($null -ne $fallbackButton -and $fallbackButton.Current.Name -in @("Pripojit", $czechConnect, "Connect", "Verbinden") -and $fallbackButton.Current.IsEnabled) {
      Click-AutomationElementCenter $fallbackButton
    }
  }

  Set-LauncherPhase "wait-connection-result"
  $deadline = (Get-Date).AddSeconds(60)
  $dialogClosedAt = $null
  do {
    Start-Sleep -Milliseconds 500
    if ($null -eq (Find-ConnectDialog $process.Id 0)) {
      $messageDialog = Find-ConfigMessageDialog $process.Id
      if ($null -ne $messageDialog -and (Test-RemoteConnectAlreadyActiveDialog $messageDialog)) {
        $alreadyActiveMessage = Get-LauncherLocalizedText 'Miniserver je ji\u017e p\u0159ipojen\u00fd p\u0159es Remote Connect v jin\u00e9 relaci Loxone Configu.'
        Post-JobStatus $BaseUrl $Token $jobId "succeeded" $alreadyActiveMessage "REMOTE_CONNECT_ALREADY_ACTIVE"
        Write-SafeLog "Config launch target is already active in another Remote Connect session."
        Show-LauncherNotice (Get-LauncherLocalizedText 'Miniserver je ji\u017e p\u0159ipojen\u00fd') $alreadyActiveMessage
        return
      }
      if ($null -ne $messageDialog) {
        throw (New-LauncherFailure "CONNECTION_REJECTED" "Loxone Config displayed an error after submitting the connection.")
      }
      if ($null -eq $dialogClosedAt) { $dialogClosedAt = Get-Date }
      # Authentication errors can appear shortly after the connect dialog
      # closes. Require an eight-second error-free window before success.
      if (((Get-Date) - $dialogClosedAt).TotalSeconds -ge 8) {
        Post-JobStatus $BaseUrl $Token $jobId "succeeded" "Loxone Config accepted the Miniserver login."
        Show-LauncherNotice "Evora Smart Hub" "Loxone Config $requiredVersion was connected in $targetLabel."
        return
      }
    } else {
      $dialogClosedAt = $null
    }
  } while ((Get-Date) -lt $deadline)
  throw (New-LauncherFailure "CONNECTION_DIALOG_TIMEOUT" "The connection dialog stayed open; connection was not confirmed.")
}

if ($CompleteUpdate) {
  if (Complete-LauncherUpdate) { exit 0 }
  exit 2
}

if ($PairingCode) {
  if (-not $HubUrl) { throw "HubUrl is required for pairing." }
  $normalizedHubUrl = Normalize-HubUrl $HubUrl
  Save-Pairing $normalizedHubUrl $PairingCode.Trim() $AgentName
  if ($PairOnly) { exit 0 }
}

if (-not (Test-Path -LiteralPath $ConfigPath)) {
  throw "Launcher is not paired. Run the installer with a one-time pairing code."
}

$configuration = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$storedHubUrl = [string]$configuration.hubUrl
$configuredHubUrl = Normalize-HubUrl $storedHubUrl
if ($storedHubUrl -ne $configuredHubUrl) {
  $configuration.hubUrl = $configuredHubUrl
  Set-Content -LiteralPath $ConfigPath -Value (ConvertTo-Json $configuration -Compress) -Encoding UTF8
  Write-SafeLog "Legacy Hub URL was migrated to an explicit HTTPS URL."
}
$agentToken = Unprotect-LauncherToken ([string]$configuration.tokenProtected)

if ($SelfTest) {
  $found = @(Get-ConfigExecutables)
  Write-Output (ConvertTo-Json @{ helperVersion = $HelperVersion; installedVersions = @($found | ForEach-Object { $_.Version }); paths = @($found | ForEach-Object { $_.Path }); diagnostics = (Get-LauncherDiagnostics $found) } -Depth 6)
  exit 0
}

$createdNew = $false
$mutex = New-Object Threading.Mutex($true, $MutexName, [ref]$createdNew)
if (-not $createdNew) { exit 0 }

try {
  Remove-Item -LiteralPath $StopRequestPath -Force -ErrorAction SilentlyContinue
  Install-HiddenLauncherEntrypoints
  Write-LauncherRuntime
  Write-SafeLog "Launcher started."
  $script:TrayHubUrl = $configuredHubUrl
  Sync-LauncherTrayOwnership
  $lastScan = [DateTime]::MinValue
  $executables = @()
  $diagnostics = $null
  while (-not $script:TrayExitRequested -and -not (Test-LauncherStopRequested)) {
    try {
      if ($script:ForceLauncherScan -or (Get-Date) -gt $lastScan.AddMinutes(1)) {
        $script:ForceLauncherScan = $false
        $executables = @(Get-ConfigExecutables)
        $diagnostics = Get-LauncherDiagnostics $executables
        $lastScan = Get-Date
      }
      $pollBody = @{
        helperVersion = $HelperVersion
        installedVersions = @($executables | ForEach-Object { $_.Version })
        diagnostics = $diagnostics
      }
      Set-LauncherTrayStatus -State "updating" -Label "kontroluji"
      $response = Invoke-HubJson "POST" $configuredHubUrl "/api/config-launcher/agent/poll" $pollBody $agentToken
      if (-not $script:HubConnectionVerified) {
        $script:HubConnectionVerified = $true
        $diagnostics = Get-LauncherDiagnostics $executables
        Write-LauncherRuntime -Connected $true
      }
      if ($null -ne $response.update) {
        if (Install-LauncherUpdate $response.update $configuredHubUrl) { exit 0 }
        $diagnostics = Get-LauncherDiagnostics $executables
      }
      if ($null -ne $response.job) {
        try {
          Start-ConfigJob $response.job $configuredHubUrl $agentToken $executables
        } catch {
          $failureCode = if ($_.Exception.Data.Contains("EvoraCode")) { [string]$_.Exception.Data["EvoraCode"] } else { "UI_AUTOMATION_FAILED" }
          $safeRemainder = if ($failureCode -eq "CONFIG_NOT_RUNNING") { "No Config window was changed." } else { "Config remains open for safe manual connection." }
          $failureMessage = "$(Get-SafeFailureMessage $failureCode) Failed step: $script:LauncherPhase. $safeRemainder"
          Write-SafeLog "Config launch job failed safely ($failureCode; $(Get-SafeExceptionFingerprint $_))."
          try { Post-JobStatus $configuredHubUrl $agentToken ([string]$response.job.id) "failed" $failureMessage $failureCode } catch { }
          Show-LauncherNotice "Evora Smart Hub" "$failureMessage Details are available in the Hub."
        } finally {
          if ($null -ne $response.job) {
            $response.job.password = $null
            $response.job.username = $null
          }
        }
      }
      Set-LauncherTrayStatus -State "online" -Label "online"
      Wait-WithTrayEvents 3000
    } catch {
      if (Test-HubRejectedPairing $_) {
        Set-LauncherTrayStatus -State "offline" -Label 'p\u00e1rov\u00e1n\u00ed je neplatn\u00e9'
        Write-SafeLog "Hub rejected the stored launcher pairing. Re-pairing is required."
        if (-not $script:PairingRejectedNoticeShown) {
          $script:PairingRejectedNoticeShown = $true
          Show-LauncherNotice "Evora Smart Hub" "Stored pairing is no longer valid. Create a new code in Hub and run Opravit-parovani.cmd from the latest ZIP."
        }
      } else {
        Set-LauncherTrayStatus -State "offline" -Label 'Hub je nedostupn\u00fd'
        Write-SafeLog "Hub poll failed; retrying later."
      }
      Wait-WithTrayEvents 30000
    }
  }
} finally {
  Dispose-LauncherTray
  Remove-Item -LiteralPath $RuntimeStatePath -Force -ErrorAction SilentlyContinue
  if ($agentToken) { $agentToken = $null }
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
