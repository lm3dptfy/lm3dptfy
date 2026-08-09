# Registers the MooseClaw dashboard update tasks in Windows Task Scheduler.
# Run this once (as the logged-in user, rcamo) to install/update the schedule.

$repoRoot = "C:\Users\rcamo\Documents\Claude\lm3dptfy"

$dailyAction = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$repoRoot\scripts\daily-update.ps1`""
$dailyTrigger = New-ScheduledTaskTrigger -Daily -At "2:00AM"
$dailySettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Hours 1)

Register-ScheduledTask -TaskName "MooseClaw Dashboard - Daily Update" `
    -Action $dailyAction -Trigger $dailyTrigger -Settings $dailySettings `
    -Description "Runs Claude Code headlessly to research and update the MooseClaw dashboard (public/dashboard.html) and push the change." `
    -Force

$weeklyAction = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$repoRoot\scripts\weekly-update.ps1`""
$weeklyTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At "1:00AM"
$weeklySettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Hours 1)

Register-ScheduledTask -TaskName "MooseClaw Dashboard - Weekly Update" `
    -Action $weeklyAction -Trigger $weeklyTrigger -Settings $weeklySettings `
    -Description "Sunday-only: runs the daily update plus a weekly digest of the past 7 days' dashboard changes." `
    -Force

Write-Output "Registered both scheduled tasks. Verify with: Get-ScheduledTask -TaskName 'MooseClaw*'"
