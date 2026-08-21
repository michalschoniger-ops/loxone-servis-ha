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

$HelperVersion = "1.0.3.1"
$AppDirectory = Join-Path $env:LOCALAPPDATA "EvoraSmartHub\ConfigLauncher"
$ConfigPath = Join-Path $AppDirectory "config.json"
$LogPath = Join-Path $AppDirectory "launcher.log"
$MutexName = "Local\EvoraSmartHubConfigLauncher"

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

function Show-LauncherNotice([string]$Title, [string]$Message, [string]$Url = "") {
  try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
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

function Save-Pairing([string]$BaseUrl, [string]$Code, [string]$Name) {
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
  Set-Content -LiteralPath $ConfigPath -Value (ConvertTo-Json $configuration -Compress) -Encoding UTF8
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

function Get-AutomationElementById($Root, [string]$AutomationId) {
  $condition = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::AutomationIdProperty, $AutomationId)
  return $Root.FindFirst([Windows.Automation.TreeScope]::Descendants, $condition)
}

function Set-AutomationValue($Element, [string]$Value, [string]$Label) {
  if ($null -eq $Element -or -not $Element.Current.IsEnabled) {
    throw "Expected $Label field is missing or disabled."
  }
  $pattern = $Element.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern)
  if ($null -eq $pattern) { throw "Expected $Label field does not support safe value entry." }
  ([Windows.Automation.ValuePattern]$pattern).SetValue($Value)
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
    $bounds = $Element.Current.BoundingRectangle
    if ($bounds.Width -le 0 -or $bounds.Height -le 0) { throw }
    [EvoraWin32]::SetCursorPos([int]($bounds.X + $bounds.Width / 2), [int]($bounds.Y + $bounds.Height / 2)) | Out-Null
    [EvoraWin32]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
    [EvoraWin32]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
  }
}

function Find-ConnectDialog([int]$ProcessId, [int]$TimeoutSeconds) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $desktop = [Windows.Automation.AutomationElement]::RootElement
  $condition = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::AutomationIdProperty, "QApplication.CMsConnectDlg")
  do {
    $dialogs = $desktop.FindAll([Windows.Automation.TreeScope]::Descendants, $condition)
    for ($index = 0; $index -lt $dialogs.Count; $index++) {
      if ($dialogs.Item($index).Current.ProcessId -eq $ProcessId) { return $dialogs.Item($index) }
    }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)
  return $null
}

function Open-ManualConnectDialog($Process) {
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class EvoraWin32 {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
}
'@
  [EvoraWin32]::SetForegroundWindow($Process.MainWindowHandle) | Out-Null
  $root = [Windows.Automation.AutomationElement]::FromHandle($Process.MainWindowHandle)
  if ($null -eq $root) { throw "Loxone Config main window was not found." }
  $items = $root.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition)
  $matches = @()
  $czechManualConnect = "P$([char]0x0159)ipojit manu$([char]0x00E1)ln$([char]0x011B)..."
  $names = @("Pripojit manualne...", $czechManualConnect, "Connect manually...", "Manuell verbinden...")
  for ($index = 0; $index -lt $items.Count; $index++) {
    $item = $items.Item($index)
    if ($item.Current.AutomationId -eq "QApplication.MainWindow.CentralWidget.CentralStack.ProjectsPage.CProjectManagementView.MenuScrollArea.qt_scrollarea_viewport.MenuPane.Item" -and $names -contains $item.Current.Name) {
      $matches += $item
    }
  }
  if ($matches.Count -ne 1) { throw "Manual connect action was not identified uniquely." }
  Invoke-AutomationElement $matches[0]
  $dialog = Find-ConnectDialog $Process.Id 2
  if ($null -eq $dialog) {
    # A verified element-center click is the Qt compatibility fallback.
    $bounds = $matches[0].Current.BoundingRectangle
    [EvoraWin32]::SetCursorPos([int]($bounds.X + $bounds.Width / 2), [int]($bounds.Y + $bounds.Height / 2)) | Out-Null
    [EvoraWin32]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
    [EvoraWin32]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
    $dialog = Find-ConnectDialog $Process.Id 5
  }
  if ($null -eq $dialog) { throw "Manual connect dialog did not open." }
  return $dialog
}

