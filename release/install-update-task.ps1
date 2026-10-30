param([string]$Root = $PSScriptRoot)
$ErrorActionPreference = 'Stop'
$resolvedRoot = (Resolve-Path -LiteralPath $Root).Path
$config = Get-Content -LiteralPath (Join-Path $resolvedRoot '.minimail/config.json') -Raw | ConvertFrom-Json
if ($config.project -notmatch '^[a-z0-9][a-z0-9_-]{0,62}$') { throw 'Invalid Compose project identity.' }
$executable = Join-Path $resolvedRoot '.minimail/bin/minimail.exe'
if (-not (Test-Path -LiteralPath $executable)) { throw 'Install or adopt MiniMail first.' }
$arguments = 'cycle --root "' + $resolvedRoot + '"'
$name = 'MiniMail-Update-' + $config.project
$existing = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
if ($existing -and ($existing.Actions.Execute -ne $executable -or $existing.Actions.Arguments -ne $arguments)) { throw 'A different scheduled task already uses this name; it was preserved.' }
$action = New-ScheduledTaskAction -Execute $executable -Argument $arguments
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Hours 1)
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Principal $principal -Description 'MiniMail verified release checks and interrupted-update recovery' -Force | Out-Null
Write-Output ('Update checks scheduled for the current Docker Desktop user. Current policy: ' + $config.mode)
