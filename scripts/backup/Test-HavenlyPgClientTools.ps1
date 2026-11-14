#Requires -Version 5.1
<#
.SYNOPSIS
  Verify PostgreSQL client tools are installed (no database connection).

.DESCRIPTION
  Checks for pg_dump, pg_restore, and psql on PATH or under -PgBinDir.
  Does not read credentials and does not connect to Supabase.

.PARAMETER PgBinDir
  Optional folder containing pg_dump.exe / pg_restore.exe / psql.exe.

.EXAMPLE
  .\scripts\backup\Test-HavenlyPgClientTools.ps1
#>
[CmdletBinding()]
param(
  [string] $PgBinDir
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$common = Join-Path $PSScriptRoot 'HavenlyBackupCommon.ps1'
. $common

$tools = @('pg_dump', 'pg_restore', 'psql')
$ok = $true

Write-Host 'HAVENLY — PostgreSQL client tools check (offline)'
Write-Host 'No database connection will be attempted.'
Write-Host ''

foreach ($name in $tools) {
  try {
    $path = Resolve-HavenlyPgCommand -Name $name -PgBinDir $PgBinDir
    $ver = Get-HavenlyToolVersionLine -ExePath $path
    Write-Host "OK  $name"
    Write-Host "    path: $path"
    Write-Host "    version: $ver"
  }
  catch {
    $ok = $false
    Write-Host "FAIL  $name"
    Write-Host "    $($_.Exception.Message)"
  }
  Write-Host ''
}

if (-not $ok) {
  Write-Host 'RESULT: FAIL — install PostgreSQL client tools, then re-run this script.'
  Write-Host 'See docs/SUPABASE_FREE_BACKUP_RESTORE.md §1.1'
  exit 1
}

Write-Host 'RESULT: OK — client tools present. Next: owner-approved dump via Invoke-HavenlyPgDump.ps1'
exit 0
