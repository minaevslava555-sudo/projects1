#Requires -Version 5.1
<#
.SYNOPSIS
  Restore a HAVENLY custom-format dump into a NEW empty LOCAL PostgreSQL database.

.DESCRIPTION
  Does NOT connect to Supabase (TEST or Production). Aborts if the target
  database name already exists. Never drops pre-existing databases.

  Uses masked SecureString password input and libpq PGPASSWORD (process env only;
  password never on argv). Clears PG* in finally.

.PARAMETER DumpPath
  Path to a verified .dump (e.g. TEST backup under C:\backups\havenly\test\...).

.PARAMETER PgBinDir
  PostgreSQL bin directory (psql, pg_restore, pg_isready, createdb).

.PARAMETER HostName
  Local server host. Default: 127.0.0.1 (localhost / ::1 also allowed).

.PARAMETER Port
  Local server port. Default: 5432

.PARAMETER UserName
  Local role used to create DB + restore. Default: postgres

.PARAMETER MaintenanceDatabase
  Existing local DB used only for existence checks. Default: postgres

.EXAMPLE
  .\scripts\backup\Invoke-HavenlyLocalRestoreDrill.ps1 `
    -DumpPath "C:\backups\havenly\test\20261114-174629\havenly-avyerjnzfsqgaascltqi-20261114-174629.dump" `
    -PgBinDir "C:\Program Files\PostgreSQL\17\bin"
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string] $DumpPath,

  [string] $PgBinDir = 'C:\Program Files\PostgreSQL\17\bin',

  [string] $HostName = '127.0.0.1',

  [string] $Port = '5432',

  [string] $UserName = 'postgres',

  [string] $MaintenanceDatabase = 'postgres'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$common = Join-Path $PSScriptRoot 'HavenlyBackupCommon.ps1'
. $common
$native = Join-Path $PSScriptRoot 'HavenlyNativeCommand.ps1'
. $native
$drillHelpers = Join-Path $PSScriptRoot 'HavenlyLocalRestoreDrillHelpers.ps1'
. $drillHelpers

function Resolve-HavenlyLocalPgBin {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Name,
    [Parameter(Mandatory = $true)]
    [string] $BinDir
  )
  $candidate = Join-Path $BinDir "$Name.exe"
  if (-not (Test-Path -LiteralPath $candidate)) {
    throw "FAIL: $Name not found under $BinDir"
  }
  return (Resolve-Path -LiteralPath $candidate).Path
}

function Assert-HavenlyLocalOnlyHost {
  param([string] $HostValue)
  $h = $HostValue.Trim().ToLowerInvariant()
  if ($h -match 'supabase\.co$' -or $h -match 'supabase\.com$' -or $h -match 'pooler\.supabase') {
    throw 'FAIL: host looks like Supabase. This drill is LOCAL PostgreSQL only.'
  }
  if ($h -notin @('127.0.0.1', 'localhost', '::1')) {
    throw @"
FAIL: refusing non-local host '$HostValue'.
Allowed: 127.0.0.1, localhost, ::1.
"@
  }
}

function Set-HavenlyLocalLibpqEnv {
  param(
    [string] $HostName,
    [string] $Port,
    [string] $UserName,
    [string] $Password,
    [string] $Database
  )
  $env:PGHOST = $HostName
  $env:PGPORT = $Port
  $env:PGUSER = $UserName
  $env:PGPASSWORD = $Password
  $env:PGDATABASE = $Database
  Remove-Item Env:PGSSLMODE -ErrorAction SilentlyContinue
}

Assert-HavenlyLocalOnlyHost -HostValue $HostName

if (-not (Test-Path -LiteralPath $DumpPath)) {
  throw "FAIL: dump not found: $DumpPath"
}

Test-HavenlySha256Sidecar -FilePath $DumpPath | Out-Null

$pgIsReady = Resolve-HavenlyLocalPgBin -Name 'pg_isready' -BinDir $PgBinDir
$psql = Resolve-HavenlyLocalPgBin -Name 'psql' -BinDir $PgBinDir
$pgRestore = Resolve-HavenlyLocalPgBin -Name 'pg_restore' -BinDir $PgBinDir
$createdb = Resolve-HavenlyLocalPgBin -Name 'createdb' -BinDir $PgBinDir

$stamp = Get-Date -Format 'yyyyMMddHHmmss'
$suffix = ([Guid]::NewGuid().ToString('n')).Substring(0, 8)
$drillDb = "havenly_restore_drill_{0}_{1}" -f $stamp, $suffix

Write-Host 'HAVENLY — LOCAL restore drill (not Supabase)'
Write-Host ("Dump:     {0}" -f $DumpPath)
Write-Host ("Server:   {0}:{1}" -f $HostName, $Port)
Write-Host ("User:     {0}" -f $UserName)
Write-Host ("New DB:   {0}" -f $drillDb)
Write-Host ("Maint DB: {0}" -f $MaintenanceDatabase)
Write-Host ''

