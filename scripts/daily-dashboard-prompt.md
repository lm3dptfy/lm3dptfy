# MooseClaw Dashboard — Daily Update

You are updating `public/dashboard.html` in this repo (`lm3dptfy/lm3dptfy`) — the **MooseClaw Dashboard**, a security/version monitoring hub for Claude Code and its ecosystem (Happy, MemPalace, OpenClaw, plugins/skills, MCP).

Follow the **exact existing structure and visual style** already in the file — do not redesign it, only update content. Look at recent git history (`git log --oneline -5`, then `git show <hash>`) for the established pattern before making changes, since the format has been refined over many days of edits.

## What to update, in order

1. **`<!-- LAST_UPDATED -->...<!-- /LAST_UPDATED -->`** near the top: set to today's date and current time, format `Mon D 2026, H:MM AM/PM CDT` (matches existing entries like `Aug 9 2026, 8:00 AM CDT`).

2. **Versions panel** (`#versions-body`): for each tracked tool (Claude Code, Happy, MemPalace, OpenClaw, and any others already listed), check the actual latest published version (npm registry, GitHub releases, or official release notes — use WebSearch/WebFetch, don't guess) and update the `latest` span. Leave `installed` as-is (that reflects this machine's state, not something to research) unless you have a way to actually re-check it locally (`npm list -g`, `uv tool list`, `claude --version`, `mempalace --version` etc — feel free to run these via Bash to get real installed numbers).

3. **Security panel** (`#security-body`): research current CVEs/advisories affecting Claude Code, MCP, or the tracked ecosystem (GitHub Security Advisories, NVD, Anthropic's own security posts). Recalculate any "N days" countdowns in existing alert banners based on today's date. Mark banners `resolved` (with the `resolved` class and a `Resolved` badge) once their deadline has passed. Add a new banner only for a genuinely new advisory — don't duplicate existing ones.

4. **News panel** (`#news-body`): replace the news items with the most current, real AI/Claude Code headlines (Claude releases, Anthropic announcements, MCP spec changes, notable ecosystem news). Each item needs: a real URL (verify it resolves, don't fabricate links), a headline, a 2-4 sentence description with concrete specifics (version numbers, dates, what actually changed — not vague hype), a date, and a badge (`NEW`, `URGENT`, `BREAKING`, etc. — colors follow the existing CSS classes already in the file). Aim for 6 items, same as recent history. Prefer sources like official release notes, GitHub releases, or reputable tech press over speculation.

5. **Per-tool panels** (`#openclaw-body`, `#happy-body`, `#mempalace-body`, `#plugins-body`): update the `Checked <date> — ...` status line at the top of each to reflect today's check, noting whether anything changed since the last check. Add a new news-item entry only if there's an actual new release/change for that tool; otherwise leave existing items as historical record.

6. **Learning panel** (`#learning-body`), if present: this looks like a running log of notable observations from each day's research — add a brief note if today's research turned up something worth remembering for future runs (a source that was unreliable, a pattern in release timing, etc). Skip if nothing notable.

## Rules

- **Never fabricate URLs, version numbers, or CVE IDs.** If you can't verify something via WebSearch/WebFetch, leave that item alone rather than guessing.
- Keep all HTML structure, CSS classes, and formatting conventions consistent with what's already there — this is a content update, not a redesign.
- Don't remove historical news items just to make room — only replace items that are clearly stale/superseded (same pattern as recent commits: older items roll off as new ones are added, oldest-first).

## When done

1. `git add public/dashboard.html`
2. `git commit -m "chore: daily dashboard update [bot] — <Month D 2026>"` (match today's date)
3. `git push`

If `git push` fails (network issue, auth issue, conflict), report that clearly rather than silently giving up — this runs unattended, so failures need to be visible in the log output.
