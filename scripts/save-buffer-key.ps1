$ErrorActionPreference = 'Stop'
$secretDirectory = Join-Path (Split-Path $PSScriptRoot -Parent) '.secrets'
New-Item -ItemType Directory -Force -Path $secretDirectory | Out-Null
$secretPath = Join-Path $secretDirectory 'buffer-api-key'
$secret = Read-Host 'Buffer API Key (hidden input)' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try {
  $plainText = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  if ([string]::IsNullOrWhiteSpace($plainText)) { throw 'Empty key' }
  [IO.File]::WriteAllText($secretPath, $plainText.Trim(), [Text.UTF8Encoding]::new($false))
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  $acl = [Security.AccessControl.FileSecurity]::new()
  $acl.SetOwner([Security.Principal.NTAccount]::new($identity))
  $acl.SetAccessRuleProtection($true, $false)
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($identity, 'FullControl', 'Allow'))
  Set-Acl -LiteralPath $secretPath -AclObject $acl
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  $plainText = $null
  $secret.Dispose()
}
Write-Host 'Saved locally. The key was not printed or sent to GitHub.'
