#Requires -Version 5.1
<#
.SYNOPSIS
  Shared helpers for HAVENLY Supabase Free backup scripts.
.NOTES
  Dot-source only. Does not connect to any database by itself.
  Never write passwords or full connection URIs to disk or host output.
  libpq auth uses process-scoped PG* environment variables — never argv.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:HavenlyProdProjectRef = 'mwlvxyszksogsyflxvuv'
$script:HavenlyTestProjectRef = 'avyerjnzfsqgaascltqi'
$script:HavenlyDefaultBackupRoot = 'C:\backups\havenly'
$script:HavenlyRepoRootHint = 'C:\projects1'

function Get-HavenlyProdProjectRef { $script:HavenlyProdProjectRef }
function Get-HavenlyTestProjectRef { $script:HavenlyTestProjectRef }
function Get-HavenlyDefaultBackupRoot { $script:HavenlyDefaultBackupRoot }

function Get-HavenlyRedactedDatabaseUrl {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Url
  )

  try {
    $uri = [Uri]$Url
    $userInfo = $uri.UserInfo
    $user = if ($userInfo) { ($userInfo -split ':', 2)[0] } else { '?' }
    $user = [Uri]::UnescapeDataString($user)
    if ($user -match '\.') {
      $user = ($user -split '\.', 2)[0] + '.***'
    }
    $db = $uri.AbsolutePath.TrimStart('/')
    if ([string]::IsNullOrWhiteSpace($db)) { $db = '?' }
    $port = if ($uri.Port -gt 0 -and -not $uri.IsDefaultPort) { ':' + $uri.Port } else { '' }
    # Password always omitted.
    return ('postgresql://{0}@***@{1}{2}/{3}' -f $user, $uri.Host, $port, $db)
  }
  catch {
    return '(redacted)'
  }
}

function Get-HavenlyRedactedConnectionSummary {
  param(
    [Parameter(Mandatory = $true)]
    [string] $HostName,
    [Parameter(Mandatory = $true)]
    [string] $Port,
    [Parameter(Mandatory = $true)]
    [string] $User,
    [Parameter(Mandatory = $true)]
    [string] $Database
  )

  $userDisp = $User
  if ($userDisp -match '\.') {
    $userDisp = ($userDisp -split '\.', 2)[0] + '.***'
  }
  $portPart = if ($Port -and $Port -ne '5432') { ':' + $Port } else { '' }
  return ('postgresql://{0}@***@{1}{2}/{3}' -f $userDisp, $HostName, $portPart, $Database)
}

