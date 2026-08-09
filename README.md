# Delta Green Agent Hub

Player-facing tools for a Delta Green campaign, published as a static site via GitHub Pages.

**Live site:** enable GitHub Pages on this repo (Settings → Pages → Deploy from branch → `main` → `/ (root)`) and it'll be served at `https://<your-username>.github.io/dg-campaign/`.

## What's here

| Page | Purpose |
|---|---|
| `index.html` | Hub landing page — links to everything below |
| `stat-generator.html` | Full character sheet generator: a 7-step wizard (identity, characteristics, derived stats, skills, Bonds, equipment, finish) with Quick/Random/Point-Buy creation paths, three selectable visual themes, and a **Play Mode** for running the finished sheet live at the table (HP/WP/SAN trackers, SAN-loss roller, Bond and skill tracking, field notes) |
| `dg-agent-portal.html` | Character brief, cover identity, and dossier — plus agent file across eras, medical history, and after-action reports (backed by a Google Apps Script + Sheet) |
| `dg-id-creator.html` | Printable cover-identity card generator |

All pages are plain static HTML/CSS/JS — no build step, no dependencies to install.

## QA

There's an automated smoke-test suite in `test/` that exercises all three
pages against a set of mock agents, with the Google Apps Script / Anthropic
backends faked out so it never touches real data. See `test/README.md`.

## Roadmap ideas for a fuller Agent Hub

Rough priority order, cheapest/highest-value first:

1. **Unify the character-code system.** `stat-generator.html` currently saves locally (`dg_char_<code>`) and doesn't push into the Agent Portal's Apps Script backend, and the ID Creator's code format is still a different, incompatible scheme — the Portal's field schema (`char_name`, `age_range`, etc.) and code format should be documented once and shared across all three tools so one code loads a character everywhere. This is now the single biggest gap.
2. ~~Skills & weapons.~~ Done — `stat-generator.html`'s wizard now covers skills (full list, point pools), Bonds, and equipment, plus a Play Mode for running the sheet live.
3. **A real percentile roller.** Play Mode tracks HP/WP/SAN and has a SAN-loss roller, but there's no roll-under-a-skill roller yet — the most obvious next in-session addition.
4. **Handout/clue log.** A shared, per-campaign log where the Handler drops handouts (pairs well with a "delta-green-handouts" style PDF workflow) and players can revisit them.
5. **Multi-agent / campaign view.** Play Mode now has a local "my characters" chip list (`dg_char_index`), but it's per-browser only — syncing it via the existing Apps Script would let a Handler see the whole cell/roster.
6. **Offline/PWA support.** Add a manifest + service worker so the hub works at the table without signal — useful since character sheets are exactly the kind of thing you don't want to lose to bad wifi.
7. **Access control.** The Agent Portal already gates some content behind a character code; if players shouldn't see each other's dossiers, consider per-agent codes tied to real auth rather than security-by-obscurity codes.

None of this pulls in code from other people's repos — the Delta Green stat/skill rules referenced here are generic game mechanics (not copyrightable), implemented fresh.

---

*Delta Green is a trademark of Arc Dream Publishing. This is an unofficial, fan-made set of campaign tools.*
