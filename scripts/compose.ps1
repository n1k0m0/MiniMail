param(
    [switch]$Vpn,
    [switch]$GeoIp,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$DockerArgs
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $projectRoot '.env'
if (-not (Test-Path -LiteralPath $envFile)) { throw 'Create .env first; see scripts/install.ps1.' }
$composeArgs = @('compose', '--project-directory', $projectRoot, '--env-file', $envFile, '-f', (Join-Path $projectRoot 'compose.yaml'))
if ($Vpn) { $composeArgs += @('-f', (Join-Path $projectRoot 'compose.vpn.yaml')) }
if ($GeoIp) { $composeArgs += @('-f', (Join-Path $projectRoot 'compose.geoip.yaml')) }
& docker @composeArgs @DockerArgs
exit $LASTEXITCODE
