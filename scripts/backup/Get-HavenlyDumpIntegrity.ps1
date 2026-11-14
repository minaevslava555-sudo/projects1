#Requires -Version 5.1
<#
.SYNOPSIS
  Verify a HAVENLY pg_dump file locally (no database connection required).

.DESCRIPTION
  Checks non-zero size, SHA-256 sidecar match, and optionally that
  pg_restore --list can read the custom-format archive.

.PARAMETER DumpPath
  Path to the .dump file.

.PARAMETER SkipList
  If set, skip pg_restore --list (SHA-256 + size only).

.PARAMETER PgBinDir
  Optional PostgreSQL bin directory.

.EXAMPLE
  .\scripts\backup\Get-HavenlyDumpIntegrity.ps1 -DumpPath C:\backups\havenly\production\...\file.dump
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string] $DumpPath,

  [switch] $SkipList,

  [string] $PgBinDir
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$common = Join-Path $PSScriptRoot 'HavenlyBackupCommon.ps1'
. $common

if (-not (Test-Path -LiteralPath $DumpPath)) {
  throw "FAIL: dump not found: $DumpPath"
}

$item = Get-Item -LiteralPath $DumpPath
Write-Host 'HAVENLY — dump integrity (offline)'
Write-Host ("File:  {0}" -f $item.FullName)
Write-Host ("Bytes: {0}" -f $item.Length)

if ($item.Length -le 0) {
  throw 'FAIL: dump file is empty.'
}

$hash = Test-HavenlySha256Sidecar -FilePath $item.FullName
Write-Host ("SHA-256: OK ({0})" -f $hash)

if (-not $SkipList) {
  $pgRestore = Resolve-HavenlyPgCommand -Name 'pg_restore' -PgBinDir $PgBinDir
  $listOut = & $pgRestore --list $item.FullName 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "FAIL: pg_restore --list exited with code $LASTEXITCODE"
  }
  $lines = @($listOut | Where-Object { $_ -and ($_ -notmatch '^\s*;') })
  Write-Host ("pg_restore --list: OK ({0} TOC lines)" -f $lines.Count)
}
else {
  Write-Host 'pg_restore --list: skipped (-SkipList)'
}

Write-Host 'RESULT: OK'
exit 0
