#Requires -Version 5.1
<#
.SYNOPSIS
  Pure helpers for LOCAL restore drill safety (no database I/O).
#>

Set-StrictMode -Version Latest

function Test-HavenlyLocalDrillDatabaseName {
  param(
    [Parameter(Mandatory = $true)]
    [AllowEmptyString()]
    [string] $Name
  )
  # Matches names minted by Invoke-HavenlyLocalRestoreDrill.ps1
  return [bool]($Name -match '^havenly_restore_drill_\d{14}_[0-9a-f]{8}$')
}

function Assert-HavenlyLocalDrillSafeToResetPublicSchema {
  <#
  .SYNOPSIS
    Fail-closed checks before DROP SCHEMA public on a brand-new local drill DB.
  .NOTES
    Does not connect. Caller supplies current_database() and public table count.
  #>
  param(
    [Parameter(Mandatory = $true)]
    [string] $ExpectedDrillDatabase,

    [Parameter(Mandatory = $true)]
    [string] $CurrentDatabase,

    [string] $MaintenanceDatabase = 'postgres',

    [int] $PublicTableCount = 0
  )

  $expected = $ExpectedDrillDatabase.Trim()
  $current = $CurrentDatabase.Trim()
  $maint = $MaintenanceDatabase.Trim()

  if (-not (Test-HavenlyLocalDrillDatabaseName -Name $expected)) {
    throw "FAIL: expected drill database name '$expected' is not a havenly_restore_drill_* name minted by this script."
  }
  if ($current -ne $expected) {
    throw @"
FAIL: refusing public-schema reset — connected database '$current' is not the drill DB '$expected' created by this invocation.
"@
  }
  if ($current -eq $maint -or $current -in @('postgres', 'template0', 'template1')) {
    throw "FAIL: refusing public-schema reset on maintenance/system database '$current'."
  }
  if (-not (Test-HavenlyLocalDrillDatabaseName -Name $current)) {
    throw "FAIL: refusing public-schema reset — '$current' is not a local drill database name."
  }
  if ($PublicTableCount -ne 0) {
    throw @"
FAIL: refusing public-schema reset — public already has $PublicTableCount table(s); this is not an empty freshly created drill DB.
"@
  }
}

function Get-HavenlyLocalStubRoleNames {
  # Only roles required for this dump's RLS POLICY ... TO <role> entries.
  return @('anon', 'authenticated')
}

function Assert-HavenlyLocalRoleOpsEndpoint {
  <#
  .SYNOPSIS
    Role stubs are cluster-wide — only allow loopback 127.0.0.1:5432.
  #>
  param(
    [Parameter(Mandatory = $true)]
    [string] $HostName,
    [Parameter(Mandatory = $true)]
    [string] $Port
  )

  if ($HostName.Trim() -ne '127.0.0.1') {
    throw "FAIL: stub role operations require HostName 127.0.0.1 (got '$HostName')."
  }
  if ("$Port".Trim() -ne '5432') {
    throw "FAIL: stub role operations require Port 5432 (got '$Port')."
  }
}

function New-HavenlyLocalStubRoleCreateSql {
  param(
    [Parameter(Mandatory = $true)]
    [string] $RoleName
  )

  $allowed = @(Get-HavenlyLocalStubRoleNames)
  if ($allowed -notcontains $RoleName) {
    throw "FAIL: refusing to create non-allowlisted stub role '$RoleName'."
  }
  # NOLOGIN + no elevated attributes. Idempotency is handled by caller (create only if missing).
  return @"
CREATE ROLE $RoleName NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT;
"@.Trim()
}

function Assert-HavenlyLocalStubRoleAttributes {
  <#
  .SYNOPSIS
    Fail-closed if an existing role has elevated/login privileges.
  .NOTES
    Does not ALTER roles. Caller supplies flags from pg_roles (or synthetic offline values).
  #>
  param(
    [Parameter(Mandatory = $true)]
    [string] $RoleName,

    [Parameter(Mandatory = $true)]
    [bool] $RolCanLogin,

    [Parameter(Mandatory = $true)]
    [bool] $RolSuper,

    [Parameter(Mandatory = $true)]
    [bool] $RolCreateDb,

    [Parameter(Mandatory = $true)]
    [bool] $RolCreateRole,

    [Parameter(Mandatory = $true)]
    [bool] $RolReplication,

    [Parameter(Mandatory = $true)]
    [bool] $RolInherit
  )

  $allowed = @(Get-HavenlyLocalStubRoleNames)
  if ($allowed -notcontains $RoleName) {
    throw "FAIL: refusing to validate non-allowlisted stub role '$RoleName'."
  }

  $problems = @()
  if ($RolCanLogin) { $problems += 'LOGIN' }
  if ($RolSuper) { $problems += 'SUPERUSER' }
  if ($RolCreateDb) { $problems += 'CREATEDB' }
  if ($RolCreateRole) { $problems += 'CREATEROLE' }
  if ($RolReplication) { $problems += 'REPLICATION' }
  if ($RolInherit) { $problems += 'INHERIT' }

  if (@($problems).Length -gt 0) {
    throw @"
FAIL: existing cluster role '$RoleName' has unexpected privileges ($($problems -join ', ')).
Refusing to ALTER it automatically. Fix or rename that role manually, then retry.
"@
  }
}

function ConvertFrom-HavenlyPgRolesTsv {
  <#
  .SYNOPSIS
    Parse psql -tAc rows: rolname|rolcanlogin|rolsuper|rolcreatedb|rolcreaterole|rolreplication|rolinherit
    Booleans as t/f.
  #>
  param(
    [AllowEmptyString()]
    [string] $Text
  )

  $rows = @()
  foreach ($line in @($Text -split '\r?\n')) {
    $trim = $line.Trim()
    if ([string]::IsNullOrWhiteSpace($trim)) { continue }
    $parts = $trim -split '\|'
    if (@($parts).Length -ne 7) {
      throw "FAIL: unexpected pg_roles row format: $trim"
    }
    $toBool = {
      param($v)
      if ($v -eq 't') { return $true }
      if ($v -eq 'f') { return $false }
      throw "FAIL: unexpected boolean '$v' in pg_roles row"
    }
    $rows += @{
      RoleName       = $parts[0]
      RolCanLogin    = (& $toBool $parts[1])
      RolSuper       = (& $toBool $parts[2])
      RolCreateDb    = (& $toBool $parts[3])
      RolCreateRole  = (& $toBool $parts[4])
      RolReplication = (& $toBool $parts[5])
      RolInherit     = (& $toBool $parts[6])
    }
  }
  return $rows
}
