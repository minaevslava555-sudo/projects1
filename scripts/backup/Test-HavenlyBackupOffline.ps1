#Requires -Version 5.1
<#
.SYNOPSIS
  Offline validation of backup identity checks and credential redaction.

.DESCRIPTION
  Uses synthetic URIs and passwords only. Does not connect to any database,
  does not read real credentials, and does not invoke pg_dump/pg_restore
  against a server.

.EXAMPLE
  .\scripts\backup\Test-HavenlyBackupOffline.ps1
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$common = Join-Path $PSScriptRoot 'HavenlyBackupCommon.ps1'
. $common

$script:PassCount = 0
$script:FailCount = 0

function Write-CaseResult {
  param(
    [string] $Name,
    [bool] $Ok,
    [string] $Detail = ''
  )
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
  param(
    [string] $Name,
    [scriptblock] $Block,
    [string] $MessageMustContain = $null
  )
  try {
    & $Block | Out-Null
    Write-CaseResult -Name $Name -Ok $false -Detail 'expected throw, but call succeeded'
  }
  catch {
    $msg = $_.Exception.Message
    if ($MessageMustContain -and ($msg -notlike "*$MessageMustContain*")) {
      Write-CaseResult -Name $Name -Ok $false -Detail "throw message missing '$MessageMustContain'"
      return
    }
    Write-CaseResult -Name $Name -Ok $true
  }
}

function Assert-True {
  param([string] $Name, [bool] $Condition, [string] $Detail = '')
  Write-CaseResult -Name $Name -Ok $Condition -Detail $Detail
}

Write-Host 'HAVENLY — offline backup helper validation (synthetic only)'
Write-Host 'No database connections will be attempted.'
Write-Host ''

$prod = Get-HavenlyProdProjectRef
$test = Get-HavenlyTestProjectRef
$synthPass = 'SYNTHETIC_PASSWORD_NOT_REAL_9f3a'
$synthPassEncoded = [Uri]::EscapeDataString($synthPass)

# --- Redaction ---
$rawForRedact = "postgresql://postgres.${prod}:${synthPass}@db.${prod}.supabase.co:5432/postgres"
$redacted = Get-HavenlyRedactedDatabaseUrl -Url $rawForRedact
Assert-True -Name 'redaction omits synthetic password' -Condition (-not $redacted.Contains($synthPass))
Assert-True -Name 'redaction keeps host' -Condition ($redacted -like "*db.$prod.supabase.co*")
Assert-True -Name 'redaction masks user project suffix' -Condition ($redacted -like 'postgresql://postgres.***@***@*')

# --- Accepted identities ---
try {
  $c1 = Resolve-HavenlyDatabaseConnection `
    -Url "postgresql://postgres:${synthPassEncoded}@db.${prod}.supabase.co:5432/postgres" `
    -ExpectedRef $prod `
    -Context 'offline-accept-direct'
  Assert-True -Name 'accept direct host + postgres user' -Condition (
    $c1.ProjectRef -eq $prod -and $c1.HostKind -eq 'direct' -and $c1.Password -eq $synthPass
  )
}
catch {
  Write-CaseResult -Name 'accept direct host + postgres user' -Ok $false -Detail $_.Exception.Message
}

try {
  $c2 = Resolve-HavenlyDatabaseConnection `
    -Url "postgresql://postgres.${test}:${synthPassEncoded}@db.${test}.supabase.co:5432/postgres" `
    -ExpectedRef $test `
    -Context 'offline-accept-direct-userref'
  Assert-True -Name 'accept direct host + matching postgres.ref user' -Condition (
    $c2.ProjectRef -eq $test -and $c2.HostKind -eq 'direct'
  )
}
catch {
  Write-CaseResult -Name 'accept direct host + matching postgres.ref user' -Ok $false -Detail $_.Exception.Message
}

