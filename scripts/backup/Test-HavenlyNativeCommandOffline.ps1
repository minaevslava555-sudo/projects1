#Requires -Version 5.1
<#
.SYNOPSIS
  Offline regression for Invoke-HavenlyNativeCommand (PowerShell 5.1 stderr).

.DESCRIPTION
  Does not connect to any database. Uses cmd.exe to emit stderr with exit 0 / 1
  under $ErrorActionPreference Stop.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$native = Join-Path $PSScriptRoot 'HavenlyNativeCommand.ps1'
. $native

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

Write-Host 'HAVENLY — native command stderr offline tests (no database)'
Write-Host ''

# Under Stop, naive 2>&1 would throw NativeCommandError on stderr.
# Helper must survive stderr + exit 0.
try {
  $r0 = Invoke-HavenlyNativeCommand -FilePath 'cmd.exe' -Arguments @(
    '/c', 'echo progress-on-stderr 1>&2 & exit /b 0'
  )
  Write-CaseResult -Name 'stderr + exit 0 does not throw under Stop' -Ok $true
  Write-CaseResult -Name 'stderr + exit 0 reports ExitCode 0' -Ok ($r0.ExitCode -eq 0)
  Write-CaseResult -Name 'stderr + exit 0 captures diagnostic text' -Ok ($r0.Text -match 'progress-on-stderr')
}
catch {
  Write-CaseResult -Name 'stderr + exit 0 does not throw under Stop' -Ok $false -Detail $_.Exception.Message
  Write-CaseResult -Name 'stderr + exit 0 reports ExitCode 0' -Ok $false -Detail 'skipped after throw'
  Write-CaseResult -Name 'stderr + exit 0 captures diagnostic text' -Ok $false -Detail 'skipped after throw'
}

# Nonzero exit must be visible (caller fails closed on ExitCode).
try {
  $r1 = Invoke-HavenlyNativeCommand -FilePath 'cmd.exe' -Arguments @(
    '/c', 'echo failure-on-stderr 1>&2 & exit /b 1'
  )
  Write-CaseResult -Name 'stderr + exit 1 does not throw under Stop' -Ok $true
  Write-CaseResult -Name 'stderr + exit 1 reports ExitCode 1' -Ok ($r1.ExitCode -eq 1)
  Write-CaseResult -Name 'stderr + exit 1 captures diagnostic text' -Ok (
    $r1.Text -match 'failure-on-stderr'
  )
}
catch {
  Write-CaseResult -Name 'stderr + exit 1 does not throw under Stop' -Ok $false -Detail $_.Exception.Message
  Write-CaseResult -Name 'stderr + exit 1 reports ExitCode 1' -Ok $false -Detail 'skipped after throw'
  Write-CaseResult -Name 'stderr + exit 1 captures diagnostic text' -Ok $false -Detail 'skipped after throw'
}

# Preference restored after helper (Stop still in effect for subsequent throw).
try {
  $null = Invoke-HavenlyNativeCommand -FilePath 'cmd.exe' -Arguments @('/c', 'exit /b 0')
  $ErrorActionPreference = 'Stop'
  try {
    Write-Error 'forced-error-for-eap-check' -ErrorAction Stop
    Write-CaseResult -Name 'ErrorActionPreference still Stop after helper' -Ok $false -Detail 'Write-Error did not throw'
  }
  catch {
    Write-CaseResult -Name 'ErrorActionPreference still Stop after helper' -Ok (
      $_.Exception.Message -match 'forced-error-for-eap-check' -or $_.ToString() -match 'forced-error-for-eap-check'
    )
  }
}
catch {
  Write-CaseResult -Name 'ErrorActionPreference still Stop after helper' -Ok $false -Detail $_.Exception.Message
}

Write-Host ''
Write-Host ("RESULT: {0} passed, {1} failed" -f $script:PassCount, $script:FailCount)
if ($script:FailCount -gt 0) { exit 1 }
Write-Host 'Native command offline validation OK.'
exit 0
