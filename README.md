# Delta Green Agent Hub

Player-facing tools for a Delta Green campaign, published as a static site via GitHub Pages.

**Live site:** enable GitHub Pages on this repo (Settings → Pages → Deploy from branch → `main` → `/ (root)`) and it'll be served at `https://<your-username>.github.io/dg-campaign/`.

## What's here

| Page | Purpose |
|---|---|
| `index.html` | Hub landing page — links to everything below |
| `stat-generator.html` | Stats terminal — point-buy (72 points) or random-roll (4d6 drop lowest) your six characteristics, generate a Bond, export an XLSX character sheet. Ported from [pigeon-labs-stack's DELTA-GREEN-STATS](https://pigeon-labs-stack.github.io/DELTA-GREEN-STATS/) (MIT licensed, see attribution below), with a dice roller, mobile-responsive layout (the original had neither), and a "Send to Agent Portal" handoff added on top |
| `dg-agent-portal.html` | Character brief, cover identity, and dossier — plus agent file across eras, medical history, and after-action reports (backed by a Google Apps Script + Sheet) |
| `dg-id-creator.html` | Printable cover-identity card generator |

All pages are plain static HTML/CSS/JS — no build step, no dependencies to install.

## Attribution

`stat-generator.html` is a port of [PigeonFX/DELTA-GREEN-STATS](https://github.com/PigeonFX/DELTA-GREEN-STATS) (© 2024 Brook Morton, MIT License — full text in that file's header comment). The stats terminal, point-buy/dice-roll logic, the Bond generator and its bond text, and the XLSX export are all theirs, copied in with the license notice retained as MIT requires. The original had zero responsive CSS — on a phone its fixed-width layout (an 800px text box, three-column flex row) forced horizontal scroll and overlapping text. This hub's own additions on top: the Agent Hub nav link, a real mobile layout via a `@media (max-width: 760px)` block, a general-purpose dice roller (quick d4–d100 buttons, custom NdX+mod, roll-under-% skill checks), the "Send to Agent Portal" handoff, an inlined copy of the background logo, and fixing a couple of unclosed tags in the original markup.

An earlier version of this page was a custom-built 7-step character wizard (skills, Bonds-with-scores, equipment, a Play Mode, JSON import) built against a schema inferred from a *third-party* Foundry VTT port that claimed to mirror DELTA-GREEN-STATS but had actually expanded well past it. Once the real site's source was checked directly, it turned out to be much simpler — no skills, no equipment, no JSON export, just stats/Bonds/XLSX — so the custom wizard was scrapped in favor of this direct, attributed port instead of a tool built on a guess.

## QA

There's an automated smoke-test suite in `test/` that exercises all three
pages, with the Google Apps Script / Anthropic backends faked out so it never
touches real data. See `test/README.md`.

## Roadmap ideas for a fuller Agent Hub

Rough priority order, cheapest/highest-value first:

1. **Unify the character-code system.** The Agent Portal and the ID Creator still use two different, incompatible code formats — a code generated on one doesn't load on the other. The "Send to Agent Portal" handoff (localStorage `dg_handoff_agent`, consumed once on load) bridges stats-terminal output into the Cover form's notes, but it's a one-way stopgap, not a real fix.
2. **Skills & weapons.** Neither tool here has a skill list, equipment, or weapons yet — the actual next step, now that the stats terminal is grounded in something real rather than a guessed schema.
3. ~~A real percentile roller.~~ Done — the stats terminal has a dice roller (quick d4–d100, custom NdX+mod, roll-under-% skill checks) with a short roll log. Still no HP/SAN tracker for use at the table, though — nothing here tracks *live* play state yet.
4. **Handout/clue log.** A shared, per-campaign log where the Handler drops handouts (pairs well with a "delta-green-handouts" style PDF workflow) and players can revisit them.
5. **Multi-agent / campaign view.** Every tool here is single-character-at-a-time. A "my agents" list, synced via the existing Apps Script, would help players juggling a roster.
6. **Offline/PWA support.** Add a manifest + service worker so the hub works at the table without signal.
7. **Access control.** The Agent Portal already gates some content behind a character code; if players shouldn't see each other's dossiers, consider per-agent codes tied to real auth rather than security-by-obscurity codes.

Everything else in this repo — the Agent Portal, ID Creator, and hub page — is built fresh; the Delta Green stat/skill rules referenced there are generic game mechanics (not copyrightable), not lifted from anyone's code.

---

*Delta Green is a trademark of Arc Dream Publishing. This is an unofficial, fan-made set of campaign tools.*
