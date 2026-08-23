param(
  [string]$HubUrl = "",
  [string]$PairingCode = "",
  [string]$AgentName = $env:COMPUTERNAME,
  [switch]$PairOnly,
  [switch]$SelfTest
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
Set-StrictMode -Version Latest
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$HelperVersion = "3.0.0.2"
$AppDirectory = Join-Path $env:LOCALAPPDATA "EvoraSmartHub\ConfigLauncher"
$ConfigPath = Join-Path $AppDirectory "config.json"
$LogPath = Join-Path $AppDirectory "launcher.log"
$RuntimeStatePath = Join-Path $AppDirectory "runtime.json"
$StopRequestPath = Join-Path $AppDirectory "stop.request"
$RestartScriptPath = Join-Path $AppDirectory "Restart-EvoraConfigLauncher.ps1"
$MutexName = "Local\EvoraSmartHubConfigLauncher"
$script:LauncherPhase = "startup"
$script:HubConnectionVerified = $false
$script:AutomaticUpdateState = "passed"
$script:AutomaticUpdateMessage = "Updates use an authenticated Hub manifest and an exact SHA-256 check."
$script:PairingRejectedNoticeShown = $false
$script:TrayIcon = $null
$script:TrayIconImage = $null
$script:TrayStatusItem = $null
$script:TrayState = ""
$script:TrayExitRequested = $false
$script:ForceLauncherScan = $false
$script:TrayHubUrl = ""

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
  $tooltip = "Evora Config Launcher - $Label"
  $script:TrayIcon.Text = $tooltip.Substring(0, [Math]::Min(63, $tooltip.Length))
  if ($null -ne $script:TrayStatusItem) { $script:TrayStatusItem.Text = "Stav: $Label" }
}

function Initialize-LauncherTray([string]$BaseUrl) {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $script:TrayHubUrl = $BaseUrl
  $menu = [System.Windows.Forms.ContextMenuStrip]::new()
  $status = [System.Windows.Forms.ToolStripMenuItem]::new("Stav: spouštím")
  $status.Enabled = $false
  $openHub = [System.Windows.Forms.ToolStripMenuItem]::new("Otevřít Evora Smart Hub")
  $refresh = [System.Windows.Forms.ToolStripMenuItem]::new("Zkontrolovat připojení a aktualizace")
  $repair = [System.Windows.Forms.ToolStripMenuItem]::new("Vytvořit nový párovací kód")
  $diagnostics = [System.Windows.Forms.ToolStripMenuItem]::new("Otevřít diagnostický protokol")
  $exit = [System.Windows.Forms.ToolStripMenuItem]::new("Ukončit Launcher")
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
  Set-LauncherTrayStatus -State "starting" -Label "spouštím"
}

