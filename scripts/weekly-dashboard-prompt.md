# MooseClaw Dashboard — Weekly Update (Sunday)

This is the **weekly** run (Sundays only). Do everything the daily update does — read and follow `scripts/daily-dashboard-prompt.md` in full first, and complete all of it.

Then, additionally, produce a **weekly digest**:

## Weekly digest

1. Run `git log --oneline --since="7 days ago" -- public/dashboard.html` to see this week's daily commits.
2. For each, `git show <hash> --stat` (and the full diff if needed) to see what actually changed that day.
3. Write a concise digest — 5-10 bullet points covering the week's most significant changes: new tool versions released, security advisories that appeared or resolved, and major news items. Skip routine "no change" days.
4. Find the panel with `id="weekly-digest-body"` in `public/dashboard.html`. If it doesn't exist yet, create a new panel following the exact same HTML/CSS structure as the other panels (copy the pattern from an existing `<div class="panel">` block), titled "This Week" with an appropriate icon, placed near the top of the dashboard (right after the versions panel), with `<div id="weekly-digest-body">` as its content container.
5. Replace the weekly-digest-body content with this week's digest (a simple list, dated, e.g. "Week of Aug 3-9, 2026"). Keep only the current week's digest — this section shows the most recent week, not a running history.

## Commit

Commit with message `chore: weekly dashboard digest [bot] — <Month D 2026>` (in addition to, or combined with, the daily commit — use your judgment based on whether the daily update already committed separately in this same run).
