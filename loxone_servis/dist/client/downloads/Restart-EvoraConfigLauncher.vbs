Option Explicit

Dim shell, fileSystem, installDirectory, powerShellPath, updateHelperPath, command, waitPid, expectedVersion
If WScript.Arguments.Count <> 2 Then WScript.Quit 2
Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")
installDirectory = fileSystem.GetParentFolderName(WScript.ScriptFullName)
powerShellPath = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"
updateHelperPath = fileSystem.BuildPath(installDirectory, "Complete-EvoraConfigLauncherUpdate.ps1")
waitPid = CLng(WScript.Arguments(0))
expectedVersion = CStr(WScript.Arguments(1))
command = Chr(34) & powerShellPath & Chr(34) & " -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Chr(34) & updateHelperPath & Chr(34) & " -WaitForPid " & CStr(waitPid) & " -ExpectedVersion " & Chr(34) & expectedVersion & Chr(34)
shell.Run command, 0, False
