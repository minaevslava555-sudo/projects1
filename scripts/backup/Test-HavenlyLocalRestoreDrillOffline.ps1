#Requires -Version 5.1
<#
.SYNOPSIS
  Offline tests for local restore drill public-schema reset safety (no DB I/O).
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'HavenlyLocalRestoreDrillHelpers.ps1')

$script:PassCount = 0
$script:FailCount = 0

function Write-CaseResult {
  param([string] $Name, [bool] $Ok, [string] $Detail = '')
  if ($Ok) {
    $script:PassCount++
    Write-Host "PASS  $Name"
  }
  else {
    $script:FailCount++
    Write-Host "FAIL  $Name"
    if ($Detail) { Write-Host "      $Detail" }
  }
}

function Assert-Throws {
  param([string] $Name, [scriptblock] $Block, [string] $MessageMustContain = $null)
  try {
    & $Block | Out-Null
    Write-CaseResult -Name $Name -Ok $false -Detail 'expected throw'
  }
  catch {
    $msg = $_.Exception.Message
    if ($MessageMustContain -and ($msg -notlike "*$MessageMustContain*")) {
      Write-CaseResult -Name $Name -Ok $false -Detail "missing '$MessageMustContain' in: $msg"
      return
    }
    Write-CaseResult -Name $Name -Ok $true
  }
}

Write-Host 'HAVENLY — local restore drill safety offline tests (no database)'
Write-Host ''

$good = 'havenly_restore_drill_20261114183000_abcd1234'

Write-CaseResult -Name 'accept minted drill database name pattern' -Ok (
  (Test-HavenlyLocalDrillDatabaseName -Name $good)
)
Write-CaseResult -Name 'reject postgres maintenance name' -Ok (
  -not (Test-HavenlyLocalDrillDatabaseName -Name 'postgres')
)
Write-CaseResult -Name 'reject non-drill name' -Ok (
  -not (Test-HavenlyLocalDrillDatabaseName -Name 'havenly_other_db')
)

try {
  Assert-HavenlyLocalDrillSafeToResetPublicSchema `
    -ExpectedDrillDatabase $good `
    -CurrentDatabase $good `
    -MaintenanceDatabase 'postgres' `
    -PublicTableCount 0
  Write-CaseResult -Name 'allow reset when identity matches empty drill DB' -Ok $true
}
catch {
  Write-CaseResult -Name 'allow reset when identity matches empty drill DB' -Ok $false -Detail $_.Exception.Message
}

Assert-Throws -Name 'reject reset when current_database mismatches' -MessageMustContain 'not the drill DB' -Block {
  Assert-HavenlyLocalDrillSafeToResetPublicSchema `
    -ExpectedDrillDatabase $good `
    -CurrentDatabase 'postgres' `
    -PublicTableCount 0
}

Assert-Throws -Name 'reject reset when expected is postgres (not drill-shaped)' -MessageMustContain 'minted' -Block {
  Assert-HavenlyLocalDrillSafeToResetPublicSchema `
    -ExpectedDrillDatabase 'postgres' `
    -CurrentDatabase 'postgres' `
    -PublicTableCount 0
}

Assert-Throws -Name 'reject reset when current is template1' -MessageMustContain 'not the drill DB' -Block {
  Assert-HavenlyLocalDrillSafeToResetPublicSchema `
    -ExpectedDrillDatabase $good `
    -CurrentDatabase 'template1' `
    -PublicTableCount 0
}

Assert-Throws -Name 'reject reset when public already has tables' -MessageMustContain 'table' -Block {
  Assert-HavenlyLocalDrillSafeToResetPublicSchema `
    -ExpectedDrillDatabase $good `
    -CurrentDatabase $good `
    -PublicTableCount 3
}

