# Delta Green Agent Hub

Player- and Handler-facing tools for a Delta Green campaign, published as a static site via GitHub Pages, installable as an offline-capable PWA.

**Live site:** enable GitHub Pages on this repo (Settings → Pages → Deploy from branch → `main` → `/ (root)`) and it'll be served at `https://<your-username>.github.io/dg-campaign/`.

## What's here

`index.html` is a two-clearance landing page (after a one-time, session-gated boot-splash animation): **Agent**, for players, and **A-Cell**, for the Handler, password-gated. Both lead into a shared "manila folder on a desk" visual system (`assets/theme-folder.css`) used across every hub page outside `stats/`'s own six themes.

| Page | Purpose |
|---|---|
| `index.html` | Clearance chooser (boot splash → Agent / A-Cell cards). Entry point for everyone. |
| `agent-hub.html` | The player's own hub. Reads this browser's local Agent roster (`localStorage`'s `dg_agent_roster`) as folder ear-tabs, one per Agent, plus a pinned "+ New Recruit" tab. Each Agent's panel has **Play** (opens the character sheet already loaded and in Live Play), **Agent File**, and **Cover ID** buttons, plus a read-only mirror of any Handouts filed for that Agent (with private per-Agent notes). |
| `dg-agent-portal.html` | An individual Agent's dossier. Three tabs: **Cover** (physical description brief + AI portrait prompt + printable dossier), **Agent File** (load an existing agent by its Character Code across sessions/devices), and **Cover IDs** — a native in-page "Cover ID Fabricator": pick a cover agency and era and it renders a historically-styled credential card live, watermarked "PROP — NOT A GOVERNMENT DOCUMENT" so it's unmistakably a game prop anywhere outside the game. A slide-up **Agent Roster** remembers every agent submitted or loaded in this browser. Backed by a Google Apps Script + Sheet. |
| `stats/index.html` | Full Delta Green character creator — point-buy or dice-roll stats, 18 professions with contextual skills, bonus skill points, random bio generation, Bonds, equipment loadout, a dice-roller widget, save/share, and printable/Foundry VTT export. **Five visual themes** (all mobile-friendly, see Mobile below) plus **Live Play**, an orthogonal mode — not a theme of its own — layered on top of whichever theme is active, with a sticky HP/WP/SAN/BP tracker bar for use at the table. A top-right settings cog holds Theme, cloud Load by Code, and Export, keeping the page itself uncluttered for a brand-new recruit. Ported wholesale from [pigeon-labs-stack's DELTA-GREEN-STATS](https://pigeon-labs-stack.github.io/DELTA-GREEN-STATS/) — see Attribution below. |
| `a-cell.html` | The Handler's dashboard, password-gated. Five tabs: **Play** (a simplified view of every Agent on file for running the table), **Cells** (group Agents into named Cells with their own Handler), **Handouts** (file campaign-wide or Cell-scoped documents, with photos, that mirror into each Agent's own hub view), **Sheet** (a dense, Excel-style roster table across every Agent), and **Music** (broadcast a track, ambient layers, and stinger sound effects to every player's Table Radio widget at once). |
| `dg-id-creator.html` | A simpler, standalone paper/dossier-styled cover-ID card generator with its own `DG-` base64 save codes, superseded by the Cover IDs tab's native Fabricator and no longer linked from anywhere. Kept in the repo rather than deleted. |

All pages are static HTML/CSS/JS with no build step. `stats/` is the one exception to "single self-contained file" — it's a direct, unminified copy of pigeon-labs-stack's own multi-file layout (one HTML file, one stylesheet, thirteen `.js` files), kept that way deliberately so it stays diffable against upstream.

### Table Radio (shared music widget)

`assets/table-radio.js` is a small persistent widget included on every player-reachable hub page (and `stats/`) that keeps a player "tuned in" to whatever the Handler is broadcasting from A-Cell's Music tab, staying loosely in sync as players move between pages via a server-stamped `started_at` timestamp every device reads. On top of the main track, the Handler can layer **ambient loops** (rain, wind, machine hum, static/interference — procedurally synthesized, not licensed audio) that play underneath it, independently toggleable per channel and locally mutable per listener, and fire one-shot **stinger** sound effects heard by everyone tuned to that channel. Backed by its own Apps Script additions (`acell-table-radio-addition.txt`, plus the ambient/stinger extensions — handed over separately, not committed here since they're Apps Script, not something this static site serves).

### Offline support (PWA)

`manifest.json` + `sw.js` make this installable to a phone's home screen and usable at the table with no signal. `sw.js` runs a stale-while-revalidate strategy over the static app shell (every page, script, stylesheet, and icon listed in `SHELL_FILES`) — instant load from cache, refreshed in the background for next time — while deliberately leaving every Apps Script/backend call alone, so it never serves stale campaign data offline and calls it a feature. `CACHE_NAME` gets bumped on every shell file change so returning visitors aren't stuck on old JS. One real constraint worth knowing: iOS disables `window.alert()`/`confirm()`/`prompt()` entirely inside a home-screen-installed (standalone) PWA, so this app avoids native dialogs in favor of real in-page UI (inline inputs, `dgConfirm()` in `stats/save-load.js`) wherever a flow needs to work standalone, not just in a normal browser tab.

### Export to Agent File

`stats/`'s **Open Agent File** button (`stats/agent-portal-export.js`) sends a finished character to the Agent Portal using the **exact same submission path** the Portal's own Cover form uses — same Apps Script endpoint, same field names, same `PREFIX-XXXX` code format. It's not a new backend integration; it's this page filling out that form programmatically, then reusing the character's own Cloud Save code (below) rather than minting an unrelated second one, so Play/Recruit links from the Agent File always resolve back to the real character. Name, age range, sex, nationality, and profession carry straight over from the character's Biography; build and outfit are derived automatically:

- **Build** — from STR+CON, reusing the same tiered word pools (`bioData.buildDescriptors`) the Creator's own "Random Bio" feature uses.
- **Outfit** (jacket/shirt/trousers/footwear) — a plausible default per profession (`PROFESSION_OUTFIT` in that same file).

Everything else about physical appearance is left blank, same as any new agent — the Cover tab in the Portal stays the place to fill in or edit the rest. (Campaign era/decade isn't part of this bridge — the Agent File's era selector stays a manual one-time choice per agent, since `stats/` characters carry no era of their own to derive a default from.)

### Mobile

`stats/` originally only worked cleanly on a phone in its dedicated "Mobile" theme — the other themes genuinely overflowed horizontally, since pigeon-labs-stack built them desktop-first. Fixed via a viewport-width-gated addition at the bottom of `stats/styles.css` (not scoped to any theme, so it changes nothing on desktop). Root cause of most of it: browsers give every `<fieldset>` a default `min-width: min-content`, so it refuses to shrink below its widest unbreakable content no matter how well the layout inside it collapses — plus a few genuinely fixed-width grids (the skills list's `80px` column gap, biography fields' `160px` label column, the equipment picker).

Live Play was the trickiest, since its full character sheet mirrors a printed form (percentage-width table columns, side-by-side sub-sections) rather than being built for a phone at all. It reflows below 700px instead of scrolling horizontally: the Personal Data table's `<table>`/`<tr>`/`<td>` switch to block display so each field stacks as its own full-width row, and the Stats+Bonds / Derived+Motivations / Physical-Description+Incidents side-by-side pairs stack vertically. The sticky HP/WP/SAN/BP tracker bar and the Dice Roller widget (which auto-expands when Live Play is on) needed their own fixes too — the Dice Roller is a full-width bottom sheet on mobile rather than a fixed floating panel.

### Import Agent (one button, any format)

Picking the right one of five format-specific buttons was the cumbersome part — a player just wants to hand over their file. `stats/index.html` has a single **"Import Agent"** drop zone right at the top of the page for a brand-new character: drop a file, or click to browse, and `importAgentAuto()` (`stats/scripts.js`) figures out the format itself and routes it to the matching importer — no new parsing logic, just the routing in front of what already existed. Detection is by file extension first (`.toml`, `.json`, `.pdf`, `.xlsx`, `.html`), falling back to sniffing the actual bytes/content for a file dropped in without one (common from a mobile "Share" sheet). Once a character is named, this block relocates into the settings cog's "New Recruit" section, reachable there for re-importing onto an existing sheet.

Several agents in this campaign were built on other tools before this hub existed. `stats/`'s settings cog has import counterparts for the main ones, all reachable through the one-button importer above:

- **Import from PDF Sheet** — works on both this hub's own exported/printed sheets and **official pre-generated Delta Green Agent PDFs** from published scenarios (their AcroForm field names are identical to the blank template).
- **Import from Google Sheet** (`stats/sheets-import.js`) — the counterpart to the Export Google Sheet button; reads the same fixed cell addresses the export writes, plus `xl/sharedStrings.xml` for cells Google Sheets rewrote to shared-string references after a round trip.
- **Import from Kappa Black** (`.toml`, `stats/scripts.js` — `parseSimpleTOML()` / `convertKappaBlackToAgentData()` / `importKappaBlackTOMLToEditor()`) — a hand-rolled parser scoped to exactly the subset [Kappa Black](https://www.kappablack.com/)'s flat TOML export uses, reshaped into the same object shape a Foundry VTT export uses so profession/skill/bond/gear handling is shared code. **Limitation:** Kappa Black's TOML has no Sex field — needs manual entry after import. Its **JSON** export is Foundry VTT actor JSON and already works via the same importer.

All of these land through the exact same `dgSaveLoad.applyState()` / `applyImportedAgentData()` path `stats/`'s own Printable-Sheet-HTML and Foundry-JSON imports already use, so a successful import behaves like any other loaded character — auto-saves, exports to Agent File, etc. — normally. None of these recover *everything* (specialty skills, weapon tables, and similar detail may need re-entry) — see each button's own description for specifics.

### Cloud Save

Every import above is still a file changing hands — fine for a one-time move, cumbersome if you want a character to just follow you between a laptop and a phone at the table. `stats/cloud-sync.js` adds an **automatic** save on top of the existing Apps Script backend, keyed by an Agent Code:

- **Auto-starts on its own** — the first edit made after a real name is entered mints a code and pushes immediately; every edit after that debounces another push, so the cloud copy stays current with no button to remember.
- **Load by Code**, in the settings cog, is the only manual control left — a real text input, not `window.prompt()` (which is silently disabled in a standalone PWA — see Offline support above). Pulls a previously cloud-saved character back down by its code on any device/browser and re-activates syncing under that code going forward.
- **No Start or Stop button.** Once a character is named, syncing it is just how the page behaves now, the same way local autosave already always has been.

Needed a small, purely additive change on the Apps Script side: a `Characters` tab (one row per Agent Code, upserted rather than appended) alongside the existing `Delta Green Briefs` tab — see `character-cloud-save-addition.gs` (handed over separately). **Deployed and confirmed working.**

### Agent Roster

`dg-agent-portal.html` and `agent-hub.html` share the same **persistent, multi-agent roster** in this browser (`localStorage`'s `dg_agent_roster`) — every agent that's been submitted via the Cover form, loaded by code, or played, with photo/name/code/codename/demographics/era. `agent-hub.html` renders this roster as its own folder tabs; the Portal's own slide-up drawer lets you switch between agents, delete entries, or export/import the whole roster as a `.json` file.

## Attribution

`stats/` is a copy of [pigeon-labs-stack/DELTA-GREEN-STATS](https://github.com/pigeon-labs-stack/DELTA-GREEN-STATS) — **not** the archived `PigeonFX/DELTA-GREEN-STATS` this hub's stat generator was based on earlier. Both exist; `PigeonFX`'s is a much smaller, single-page point-buy/dice-roll/Bond-generator tool with no skills, professions, or themes, and is archived. `pigeon-labs-stack`'s is a separate, actively developed, far more complete fork/continuation — professions, skills, bio generation, equipment, Foundry VTT export, and the theme system — and is what's actually live at the pigeon-labs-stack.github.io URL this hub links out to.

Licensed under the **PolyForm Noncommercial License 1.0.0** (© 2024 Brook Morton) — not MIT. Full text in `stats/LICENSE-UPSTREAM.md`; the required copyright/license notice is also in a comment at the top of `stats/index.html`. This use (a free, unofficial, noncommercial fan hub) is squarely inside what that license permits.

Everything else in this repo — the Agent Hub, Agent Portal, A-Cell, ID Creator, and Table Radio — is built fresh; the Delta Green stat/skill rules referenced there are generic game mechanics (not copyrightable), not lifted from anyone's code.

## QA

There's an automated smoke-test suite in `test/` (380+ checks) that exercises every page — `index.html`, `agent-hub.html`, `dg-agent-portal.html`, `stats/`, `a-cell.html`, `dg-id-creator.html` — including the Cover IDs Fabricator, Export to Agent File, the Agent Roster, Handouts, Table Radio (main track, ambient layers, stingers), Cloud Save/Load by Code, and full offline/PWA behavior, with the Google Apps Script backend faked out so it never touches real data. See `test/README.md`.

## Roadmap ideas for a fuller Agent Hub

Rough priority order, cheapest/highest-value first:

1. **Unify the character-code system.** There are still separate identity/save systems that don't fully talk to each other: the Agent Portal's `PREFIX-XXXX` codes (Apps Script-backed), the now-unused `dg-id-creator.html`'s `DG-` base64 codes, `stats/`'s own save/share-link system, and `stats/`'s Cloud Save code (also `PREFIX-XXXX`-shaped, same backend, tracked under its own key). Still the single biggest gap.
2. ~~Skills & weapons.~~ Done.
3. ~~A real percentile roller.~~ Done — `stats/`'s dice-roller widget.
4. ~~Live-play HP/SAN tracking.~~ Done — Live Play's sticky tracker bar, now decoupled from theme so it layers over any of the five.
5. ~~Handout/clue log.~~ Done — A-Cell's Handouts tab, mirrored read-only into each Agent's hub view with private per-Agent notes.
6. ~~Offline/PWA support.~~ Done — see Offline support above.
7. **Access control.** A-Cell is gated behind a shared password; individual Agent dossiers/character sheets are still reachable by anyone who has the code, not tied to real per-player auth.
8. ~~Multi-source character sheet import + a roster to browse them.~~ Done — see Import Agent and Agent Roster above.
9. ~~Deploy the Cloud Save Apps Script addition.~~ Done — deployed and confirmed working.

---

*Delta Green is a trademark of Arc Dream Publishing. This is an unofficial, fan-made set of campaign tools.*
