# MooseClaw Dashboard — Daily Update

You are updating the **MooseClaw Dashboard** in this repo (`lm3dptfy/lm3dptfy`) — a security/version monitoring hub for Claude Code and its ecosystem (Happy, MemPalace, OpenClaw, plugins/skills, MCP). It spans three files now:

- **`public/dashboard.html`** — the main page. Security and News panels here show only **highlights** (top 3 items each, short 1-line descriptions) — this is deliberate, don't grow them back into long lists.
- **`public/security-history.html`** — the full, ever-growing security/CVE archive.
- **`public/news-archive.html`** — the full, ever-growing AI news archive.

Follow the **exact existing structure and visual style** already in each file — do not redesign, only update content. Look at recent git history (`git log --oneline -5`, then `git show <hash>`) for the established pattern before making changes.

## What to update, in order

1. **`<!-- LAST_UPDATED -->...<!-- /LAST_UPDATED -->`** near the top of `dashboard.html`: set to today's date and current time, format `Mon D 2026, H:MM AM/PM CDT` (matches existing entries like `Aug 9 2026, 8:00 AM CDT`).

2. **Versions panel** (`#versions-body` in `dashboard.html`): for each tracked tool (Claude Code, Happy, MemPalace, OpenClaw, and any others already listed), check the actual latest published version (npm registry, GitHub releases, or official release notes — use WebSearch/WebFetch, don't guess) and update the `latest` span. Leave `installed` as-is (that reflects this machine's state, not something to research) unless you have a way to actually re-check it locally (`npm list -g`, `uv tool list`, `claude --version`, `mempalace --version` etc — feel free to run these via Bash to get real installed numbers).

3. **Security — two files, kept in sync:**
   - Research current CVEs/advisories affecting Claude Code, MCP, or the tracked ecosystem (GitHub Security Advisories, NVD, Anthropic's own security posts).
   - `security-history.html` has two sections under two `<h2>` headers: **"🔴 Active — Needs Attention"** and **"✅ Resolved / Fixed"** (each header's text includes a count in parens, e.g. `(17)` — update that count whenever you change how many items are in that section). Keep these two sections distinct — never merge them or lose the header split.
   - **Append** any genuinely new advisory as a new `.alert-banner` at the top of the **Active** section (full detail, same format as existing entries — never delete or shorten existing archive entries, this file only grows).
   - When an active item's deadline passes or a fix ships: give it the `resolved` class, update its badge to `Resolved`/`Fixed`, and **move the whole block** from the Active section to the top of the Resolved section (don't just relabel it in place — it needs to physically move so Active only ever contains things still worth watching).
   - Then update `dashboard.html`'s `#security-body`: prioritize **active/unresolved** items for the highlight slots (what needs watching), plus **one** recently-resolved item so there's a visible "this was a problem, now it's fixed" signal. Keep it at 3 items total, each a short 1-sentence summary, ending with a link to `/security-history.html`.

4. **News — two files, kept in sync:**
   - Research the most current, real AI/Claude Code headlines (Claude releases, Anthropic announcements, MCP spec changes, notable ecosystem news). Real URLs only — verify they resolve, never fabricate links.
   - **Append** new items to the top of `#news-body` in `news-archive.html`, full description (2-4 sentences), same format as existing entries there. This file only grows — never delete existing entries.
   - Then update `dashboard.html`'s `#news-body`: keep exactly the **top 3** highlight items, each a **short 1-sentence** description, ending with a link to `/news-archive.html`.

5. **Per-tool panels** (`#openclaw-body`, `#happy-body`, `#mempalace-body`, `#plugins-body` in `dashboard.html`): update the `Checked <date> — ...` status line at the top of each to reflect today's check, noting whether anything changed since the last check. Add a new news-item entry only if there's an actual new release/change for that tool; otherwise leave existing items as historical record. These stay in `dashboard.html` — no separate archive for these yet.

6. **Learning panel** (`#learning-body` in `dashboard.html`), if present: a running log of notable observations from each day's research — add a brief note if today's research turned up something worth remembering for future runs. Skip if nothing notable.

## Rules

- **Never fabricate URLs, version numbers, or CVE IDs.** If you can't verify something via WebSearch/WebFetch, leave that item alone rather than guessing.
- Keep all HTML structure, CSS classes, and formatting conventions consistent with what's already there — this is a content update, not a redesign.
- `security-history.html` and `news-archive.html` are append-only archives — never remove or shorten existing entries there, only add new ones.
- `dashboard.html`'s Security and News panels must stay at exactly 3 highlight items each — don't let them grow back into full lists. That's what the archive pages are for.

## When done

1. `git add public/dashboard.html public/security-history.html public/news-archive.html`
2. `git commit -m "chore: daily dashboard update [bot] — <Month D 2026>"` (match today's date)
3. `git push`

If `git push` fails (network issue, auth issue, conflict), report that clearly rather than silently giving up — this runs unattended, so failures need to be visible in the log output.
