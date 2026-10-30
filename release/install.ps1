param([string]$Root = $PSScriptRoot, [string]$AdminUsername = 'admin')
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'minimail.exe') install --bundle $PSScriptRoot --root $Root --admin $AdminUsername
exit $LASTEXITCODE
