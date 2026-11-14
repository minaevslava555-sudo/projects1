#Requires -Version 5.1
<#
.SYNOPSIS
  Run a native executable under Windows PowerShell 5.1 without treating
  informational stderr as a terminating error when $ErrorActionPreference is Stop.

.NOTES
  PostgreSQL tools (pg_restore --verbose, etc.) write progress to stderr.
  With 2>&1 and ErrorAction Stop, those lines become NativeCommandError and abort.
  Success/failure must be decided by the process exit code only.
#>

Set-StrictMode -Version Latest

function ConvertTo-HavenlyNativeOutputText {
  param([object] $Item)
  if ($null -eq $Item) { return '' }
  if ($Item -is [System.Management.Automation.ErrorRecord]) {
    return [string]$Item.ToString()
  }
  return [string]$Item
}

function Invoke-HavenlyNativeCommand {
  <#
  .SYNOPSIS
    Invoke a native command; capture stdout+stderr; return ExitCode + text lines.
  .OUTPUTS
    Hashtable: ExitCode (int), Lines (string[]), Text (string)
  #>
  param(
    [Parameter(Mandatory = $true)]
    [string] $FilePath,

    [Parameter(Mandatory = $false)]
    [string[]] $Arguments = @()
  )

  $prevEap = $ErrorActionPreference
  # Continue: stderr merged via 2>&1 must not become terminating NativeCommandError.
  $ErrorActionPreference = 'Continue'
  try {
    $raw = & $FilePath @Arguments 2>&1
    $code = $LASTEXITCODE
    if ($null -eq $code) {
      $code = 0
    }
    $lines = @(
      @($raw) | ForEach-Object { ConvertTo-HavenlyNativeOutputText -Item $_ } |
        Where-Object { $null -ne $_ }
    )
    return @{
      ExitCode = [int]$code
      Lines    = $lines
      Text     = (($lines -join [Environment]::NewLine).TrimEnd())
    }
  }
  finally {
    $ErrorActionPreference = $prevEap
  }
}