function Wait-WithTrayEvents([int]$Milliseconds) {
  $deadline = [DateTime]::UtcNow.AddMilliseconds([Math]::Max(0, $Milliseconds))
  do {
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
    ContentType = "application/json"
    UseBasicParsing = $true
    TimeoutSec = 30
  }
  if ($null -ne $Body) {
    $parameters.Body = ConvertTo-Json $Body -Compress -Depth 6
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

function Install-LauncherUpdate($Update, [string]$BaseUrl) {
  if ($null -eq $Update -or -not $Update.version -or -not $Update.url -or -not $Update.sha256) { return $false }
  if ([string]$Update.version -eq $HelperVersion) { return $false }
  Set-LauncherPhase "automatic-update-download"
  $targetUri = [Uri]::new([Uri]$BaseUrl, [string]$Update.url)
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
    Set-LauncherPhase "automatic-update-install"
    Copy-Item -LiteralPath $PSCommandPath -Destination "$PSCommandPath.bak" -Force
    Copy-Item -LiteralPath $pendingPath -Destination $PSCommandPath -Force
    Remove-Item -LiteralPath $pendingPath -Force -ErrorAction SilentlyContinue
    Write-SafeLog "Launcher update installed after exact SHA-256 verification."
    if (Test-Path -LiteralPath $RestartScriptPath) {
      Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", "`"$RestartScriptPath`"", "-WaitForPid", "$PID", "-LauncherPath", "`"$PSCommandPath`"") -WindowStyle Hidden
    } else {
      Write-SafeLog "Delayed restart helper is missing; the watchdog will restore the Launcher."
    }
    return $true
  } catch {
    $script:AutomaticUpdateState = "warning"
    $script:AutomaticUpdateMessage = "Automatic update failed safely; the existing launcher remains available."
    Write-SafeLog "Automatic update failed safely ($(Get-SafeExceptionFingerprint $_))."
    Remove-Item -LiteralPath $pendingPath -Force -ErrorAction SilentlyContinue
    return $false
  }
}

function Get-AutomationElementById($Root, [string]$AutomationId) {
  $condition = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::AutomationIdProperty, $AutomationId)
  return $Root.FindFirst([Windows.Automation.TreeScope]::Descendants, $condition)
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
  $bounds = $Element.Current.BoundingRectangle
  if ($bounds.Width -le 0 -or $bounds.Height -le 0 -or $Element.Current.IsOffscreen) {
    throw "Expected action is not visible."
  }
  [EvoraWin32]::SetCursorPos([int]($bounds.X + $bounds.Width / 2), [int]($bounds.Y + $bounds.Height / 2)) | Out-Null
  [EvoraWin32]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
  [EvoraWin32]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
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

function Find-ReadyConfigProcess([int]$StartedProcessId, [string]$ExecutablePath, [int]$TimeoutSeconds) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $candidates = @()
    $startedCandidate = Get-Process -Id $StartedProcessId -ErrorAction SilentlyContinue
    if ($null -ne $startedCandidate) { $candidates += $startedCandidate }
    $candidates += @(Get-Process "LoxoneConfig" -ErrorAction SilentlyContinue | Sort-Object StartTime -Descending)
    foreach ($candidateProcess in @($candidates | Select-Object -Unique)) {
      try {
        $pathMatches = [string]::Equals([string]$candidateProcess.Path, $ExecutablePath, [StringComparison]::OrdinalIgnoreCase)
        if ($pathMatches -and $candidateProcess.MainWindowHandle -ne 0) {
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
  $condition = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::AutomationIdProperty, "QApplication.CMsConnectDlg")
  do {
    $candidateProcess = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if ($null -ne $candidateProcess) {
      try {
        $candidateProcess.Refresh()
        if ($candidateProcess.MainWindowHandle -ne 0) {
          $processRoot = [Windows.Automation.AutomationElement]::FromHandle($candidateProcess.MainWindowHandle)
          if ($null -ne $processRoot) {
            if ($processRoot.Current.AutomationId -eq "QApplication.CMsConnectDlg") { return $processRoot }
            # Qt exposes the modal dialog below its own main-window UIA tree,
            # even though the dialog is visually a separate window.
            $dialog = $processRoot.FindFirst([Windows.Automation.TreeScope]::Descendants, $condition)
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

function Open-ManualConnectDialog($Process) {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  if ($null -eq ("EvoraWin32" -as [type])) {
    Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class EvoraWin32 {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
}
'@
  }
  Set-LauncherPhase "manual-connect-existing-dialog"
  $existingDialog = Find-ConnectDialog $Process.Id 0
  if ($null -ne $existingDialog) { return $existingDialog }
  [EvoraWin32]::SetForegroundWindow($Process.MainWindowHandle) | Out-Null
  $root = [Windows.Automation.AutomationElement]::FromHandle($Process.MainWindowHandle)
  if ($null -eq $root) { throw (New-LauncherFailure "CONFIG_WINDOW_TIMEOUT" "Loxone Config main window was not found.") }
  $czechManualConnect = "P$([char]0x0159)ipojit manu$([char]0x00E1)ln$([char]0x011B)..."
  $names = @("Pripojit manualne...", $czechManualConnect, "Connect manually...", "Manuell verbinden...")

  $findManualAction = {
    param($SearchRoot)
    $items = $SearchRoot.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition)
    $matches = @()
    for ($index = 0; $index -lt $items.Count; $index++) {
      $item = $items.Item($index)
      if ($item.Current.AutomationId -eq "QApplication.MainWindow.CentralWidget.CentralStack.ProjectsPage.CProjectManagementView.MenuScrollArea.qt_scrollarea_viewport.MenuPane.Item" -and $names -contains $item.Current.Name -and $item.Current.IsEnabled -and -not $item.Current.IsOffscreen) {
        $matches += $item
      }
    }
    if ($matches.Count -eq 1) { return $matches[0] }
    return $null
  }

  Set-LauncherPhase "manual-connect-find-action"
  $manualAction = & $findManualAction $root
  if ($null -eq $manualAction) {
    $homeId = "QApplication.MainWindow.CentralWidget.CLxTitleBar.CTitleBarTabs.CTitleBarTabs::CHomeButton"
    $homeButton = Get-AutomationElementById $root $homeId
    if ($null -eq $homeButton -or -not $homeButton.Current.IsEnabled) {
      throw (New-LauncherFailure "CONFIG_HOME_NOT_FOUND" "The verified Home action was not found.")
    }
    Set-LauncherPhase "manual-connect-open-home"
    Invoke-AutomationElement $homeButton
    $homeDeadline = (Get-Date).AddSeconds(15)
    do {
      Start-Sleep -Milliseconds 300
      $root = [Windows.Automation.AutomationElement]::FromHandle($Process.MainWindowHandle)
      if ($null -ne $root) { $manualAction = & $findManualAction $root }
    } while ($null -eq $manualAction -and (Get-Date) -lt $homeDeadline)
  }
  if ($null -eq $manualAction) {
    throw (New-LauncherFailure "MANUAL_CONNECT_NOT_FOUND" "Manual connect action was not identified uniquely.")
  }

  Set-LauncherPhase "manual-connect-open-dialog"
  Invoke-AutomationElement $manualAction
  $dialog = Find-ConnectDialog $Process.Id 4
  if ($null -eq $dialog) {
    # A verified element-center click is the Qt compatibility fallback.
    Click-AutomationElementCenter $manualAction
    $dialog = Find-ConnectDialog $Process.Id 10
  }
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

  Set-LauncherPhase "start-config"
  Post-JobStatus $BaseUrl $Token $jobId "launching" "Starting exact Loxone Config $requiredVersion."
  $started = Start-Process -FilePath $candidate.Path -PassThru
  Set-LauncherPhase "wait-config-window"
  $process = Find-ReadyConfigProcess $started.Id ([string]$candidate.Path) 45

  # The job is already in the launching state. Sending the same transition a
  # second time made older Hub builds reject the request before UI automation.
  Set-LauncherPhase "open-manual-connect"
  $dialog = Open-ManualConnectDialog $process
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
      if ($null -ne (Find-ConfigMessageDialog $process.Id)) {
        throw (New-LauncherFailure "CONNECTION_REJECTED" "Loxone Config displayed an error after submitting the connection.")
      }
      if ($null -eq $dialogClosedAt) { $dialogClosedAt = Get-Date }
      # Authentication errors can appear shortly after the connect dialog
      # closes. Require an eight-second error-free window before success.
      if (((Get-Date) - $dialogClosedAt).TotalSeconds -ge 8) {
        Post-JobStatus $BaseUrl $Token $jobId "succeeded" "Loxone Config accepted the Miniserver login."
        Show-LauncherNotice "Evora Smart Hub" "Loxone Config $requiredVersion was opened and connected."
        return
      }
    } else {
      $dialogClosedAt = $null
    }
  } while ((Get-Date) -lt $deadline)
  throw (New-LauncherFailure "CONNECTION_DIALOG_TIMEOUT" "The connection dialog stayed open; connection was not confirmed.")
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
  Write-LauncherRuntime
  Write-SafeLog "Launcher started."
  Initialize-LauncherTray $configuredHubUrl
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
          $failureMessage = "$(Get-SafeFailureMessage $failureCode) Failed step: $script:LauncherPhase. Config remains open for safe manual connection."
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
        Set-LauncherTrayStatus -State "offline" -Label "párování je neplatné"
        Write-SafeLog "Hub rejected the stored launcher pairing. Re-pairing is required."
        if (-not $script:PairingRejectedNoticeShown) {
          $script:PairingRejectedNoticeShown = $true
          Show-LauncherNotice "Evora Smart Hub" "Stored pairing is no longer valid. Create a new code in Hub and run Opravit-parovani.cmd from the latest ZIP."
        }
      } else {
        Set-LauncherTrayStatus -State "offline" -Label "Hub je nedostupný"
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
