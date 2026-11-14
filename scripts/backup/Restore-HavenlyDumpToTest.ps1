#Requires -Version 5.1
<#
.SYNOPSIS
  Restore a logical dump into the disposable HAVENLY TEST project ONLY.

.DESCRIPTION
  Hard-fails unless:
    - Process-scoped HAVENLY_PRICING_TEST_DATABASE_URL confirms TEST project identity
    - -ConfirmTestProjectRef equals avyerjnzfsqgaascltqi
    - -IUnderstandThisOverwritesTestDatabase is passed

  Explicitly rejects Production as a restore destination.
  Authenticates via PG* process env — password/URI never on pg_restore argv.
  Does not restore Storage object bytes.

.PARAMETER DumpPath
  Path to a custom-format .dump produced by Invoke-HavenlyPgDump.ps1

.PARAMETER ConfirmTestProjectRef
  Must be exactly avyerjnzfsqgaascltqi

.PARAMETER IUnderstandThisOverwritesTestDatabase
  Required acknowledgement switch.

.PARAMETER Clean
  Pass --clean --if-exists to pg_restore (drops restored objects first).
  Still TEST-only. Use with care.

.PARAMETER PgBinDir
  Optional PostgreSQL bin directory.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string] $DumpPath,

  [Parameter(Mandatory = $true)]
  [string] $ConfirmTestProjectRef,

  [Parameter(Mandatory = $true)]
  [switch] $IUnderstandThisOverwritesTestDatabase,

  [switch] $Clean,

  [string] $PgBinDir
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$common = Join-Path $PSScriptRoot 'HavenlyBackupCommon.ps1'
. $common

$expectedTest = Get-HavenlyTestProjectRef
$prodRef = Get-HavenlyProdProjectRef

if (-not $IUnderstandThisOverwritesTestDatabase) {
  throw 'FAIL: refuse restore without -IUnderstandThisOverwritesTestDatabase.'
}

if ($ConfirmTestProjectRef -eq $prodRef) {
  throw 'FAIL: Production project ref is not a valid restore destination. Restore aborted.'
}

if ($ConfirmTestProjectRef -ne $expectedTest) {
  throw "FAIL: -ConfirmTestProjectRef must be exactly $expectedTest. No restore started."
}

if (-not (Test-Path -LiteralPath $DumpPath)) {
  throw "FAIL: dump not found: $DumpPath"
}

Test-HavenlySha256Sidecar -FilePath $DumpPath | Out-Null

# Only TEST credentials are loaded (ValidateSet Target=Test inside helper).
$cred = Get-HavenlyBackupDatabaseUrlFromEnv -Target Test
Assert-HavenlyTestOnlyRestoreTarget -CredentialInfo $cred

$conn = $cred.Connection
$pgRestore = Resolve-HavenlyPgCommand -Name 'pg_restore' -PgBinDir $PgBinDir
$ver = Get-HavenlyToolVersionLine -ExePath $pgRestore

Write-Host 'HAVENLY — pg_restore into disposable TEST ONLY'
Write-Host ("Project ref:    {0}" -f $expectedTest)
Write-Host ("Host kind:      {0}" -f $conn.HostKind)
Write-Host ("URI (redacted): {0}" -f $cred.RedactedUrl)
Write-Host ("Dump:           {0}" -f $DumpPath)
Write-Host ("pg_restore:     {0}" -f $ver)
Write-Host ("Clean objects:  {0}" -f [bool]$Clean)
Write-Host 'Auth: PG* process env (password not on argv)'
Write-Host 'Storage object bytes are NOT restored by this script.'
Write-Host 'Production restore destination: REJECTED by design.'
Write-Host ''

# --dbname is the database NAME only (not a URI). Host/user/password via PG* env.
$restoreArgs = @(
  '--no-owner',
  '--no-acl',
  '--verbose',
  '--dbname', $conn.Database
)
if ($Clean) {
  $restoreArgs += @('--clean', '--if-exists')
}
$restoreArgs += $DumpPath

$exitCode = Invoke-HavenlyLibpqCommand -ExePath $pgRestore -Connection $conn -Arguments $restoreArgs
if ($exitCode -ne 0) {
  throw @"
FAIL: pg_restore exited with code $exitCode.
Partial restores are possible; inspect TEST before trusting the database.
"@
}

Write-Host 'RESULT: OK (pg_restore exit 0)'
Write-Host 'Next: run owner-approved read-only verification SQL on TEST only.'
Write-Host 'Clear Process-scoped HAVENLY_PRICING_TEST_DATABASE_URL when finished.'
exit 0
