param([string]$AdminUsername = 'admin')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $projectRoot '.env'
Get-Command docker -ErrorAction Stop | Out-Null
& docker compose version
if ($LASTEXITCODE -ne 0) { throw 'Install Docker Compose v2 first.' }
if (-not (Test-Path -LiteralPath $envFile)) {
    $randomBytes = New-Object byte[] 32
    $random = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $random.GetBytes($randomBytes) } finally { $random.Dispose() }
    $key = ([BitConverter]::ToString($randomBytes)).Replace('-', '').ToLowerInvariant()
    try {
        $stream = [IO.File]::Open($envFile, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        try {
            $bytes = [Text.Encoding]::UTF8.GetBytes("APP_ENCRYPTION_KEY=$key`n")
            $stream.Write($bytes, 0, $bytes.Length)
        } finally { $stream.Dispose() }
    } catch [IO.IOException] {
        if (-not (Test-Path -LiteralPath $envFile)) { throw }
    }
    $key = $null
    Write-Output 'Created .env. Back it up privately with the database; restrict its Windows file permissions.'
}
$configuredKeys = @([IO.File]::ReadAllLines($envFile) | Where-Object { $_ -cmatch '^APP_ENCRYPTION_KEY=[a-fA-F0-9]{64}$' })
if ($configuredKeys.Count -ne 1) { throw 'Set APP_ENCRYPTION_KEY to exactly 64 hexadecimal characters. Existing keys are never replaced.' }
$baseArgs = @('compose', '--project-directory', $projectRoot, '--env-file', $envFile, '-f', (Join-Path $projectRoot 'compose.yaml'))
& docker @baseArgs build
if ($LASTEXITCODE -ne 0) { throw 'Docker build failed.' }
$status = & docker @baseArgs run --rm --no-deps -T minimail node server/install-status.js
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect installation.' }
if ($status.Trim() -eq 'needs-admin') {
    & docker @baseArgs run --rm --no-deps minimail node server/create-admin.js $AdminUsername
    if ($LASTEXITCODE -ne 0) { throw 'Administrator creation failed.' }
}
& docker @baseArgs up -d
if ($LASTEXITCODE -ne 0) { throw 'MiniMail did not start.' }
Write-Output 'MiniMail is listening on http://127.0.0.1:3000. Configure HTTPS before remote access.'