function ConvertFrom-HavenlySecureString {
  param(
    [Parameter(Mandatory = $true)]
    [System.Security.SecureString] $SecureString
  )

  $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureString)
  try {
    return [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  }
  finally {
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

function Clear-HavenlyLibpqProcessEnv {
  <#
  .SYNOPSIS
    Remove Process-scoped libpq credential env vars (fail-safe cleanup).
  #>
  foreach ($k in @('PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'PGSSLMODE')) {
    Remove-Item -Path "Env:$k" -ErrorAction SilentlyContinue
  }
}

function Clear-HavenlyConnectionSecrets {
  param(
    [hashtable] $Connection
  )

  if ($null -eq $Connection) { return }
  if ($Connection.ContainsKey('Password')) {
    $Connection['Password'] = $null
    $Connection.Remove('Password')
  }
  if ($Connection.ContainsKey('SourceUrl')) {
    $Connection['SourceUrl'] = $null
    $Connection.Remove('SourceUrl')
  }
}

function Get-HavenlyUserRefFromUsername {
  param([string] $User)

  if ([string]::IsNullOrWhiteSpace($User)) { return $null }
  if ($User.StartsWith('postgres.') -and $User.Length -gt 'postgres.'.Length) {
    $ref = $User.Substring('postgres.'.Length).Trim()
    if ($ref -and ($ref -match '^[A-Za-z0-9-]+$')) {
      return $ref
    }
  }
  return $null
}

function Get-HavenlyHostRefFromHostname {
  param([string] $HostName)

  if ([string]::IsNullOrWhiteSpace($HostName)) { return $null }
  $h = $HostName.ToLowerInvariant()
  if ($h -match '^db\.([a-z0-9-]+)\.supabase\.co$') {
    return $Matches[1]
  }
  return $null
}

function Test-HavenlyApprovedSupabaseHostname {
  param(
    [Parameter(Mandatory = $true)]
    [string] $HostName
  )

  $h = $HostName.ToLowerInvariant()
  if ($h -match '^db\.[a-z0-9-]+\.supabase\.co$') {
    return @{ Approved = $true; Kind = 'direct'; HostRef = (Get-HavenlyHostRefFromHostname -HostName $h) }
  }
  # Session / transaction pooler hosts (ref is not in hostname).
  if ($h -match '^(?:[a-z0-9-]+\.)*pooler\.supabase\.com$') {
    return @{ Approved = $true; Kind = 'pooler'; HostRef = $null }
  }
  return @{ Approved = $false; Kind = 'rejected'; HostRef = $null }
}

function Resolve-HavenlyDatabaseConnectionFromParts {
  <#
  .SYNOPSIS
    Validate discrete connection fields. Does not connect. Does not build a password URI.
  #>
  param(
    [Parameter(Mandatory = $true)]
    [string] $HostName,
    [Parameter(Mandatory = $true)]
    [string] $Port,
    [Parameter(Mandatory = $true)]
    [string] $User,
    [Parameter(Mandatory = $true)]
    [string] $Database,
    [Parameter(Mandatory = $true)]
    [string] $Password,
    [Parameter(Mandatory = $true)]
    [string] $ExpectedRef,
    [string] $Context = 'backup',
    [switch] $RequireSessionPoolerForTest
  )

  $hostName = $HostName.Trim()
  $user = $User.Trim()
  $db = $Database.Trim()
  $port = "$Port".Trim()

  if ([string]::IsNullOrWhiteSpace($hostName)) {
    throw "FAIL ($Context): host is required. No database tool was invoked."
  }
  if ([string]::IsNullOrWhiteSpace($user)) {
    throw "FAIL ($Context): username is required. No database tool was invoked."
  }
  if ([string]::IsNullOrWhiteSpace($db)) {
    throw "FAIL ($Context): database name is required. No database tool was invoked."
  }
  if ([string]::IsNullOrWhiteSpace($port) -or ($port -notmatch '^\d+$')) {
    throw "FAIL ($Context): port must be a number. No database tool was invoked."
  }
  if ([string]::IsNullOrEmpty($Password)) {
    throw "FAIL ($Context): password is required. No database tool was invoked."
  }

  $hostInfo = Test-HavenlyApprovedSupabaseHostname -HostName $hostName
  if (-not $hostInfo.Approved) {
    throw @"
FAIL ($Context): host is not an approved Supabase hostname.
Allowed: db.<project-ref>.supabase.co or *.pooler.supabase.com
No database tool was invoked.
"@
  }

  $userRef = Get-HavenlyUserRefFromUsername -User $user
  $hostRef = $hostInfo.HostRef

  if ($hostInfo.Kind -eq 'pooler') {
    if (-not $userRef) {
      throw @"
FAIL ($Context): pooler hosts require username postgres.<project-ref> so the project can be confirmed.
No database tool was invoked.
"@
    }
  }

  if ($hostRef -and $userRef -and ($hostRef -ne $userRef)) {
    throw @"
FAIL ($Context): project ref mismatch between hostname and username.
No database tool was invoked.
"@
  }

  $resolvedRef = if ($hostRef) { $hostRef } elseif ($userRef) { $userRef } else { $null }
  if (-not $resolvedRef) {
    throw @"
FAIL ($Context): cannot resolve project ref (need db.<ref>.supabase.co and/or postgres.<ref>).
No database tool was invoked.
"@
  }

  if ($userRef -and ($userRef -ne $resolvedRef)) {
    throw "FAIL ($Context): username project ref does not match resolved ref. No database tool was invoked."
  }

  if ($resolvedRef -ne $ExpectedRef) {
    throw @"
FAIL ($Context): project ref mismatch (resolved ref does not match expected $ExpectedRef).
No database tool was invoked.
"@
  }

  if ($RequireSessionPoolerForTest) {
    Assert-HavenlySessionPoolerTestIdentity `
      -HostKind $hostInfo.Kind `
      -Port $port `
      -User $user `
      -ProjectRef $resolvedRef `
      -Context $Context
  }

  return @{
    Host        = $hostName
    Port        = $port
    User        = $user
    Password    = $Password
    Database    = $db
    ProjectRef  = $resolvedRef
    HostKind    = $hostInfo.Kind
    ExpectedRef = $ExpectedRef
    RedactedUrl = (Get-HavenlyRedactedConnectionSummary -HostName $hostName -Port $port -User $user -Database $db)
    # Interactive / parts path never materializes a password-bearing URI.
    SourceUrl   = $null
  }
}

function Assert-HavenlySessionPoolerTestIdentity {
  <#
  .SYNOPSIS
    Fail-closed checks for interactive TEST Session-pooler dumps.
  #>
  param(
    [Parameter(Mandatory = $true)]
    [string] $HostKind,
    [Parameter(Mandatory = $true)]
    [string] $Port,
    [Parameter(Mandatory = $true)]
    [string] $User,
    [Parameter(Mandatory = $true)]
    [string] $ProjectRef,
    [string] $Context = 'interactive-test'
  )

  $test = Get-HavenlyTestProjectRef
  $prod = Get-HavenlyProdProjectRef

  if ($ProjectRef -eq $prod) {
    throw "FAIL ($Context): Production project ref is not allowed for interactive TEST entry. No database tool was invoked."
  }
  if ($ProjectRef -ne $test) {
    throw "FAIL ($Context): project ref must be disposable TEST $test. No database tool was invoked."
  }
  if ($HostKind -ne 'pooler') {
    throw @"
FAIL ($Context): interactive TEST entry requires a Session pooler host (*.pooler.supabase.com), not direct db.<ref>.supabase.co.
No database tool was invoked.
"@
  }
  # Supabase Session mode uses 5432 on the pooler; Transaction mode (often 6543) is unsuitable for pg_dump.
  if ($Port -ne '5432') {
    throw @"
FAIL ($Context): Session pooler port must be 5432 (refusing port $Port; transaction pooler is not suitable for pg_dump).
No database tool was invoked.
"@
  }
  $expectedUser = "postgres.$test"
  if ($User -ne $expectedUser) {
    throw @"
FAIL ($Context): username must be exactly $expectedUser for TEST Session pooler.
No database tool was invoked.
"@
  }
}

function Read-HavenlyInteractiveTestConnection {
  <#
  .SYNOPSIS
    Prompt for TEST Session-pooler fields; password via SecureString.
  .NOTES
    Does not connect. Does not write secrets to disk or history as plaintext.
    Returns a Connection hashtable for Invoke-HavenlyLibpqCommand.
  #>
  [CmdletBinding()]
  param()

  $test = Get-HavenlyTestProjectRef
  $prod = Get-HavenlyProdProjectRef
  $defaultUser = "postgres.$test"

  Write-Host 'HAVENLY — interactive TEST credential entry (Session pooler)'
  Write-Host ("Expected project ref: {0}" -f $test)
  Write-Host ("Production ref {0} will be rejected." -f $prod)
  Write-Host 'Enter non-secret fields first. Password is masked and not echoed.'
  Write-Host ''

  $hostName = Read-Host 'Host (*.pooler.supabase.com)'
  $portIn = Read-Host 'Port [5432]'
  $port = if ([string]::IsNullOrWhiteSpace($portIn)) { '5432' } else { $portIn.Trim() }
  $userIn = Read-Host ("Username [{0}]" -f $defaultUser)
  $user = if ([string]::IsNullOrWhiteSpace($userIn)) { $defaultUser } else { $userIn.Trim() }
  $dbIn = Read-Host 'Database [postgres]'
  $db = if ([string]::IsNullOrWhiteSpace($dbIn)) { 'postgres' } else { $dbIn.Trim() }

  Write-Host ''
  Write-Host 'Confirm non-secret connection identity (password not shown):'
  Write-Host ("  host:     {0}" -f $hostName)
  Write-Host ("  port:     {0}" -f $port)
  Write-Host ("  user:     {0}" -f $user)
  Write-Host ("  database: {0}" -f $db)
  Write-Host ("  ref:      {0}" -f $test)
  $confirm = Read-Host 'Type YES to continue'
  if ($confirm -ne 'YES') {
    throw 'FAIL: interactive TEST entry aborted by operator. No database tool was invoked.'
  }

  $secure = Read-Host 'Database password' -AsSecureString
  if (-not $secure -or $secure.Length -le 0) {
    throw 'FAIL: empty password. No database tool was invoked.'
  }

  $plain = $null
  try {
    $plain = ConvertFrom-HavenlySecureString -SecureString $secure
    return (Resolve-HavenlyDatabaseConnectionFromParts `
        -HostName $hostName `
        -Port $port `
        -User $user `
        -Database $db `
        -Password $plain `
        -ExpectedRef $test `
        -Context 'interactive-test' `
        -RequireSessionPoolerForTest)
  }
  finally {
    $plain = $null
    if ($secure) { $secure.Dispose() }
  }
}

function Resolve-HavenlyDatabaseConnection {
  <#
  .SYNOPSIS
    Parse and validate a Supabase Postgres URI. Fail closed on ambiguity.
  .OUTPUTS
    Hashtable with Host, Port, User, Password, Database, ProjectRef, HostKind, RedactedUrl.
    Does not connect.
  #>
  param(
    [Parameter(Mandatory = $true)]
    [string] $Url,
    [Parameter(Mandatory = $true)]
    [string] $ExpectedRef,
    [string] $Context = 'backup'
  )

  if ([string]::IsNullOrWhiteSpace($Url)) {
    throw "FAIL ($Context): empty database URI. No database tool was invoked."
  }

  try {
    $uri = [Uri]$Url.Trim()
  }
  catch {
    throw "FAIL ($Context): URI is not parseable. No database tool was invoked."
  }

  if ($uri.Scheme -notin @('postgresql', 'postgres')) {
    throw "FAIL ($Context): URI scheme must be postgresql/postgres. No database tool was invoked."
  }

  $hostName = $uri.Host
  if ([string]::IsNullOrWhiteSpace($hostName)) {
    throw "FAIL ($Context): URI host is missing. No database tool was invoked."
  }

  $userInfo = $uri.UserInfo
  if ([string]::IsNullOrWhiteSpace($userInfo)) {
    throw "FAIL ($Context): URI userinfo (username/password) is required. No database tool was invoked."
  }

  $parts = $userInfo -split ':', 2
  $user = [Uri]::UnescapeDataString($parts[0])
  $password = if ($parts.Count -gt 1) { [Uri]::UnescapeDataString($parts[1]) } else { '' }
  if ([string]::IsNullOrEmpty($password)) {
    throw "FAIL ($Context): URI password is required (use session env only). No database tool was invoked."
  }

  $db = $uri.AbsolutePath.TrimStart('/')
  if ([string]::IsNullOrWhiteSpace($db)) {
    $db = 'postgres'
  }
  if ($uri.Query -and ($uri.Query -match '(?i)host=|hostaddr=')) {
    throw "FAIL ($Context): URI query must not override host/hostaddr. No database tool was invoked."
  }

  $port = if ($uri.Port -gt 0) { [string]$uri.Port } else { '5432' }

  $conn = Resolve-HavenlyDatabaseConnectionFromParts `
    -HostName $hostName `
    -Port $port `
    -User $user `
    -Database $db `
    -Password $password `
    -ExpectedRef $ExpectedRef `
    -Context $Context

  # Preserve URI-path redaction / SourceUrl for env-based callers only.
  $conn.RedactedUrl = (Get-HavenlyRedactedDatabaseUrl -Url $Url)
  $conn.SourceUrl = $Url
  return $conn
}

function Assert-HavenlyExpectedProjectRef {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Url,
    [Parameter(Mandatory = $true)]
    [string] $ExpectedRef,
    [string] $Context = 'backup'
  )

  $conn = Resolve-HavenlyDatabaseConnection -Url $Url -ExpectedRef $ExpectedRef -Context $Context
  return $conn.ProjectRef
}

function Get-HavenlyBackupDatabaseUrlFromEnv {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Production', 'Test')]
    [string] $Target
  )

  if ($Target -eq 'Production') {
    $name = 'HAVENLY_PROD_DATABASE_URL'
    $expected = Get-HavenlyProdProjectRef
  }
  else {
    $name = 'HAVENLY_PRICING_TEST_DATABASE_URL'
    $expected = Get-HavenlyTestProjectRef
  }

  # Process scope ONLY — no User/Machine fallback (stale secrets / wrong target).
  $url = [Environment]::GetEnvironmentVariable($name, 'Process')
  if ([string]::IsNullOrWhiteSpace($url)) {
    throw "FAIL: set Process-scoped env $name for -Target $Target (session only; do not commit). No database tool was invoked."
  }

  $conn = Resolve-HavenlyDatabaseConnection -Url $url.Trim() -ExpectedRef $expected -Context "env:$name"
  return @{
    Connection   = $conn
    EnvVarName   = $name
    ExpectedRef  = $expected
    Target       = $Target
    RedactedUrl  = $conn.RedactedUrl
    ProjectRef   = $conn.ProjectRef
  }
}

function Assert-HavenlyTestOnlyRestoreTarget {
  param(
    [Parameter(Mandatory = $true)]
    [hashtable] $CredentialInfo
  )

  $prod = Get-HavenlyProdProjectRef
  $test = Get-HavenlyTestProjectRef

  if ($CredentialInfo.Target -eq 'Production') {
    throw 'FAIL: Production is not a valid restore destination. Restore aborted.'
  }
  if ($CredentialInfo.ExpectedRef -eq $prod -or $CredentialInfo.ProjectRef -eq $prod) {
    throw 'FAIL: URI resolved to Production. Restore aborted. This script is TEST-only.'
  }
  if ($CredentialInfo.ProjectRef -ne $test -or $CredentialInfo.ExpectedRef -ne $test) {
    throw 'FAIL: restore target is not the disposable TEST project. Restore aborted.'
  }
}

function Resolve-HavenlyPgCommand {
  param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('pg_dump', 'pg_restore', 'psql')]
    [string] $Name,
    [string] $PgBinDir
  )

  if ($PgBinDir) {
    $candidate = Join-Path $PgBinDir "$Name.exe"
    if (-not (Test-Path -LiteralPath $candidate)) {
      throw "FAIL: $Name not found under -PgBinDir: $PgBinDir"
    }
    return (Resolve-Path -LiteralPath $candidate).Path
  }

  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $cmd) {
    throw "FAIL: $Name not found on PATH. Install PostgreSQL client tools or pass -PgBinDir. See docs/SUPABASE_FREE_BACKUP_RESTORE.md."
  }
  return $cmd.Source
}

