# Delta Green Agent Hub

Player-facing tools for a Delta Green campaign, published as a static site via GitHub Pages.

**Live site:** enable GitHub Pages on this repo (Settings → Pages → Deploy from branch → `main` → `/ (root)`) and it'll be served at `https://<your-username>.github.io/dg-campaign/`.

## What's here

The hub landing page (`index.html`) links to two tools:

| Page | Purpose |
|---|---|
| `stats/index.html` | Full Delta Green character creator — point-buy or dice-roll stats, 18 professions with contextual skills, bonus skill points, random bio generation, Bonds, equipment loadout, a dice-roller widget, save/share, and printable/Foundry VTT export. **Six visual themes**, including a dedicated "Live Play" mode with a sticky HP/WP/SAN tracker bar for use at the table. Ported wholesale from [pigeon-labs-stack's DELTA-GREEN-STATS](https://pigeon-labs-stack.github.io/DELTA-GREEN-STATS/) — see Attribution below. Auto-saves to this browser as you go (so it remembers where you left off), and has an **Export to Agent File** button to hand a finished character off to the Agent Portal — see below |
| `dg-agent-portal.html` | The place to come back to. Three tabs on one Agent: **Cover** (physical description brief + AI portrait prompt + printable dossier), **Agent File** (load an existing agent by its Character Code across sessions/devices), and **Cover IDs** — the "Cover ID Fabricator," a native in-page tablet UI: pick a cover agency (FBI, DEA, ATF, Secret Service, ICE, CBP, NCIS, FinCEN, USPI, NYPD, county sheriff, the fictional M-EPIC, or a Delta Green Directorate credential) and an era (90s/00s/10s/20s), and it renders a historically-styled credential card live, with an agent-code importer and PRINT/EXPORT. Every rendered card — on-screen and in the printed/exported version — carries a diagonal "PROP — NOT A GOVERNMENT DOCUMENT" watermark, so a card is still unmistakably a game prop if it's ever seen outside the game. Backed by a Google Apps Script + Sheet |

`dg-id-creator.html` still exists as its own standalone file (a simpler, paper/dossier-styled cover-ID card generator, with its own `DG-` base64 save codes), but it's no longer linked from the hub or the Agent Portal — the Cover IDs tab's native Fabricator superseded it. Kept in the repo for now rather than deleted.

All pages are static HTML/CSS/JS with no build step. `stats/` is the one exception to "single self-contained file" — it's a direct, unminified copy of pigeon-labs-stack's own multi-file layout (one HTML file, one stylesheet, twelve `.js` files), kept that way deliberately so it stays diffable against upstream.

### Export to Agent File

`stats/`'s "Export to Agent File" button (`stats/agent-portal-export.js`) sends a finished character to the Agent Portal using the **exact same submission path** the Portal's own Cover form uses — same Apps Script endpoint, same field names, same `PREFIX-XXXX` code format. It's not a new backend integration; it's this page filling out that form programmatically. Two fields are derived automatically and sent quietly in the background, since they already feed the Portal's AI portrait-prompt generator:

- **Build** — from STR+CON, reusing the same tiered word pools (`bioData.buildDescriptors`) the Creator's own "Random Bio" feature uses, so an above-average-strength Agent gets a build description to match.
- **Outfit** (jacket/shirt/trousers/footwear) — a plausible default per profession (`PROFESSION_OUTFIT` in that same file), e.g. a physician gets a lab coat and scrubs, a special operator gets tactical gear.

Everything else about physical appearance is left blank, same as any new agent — the Cover tab in the Portal stays the place to fill in or edit the rest. The exported agent's code is saved to this browser's `localStorage` (`dg_last_agent`) so the Agent Portal picks it up automatically if opened next in the same browser.

There are two ways to trigger this from `stats/index.html`:
- **"→ Open Agent File"**, the button above the theme selector (replacing the old paragraph that mentioned Foundry VTT — this hub doesn't use Foundry, so that was just noise). One click exports the current character *and* navigates straight to the Agent Portal, landing directly on the Agent File tab with that character already showing, not the Portal's default Cover tab.
- The **"→ Export to Agent File"** button further down, in the save/share bar, for exporting without leaving the page.

This bridges `stats/` → Agent Portal one-way. It does *not* unify the three separate code/save systems described in Roadmap item #1 below — the ID Creator's own code format is still separate.

## Attribution

`stats/` is a copy of [pigeon-labs-stack/DELTA-GREEN-STATS](https://github.com/pigeon-labs-stack/DELTA-GREEN-STATS) — **not** the archived `PigeonFX/DELTA-GREEN-STATS` this hub's stat generator was based on earlier. Both exist; `PigeonFX`'s is a much smaller, single-page point-buy/dice-roll/Bond-generator tool with no skills, professions, or themes, and is archived. `pigeon-labs-stack`'s is a separate, actively developed, far more complete fork/continuation — professions, skills, bio generation, equipment, Foundry VTT export, and the theme system — and is what's actually live at the pigeon-labs-stack.github.io URL this hub links out to. The two got conflated in an earlier pass here (a third-party Foundry module claiming to mirror the *simple* tool was actually built against *this* richer one's data shapes) — worth knowing if anything here ever looks inconsistent with the simple tool's source.

Licensed under the **PolyForm Noncommercial License 1.0.0** (© 2024 Brook Morton) — not MIT. Full text in `stats/LICENSE-UPSTREAM.md`; the required copyright/license notice is also in a comment at the top of `stats/index.html`. This use (a free, unofficial, noncommercial fan hub) is squarely inside what that license permits. This hub's own changes on top of the upstream copy: the Agent Hub nav link, and the footer's legal disclaimer adjusted — upstream's says it's "published by arrangement with the Delta Green Partnership," which describes pigeon-labs-stack's own relationship with the IP holder, not this fork's, so that specific claim was removed while keeping the trademark/copyright acknowledgment.

Everything else in this repo — the Agent Portal, ID Creator, and hub page — is built fresh; the Delta Green stat/skill rules referenced there are generic game mechanics (not copyrightable), not lifted from anyone's code.

## QA

There's an automated smoke-test suite in `test/` that exercises all four
pages (including the Cover IDs tab's embedded ID Creator and the Export to
Agent File flow), with the Google Apps Script / Anthropic backends faked out
so it never touches real data. See `test/README.md`.

## Roadmap ideas for a fuller Agent Hub

Rough priority order, cheapest/highest-value first:

1. **Unify the character-code system.** There are still *three* separate identity/save systems that don't talk to each other: the Agent Portal's `PREFIX-XXXX` codes (Apps Script-backed), the now-unused `dg-id-creator.html`'s `DG-` base64 codes, and `stats/`'s own save/share-link system (localStorage + a TinyURL-shortened link). The **Export to Agent File** button bridges `stats/` → Agent Portal one-way (using the Portal's own code format), and the Cover IDs tab's Fabricator imports agents by the Portal's own `PREFIX-XXXX` code too (same Apps Script query as the Agent File tab) rather than adding a fourth format — so the only real outlier left is `dg-id-creator.html`'s orphaned `DG-` codes. Still the single biggest gap, but a smaller one than it was.
2. ~~Skills & weapons.~~ Done — `stats/` covers skills (full list + specialties), professions, and an equipment/weapon loadout picker.
3. ~~A real percentile roller.~~ Done — `stats/` has its own dice-roller widget (quick dice, custom rolls, roll-under-% checks) built in.
4. ~~Live-play HP/SAN tracking.~~ Done, sort of — `stats/`'s "Live Play (Field Notes)" theme has a sticky HP/WP/SAN/BP tracker bar and a full live character sheet. It's independent of the Agent Portal's dossier system, though (see #1).
5. **Handout/clue log.** A shared, per-campaign log where the Handler drops handouts (pairs well with a "delta-green-handouts" style PDF workflow) and players can revisit them.
6. **Offline/PWA support.** Add a manifest + service worker so the hub works at the table without signal.
7. **Access control.** The Agent Portal already gates some content behind a character code; if players shouldn't see each other's dossiers, consider per-agent codes tied to real auth rather than security-by-obscurity codes.
8. **Multi-source character sheet import ("Phase 2").** Several existing agents in this campaign were built on other tools before this hub existed: [PigeonFX/DELTA-GREEN-STATS](https://github.com/PigeonFX/DELTA-GREEN-STATS) (the older, simpler archived tool — see Attribution), [Kappa Black](https://www.kappablack.com/)'s character sheet, and the official Delta Green agent-brief PDFs (fillable forms, e.g. the pre-generated `USSS Personal Protective Detail` agent). Goal: a player picks their source, imports in a few clicks/seconds, and the character is immediately playable and saved (presumably via the same Export to Agent File / `PREFIX-XXXX` path everything else already uses), plus a way to browse and switch between everyone's imported sheets rather than juggling separate files. Three different import parsers (two web tools' own save/export formats, one PDF form-field extraction) is real scope — worth its own design pass rather than folding into an existing feature, which is why it's tracked here as a distinct future phase rather than attempted piecemeal.

---

*Delta Green is a trademark of Arc Dream Publishing. This is an unofficial, fan-made set of campaign tools.*
