# Delta Green Agent Hub

Player-facing tools for a Delta Green campaign, published as a static site via GitHub Pages.

**Live site:** enable GitHub Pages on this repo (Settings → Pages → Deploy from branch → `main` → `/ (root)`) and it'll be served at `https://<your-username>.github.io/dg-campaign/`.

## What's here

| Page | Purpose |
|---|---|
| `index.html` | Hub landing page — links to everything below |
| `stat-generator.html` | Random 3d6 or point-buy characteristic generator, with derived Hit Points / Willpower / Sanity / Breaking Point |
| `portrait-questionnaire.html` | Character brief form so the Handler can generate a reference portrait |
| `dg-agent-portal.html` | Agent dossier — cover identity, agent file across eras, medical history, after-action reports (backed by a Google Apps Script + Sheet) |
| `dg-id-creator.html` | Printable cover-identity card generator |

All pages are plain static HTML/CSS/JS — no build step, no dependencies to install.

## Roadmap ideas for a fuller Agent Hub

Rough priority order, cheapest/highest-value first:

1. **Unify the character-code system.** `stat-generator.html` currently saves locally and doesn't push into the Agent Portal's Apps Script backend — the Portal's field schema (`char_name`, `age_range`, etc.) and code format should be documented once and shared across all four tools so one code loads a character everywhere.
2. **Skills & weapons.** The current tools cover stats and identity but not skills, equipment, or weapons — a skill sheet (with the standard Delta Green skill list and percentiles) and a simple loadout/inventory tracker would round out character creation.
3. **Session/dice tools for play.** A percentile roller (roll-under vs. a skill or stat×5), a SAN-loss roller (e.g. `1d4/1d8`), and a Bond tracker (Delta Green's replacement for standard sanity recovery) would make this useful *during* sessions, not just at character creation.
4. **Handout/clue log.** A shared, per-campaign log where the Handler drops handouts (pairs well with a "delta-green-handouts" style PDF workflow) and players can revisit them.
5. **Multi-agent / campaign view.** Right now each tool is single-agent-at-a-time via a code. A simple "my agents" list (stored locally, or synced via the existing Apps Script) would help players juggling a Trained Agent roster or Friendly-Programs cell.
6. **Offline/PWA support.** Add a manifest + service worker so the hub works at the table without signal — useful since character sheets are exactly the kind of thing you don't want to lose to bad wifi.
7. **Access control.** The Agent Portal already gates some content behind a character code; if players shouldn't see each other's dossiers, consider per-agent codes tied to real auth rather than security-by-obscurity codes.

None of this pulls in code from other people's repos — the Delta Green stat/skill rules referenced here are generic game mechanics (not copyrightable), implemented fresh.

---

*Delta Green is a trademark of Arc Dream Publishing. This is an unofficial, fan-made set of campaign tools.*
