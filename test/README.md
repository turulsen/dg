# QA harness

Automated smoke tests for the three Agent Hub pages, run against a set of mock
Delta Green agents. Nothing here ever touches the real Google Apps Script
backend or Anthropic API — `run_tests.py` intercepts and fakes both, and
Google Fonts requests are blocked to keep tests fast and offline-safe.

## Run it

```bash
python3 -m http.server 8949 &
python3 test/run_tests.py
```

Results print to stdout and are written to `test/results.json`. Exit code is
non-zero if anything fails.

## What it covers

- **stat-generator.html** — the full 7-step wizard end to end (identity →
  characteristics → derived → skills → Bonds → equipment → finish) for
  every mock agent, exercising all three creation paths (Quick/Random/Point-
  Buy), Dodge staying locked to DEX×2, skill-bias application, adding a Bond
  and an equipment item, and the finished summary containing all of it.
  Then Play Mode: the right character loads, the HP meter adjusts, the
  SAN-loss roller produces a result, a Bond score adjusts, field notes
  persist to `localStorage`, and all three themes apply and the choice
  persists.
- **External import (`pigeon-export-fixture.json`)** — pastes a fixture
  shaped like pigeon-labs-stack's DELTA-GREEN-STATS export and checks the
  reported counts, that characteristics map 1:1, that a known key mismatch
  (`heavy_machiner` → Heavy Machinery) aliases correctly, that Bonds and
  weapons/equipment land, and that "Send Identity to Agent Portal" opens a
  new tab with the Cover form's name and notes prefilled and the handoff
  key cleared afterward.
- **dg-agent-portal.html** — tab switching (Cover / Agent File / Cover IDs),
  full profession dropdown, random agent generator per profession, cover
  form submit + dossier render, localStorage persistence, restoring an
  agent by code re-renders the dossier in place on the Cover tab (not just
  a silent jump to Agent File), Agent File code-gate loading via the JSONP
  endpoint.
- **dg-id-creator.html** — manual name entry, code loader behavior.

`dg-id-creator.html`'s visual theme (paper/dossier styling to match the rest
of the hub) is a CSS-only change with no functional test coverage — verify
it visually if you touch that stylesheet again.

## Known gap this suite documents, doesn't fix

`dg-id-creator.html`'s code loader expects a base64-JSON code prefixed
`DG-`; `dg-agent-portal.html` and `stat-generator.html` both use short
`PREFIX-XXXX` codes tied to the Apps Script backend. A code generated on one
page is rejected on the other. This is tracked as roadmap item #1 in the
root README ("Unify the character-code system") — fixing it is a schema
decision, not a bug fix, so it's left as a documented gap rather than
silently patched.

## Mock agents

`mock-agents.json` has five fictional Delta Green agents spanning different
professions, used to exercise the cover-brief form fields and the random
agent generator's profession list.

`pigeon-export-fixture.json` is a hand-built fixture shaped like pigeon-labs-
stack's DELTA-GREEN-STATS export (documented in that project's Foundry VTT
port, `pigeon-labs-stack/delta-green-agent-wizard-module`, in the comment
block at the top of `scripts/pdf-export.js` — its `collectState()` shape).
It's not a real export pulled from that site (this session can't reach
pigeon-labs-stack.github.io — network policy blocks that host), so it's
worth spot-checking against a real export if the site's format ever changes.
