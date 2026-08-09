# QA harness

Automated smoke tests for the four Agent Hub pages, run against a set of mock
Delta Green agents (for the Agent Portal / ID Creator) plus a direct exercise
of the character creator. Nothing here ever touches the real Google Apps
Script backend or Anthropic API — `run_tests.py` intercepts and fakes both,
and Google Fonts requests are blocked to keep tests fast and offline-safe.

## Run it

```bash
python3 -m http.server 8949 &
python3 test/run_tests.py
```

Results print to stdout and are written to `test/results.json`. Exit code is
non-zero if anything fails.

## What it covers

- **`stats/index.html`** — third-party production code (~17,000 lines across
  13 files, see the root README's Attribution section), so this favors
  breadth over exhaustively testing every feature: page loads with no JS
  exceptions, the Agent Hub nav link is present, all 6 themes switch without
  throwing, manual stat +/- works, random point buy sums to exactly 72,
  reset returns all six stats to 3, the profession dropdown has ~18 options,
  Random Bio fills the name field, the Character Creation Wizard opens to
  step 1, and the dice-roller widget opens and rolls without throwing. Not
  covered: PDF/Foundry/Sheets export (each dynamically loads its own CDN
  library — pdf-lib, JSZip — unreachable from this sandbox), and the
  save/share-link flow (calls the TinyURL API, also unreachable here).
- **Mobile layout (`test_mobile_no_overflow`)** — checks `document.
  documentElement.scrollWidth` stays at or under the viewport width (390px).
  `stats/index.html` is a partial exception: only its dedicated "Mobile"
  theme is meant to be responsive (the other five — X-Files, Modern, Son of
  Sam, Field Notes, Live Play — are desktop-oriented by the original
  design), so it's checked separately with that theme selected rather than
  folded into the general sweep across `index.html` / `dg-agent-portal.html`
  / `dg-id-creator.html`.
- **dg-agent-portal.html** — tab switching (Cover / Agent File / Cover IDs),
  full profession dropdown, random agent generator per profession, cover
  form submit + dossier render, localStorage persistence, restoring an
  agent by code re-renders the dossier in place on the Cover tab (not just
  a silent jump to Agent File), Agent File code-gate loading via the JSONP
  endpoint.
- **`test_cover_ids_tab`** — the Cover IDs tab's "Cover ID Fabricator" is
  native to `dg-agent-portal.html` (not an iframe): switching to the tab
  renders the tablet UI, the card preview shows a placeholder until an
  agency + era are picked, choosing one renders a live credential card
  reflecting the entered cover name, and the agent-code importer ("LOAD")
  queries the same Apps Script JSONP endpoint the Agent File tab uses.
  Ported wholesale from the project's `Dev` branch, which had built this
  out fully while this branch's Cover IDs tab was still an iframe wrapping
  the older, less-developed standalone `dg-id-creator.html`.
- **dg-id-creator.html** — still tested on its own (manual name entry, code
  loader behavior) even though nothing links to it anymore, since the file
  is still in the repo.
- **`test_agent_file_export`** — `stats/`'s "Export to Agent File" button
  (`stats/agent-portal-export.js`). Builds a character with above-average
  STR/CON, exports it, and intercepts the POST payload to check: build text
  reflects the actual stats (this is a regression test for a bug where
  `csStats.str`/`.con` were read lowercase against the real uppercase
  `STR`/`CON` keys, silently defaulting every export to "average build"
  regardless of the character), outfit fields match the profession, age/sex
  map into the Portal's enums, the notes field lists profession/stats/
  skills/bonds/equipment, and the agent is cached to `localStorage`
  (`dg_last_agent`) in the Portal's own shape.
- **`test_hub_two_cards`** — `index.html` links to exactly
  `stats/index.html` and `dg-agent-portal.html`, no more, no standalone ID
  Creator card.

`dg-id-creator.html`'s visual theme (paper/dossier styling to match the rest
of the hub) is a CSS-only change with no functional test coverage — verify
it visually if you touch that stylesheet again.

## Known gap this suite documents, doesn't fix

Three separate, incompatible identity/save systems: the now-unlinked
`dg-id-creator.html`'s code loader expects a base64-JSON code prefixed
`DG-`; `dg-agent-portal.html` (including its Cover IDs tab's Fabricator)
uses short `PREFIX-XXXX` codes tied to the Apps Script backend; `stats/`'s
save/share system is its own localStorage + TinyURL-link scheme, unrelated
to either. Nothing generated on one loads on either of the others. This is
tracked as roadmap item #1 in the root README ("Unify the character-code
system") — fixing it is a schema/architecture decision, not a bug fix, so
it's left as a documented gap rather than silently patched.

## Mock agents

`mock-agents.json` has five fictional Delta Green agents spanning different
professions, used to exercise the Agent Portal's cover-brief form fields and
the random agent generator's profession list. `stats/index.html` builds its
own characters end-to-end (professions, bio, stats) as part of its own test,
so it doesn't use this fixture.