$ready = Invoke-HavenlyNativeCommand -FilePath $pgIsReady -Arguments @('-h', $HostName, '-p', $Port)
if ($ready.ExitCode -ne 0) {
  throw @"
FAIL: local PostgreSQL server is not accepting connections on ${HostName}:${Port}.
pg_isready: $($ready.Text)

Prerequisite: install and start a local PostgreSQL 17 *server* (data directory + Windows service).
This workstation has client tools at $PgBinDir but readiness review found no local server/service/port listener.
Do not point this drill at Supabase.
"@
}

$secure = Read-Host "Local PostgreSQL password for user '$UserName'" -AsSecureString
if (-not $secure -or $secure.Length -le 0) {
  throw 'FAIL: empty password.'
}

$plain = $null
$prevPg = @{}
foreach ($k in @('PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'PGSSLMODE')) {
  $prevPg[$k] = [Environment]::GetEnvironmentVariable($k, 'Process')
}

try {
  $plain = ConvertFrom-HavenlySecureString -SecureString $secure
  Set-HavenlyLocalLibpqEnv -HostName $HostName -Port $Port -UserName $UserName -Password $plain -Database $MaintenanceDatabase

  # Existence check — abort if name already exists (never DROP).
  $existsSql = "SELECT 1 FROM pg_database WHERE datname = '$drillDb';"
  $exists = Invoke-HavenlyNativeCommand -FilePath $psql -Arguments @(
    '-v', 'ON_ERROR_STOP=1', '-w', '-tAc', $existsSql
  )
  if ($exists.ExitCode -ne 0) {
    throw "FAIL: could not query pg_database (server up? password correct?). Details: $($exists.Text)"
  }
  if ($exists.Text.Trim() -eq '1') {
    throw "FAIL: database '$drillDb' already exists. Refusing to overwrite or drop it."
  }

  Write-Host "Creating empty database $drillDb ..."
  # -w: never prompt; password from PGPASSWORD only (not argv).
  $create = Invoke-HavenlyNativeCommand -FilePath $createdb -Arguments @('-w', $drillDb)
  if ($create.Text) { Write-Host $create.Text }
  if ($create.ExitCode -ne 0) {
    throw "FAIL: createdb exited with code $($create.ExitCode). $($create.Text)"
  }

  # Fresh DBs include an empty default "public" schema; dumps often contain CREATE SCHEMA public.
  # Reset public ONLY after proving we are on this invocation's drill DB (never maintenance/pre-existing).
  Write-Host 'Preparing drill DB public schema for restore ...'
  Set-HavenlyLocalLibpqEnv -HostName $HostName -Port $Port -UserName $UserName -Password $plain -Database $drillDb

  $idCheck = Invoke-HavenlyNativeCommand -FilePath $psql -Arguments @(
    '-v', 'ON_ERROR_STOP=1', '-w', '-tAc',
    'SELECT current_database();'
  )
  if ($idCheck.ExitCode -ne 0) {
    throw "FAIL: could not read current_database() on drill DB. $($idCheck.Text)"
  }
  $currentDb = $idCheck.Text.Trim()

  $tblCountCheck = Invoke-HavenlyNativeCommand -FilePath $psql -Arguments @(
    '-v', 'ON_ERROR_STOP=1', '-w', '-tAc',
    "SELECT count(*)::int FROM pg_tables WHERE schemaname = 'public';"
  )
  if ($tblCountCheck.ExitCode -ne 0) {
    throw "FAIL: could not count public tables on drill DB. $($tblCountCheck.Text)"
  }
  $publicTableCount = 0
  $parsedCount = 0
  if (-not [int]::TryParse($tblCountCheck.Text.Trim(), [ref]$parsedCount)) {
    throw "FAIL: unexpected public table count response: $($tblCountCheck.Text)"
  }
  $publicTableCount = $parsedCount

  Assert-HavenlyLocalDrillSafeToResetPublicSchema `
    -ExpectedDrillDatabase $drillDb `
    -CurrentDatabase $currentDb `
    -MaintenanceDatabase $MaintenanceDatabase `
    -PublicTableCount $publicTableCount

  # Safe: identity checks passed; empty public only. Dump will CREATE SCHEMA public.
  $dropPublic = Invoke-HavenlyNativeCommand -FilePath $psql -Arguments @(
    '-v', 'ON_ERROR_STOP=1', '-w', '-c',
    'DROP SCHEMA public CASCADE;'
  )
  if ($dropPublic.ExitCode -ne 0) {
    throw "FAIL: DROP SCHEMA public on drill DB failed. $($dropPublic.Text)"
  }
  if ($dropPublic.Text) { Write-Host $dropPublic.Text }

  # Stub Supabase RLS roles on LOCAL cluster only (cluster-wide; remain after dropdb).
  # Preserve POLICY TOC entries — do not skip them. Never ALTER existing elevated roles.
  Write-Host 'Ensuring local stub roles anon/authenticated (NOLOGIN, no elevated privileges) ...'
  Assert-HavenlyLocalRoleOpsEndpoint -HostName $HostName -Port $Port

  $roleQuery = @'
SELECT rolname || '|' || rolcanlogin || '|' || rolsuper || '|' || rolcreatedb || '|' || rolcreaterole || '|' || rolreplication || '|' || rolinherit
FROM pg_roles
WHERE rolname IN ('anon', 'authenticated')
ORDER BY 1;
'@
  $roleLookup = Invoke-HavenlyNativeCommand -FilePath $psql -Arguments @(
    '-v', 'ON_ERROR_STOP=1', '-w', '-tAc', $roleQuery
  )
  if ($roleLookup.ExitCode -ne 0) {
    throw "FAIL: could not query pg_roles for stub roles. $($roleLookup.Text)"
  }
  $existingRoles = @(ConvertFrom-HavenlyPgRolesTsv -Text $roleLookup.Text)
  $existingMap = @{}
  foreach ($r in $existingRoles) {
    $existingMap[$r.RoleName] = $r
  }

  foreach ($roleName in @(Get-HavenlyLocalStubRoleNames)) {
    if ($existingMap.ContainsKey($roleName)) {
      $er = $existingMap[$roleName]
      Assert-HavenlyLocalStubRoleAttributes `
        -RoleName $roleName `
        -RolCanLogin $er.RolCanLogin `
        -RolSuper $er.RolSuper `
        -RolCreateDb $er.RolCreateDb `
        -RolCreateRole $er.RolCreateRole `
        -RolReplication $er.RolReplication `
        -RolInherit $er.RolInherit
      Write-Host ("  role {0}: exists with safe attributes (left unchanged)" -f $roleName)
    }
    else {
      $createSql = New-HavenlyLocalStubRoleCreateSql -RoleName $roleName
      $createRole = Invoke-HavenlyNativeCommand -FilePath $psql -Arguments @(
        '-v', 'ON_ERROR_STOP=1', '-w', '-c', $createSql
      )
      if ($createRole.ExitCode -ne 0) {
        throw "FAIL: CREATE ROLE $roleName failed. $($createRole.Text)"
      }
      Write-Host ("  role {0}: created (NOLOGIN, no elevated privileges)" -f $roleName)
    }
  }
  Write-Host 'Note: stub roles are cluster-wide and remain after this drill database is dropped.'

  Write-Host 'Restoring (--single-transaction --exit-on-error --no-owner --no-acl) ...'
  # Still on drill DB via PG*. --dbname is the database NAME only (not a URI).
  # Verbose progress on stderr must not abort under ErrorAction Stop (see HavenlyNativeCommand.ps1).
  # RLS POLICY objects are restored (not excluded). ACLs/owners omitted by design.
  $restore = Invoke-HavenlyNativeCommand -FilePath $pgRestore -Arguments @(
    "--dbname=$drillDb",
    '--no-owner',
    '--no-acl',
    '--single-transaction',
    '--exit-on-error',
    '--verbose',
    $DumpPath
  )
  foreach ($line in @($restore.Lines)) {
    if (-not [string]::IsNullOrWhiteSpace($line)) { Write-Host $line }
  }
  if ($restore.ExitCode -ne 0) {
    throw "FAIL: pg_restore exited with code $($restore.ExitCode) (with --single-transaction, failed TX should roll back)."
  }

  Write-Host 'Verifying public tables ...'
  $tables = Invoke-HavenlyNativeCommand -FilePath $psql -Arguments @(
    '-v', 'ON_ERROR_STOP=1', '-w', '-tAc',
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1;"
  )
  if ($tables.ExitCode -ne 0) {
    throw "FAIL: table verification query failed: $($tables.Text)"
  }
  $tablesRaw = $tables.Text.Trim()
  if ([string]::IsNullOrWhiteSpace($tablesRaw)) {
    throw 'FAIL: restore reported success but public schema has no tables.'
  }

  $tableList = @(
    $tablesRaw -split '\r?\n' |
      Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
      ForEach-Object { $_.Trim() }
  )
  Write-Host ("public tables ({0}):" -f @($tableList).Length)
  foreach ($t in $tableList) {
    Write-Host ("  - {0}" -f $t)
  }

  $hints = @('projects1_orders', 'projects1_services')
  $found = @($hints | Where-Object { $tableList -contains $_ })
  if (@($found).Length -eq 0) {
    Write-Host 'WARNING: neither projects1_orders nor projects1_services found — inspect manually.'
  }
  else {
    Write-Host ("HAVENLY table hint(s) present: {0}" -f ($found -join ', '))
  }

  Write-Host ''
  Write-Host 'RESULT: OK — local restore drill succeeded.'
  Write-Host ("Drill database left for inspection: {0}" -f $drillDb)
  Write-Host 'This script never drops databases. Optional cleanup (local only, after review):'
  Write-Host ("  & `"$PgBinDir\dropdb.exe`" -h $HostName -p $Port -U $UserName -w $drillDb")
  exit 0
}
finally {
  $plain = $null
  foreach ($k in @('PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'PGSSLMODE')) {
    $prev = $prevPg[$k]
    if ($null -eq $prev -or $prev -eq '') {
      Remove-Item -Path "Env:$k" -ErrorAction SilentlyContinue
    }
    else {
      Set-Item -Path "Env:$k" -Value $prev
    }
  }
  if ($secure) { $secure.Dispose() }
}