function Post-JobStatus([string]$BaseUrl, [string]$Token, [string]$JobId, [string]$State, [string]$Message, [string]$ErrorCode = "") {
  $body = @{ state = $State; message = $Message; errorCode = if ($ErrorCode) { $ErrorCode } else { $null } }
  Invoke-HubJson "POST" $BaseUrl "/api/config-launcher/agent/jobs/$JobId/status" $body $Token | Out-Null
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

  Post-JobStatus $BaseUrl $Token $jobId "launching" "Starting exact Loxone Config $requiredVersion."
  $started = Start-Process -FilePath $candidate.Path -PassThru
  Start-Sleep -Seconds 4
  $process = Get-Process -Id $started.Id -ErrorAction SilentlyContinue
  if ($null -eq $process -or $process.MainWindowHandle -eq 0) {
    $process = Get-Process "LoxoneConfig" -ErrorAction SilentlyContinue |
      Where-Object { $_.Path -eq $candidate.Path -and $_.MainWindowHandle -ne 0 } |
      Sort-Object StartTime -Descending | Select-Object -First 1
  }
  if ($null -eq $process -or $process.MainWindowHandle -eq 0) { throw "Exact Loxone Config window did not start." }
  try { $process.WaitForInputIdle(15000) | Out-Null } catch { }

  $dialog = Open-ManualConnectDialog $process
  $fieldBase = "QApplication.CMsConnectDlg.ContentContainer.CMsConnectDlg.m_frmCredentials."
  Set-AutomationValue (Get-AutomationElementById $dialog ($fieldBase + "m_tbUser")) ([string]$Job.username) "username"
  # Manual Remote Connect in Loxone Config expects the Miniserver serial in
  # External address. Local address intentionally stays empty.
  Set-AutomationValue (Get-AutomationElementById $dialog ($fieldBase + "m_tbLocalAddress")) "" "local address"
  Set-AutomationValue (Get-AutomationElementById $dialog ($fieldBase + "m_tbExternalAddress")) ([string]$Job.serial) "external address"
  Set-AutomationValue (Get-AutomationElementById $dialog ($fieldBase + "m_tbPassword")) ([string]$Job.password) "password"

  $connectButton = Get-AutomationElementById $dialog "QApplication.CMsConnectDlg.ButtonContainer.QDialogButtonBox.QToolButton"
  $czechConnect = "P$([char]0x0159)ipojit"
  if ($null -eq $connectButton -or $connectButton.Current.Name -notin @("Pripojit", $czechConnect, "Connect", "Verbinden") -or -not $connectButton.Current.IsEnabled) {
    throw "Connect button was not identified safely."
  }
  Post-JobStatus $BaseUrl $Token $jobId "connecting" "Credentials entered; connecting to the Miniserver."
  Invoke-AutomationElement $connectButton

  $deadline = (Get-Date).AddSeconds(60)
  do {
    Start-Sleep -Milliseconds 500
    if ($null -eq (Find-ConnectDialog $process.Id 0)) {
      Start-Sleep -Seconds 2
      Post-JobStatus $BaseUrl $Token $jobId "succeeded" "Loxone Config accepted the connection dialog."
      Show-LauncherNotice "Evora Smart Hub" "Loxone Config $requiredVersion was opened."
      return
    }
  } while ((Get-Date) -lt $deadline)
  throw "The connection dialog stayed open; connection was not confirmed."
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
$configuredHubUrl = Normalize-HubUrl ([string]$configuration.hubUrl)
$agentToken = Unprotect-LauncherToken ([string]$configuration.tokenProtected)

if ($SelfTest) {
  $found = @(Get-ConfigExecutables)
  Write-Output (ConvertTo-Json @{ helperVersion = $HelperVersion; installedVersions = @($found | ForEach-Object { $_.Version }); paths = @($found | ForEach-Object { $_.Path }) } -Depth 4)
  exit 0
}

$createdNew = $false
$mutex = New-Object Threading.Mutex($true, $MutexName, [ref]$createdNew)
if (-not $createdNew) { exit 0 }

try {
  Write-SafeLog "Launcher started."
  $lastScan = [DateTime]::MinValue
  $executables = @()
  while ($true) {
    try {
      if ((Get-Date) -gt $lastScan.AddMinutes(1)) {
        $executables = @(Get-ConfigExecutables)
        $lastScan = Get-Date
      }
      $pollBody = @{
        helperVersion = $HelperVersion
        installedVersions = @($executables | ForEach-Object { $_.Version })
      }
      $response = Invoke-HubJson "POST" $configuredHubUrl "/api/config-launcher/agent/poll" $pollBody $agentToken
      if ($null -ne $response.job) {
        try {
          Start-ConfigJob $response.job $configuredHubUrl $agentToken $executables
        } catch {
          Write-SafeLog "Config launch job failed safely."
          try { Post-JobStatus $configuredHubUrl $agentToken ([string]$response.job.id) "failed" "Windows Launcher could not complete the verified UI Automation sequence." "UI_AUTOMATION_FAILED" } catch { }
          Show-LauncherNotice "Evora Smart Hub" "Loxone Config could not be opened automatically. Details are available in the Hub."
        } finally {
          if ($null -ne $response.job) {
            $response.job.password = $null
            $response.job.username = $null
          }
        }
      }
      Start-Sleep -Seconds 3
    } catch {
      Write-SafeLog "Hub poll failed; retrying later."
      Start-Sleep -Seconds 30
    }
  }
} finally {
  if ($agentToken) { $agentToken = $null }
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