try {
  $c3 = Resolve-HavenlyDatabaseConnection `
    -Url "postgresql://postgres.${test}:${synthPassEncoded}@aws-0-eu-central-1.pooler.supabase.com:6543/postgres" `
    -ExpectedRef $test `
    -Context 'offline-accept-pooler'
  Assert-True -Name 'accept pooler host + postgres.ref user' -Condition (
    $c3.ProjectRef -eq $test -and $c3.HostKind -eq 'pooler'
  )
}
catch {
  Write-CaseResult -Name 'accept pooler host + postgres.ref user' -Ok $false -Detail $_.Exception.Message
}

# --- Rejected identities ---
Assert-Throws -Name 'reject non-Supabase host' -MessageMustContain 'approved Supabase' -Block {
  Resolve-HavenlyDatabaseConnection `
    -Url "postgresql://postgres.${test}:${synthPassEncoded}@evil.example.com:5432/postgres" `
    -ExpectedRef $test `
    -Context 'offline-reject-host'
}

Assert-Throws -Name 'reject pooler without postgres.ref user' -MessageMustContain 'postgres.<project-ref>' -Block {
  Resolve-HavenlyDatabaseConnection `
    -Url "postgresql://postgres:${synthPassEncoded}@aws-0-eu-central-1.pooler.supabase.com:6543/postgres" `
    -ExpectedRef $test `
    -Context 'offline-reject-pooler-user'
}

Assert-Throws -Name 'reject host/user ref mismatch' -MessageMustContain 'mismatch' -Block {
  Resolve-HavenlyDatabaseConnection `
    -Url "postgresql://postgres.${test}:${synthPassEncoded}@db.${prod}.supabase.co:5432/postgres" `
    -ExpectedRef $prod `
    -Context 'offline-reject-mismatch'
}

Assert-Throws -Name 'reject wrong expected ref' -MessageMustContain 'expected' -Block {
  Resolve-HavenlyDatabaseConnection `
    -Url "postgresql://postgres:${synthPassEncoded}@db.${test}.supabase.co:5432/postgres" `
    -ExpectedRef $prod `
    -Context 'offline-reject-expected'
}

Assert-Throws -Name 'reject host override in query' -MessageMustContain 'host' -Block {
  Resolve-HavenlyDatabaseConnection `
    -Url "postgresql://postgres:${synthPassEncoded}@db.${test}.supabase.co:5432/postgres?host=evil.example.com" `
    -ExpectedRef $test `
    -Context 'offline-reject-query-host'
}

