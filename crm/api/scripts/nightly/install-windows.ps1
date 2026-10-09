# ***************************************************
# * THE NIGHTLY RUN ON WINDOWS: one scheduled task, 02:00 every day
# ***************************************************
# The Mac runs scripts/nightly/run.sh from launchd; this is the same script
# from Task Scheduler, through Git Bash. Run once, from crm/api:
#
#   powershell -ExecutionPolicy Bypass -File scripts\nightly\install-windows.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\nightly\install-windows.ps1 -Remove
#
# Reports land in %USERPROFILE%\diane-nightly\<date>\report.md, and
# latest.md beside them. The PC must be on (asleep is fine: it wakes it).
param([switch]$Remove, [string]$At = '02:00')

$name = 'Diane nightly'
if ($Remove) {
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
  Write-Output "Removed '$name'."
  exit 0
}

$bash = 'C:\Program Files\Git\bin\bash.exe'
if (-not (Test-Path $bash)) { Write-Error "Git Bash not found at $bash"; exit 1 }
$script = (Resolve-Path (Join-Path $PSScriptRoot 'run.sh')).Path -replace '\\', '/'

$action = New-ScheduledTaskAction -Execute $bash -Argument "-lc `"'$script'`""
$trigger = New-ScheduledTaskTrigger -Daily -At $At
# Wakes the PC for it, runs when it can if 02:00 was missed, and never two at once.
$settings = New-ScheduledTaskSettingsSet -WakeToRun -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 6)
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Description 'Diane and the expense bot: every suite, scored and compared with the night before. See crm/api/scripts/nightly/run.sh.' -Force | Out-Null
Write-Output "Registered '$name' for $At daily. Reports: $env:USERPROFILE\diane-nightly"
