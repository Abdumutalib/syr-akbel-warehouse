Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
root = files.GetParentFolderName(files.GetParentFolderName(WScript.ScriptFullName))
shell.CurrentDirectory = root
command = Chr(34) & root & "\bin\node.exe" & Chr(34) & " " & Chr(34) & root & "\scripts\backup-desktop-launcher.mjs" & Chr(34) & " --background"
shell.Run command, 0, False