function Get-HavenlyToolVersionLine {
  param(
    [Parameter(Mandatory = $true)]
    [string] $ExePath
  )

  $out = & $ExePath --version 2>&1 | Out-String
  return ($out.Trim() -replace '\s+', ' ')
}

function Invoke-HavenlyLibpqCommand {
  <#
  .SYNOPSIS
    Run pg_dump / pg_restore / psql with connection details in PG* env vars only.
  .NOTES
    Never places password or full URI on the process command line.
    Restores prior PG* process env values in finally (or removes if previously unset).
  #>
  param(
    [Parameter(Mandatory = $true)]
    [string] $ExePath,
    [Parameter(Mandatory = $true)]
    [hashtable] $Connection,
    [Parameter(Mandatory = $true)]
    [string[]] $Arguments
  )

  foreach ($a in $Arguments) {
    if ($null -eq $a) { continue }
    $s = [string]$a
    # Reject URI-shaped argv first so credential-bearing URIs are classified as URI
    # leaks (not merely "password in args"). Password check still applies to non-URIs.
    if ($s -match '(?i)^postgres(ql)?://') {
      throw 'FAIL: refusing to invoke libpq tool with a postgresql URI argument.'
    }
    if ($Connection.ContainsKey('SourceUrl') -and $Connection.SourceUrl -and ($s -eq $Connection.SourceUrl)) {
      throw 'FAIL: refusing to invoke libpq tool with full database URI in arguments.'
    }
    if ($Connection.Password -and $s.Contains($Connection.Password)) {
      throw 'FAIL: refusing to invoke libpq tool with password present in arguments.'
    }
  }

  $keys = @('PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'PGSSLMODE')
  $previous = @{}
  foreach ($k in $keys) {
    $previous[$k] = [Environment]::GetEnvironmentVariable($k, 'Process')
  }

  try {
    $env:PGHOST = $Connection.Host
    $env:PGPORT = $Connection.Port
    $env:PGUSER = $Connection.User
    $env:PGPASSWORD = $Connection.Password
    $env:PGDATABASE = $Connection.Database
    $env:PGSSLMODE = 'require'

    & $ExePath @Arguments
    return $LASTEXITCODE
  }
  finally {
    foreach ($k in $keys) {
      $prev = $previous[$k]
      if ($null -eq $prev -or $prev -eq '') {
        Remove-Item -Path "Env:$k" -ErrorAction SilentlyContinue
      }
      else {
        Set-Item -Path "Env:$k" -Value $prev
      }
    }
  }
}

function Restrict-HavenlySensitivePath {
  <#
  .SYNOPSIS
    Restrict a file or directory DACL to the current Windows user only (fail closed).
  .NOTES
    Modifies Access (DACL) only via GetAccessControl/SetAccessControl so a normal
    user does not need SeSecurityPrivilege (avoids rewriting owner/SACL).
    NTFS ACLs are not encryption at rest.
  #>
  param(
    [Parameter(Mandatory = $true)]
    [string] $Path
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    throw "FAIL: cannot restrict ACL; path missing: $Path"
  }

  $current = [System.Security.Principal.WindowsIdentity]::GetCurrent()
  if (-not $current -or -not $current.User) {
    throw 'FAIL: cannot determine current Windows user SID for ACL restriction.'
  }
  $userSid = $current.User

  try {
    $item = Get-Item -LiteralPath $Path
    $isDir = [bool]$item.PSIsContainer
    # Access section only — preserve owner and SACL; do not require SeSecurityPrivilege.
    $sections = [System.Security.AccessControl.AccessControlSections]::Access
    $acl = $item.GetAccessControl($sections)

    # Break inheritance; do not copy inherited ACEs (ancestors must not keep access).
    $acl.SetAccessRuleProtection($true, $false)

    foreach ($existing in @($acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))) {
      [void]$acl.RemoveAccessRule($existing)
    }

    $rights = [System.Security.AccessControl.FileSystemRights]::FullControl
    $inherit = if ($isDir) {
      [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
      [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
    }
    else {
      [System.Security.AccessControl.InheritanceFlags]::None
    }
    $propagate = [System.Security.AccessControl.PropagationFlags]::None
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
      $userSid,
      $rights,
      $inherit,
      $propagate,
      ([System.Security.AccessControl.AccessControlType]::Allow)
    )
    $acl.AddAccessRule($rule)
    $item.SetAccessControl($acl)
  }
  catch {
    throw "FAIL: could not apply restrictive ACL on $Path. $($_.Exception.Message)"
  }

  Assert-HavenlySensitivePathRestricted -Path $Path -ExpectedUserSid $userSid
}

function Assert-HavenlySensitivePathRestricted {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Path,
    [Parameter(Mandatory = $true)]
    [System.Security.Principal.SecurityIdentifier] $ExpectedUserSid
  )

  $item = Get-Item -LiteralPath $Path
  $sections = [System.Security.AccessControl.AccessControlSections]::Access
  $acl = $item.GetAccessControl($sections)

  if (-not $acl.AreAccessRulesProtected) {
    throw "FAIL: ACL verification failed — inheritance still enabled on $Path"
  }

  # Inherited ACEs must be gone so open ancestors cannot keep access on this object.
  $inherited = @(
    $acl.GetAccessRules($false, $true, [System.Security.Principal.SecurityIdentifier])
  )
  if (@($inherited).Length -gt 0) {
    throw "FAIL: ACL verification failed — inherited access rules remain on $Path"
  }

  # Explicit rules only (PS 5.1: always wrap before Length).
  $access = @(
    $acl.GetAccessRules($true, $false, [System.Security.Principal.SecurityIdentifier])
  )
  if (@($access).Length -eq 0) {
    throw "FAIL: ACL verification failed — no explicit access rules on $Path"
  }

  foreach ($rule in @($access)) {
    if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) {
      throw "FAIL: ACL verification failed — unexpected non-Allow rule on $Path"
    }
    if ($rule.IdentityReference.Value -ne $ExpectedUserSid.Value) {
      throw @"
FAIL: ACL verification failed — principal other than current user has access on $Path.
Filesystem ACL restriction did not meet fail-closed policy.
"@
    }
  }
}