Assert-Throws -Name 'reject missing password' -MessageMustContain 'password' -Block {
  Resolve-HavenlyDatabaseConnection `
    -Url "postgresql://postgres@db.${test}.supabase.co:5432/postgres" `
    -ExpectedRef $test `
    -Context 'offline-reject-nopass'
}

# --- Process-scoped env only (do not leave secrets behind) ---
$marker = 'HAVENLY_OFFLINE_TEST_MARKER_URI'
$prevProd = [Environment]::GetEnvironmentVariable('HAVENLY_PROD_DATABASE_URL', 'Process')
try {
  # Ensure User-scope value alone is ignored: we only set Process for the positive path.
  Remove-Item Env:HAVENLY_PROD_DATABASE_URL -ErrorAction SilentlyContinue
  Assert-Throws -Name 'reject missing Process-scoped Production URI' -MessageMustContain 'Process-scoped' -Block {
    Get-HavenlyBackupDatabaseUrlFromEnv -Target Production
  }

  $env:HAVENLY_PROD_DATABASE_URL = "postgresql://postgres:${synthPassEncoded}@db.${prod}.supabase.co:5432/postgres"
  $got = Get-HavenlyBackupDatabaseUrlFromEnv -Target Production
  Assert-True -Name 'accept Process-scoped Production URI' -Condition ($got.ProjectRef -eq $prod)
}
finally {
  if ($null -eq $prevProd -or $prevProd -eq '') {
    Remove-Item Env:HAVENLY_PROD_DATABASE_URL -ErrorAction SilentlyContinue
  }
  else {
    $env:HAVENLY_PROD_DATABASE_URL = $prevProd
  }
}

# --- argv guard (no tool execution against a server) ---
$fakeConn = @{
  Host       = "db.$test.supabase.co"
  Port       = '5432'
  User       = 'postgres'
  Password   = $synthPass
  Database   = 'postgres'
  SourceUrl  = "postgresql://postgres:${synthPass}@db.$test.supabase.co:5432/postgres"
  ProjectRef = $test
}
Assert-Throws -Name 'refuse password in tool arguments' -MessageMustContain 'password' -Block {
  Invoke-HavenlyLibpqCommand -ExePath 'cmd.exe' -Connection $fakeConn -Arguments @('/c', "echo $synthPass")
}
# Credential-bearing URI must be rejected as a URI argv (message contains URI),
# even though the same string also embeds the password.
Assert-Throws -Name 'refuse URI argument to tool' -MessageMustContain 'URI' -Block {
  Invoke-HavenlyLibpqCommand -ExePath 'cmd.exe' -Connection $fakeConn -Arguments @($fakeConn.SourceUrl)
}
# URI without matching Connection.Password still rejected by scheme check.
Assert-Throws -Name 'refuse URI argument without embedded session password' -MessageMustContain 'URI' -Block {
  $uriNoMatchingSecret = "postgresql://postgres@db.$test.supabase.co:5432/postgres"
  Invoke-HavenlyLibpqCommand -ExePath 'cmd.exe' -Connection $fakeConn -Arguments @($uriNoMatchingSecret)
}

# --- TEST-only restore gate ---
Assert-Throws -Name 'restore gate rejects Production credential info' -MessageMustContain 'Production' -Block {
  Assert-HavenlyTestOnlyRestoreTarget -CredentialInfo @{
    Target      = 'Production'
    ExpectedRef = $prod
    ProjectRef  = $prod
  }
}

# --- Interactive TEST Session-pooler parts (synthetic; no Read-Host / no connect) ---
try {
  $cParts = Resolve-HavenlyDatabaseConnectionFromParts `
    -HostName 'aws-0-eu-central-1.pooler.supabase.com' `
    -Port '5432' `
    -User "postgres.$test" `
    -Database 'postgres' `
    -Password $synthPass `
    -ExpectedRef $test `
    -Context 'offline-parts-session' `
    -RequireSessionPoolerForTest
  Assert-True -Name 'accept interactive TEST Session pooler parts' -Condition (
    $cParts.ProjectRef -eq $test -and
    $cParts.HostKind -eq 'pooler' -and
    $null -eq $cParts.SourceUrl -and
    (-not $cParts.RedactedUrl.Contains($synthPass))
  )
}
catch {
  Write-CaseResult -Name 'accept interactive TEST Session pooler parts' -Ok $false -Detail $_.Exception.Message
}

Assert-Throws -Name 'reject interactive parts with Production username/ref' -MessageMustContain 'Production' -Block {
  Resolve-HavenlyDatabaseConnectionFromParts `
    -HostName 'aws-0-eu-central-1.pooler.supabase.com' `
    -Port '5432' `
    -User "postgres.$prod" `
    -Database 'postgres' `
    -Password $synthPass `
    -ExpectedRef $prod `
    -Context 'offline-parts-prod' `
    -RequireSessionPoolerForTest
}

Assert-Throws -Name 'reject Production pooler user when ExpectedRef is TEST' -MessageMustContain 'expected' -Block {
  Resolve-HavenlyDatabaseConnectionFromParts `
    -HostName 'aws-0-eu-central-1.pooler.supabase.com' `
    -Port '5432' `
    -User "postgres.$prod" `
    -Database 'postgres' `
    -Password $synthPass `
    -ExpectedRef $test `
    -Context 'offline-parts-prod-vs-test' `
    -RequireSessionPoolerForTest
}

Assert-Throws -Name 'reject transaction pooler port 6543 for interactive TEST' -MessageMustContain '5432' -Block {
  Resolve-HavenlyDatabaseConnectionFromParts `
    -HostName 'aws-0-eu-central-1.pooler.supabase.com' `
    -Port '6543' `
    -User "postgres.$test" `
    -Database 'postgres' `
    -Password $synthPass `
    -ExpectedRef $test `
    -Context 'offline-parts-txport' `
    -RequireSessionPoolerForTest
}

Assert-Throws -Name 'reject direct host for interactive Session-pooler requirement' -MessageMustContain 'Session pooler' -Block {
  Resolve-HavenlyDatabaseConnectionFromParts `
    -HostName "db.$test.supabase.co" `
    -Port '5432' `
    -User "postgres.$test" `
    -Database 'postgres' `
    -Password $synthPass `
    -ExpectedRef $test `
    -Context 'offline-parts-direct' `
    -RequireSessionPoolerForTest
}

Assert-Throws -Name 'session identity helper rejects Production ref' -MessageMustContain 'Production' -Block {
  Assert-HavenlySessionPoolerTestIdentity `
    -HostKind 'pooler' `
    -Port '5432' `
    -User "postgres.$prod" `
    -ProjectRef $prod `
    -Context 'offline-session-assert'
}

