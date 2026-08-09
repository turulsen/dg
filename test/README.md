# QA harness

Automated smoke tests for the four Agent Hub pages, run against a set of mock
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

- **stat-generator.html** — random 3d6 rolls stay in range, point-buy pool
  math updates on edit, sheet generation includes name + derived stats.
- **portrait-questionnaire.html** — full form fill + submit renders a
  dossier, no JS exceptions.
- **dg-agent-portal.html** — tab switching (Cover / Agent File / Cover IDs),
  full profession dropdown, random agent generator per profession, cover
  form submit + dossier render, localStorage persistence, Agent File
  code-gate loading via the JSONP endpoint.
- **dg-id-creator.html** — manual name entry, code loader behavior.

## Known gap this suite documents, doesn't fix

`dg-id-creator.html`'s code loader expects a base64-JSON code prefixed
`DG-`; `dg-agent-portal.html` / `stat-generator.html` /
`portrait-questionnaire.html` all use short `PREFIX-XXXX` codes tied to the
Apps Script backend. A code generated on one page is rejected on the other.
This is tracked as roadmap item #1 in the root README ("Unify the
character-code system") — fixing it is a schema decision, not a bug fix, so
it's left as a documented gap rather than silently patched.

## Mock agents

`mock-agents.json` has five fictional Delta Green agents spanning different
professions, used to exercise the cover-brief form fields and the random
agent generator's profession list.