function Write-HavenlySha256Sidecar {
  param(
    [Parameter(Mandatory = $true)]
    [string] $FilePath
  )

  $hash = Get-FileHash -LiteralPath $FilePath -Algorithm SHA256
  $sidecar = "$FilePath.sha256"
  $line = '{0}  {1}' -f $hash.Hash.ToLowerInvariant(), (Split-Path -Leaf $FilePath)
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($sidecar, $line + [Environment]::NewLine, $utf8)
  Restrict-HavenlySensitivePath -Path $sidecar
  return @{
    Hash    = $hash.Hash.ToLowerInvariant()
    Sidecar = $sidecar
    Bytes   = (Get-Item -LiteralPath $FilePath).Length
  }
}

function Test-HavenlySha256Sidecar {
  param(
    [Parameter(Mandatory = $true)]
    [string] $FilePath
  )

  $sidecar = "$FilePath.sha256"
  if (-not (Test-Path -LiteralPath $sidecar)) {
    throw "FAIL: missing SHA-256 sidecar: $sidecar"
  }

  $raw = (Get-Content -LiteralPath $sidecar -Raw).Trim()
  if ($raw -notmatch '^([A-Fa-f0-9]{64})\s+(.+)$') {
    throw 'FAIL: could not parse SHA-256 sidecar format.'
  }
  $expected = $Matches[1].ToLowerInvariant()
  $actual = (Get-FileHash -LiteralPath $FilePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($expected -ne $actual) {
    throw 'FAIL: SHA-256 mismatch for dump file (sidecar does not match file bytes).'
  }
  return $actual
}

function New-HavenlyBackupRunDirectory {
  param(
    [Parameter(Mandatory = $true)]
    [string] $BackupRoot,
    [Parameter(Mandatory = $true)]
    [ValidateSet('Production', 'Test')]
    [string] $Target,
    [Parameter(Mandatory = $true)]
    [string] $ProjectRef
  )

  $repoHint = $script:HavenlyRepoRootHint
  $fullRoot = [System.IO.Path]::GetFullPath($BackupRoot)
  $fullRepo = [System.IO.Path]::GetFullPath($repoHint)
  if ($fullRoot.StartsWith($fullRepo, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw @"
FAIL: backup root must be outside the git repository ($repoHint).
Use $script:HavenlyDefaultBackupRoot (or another non-repo path). Refusing to write dumps inside the project tree.
"@
  }

  # Shared backup root: restrict only when newly created. Re-ACL of a pre-existing
  # root every run is unnecessary and can fail on locked/system descriptors.
  # Protection of dump contents relies on the run directory + artifact DACLs
  # (inheritance disabled so open ancestors cannot keep access).
  if (-not (Test-Path -LiteralPath $fullRoot)) {
    New-Item -ItemType Directory -Path $fullRoot -Force | Out-Null
    Restrict-HavenlySensitivePath -Path $fullRoot
  }

  $targetRoot = Join-Path $fullRoot $Target.ToLowerInvariant()
  if (-not (Test-Path -LiteralPath $targetRoot)) {
    New-Item -ItemType Directory -Path $targetRoot -Force | Out-Null
    Restrict-HavenlySensitivePath -Path $targetRoot
  }

  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $dir = Join-Path $targetRoot $stamp
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
  Restrict-HavenlySensitivePath -Path $dir

  return @{
    Directory  = $dir
    Stamp      = $stamp
    ProjectRef = $ProjectRef
  }
}
