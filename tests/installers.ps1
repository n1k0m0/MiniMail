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