Assert-Throws -Name 'reject reset when expected name is not drill-shaped' -MessageMustContain 'minted' -Block {
  Assert-HavenlyLocalDrillSafeToResetPublicSchema `
    -ExpectedDrillDatabase 'not_a_drill_db' `
    -CurrentDatabase 'not_a_drill_db' `
    -PublicTableCount 0
}

# --- Stub roles (anon / authenticated) ---
$stubNames = @(Get-HavenlyLocalStubRoleNames)
Write-CaseResult -Name 'stub role allowlist is anon + authenticated only' -Ok (
  ($stubNames -join ',') -eq 'anon,authenticated'
)

try {
  $sqlAnon = New-HavenlyLocalStubRoleCreateSql -RoleName 'anon'
  Write-CaseResult -Name 'CREATE ROLE SQL is NOLOGIN without elevated attrs' -Ok (
    ($sqlAnon -match 'NOLOGIN') -and
    ($sqlAnon -match 'NOSUPERUSER') -and
    ($sqlAnon -match 'NOCREATEDB') -and
    ($sqlAnon -match 'NOCREATEROLE') -and
    ($sqlAnon -match 'NOREPLICATION') -and
    ($sqlAnon -match 'NOINHERIT') -and
    ($sqlAnon -notmatch '\bLOGIN\b')
  )
}
catch {
  Write-CaseResult -Name 'CREATE ROLE SQL is NOLOGIN without elevated attrs' -Ok $false -Detail $_.Exception.Message
}

Assert-Throws -Name 'refuse CREATE SQL for non-allowlisted role' -MessageMustContain 'allowlisted' -Block {
  New-HavenlyLocalStubRoleCreateSql -RoleName 'service_role'
}

try {
  Assert-HavenlyLocalStubRoleAttributes `
    -RoleName 'anon' `
    -RolCanLogin $false `
    -RolSuper $false `
    -RolCreateDb $false `
    -RolCreateRole $false `
    -RolReplication $false `
    -RolInherit $false
  Write-CaseResult -Name 'accept existing stub role with safe attributes' -Ok $true
}
catch {
  Write-CaseResult -Name 'accept existing stub role with safe attributes' -Ok $false -Detail $_.Exception.Message
}

Assert-Throws -Name 'reject existing stub role with LOGIN' -MessageMustContain 'LOGIN' -Block {
  Assert-HavenlyLocalStubRoleAttributes `
    -RoleName 'authenticated' `
    -RolCanLogin $true `
    -RolSuper $false `
    -RolCreateDb $false `
    -RolCreateRole $false `
    -RolReplication $false `
    -RolInherit $false
}

Assert-Throws -Name 'reject existing stub role with SUPERUSER' -MessageMustContain 'SUPERUSER' -Block {
  Assert-HavenlyLocalStubRoleAttributes `
    -RoleName 'anon' `
    -RolCanLogin $false `
    -RolSuper $true `
    -RolCreateDb $false `
    -RolCreateRole $false `
    -RolReplication $false `
    -RolInherit $false
}

Assert-Throws -Name 'role ops require 127.0.0.1' -MessageMustContain '127.0.0.1' -Block {
  Assert-HavenlyLocalRoleOpsEndpoint -HostName 'localhost' -Port '5432'
}

Assert-Throws -Name 'role ops require port 5432' -MessageMustContain '5432' -Block {
  Assert-HavenlyLocalRoleOpsEndpoint -HostName '127.0.0.1' -Port '5433'
}

try {
  Assert-HavenlyLocalRoleOpsEndpoint -HostName '127.0.0.1' -Port '5432'
  Write-CaseResult -Name 'role ops accept 127.0.0.1:5432' -Ok $true
}
catch {
  Write-CaseResult -Name 'role ops accept 127.0.0.1:5432' -Ok $false -Detail $_.Exception.Message
}

try {
  $parsed = @(ConvertFrom-HavenlyPgRolesTsv -Text "anon|f|f|f|f|f|f`nauthenticated|f|f|f|f|f|f")
  Write-CaseResult -Name 'parse pg_roles TSV for two stub roles' -Ok (
    (@($parsed).Length -eq 2) -and ($parsed[0].RoleName -eq 'anon') -and (-not $parsed[0].RolCanLogin)
  )
}
catch {
  Write-CaseResult -Name 'parse pg_roles TSV for two stub roles' -Ok $false -Detail $_.Exception.Message
}

Write-Host ''
Write-Host ("RESULT: {0} passed, {1} failed" -f $script:PassCount, $script:FailCount)
if ($script:FailCount -gt 0) { exit 1 }
Write-Host 'Local restore drill safety offline validation OK.'
exit 0
