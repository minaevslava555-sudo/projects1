#Requires -Version 5.1
<#
.SYNOPSIS
  Create a logical pg_dump of HAVENLY Production or disposable TEST.

.DESCRIPTION
  Fail-closed on Supabase project identity (approved host + consistent ref).
  Authenticates via process-scoped PG* environment variables — password and
  full URI never appear on the pg_dump command line.
  Writes custom-format dump + SHA-256 sidecar + MANIFEST.txt under
  C:\backups\havenly\ (outside the git repo) by default, with NTFS ACL
  restricted to the current Windows user (not encryption at rest).

  -Interactive is TEST-only: Session pooler fields + masked SecureString password.
  Prefer interactive TEST entry so a password-bearing URI is never constructed.

.PARAMETER Target
  Production or Test.

.PARAMETER Interactive
  TEST-only. Prompt for Session pooler host/port/user/database and masked password.

.PARAMETER BackupRoot
  Directory outside the repository. Default: C:\backups\havenly

.PARAMETER IncludeSchemas
  Schemas to dump. Default: public only.

.PARAMETER PgBinDir
  Optional PostgreSQL bin directory.

.EXAMPLE
  .\scripts\backup\Invoke-HavenlyPgDump.ps1 -Target Test -Interactive -PgBinDir 'C:\Program Files\PostgreSQL\17\bin'
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Production', 'Test')]
  [string] $Target,

  [switch] $Interactive,

  [string] $BackupRoot,

  [string[]] $IncludeSchemas = @('public'),

  [string] $PgBinDir
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$common = Join-Path $PSScriptRoot 'HavenlyBackupCommon.ps1'
. $common

if (-not $BackupRoot) {
  $BackupRoot = Get-HavenlyDefaultBackupRoot
}

if ($Interactive -and $Target -ne 'Test') {
  throw 'FAIL: -Interactive is allowed only with -Target Test. Production interactive entry is disabled.'
}

$conn = $null
$cred = $null
$authMode = 'env-uri'

try {
  if ($Interactive) {
    $authMode = 'interactive-session-pooler'
    $conn = Read-HavenlyInteractiveTestConnection
    $cred = @{
      Connection  = $conn
      EnvVarName  = $null
      ExpectedRef = (Get-HavenlyTestProjectRef)
      Target      = 'Test'
      RedactedUrl = $conn.RedactedUrl
      ProjectRef  = $conn.ProjectRef
    }
    Assert-HavenlyTestOnlyRestoreTarget -CredentialInfo $cred
  }
  else {
    $cred = Get-HavenlyBackupDatabaseUrlFromEnv -Target $Target
    $conn = $cred.Connection
  }

  $pgDump = Resolve-HavenlyPgCommand -Name 'pg_dump' -PgBinDir $PgBinDir
  $pgDumpVer = Get-HavenlyToolVersionLine -ExePath $pgDump

  $run = New-HavenlyBackupRunDirectory -BackupRoot $BackupRoot -Target $Target -ProjectRef $cred.ProjectRef
  $fileName = 'havenly-{0}-{1}.dump' -f $cred.ProjectRef, $run.Stamp
  $dumpPath = Join-Path $run.Directory $fileName

  Write-Host 'HAVENLY — pg_dump (logical backup)'
  Write-Host ("Target:         {0}" -f $Target)
  Write-Host ("Project ref:    {0}" -f $cred.ProjectRef)
  Write-Host ("Host kind:      {0}" -f $conn.HostKind)
  Write-Host ("Identity:       {0}" -f $cred.RedactedUrl)
  Write-Host ("Auth mode:      {0}" -f $authMode)
  Write-Host ("Schemas:        {0}" -f ($IncludeSchemas -join ', '))
  Write-Host ("Output:         {0}" -f $dumpPath)
  Write-Host ("pg_dump:        {0}" -f $pgDumpVer)
  Write-Host 'Auth: PG* process env (password not on argv; cleared in finally)'
  Write-Host ''

  $dumpArgs = @(
    '--format=custom',
    '--no-owner',
    '--no-acl',
    '--verbose',
    '--file', $dumpPath
  )
  foreach ($schema in $IncludeSchemas) {
    if ([string]::IsNullOrWhiteSpace($schema)) { continue }
    $dumpArgs += @('--schema', $schema.Trim())
  }

  $exitCode = Invoke-HavenlyLibpqCommand -ExePath $pgDump -Connection $conn -Arguments $dumpArgs
  if ($exitCode -ne 0) {
    throw "FAIL: pg_dump exited with code $exitCode"
  }

  $item = Get-Item -LiteralPath $dumpPath
  if ($item.Length -le 0) {
    throw 'FAIL: dump file is empty.'
  }

  Restrict-HavenlySensitivePath -Path $dumpPath
  $hashInfo = Write-HavenlySha256Sidecar -FilePath $dumpPath

  $manifestPath = Join-Path $run.Directory 'MANIFEST.txt'
  $manifest = @"
HAVENLY logical backup manifest
===============================
created_utc:        $([DateTime]::UtcNow.ToString('o'))
target:             $Target
project_ref:        $($cred.ProjectRef)
host_kind:          $($conn.HostKind)
identity_redacted:  $($cred.RedactedUrl)
auth_mode:          $authMode
schemas:            $($IncludeSchemas -join ', ')
dump_file:          $fileName
dump_bytes:         $($hashInfo.Bytes)
sha256:             $($hashInfo.Hash)
pg_dump:            $pgDumpVer
flags:              --format=custom --no-owner --no-acl
auth:               libpq PG* process env (no URI/password on argv)
acl:                NTFS restricted to current Windows user (NOT encryption at rest)
notes:
  - Keep outside git (see docs/SUPABASE_FREE_BACKUP_RESTORE.md).
  - Default schema coverage is public only; auth/storage/extensions/roles incomplete.
  - Storage object bytes are NOT included. See docs/SUPABASE_STORAGE_BACKUP_PLAN.md.
  - Not a substitute for verifying Supabase dashboard daily backups / PITR.
"@
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($manifestPath, $manifest.TrimEnd() + [Environment]::NewLine, $utf8)
  Restrict-HavenlySensitivePath -Path $manifestPath

  Write-Host 'RESULT: OK'
  Write-Host ("Dump:     {0}" -f $dumpPath)
  Write-Host ("SHA-256:  {0}" -f $hashInfo.Hash)
  Write-Host ("Manifest: {0}" -f $manifestPath)
  if (-not $Interactive) {
    Write-Host 'Clear Process-scoped database URL when finished (Remove-Item Env:...).'
  }
  exit 0
}
finally {
  Clear-HavenlyConnectionSecrets -Connection $conn
  Clear-HavenlyLibpqProcessEnv
}
