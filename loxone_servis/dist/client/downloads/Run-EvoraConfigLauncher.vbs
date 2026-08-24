Option Explicit

Dim shell, fileSystem, installDirectory, powerShellPath, launcherPath, command
Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")
installDirectory = fileSystem.GetParentFolderName(WScript.ScriptFullName)
powerShellPath = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"
launcherPath = fileSystem.BuildPath(installDirectory, "EvoraConfigLauncher.ps1")
command = Chr(34) & powerShellPath & Chr(34) & " -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Chr(34) & launcherPath & Chr(34)
shell.Run command, 0, False
