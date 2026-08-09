# QA harness

Automated smoke tests for the three Agent Hub pages, run against a set of mock
Delta Green agents (for the Agent Portal / ID Creator) plus a direct exercise
of the stats terminal. Nothing here ever touches the real Google Apps Script
backend or Anthropic API — `run_tests.py` intercepts and fakes both, and
Google Fonts / cdnjs requests are blocked or stubbed to keep tests fast and
offline-safe.

## Run it

```bash
python3 -m http.server 8949 &
python3 test/run_tests.py
```

Results print to stdout and are written to `test/results.json`. Exit code is
non-zero if anything fails.

## What it covers

- **stat-generator.html** — starting state (six 3s, 54 points remaining),
  manual stat adjustment (value/×5/remaining-points all update together),
  random point buy (spends exactly 72 points, every stat 3–18), random dice
  roll (4d6 drop lowest, every stat 3–18), reset, the Bond generator
  (default category pre-checked, produces text), the dice roller (quick
  d100 button, custom NdX+mod arithmetic, roll-under-% skill check
  clamping and SUCCESS/FAILURE reporting, the log capping at 8 entries),
  the XLSX export button's wiring (the `xlsx.full.min.js` CDN library
  itself is stubbed via `page.add_init_script` — see `XLSX_STUB` — since
  that CDN is unreachable from this sandbox, same as Google Fonts; the
  stub verifies *our* code calls it correctly, not that the CDN itself
  loads), and the "Send to Agent Portal" handoff into a real second page.
  Also a regression check that the bond-category checkboxes are actually
  inside the `<form>` — the original site's markup had `<label>`/`<form>`
  left unclosed, fixed when this was ported in.
- **Mobile layout (`test_mobile_no_overflow`)** — checks `document.
  documentElement.scrollWidth` stays at or under the viewport width (390px)
  on all four pages. Added after `stat-generator.html` shipped with zero
  responsive CSS (inherited from the original it was ported from) and
  overflowed/overlapped badly on a phone.
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
`DG-`; `dg-agent-portal.html` uses short `PREFIX-XXXX` codes tied to the
Apps Script backend. A code generated on one page is rejected on the other.
This is tracked as roadmap item #1 in the root README ("Unify the
character-code system") — fixing it is a schema decision, not a bug fix, so
it's left as a documented gap rather than silently patched.

## Mock agents

`mock-agents.json` has five fictional Delta Green agents spanning different
professions, used to exercise the Agent Portal's cover-brief form fields and
the random agent generator's profession list. `stat-generator.html` has no
per-character identity of its own (neither did the original PigeonFX tool
it's ported from), so its test doesn't use this fixture.
