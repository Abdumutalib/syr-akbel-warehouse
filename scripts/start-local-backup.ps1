param(
  [string]$DataDirectory = (Join-Path $env:LOCALAPPDATA 'AKBEL-Backup'),
  [switch]$Setup,
  [switch]$UpdateCredentials,
  [switch]$Once,
  [string]$RestoreTo
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
$appRoot = Split-Path $PSScriptRoot -Parent
$backupRoot = [System.IO.Path]::GetFullPath($DataDirectory)
if ($backupRoot.StartsWith('\\')) { throw 'Use a local NTFS disk, not a network share.' }
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
# NTFS permissions protect restored plaintext data. DPAPI protects credentials/key.
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
& icacls.exe $backupRoot '/inheritance:r' '/grant:r' ('*' + $identity.Value + ':(OI)(CI)F') | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Backup directory permissions could not be set.' }
$allowed = @($identity.Value, 'S-1-5-18', 'S-1-5-32-544')
foreach ($rule in (Get-Acl -LiteralPath $backupRoot).Access) {
  if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -notin $allowed) { throw 'Backup directory grants access to another user. Choose a new private directory.' }
}
$secretPath = Join-Path $backupRoot 'credentials.clixml'
if ($Setup -or !(Test-Path -LiteralPath $secretPath)) {
  if (Test-Path -LiteralPath $secretPath) { throw 'Existing key must be preserved. Do not overwrite credentials.clixml.' }
  $credential = Get-Credential -Message 'AKBEL website administrator login (not your Windows password)'
  if (!$credential) { throw 'Setup cancelled.' }
  $randomKey = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($randomKey)
  $rng.Dispose()
  $protectedKey = ConvertTo-SecureString ([Convert]::ToBase64String($randomKey)) -AsPlainText -Force
  [pscustomobject]@{ Credential = $credential; Key = $protectedKey } | Export-Clixml -LiteralPath $secretPath
}
$settings = Import-Clixml -LiteralPath $secretPath
if ($UpdateCredentials) {
  $replacement = Get-Credential -UserName $settings.Credential.UserName -Message 'Updated AKBEL administrator credentials'
  if (!$replacement) { throw 'Credential update cancelled.' }
  $settings.Credential = $replacement
  $settings | Export-Clixml -LiteralPath $secretPath
}
$env:AKBEL_BACKUP_USERNAME = $settings.Credential.UserName
$env:AKBEL_BACKUP_PASSWORD = $settings.Credential.GetNetworkCredential().Password
$env:AKBEL_BACKUP_KEY = ([pscredential]::new('backup-key', $settings.Key)).GetNetworkCredential().Password
$env:AKBEL_BACKUP_DIRECTORY = $backupRoot
$env:AKBEL_BACKUP_SOURCE = 'https://akbelim.com'
$agentArgs = @((Join-Path $PSScriptRoot 'backup-agent.mjs'))
if ($RestoreTo) {
  $restorePath = [System.IO.Path]::GetFullPath($RestoreTo)
  if (!$restorePath.StartsWith($backupRoot.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'RestoreTo must be a NEW subdirectory of the protected backup folder.' }
  $agentArgs += @('--restore', $restorePath)
}
elseif ($Once) { $agentArgs += '--once' }
else { $agentArgs += '--standby' }
try {
  Write-Host "Backup folder: $backupRoot"
  Write-Host 'Keep this window running. Standby is read-only; public automatic failover is not configured.'
  & node @agentArgs
  if ($LASTEXITCODE -ne 0) { throw "Backup agent exited with code $LASTEXITCODE" }
} finally {
  Remove-Item Env:AKBEL_BACKUP_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:AKBEL_BACKUP_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:AKBEL_BACKUP_USERNAME -ErrorAction SilentlyContinue
}
