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
- **`test_stat_generator_agent_file_nav`** — the "Open Agent File" button
  above the theme selector (replacing the old paragraph that mentioned
  Foundry VTT). Checks the old paragraph is gone, the button exports the
  current character through the same path as the Export to Agent File
  button, and lands the player directly on the Agent Portal's Agent File
  tab showing that character (not the Portal's default Cover tab). This
  test needs its own font-blocking `page.route` calls alongside its
  script.google.com capture, unlike most tests here that get font-blocking
  for free via `mock_routes()` — dg-agent-portal.html's inline `<script>`
  sits right after its Google Fonts `<link>`, so an unblocked font request
  that never resolves in this sandbox hangs that script's execution
  entirely (this hung the test outright before the fix, not just slowed
  it down).
- **Mobile layout (`test_mobile_no_overflow`)** — checks `document.
  documentElement.scrollWidth` stays at or under the viewport width (390px)
  across `index.html`, `dg-agent-portal.html`, and `dg-id-creator.html`,
  plus all six `stats/index.html` themes individually (X-Files, Modern, Son
  of Sam, Field Notes, Mobile, and Live Play with real content filled in —
  see the root README's Mobile section for what was actually wrong and how
  it was fixed). Live Play gets three extra checks since page-level
  scrollWidth alone doesn't catch everything that was broken there: the
  full character sheet's own `#lp-sheet` *is* expected to be wider than the
  viewport (it scrolls horizontally within its own box by design, so this
  test asserts `scrollWidth > 390` for it, not `<=`), the sticky HP/WP/SAN/
  BP tracker bar must fit without its own overflow, and the Dice Roller
  widget (which auto-expands when Live Play is selected) must stay within
  the viewport rather than the fixed 270px floating panel it used to be.
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
  the older, less-developed standalone `dg-id-creator.html`. Also checks
  every rendered card (on-screen and in the PRINT/EXPORT popup) carries the
  "PROP — NOT A GOVERNMENT DOCUMENT" watermark — these are replicas of real
  federal/municipal credentials, and the watermark exists so a card is
  still unmistakably a game prop if it ever leaves the table out of
  context — and regression-tests PRINT/EXPORT specifically against a
  credential-book layout (e.g. FBI 90s), since those render as plain
  inline-styled divs with no `.ids-card-wrap` class and used to fail the
  print gate's class-based check silently.
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
- **`test_hub_latest_agent_panel`** — the hub's "Continue Playing" panel.
  Checks it's hidden entirely (not an empty/broken preview) in a fresh
  browser with no saved agent, then that a saved agent (`dg_last_agent`,
  including a photo) produces a populated preview -- name, code, codename,
  updated date, photo -- that links straight to the Agent Portal's Agent
  File tab. Needs the same font-blocking `page.route` calls as
  `test_stat_generator_agent_file_nav` (see above) for the same reason:
  `index.html`'s own inline `<script>` sits after its Google Fonts
  `<link>`, so an unblocked font request hangs it, not just slows it down
  -- this cost a debugging pass here too before the pattern was applied
  consistently to every test that touches one of these three pages'
  scripts for the first time.

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
