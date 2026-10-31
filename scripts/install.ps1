param([string]$AdminUsername = 'admin')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $projectRoot '.env'
function Protect-EnvFile {
    if (-not [Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([Runtime.InteropServices.OSPlatform]::Windows)) { return }
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $acl = Get-Acl -LiteralPath $envFile
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($rule in @($acl.Access)) { $acl.RemoveAccessRuleSpecific($rule) }
    foreach ($principal in @($sid, 'S-1-5-18', 'S-1-5-32-544')) {
        $identity = [Security.Principal.SecurityIdentifier]::new($principal)
        $rule = [Security.AccessControl.FileSystemAccessRule]::new(
            $identity,
            [Security.AccessControl.FileSystemRights]::FullControl,
            [Security.AccessControl.AccessControlType]::Allow
        )
        $acl.AddAccessRule($rule)
    }
    $file = [IO.FileInfo]::new($envFile)
    if ($file.PSObject.Methods.Name -contains 'SetAccessControl') {
        $file.SetAccessControl($acl)
    } else {
        [IO.FileSystemAclExtensions]::SetAccessControl($file, $acl)
    }
}
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
        $stream.Dispose()
        Protect-EnvFile
        [IO.File]::WriteAllText($envFile, "APP_ENCRYPTION_KEY=$key`n", [Text.UTF8Encoding]::new($false))
    } catch [IO.IOException] {
        if (-not (Test-Path -LiteralPath $envFile)) { throw }
    }
    $key = $null
    Write-Output 'Created .env. Back it up privately with the database.'
}
Protect-EnvFile
$configuredKeys = @([IO.File]::ReadAllLines($envFile) | Where-Object { $_ -cmatch '^APP_ENCRYPTION_KEY=' })
if ($configuredKeys.Count -ne 1 -or $configuredKeys[0] -cnotmatch '^APP_ENCRYPTION_KEY=[a-fA-F0-9]{64}$') { throw 'Set exactly one APP_ENCRYPTION_KEY to 64 hexadecimal characters. Existing keys are never replaced.' }
foreach ($name in @('MYSQL_PASSWORD', 'MYSQL_ROOT_PASSWORD')) {
    $lines = @([IO.File]::ReadAllLines($envFile))
    $matching = @($lines | Where-Object { $_ -cmatch "^${name}=" })
    if ($matching.Count -gt 1) { throw "Duplicate $name in .env" }
    if ($matching.Count -eq 0 -or $matching[0] -cmatch "^${name}=$") {
        $randomBytes = New-Object byte[] 32
        $random = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $random.GetBytes($randomBytes) } finally { $random.Dispose() }
        $password = ([BitConverter]::ToString($randomBytes)).Replace('-', '').ToLowerInvariant()
        $lines = @($lines | Where-Object { $_ -cnotmatch "^${name}=" }) + "${name}=$password"
        [IO.File]::WriteAllLines($envFile, $lines, [Text.UTF8Encoding]::new($false))
        Protect-EnvFile
        $password = $null
    }
}
$baseArgs = @('compose', '--project-directory', $projectRoot, '--env-file', $envFile, '-f', (Join-Path $projectRoot 'compose.yaml'))
& docker @baseArgs build
if ($LASTEXITCODE -ne 0) { throw 'Docker build failed.' }
& docker @baseArgs up -d --wait database
if ($LASTEXITCODE -ne 0) { throw 'MySQL did not become ready.' }
$status = & docker @baseArgs run --rm --no-deps -T minimail node server/install-status.js
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect installation.' }
if ($status.Trim() -eq 'needs-admin') {
    & docker @baseArgs run --rm --no-deps minimail node server/create-admin.js $AdminUsername
    if ($LASTEXITCODE -ne 0) { throw 'Administrator creation failed.' }
}
& docker @baseArgs up -d
if ($LASTEXITCODE -ne 0) { throw 'MiniMail did not start.' }
Write-Output 'MiniMail is listening on http://127.0.0.1:3000. Configure HTTPS for sign-in.'
