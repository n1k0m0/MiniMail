$ErrorActionPreference = 'Stop'
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('minimail-install-' + [Guid]::NewGuid().ToString('N'))
$fixture = Join-Path $testRoot 'project with spaces'
New-Item -ItemType Directory -Path (Join-Path $fixture 'scripts') -Force | Out-Null
$testLog = Join-Path $testRoot 'docker.log'
function global:docker {
    [IO.File]::AppendAllText($testLog, ($args -join '|') + "`n")
    $global:LASTEXITCODE = 0
    if (($args -join ' ') -like '*server/install-status.js*') { 'configured' }
}
try {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot '../scripts/install.ps1') -Destination (Join-Path $fixture 'scripts/install.ps1')
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot '../compose.yaml') -Destination (Join-Path $fixture 'compose.yaml')
    & (Join-Path $fixture 'scripts/install.ps1') -AdminUsername test-admin
    $before = [IO.File]::ReadAllText((Join-Path $fixture '.env'))
    & (Join-Path $fixture 'scripts/install.ps1') -AdminUsername test-admin
    $after = [IO.File]::ReadAllText((Join-Path $fixture '.env'))
    if ($before -ne $after -or $after -notmatch '(?m)^APP_ENCRYPTION_KEY=[a-f0-9]{64}\r?$' -or $after -notmatch '(?m)^MYSQL_PASSWORD=[a-f0-9]{64}\r?$' -or $after -notmatch '(?m)^MYSQL_ROOT_PASSWORD=[a-f0-9]{64}\r?$') { throw 'Existing encryption key was not preserved.' }
    if ([Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([Runtime.InteropServices.OSPlatform]::Windows)) {
        $envPath = Join-Path $fixture '.env'
        & icacls $envPath '/grant' '*S-1-1-0:R' | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not create ACL regression fixture.' }
        & (Join-Path $fixture 'scripts/install.ps1') -AdminUsername test-admin
        $acl = Get-Acl -LiteralPath $envPath
        $allowed = @([Security.Principal.WindowsIdentity]::GetCurrent().User.Value, 'S-1-5-18', 'S-1-5-32-544')
        $identities = @($acl.Access | ForEach-Object { $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value })
        if (-not $acl.AreAccessRulesProtected -or @($identities | Where-Object { $_ -notin $allowed }).Count) { throw 'The installer did not remove broad .env access.' }
    }
    [IO.File]::AppendAllText((Join-Path $fixture '.env'), "APP_ENCRYPTION_KEY=invalid`n")
    $rejected = $false
    try { & (Join-Path $fixture 'scripts/install.ps1') -AdminUsername test-admin } catch { $rejected = $true }
    if (-not $rejected) { throw 'Duplicate encryption keys must be rejected.' }
    [IO.File]::WriteAllText((Join-Path $fixture '.env'), $before)
    if ([IO.File]::ReadAllText($testLog) -like '*server/create-admin.js*') { throw 'Existing administrator was recreated.' }
    Write-Output 'PowerShell installer tests passed.'
} finally {
    Remove-Item Function:\docker -ErrorAction SilentlyContinue
    # .NET also removes Unix dotfiles without prompting; directories are deleted
    # only when empty, so unexpected fixture contents cannot be removed silently.
    foreach ($file in @((Join-Path $fixture '.env'), (Join-Path $fixture 'compose.yaml'), (Join-Path $fixture 'scripts/install.ps1'), $testLog)) {
        [IO.File]::Delete($file)
    }
    foreach ($directory in @((Join-Path $fixture 'scripts'), $fixture, $testRoot)) {
        [IO.Directory]::Delete($directory)
    }
}