# SecureString conversion (synthetic) — plaintext only in memory for the call
try {
  $ss = ConvertTo-SecureString $synthPass -AsPlainText -Force
  $roundTrip = ConvertFrom-HavenlySecureString -SecureString $ss
  Assert-True -Name 'SecureString round-trip matches synthetic password' -Condition ($roundTrip -eq $synthPass)
  $ss.Dispose()
  $roundTrip = $null
}
catch {
  Write-CaseResult -Name 'SecureString round-trip matches synthetic password' -Ok $false -Detail $_.Exception.Message
}

# --- ACL regression (local filesystem only; non-admin PS 5.1) ---
$tempRoot = Join-Path $env:TEMP ('havenly-backup-offline-' + [Guid]::NewGuid().ToString('n'))
$userSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
try {
  New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

  # Existing directory (created first, then restricted) — DACL-only path.
  $existingDir = Join-Path $tempRoot 'existing-dir'
  New-Item -ItemType Directory -Path $existingDir -Force | Out-Null
  try {
    Restrict-HavenlySensitivePath -Path $existingDir
    Assert-HavenlySensitivePathRestricted -Path $existingDir -ExpectedUserSid $userSid
    Write-CaseResult -Name 'ACL restrict existing directory (DACL-only)' -Ok $true
  }
  catch {
    Write-CaseResult -Name 'ACL restrict existing directory (DACL-only)' -Ok $false -Detail $_.Exception.Message
  }

  # New nested directory under a still-open parent (ancestor must not keep access).
  $openParent = Join-Path $tempRoot 'open-parent'
  New-Item -ItemType Directory -Path $openParent -Force | Out-Null
  $newChild = Join-Path $openParent 'new-child'
  New-Item -ItemType Directory -Path $newChild -Force | Out-Null
  try {
    Restrict-HavenlySensitivePath -Path $newChild
    $childAcl = (Get-Item -LiteralPath $newChild).GetAccessControl(
      [System.Security.AccessControl.AccessControlSections]::Access
    )
    $inheritedLeft = @(
      $childAcl.GetAccessRules($false, $true, [System.Security.Principal.SecurityIdentifier])
    )
    Assert-True -Name 'ACL new directory breaks inheritance from open ancestor' -Condition (
      $childAcl.AreAccessRulesProtected -and (@($inheritedLeft).Length -eq 0)
    )
  }
  catch {
    Write-CaseResult -Name 'ACL new directory breaks inheritance from open ancestor' -Ok $false -Detail $_.Exception.Message
  }

  # File artifact
  $tempFile = Join-Path $tempRoot 'sample.txt'
  Set-Content -LiteralPath $tempFile -Value 'synthetic-not-customer-data' -Encoding UTF8
  try {
    Restrict-HavenlySensitivePath -Path $tempFile
    Assert-HavenlySensitivePathRestricted -Path $tempFile -ExpectedUserSid $userSid
    $acl = (Get-Item -LiteralPath $tempFile).GetAccessControl(
      [System.Security.AccessControl.AccessControlSections]::Access
    )
    $rules = @(
      $acl.GetAccessRules($true, $false, [System.Security.Principal.SecurityIdentifier])
    )
    $foreign = @($rules | Where-Object { $_.IdentityReference.Value -ne $userSid.Value })
    Assert-True -Name 'ACL restrict to current user (temp file)' -Condition (
      $acl.AreAccessRulesProtected -and (@($rules).Length -ge 1) -and (@($foreign).Length -eq 0)
    )
  }
  catch {
    Write-CaseResult -Name 'ACL restrict to current user (temp file)' -Ok $false -Detail $_.Exception.Message
  }

  # Fail-closed: foreign Allow ACE must be rejected by verification.
  $foreignFile = Join-Path $tempRoot 'foreign-ace.txt'
  Set-Content -LiteralPath $foreignFile -Value 'synthetic' -Encoding UTF8
  try {
    Restrict-HavenlySensitivePath -Path $foreignFile
    $fItem = Get-Item -LiteralPath $foreignFile
    $fAcl = $fItem.GetAccessControl([System.Security.AccessControl.AccessControlSections]::Access)
    $usersSid = New-Object System.Security.Principal.SecurityIdentifier(
      [System.Security.Principal.WellKnownSidType]::BuiltinUsersSid,
      $null
    )
    $foreignRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
      $usersSid,
      ([System.Security.AccessControl.FileSystemRights]::Read),
      ([System.Security.AccessControl.InheritanceFlags]::None),
      ([System.Security.AccessControl.PropagationFlags]::None),
      ([System.Security.AccessControl.AccessControlType]::Allow)
    )
    $fAcl.AddAccessRule($foreignRule)
    $fItem.SetAccessControl($fAcl)
    Assert-Throws -Name 'ACL verification rejects foreign Allow ACE' -MessageMustContain 'fail-closed' -Block {
      Assert-HavenlySensitivePathRestricted -Path $foreignFile -ExpectedUserSid $userSid
    }
  }
  catch {
    # If setup threw before Assert-Throws, count as failure for this case.
    if ($_.Exception.Message -notlike '*fail-closed*') {
      Write-CaseResult -Name 'ACL verification rejects foreign Allow ACE' -Ok $false -Detail $_.Exception.Message
    }
  }

  # Shared-root behavior: existing ancestor is not re-restricted by run-dir helper;
  # stamp directory is restricted (simulates C:\backups\havenly already present).
  $simRoot = Join-Path $tempRoot 'sim-backups-havenly'
  New-Item -ItemType Directory -Path $simRoot -Force | Out-Null
  try {
    $runInfo = New-HavenlyBackupRunDirectory -BackupRoot $simRoot -Target Test -ProjectRef $test
    Assert-HavenlySensitivePathRestricted -Path $runInfo.Directory -ExpectedUserSid $userSid
    Assert-True -Name 'ACL run directory restricted under pre-existing root' -Condition (
      (Test-Path -LiteralPath $runInfo.Directory)
    )
  }
  catch {
    Write-CaseResult -Name 'ACL run directory restricted under pre-existing root' -Ok $false -Detail $_.Exception.Message
  }
}
catch {
  Write-CaseResult -Name 'ACL regression harness' -Ok $false -Detail $_.Exception.Message
}
finally {
  if (Test-Path -LiteralPath $tempRoot) {
    # Restricted dirs may need current-user delete; ignore cleanup races.
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}

# Production isolation still enforced (identity — unrelated to ACL but required regression).
Assert-Throws -Name 'Production isolation: interactive Session helper rejects Production' -MessageMustContain 'Production' -Block {
  Assert-HavenlySessionPoolerTestIdentity `
    -HostKind 'pooler' `
    -Port '5432' `
    -User "postgres.$prod" `
    -ProjectRef $prod `
    -Context 'offline-acl-prod-isolation'
}

Write-Host ''
Write-Host ("RESULT: {0} passed, {1} failed" -f $script:PassCount, $script:FailCount)
if ($script:FailCount -gt 0) {
  exit 1
}
Write-Host 'Offline validation OK. Do not dump/restore until owner approves a live target.'
exit 0
