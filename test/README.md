# QA harness

Automated smoke tests for this repo's pages — `index.html`, `agent-hub.html`,
`dg-agent-portal.html`, `stats/index.html`, `a-cell.html`, `dg-id-creator.html`,
`notes/index.html` — run against a set of mock Delta Green agents (for the
Agent Portal / ID Creator) plus a direct exercise of the character creator.
Nothing here ever touches the real Google Apps Script backend or Anthropic
API — `run_tests.py` intercepts and fakes both, and Google Fonts requests are
blocked to keep tests fast and offline-safe.

## Run it

```bash
python3 -m http.server 8949 &
python3 test/run_tests.py
```

Results print to stdout and are written to `test/results.json`. Exit code is
non-zero if anything fails. Current suite size is 550+ individual checks
across ~65 test functions.

## What it covers

### stats/index.html

Third-party production code (~17,000 lines across 13 files, see the root
README's Attribution section), so this favors breadth over exhaustively
testing every feature: page loads with no JS exceptions, the Agent Hub nav
link is present, all 6 themes switch without throwing, manual stat +/- works,
random point buy sums to exactly 72, reset returns all six stats to 3, the
profession dropdown has ~18 options, Random Bio fills the name field, the
Character Creation Wizard opens to step 1, and the dice-roller widget opens
and rolls without throwing. Not covered: PDF export/import (pdf-lib,
unreachable from this sandbox and not yet vendored the way JSZip is — see
`test_stat_generator_sheets_roundtrip` below) and Foundry export, and the
save/share-link flow (calls the TinyURL API, also unreachable here).

- **`test_stat_generator_sheets_roundtrip`** — the Google Sheet export
  (`sheets-export.js`, pre-existing) and import (`stats/sheets-import.js`,
  this hub's addition) round-trip a character through a real `.xlsx` file:
  builds a character, exports it, blanks the form, imports the exported
  file back, and checks name/employer/nationality/age/STR all survive the
  round trip. Both directions need JSZip, loaded from a CDN this sandbox
  blocks -- unlike most CDN-dependent features here, this one gets a
  vendored local copy (`test/vendor/jszip.min.js`) served in place of the
  CDN URL via `page.route`, rather than being skipped, since the round
  trip is the main thing worth verifying about this feature. Also
  regression-tests that `stats/assets/Delta-Green-character-sheet-
  template.xlsx` actually exists -- it was missing entirely from the
  initial port (a silent 404 on every export attempt) until restored
  alongside the DD Form 315 PDF template (see the root README's Import
  Character section).
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
- **`test_foundry_import_profession_and_outfit`** — regression test for a
  real bug from a user's Kappa Black Foundry VTT export: importing a
  character never actually set the profession `<select>`, so the
  profession-derived outfit guess in Export to Agent File silently kept
  whatever profession (or none) was already selected — a "Pilot" character
  came out in a leftover police officer's patrol uniform. Root cause had
  two layers: `importFoundryJSONToEditor()` never touched the profession
  field at all, and even where profession *was* applied (`applyState()`,
  used by PDF/Sheets imports) it wrote a human-readable title string
  ("Pilot") to a `<select>` whose option values are lowercase-underscore
  keys ("pilot_sailor") — a silent no-op everywhere it happened. Fixed via
  a shared `matchProfessionKey()` helper (`stats/save-load.js`, callable
  from `scripts.js` too since both are classic `<script>` tags on the same
  page). This test pre-pollutes the profession select with a *different*
  profession first, since that's what actually produced a wrong (not
  merely blank) outfit in the field, then imports `test/fixtures/
  kappablack-foundry.json` (a trimmed copy of the user's real export) and
  checks both the resolved profession and the resulting outfit.
- **`test_kappablack_toml_import`** — Kappa Black's *other* export format,
  a flat `.toml` file with no existing parser on the page. Rather than
  duplicate the ~150 lines of field-mapping the Foundry JSON importer
  already has, `importKappaBlackTOMLToEditor()` (`stats/scripts.js`)
  converts the parsed TOML into the same object shape a real Foundry
  export uses and hands it to the shared `applyImportedAgentData()`. Runs
  against `test/fixtures/kappablack-export.toml` — the user's real
  "Alistair Islay Lagavulin" (Pilot) export, byte for byte — and checks:
  name, profession-title resolution (same `matchProfessionKey()` path
  above), a stat score, a skill whose Kappa Black title doesn't match this
  app's label ("Driving" → `drive`), a plain skill score, one specialty
  row per `[[skills]]` entry that has a `type` (7 total: Craft ×2, Pilot,
  Military Science, Science ×3), both bonds, and — end to end — that
  Export to Agent File's outfit guess reflects the imported profession.
- **`test_import_agent_auto_detect`** — the single "Import Agent" drop
  zone (`#agent-drop-zone` / `#agent-import-auto-input`) at the top of
  `stats/index.html`, replacing having to pick the right button out of
  five in Advanced. `importAgentAuto()` (`stats/scripts.js`) detects
  format by file extension, falling back to sniffing the actual
  bytes/content for a file dropped in without one. This test proves the
  *routing*, not the underlying parsers (those have their own coverage
  above): a real `.toml` fixture routes through the Kappa Black path
  (checked via the "Driving" → `drive` synonym, which only that parser
  performs), a real Foundry `.json` fixture routes through
  `applyImportedAgentData()`, an extension-less file whose content is
  this site's own `v:1` state JSON is content-sniffed and routed through
  `applyState()` instead (a different function than the Foundry path,
  since both are valid `.json` a player might hand over), and an
  unrecognized format fails closed (an auto-dismissed `alert()`) rather
  than throwing — deliberately triggers the dispatcher's own
  `console.error` logging, which is filtered out of the test's exception
  check rather than treated as a failure, since it's the same intentional
  pattern `importFromPDF`/`importFromSheets` already use for their own
  bad-file cases.
- **`test_cloud_save`** — the automatic background Cloud Save
  (`stats/cloud-sync.js`): inactive (no requests) on page load before a
  name is entered, auto-starts and pushes an initial `action:
  'save_character'` POST from *entering a name alone* (no button to
  click — there isn't one), a debounced push fires again after a
  further edit (proves the *ongoing* sync, not just the initial
  auto-start push — this test genuinely waits out the 4s debounce), and
  there's neither a Start nor a Stop button — both existed briefly
  during development and were removed once syncing became fully
  automatic, since neither was really a setting to toggle (Stop in
  particular would have needed its own persisted opt-out flag just to
  mean anything, since any further edit could otherwise silently
  re-provision a cleared code and resume — a toggle nobody can predict
  the state of is worse than not having one). "Load by Code" (called
  directly with a code argument, bypassing the native `prompt()` this
  test isn't exercising) is the one manual control left, since pulling a
  character down inherently needs a code from the player; restores a
  character from a mocked `action=load_character` response and
  re-activates syncing under that code. Confirmed working against the
  real deployment by the user directly.
- **`test_agent_file_open_character_sheet_btn`** — the "Open Character
  Sheet" button on the Agent Portal's Agent File tab, added above the era
  selector. Checks the button is present-but-hidden on the code-gate
  screen (not merely absent from the DOM — an earlier draft of this test
  asserted `.count() == 0` there, which passed for the wrong reason, since
  the button already exists in the DOM at that point with `display:none`
  on an ancestor; fixed to assert `not page.is_visible(...)` instead),
  becomes visible once an agent loads, and navigates to `stats/index.html`.
- **Mobile layout (`test_mobile_no_overflow`)** — checks `document.
  documentElement.scrollWidth` stays at or under the viewport width (390px)
  across `index.html`, `agent-hub.html`, `dg-agent-portal.html`,
  `dg-id-creator.html`, `a-cell.html` (including its Evidence tab's sidebar
  + open create form — a real bug once reported live: that layout's
  fixed-width sidebar didn't stack below 720px, pushing the form off the
  right edge of a phone screen), plus all six `stats/index.html` themes
  individually (X-Files, Modern, Son of Sam, Field Notes, Mobile, and Live
  Play with real content filled in — see the root README's Mobile section
  for what was actually wrong and how it was fixed). Live Play gets several
  extra checks since page-level scrollWidth alone doesn't catch everything
  that was broken there: an earlier version of this fix let `#lp-sheet`
  scroll horizontally within its own box "like panning a PDF," so this test
  used to assert it was *wider* than the viewport on purpose -- real usage
  on a phone showed that just left content off-screen with no cue there was
  more to scroll to, so it now genuinely reflows below 700px and this test
  asserts `scrollWidth <= 390` for it like everything else, plus checks that
  specific Personal Data fields (Nationality/Sex/Age/Education) and the
  Bonds table -- both of which used to sit off-screen to the right in the
  old side-by-side layout -- have their own bounding boxes fully within
  the viewport, not just a smaller overall scrollWidth. The sticky
  HP/WP/SAN/BP tracker bar must fit without its own overflow; SANITY
  ROLL (shortened to "SAN ROLL" and repositioned via flex `order`,
  unlike the generic dice quick-roll, which stays dropped as redundant)
  must still be visible and sit between SAN and BP. This test also
  pushes STR/CON/POW up before checking the tracker bar, not just
  testing a fresh character's low single-digit defaults -- an earlier
  version of this test only checked those defaults, which silently
  hid a real bug: `.lp-tracker-sep`/`-max` (the "/15" half of "15/15")
  were never actually shrunk for mobile, so a genuinely two-digit value
  visually collided with the +/- buttons in real play despite every
  page/bar-level overflow check passing (the container itself never
  overflowed; its children just crowded on top of each other inside
  it), which is why this test now also checks tracker items' own
  bounding boxes for pairwise overlap, not just container scrollWidth.
  The Dice Roller widget (which auto-expands on wide viewports only --
  see above) must stay within the viewport rather than the fixed 270px
  floating panel it used to be.

### dg-agent-portal.html

Tab switching (Cover / Agent File / Cover IDs), full profession dropdown,
random agent generator per profession, cover form submit + dossier render,
localStorage persistence, restoring an agent by code re-renders the dossier
in place on the Cover tab (not just a silent jump to Agent File), Agent File
code-gate loading via the JSONP endpoint, KIA stamp + Vitals/Bonds scoring
once a saved character sheet loads, AI Face/Outfit Plate generation
(`generate_plate_image`, gated on a Face Plate existing before an Outfit
Plate can reference it).

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

### index.html

- **`test_hub_two_cards`** — links to exactly `stats/index.html` and
  `dg-agent-portal.html`, no more, no standalone ID Creator card.
- **`test_hub_latest_agent_panel`** — the hub's "Continue Playing" panel.
  Checks it's hidden entirely (not an empty/broken preview) in a fresh
  browser with no saved agent, then that a saved agent (`dg_last_agent`,
  including a photo) produces a populated preview -- name, code, codename,
  updated date, photo -- that links straight to the Agent Portal's Agent
  File tab. Needs the same font-blocking `page.route` calls as
  `test_stat_generator_agent_file_nav` (see above) for the same reason:
  `index.html`'s own inline `<script>` sits after its Google Fonts
  `<link>`, so an unblocked font request hangs it, not just slows it down.

### dg-id-creator.html

Still tested on its own (manual name entry, code loader behavior) even
though nothing links to it anymore, since the file is still in the repo.
Its visual theme (paper/dossier styling to match the rest of the hub) is a
CSS-only change with no functional test coverage — verify it visually if
you touch that stylesheet again.

### agent-hub.html (the player's own hub)

- **`test_agent_roster`** — the Agent Roster drawer (ported from the
  project's `Dev` branch alongside the Cover ID Fabricator). Submits 3
  different agents across separate page loads (tracking each one's real
  generated code, not assuming order), checks all 3 join the roster and
  the most recently submitted is the one marked active, switches to a
  different card and confirms that agent's data actually loads (exercises
  the "fetch by code" path, not just the in-memory shortcut), deletes an
  entry, and exports the roster as JSON. The "most recent is active" check
  is a regression test for a real bug found while building this:
  `handleSubmit()` never updated the in-memory `afCode`/`afData` globals
  after a fresh Cover submission (only the load-by-code path did), so the
  roster's active-agent detection kept pointing at whichever agent was
  active *before* the latest submission. Needs a custom, code-aware
  `script.google.com` mock (not the shared `mock_routes()`, which returns
  identical data regardless of the requested code) so switching to a
  specific agent can be verified to load *that* agent, not just some agent.
- **Cover Identity** — entering a real name in the sticky-note field at the
  top of the page replaces this browser's *claimed* roster entries with
  every Agent tied to that `player_name` (character sheet, Agent File, or
  both); an Agent tied to a *different* name doesn't show up even if this
  browser touched it before, but an Agent with no `player_name` at all yet
  is kept regardless, rather than vanishing the moment someone else's name
  is searched on the same device.
- **Handouts** (A-Cell's Evidence Locker, mirrored read-only here under its
  original name) — one shared fetch of Cells + Evidence reused across every
  Agent's panel: a Cell-scoped item only shows for an Agent who's actually
  a member of that Cell, a campaign-wide one (blank `cell_id`) shows for
  everyone, a photo opens in a full-size lightbox, and each Agent has their
  own private per-Handout notes (`list_handout_notes`/`save_handout_note`,
  debounced auto-save, never surfaced to the Handler) scoped to
  `(handout_id, agent_code)`.
- **KIA** — a saved character sheet at 0 HP shows a KIA stamp and a
  struck-through name on the roster tab; above 0 HP shows neither.
- **Erase Agent** — a real backend `delete_character` call (not just local
  roster removal), gated behind a confirm.
- **Notes button** — links to `notes/index.html?code=<that Agent's code>`,
  deep-linking straight to that Agent's notes rather than the picker's
  default "most recently active" Agent.

### a-cell.html (the Handler's dashboard)

Password-gated (a separate, shared, in-fiction "clearance" password, not
real per-Handler auth), with a real `HANDLER_PASSWORD` Script Property
exchanged for a short-lived session token (`handler_login` /
`requireHandlerSession_()` in `backend/Code.gs`) gating a handful of
Admin-only listing reads (`list_characters`, `list_agent_file_only`,
`list_deleted_characters`) — everything else (`list_cells`, `list_evidence`,
`list_operations`, and every Handler write) is either open or gated behind
just the plain `handler_password` on the write itself.

- **Play** — every Agent on file (not just this browser's own roster),
  pulled from `list_characters`'s flat per-Agent summary rather than each
  Agent's entire character sheet; picking an Agent fetches that one Agent's
  full sheet on demand (`load_character`). A Cell filter narrows the list
  to one Cell's members and adds a "Cell Dashboard" (HP/WP/SAN/BP for every
  member at a glance). KIA stamp for an Agent at 0 HP.
- **Cells** — real named groups (a Handler + member Agents picked from the
  full roster), backed by `list_cells`/`create_cell`/`update_cell_members`/
  `delete_cell`.
- **Evidence** — evolved from the original "Handouts" tab into a full
  locker: items are filed into per-Operation folders within a Cell (or left
  Unfiled, or scoped to All Cells), staged behind a **Released** toggle
  (independent of when filed — existing Handouts from before this
  migration start unreleased by design and need one manual Release click
  each), and can be **restricted to specific Agents** within that Cell
  (empty = whole Cell once released). Backed by `list_evidence`/
  `create_evidence`/`update_evidence`/`delete_evidence` plus
  `list_operations`/`create_operation`/`update_operation`/`delete_operation`.
  Covers filing into a folder, the Released toggle flipping a card's staged
  styling, the per-Agent restriction checklist round-tripping through
  Edit, folder filtering (All/Unfiled/a named Operation), deleting an
  Operation not cascade-deleting the evidence filed under it, and a real
  photo (>64KiB base64, over the `keepalive` cap) still reaching the
  backend since that one POST deliberately omits `keepalive`.
- **Sheet** — a dense, spreadsheet-style roster table (Cell, Handler, Agent
  Name, Player Name, HP, SAN, Online) merged with the former separate Admin
  tab, so deleting an Agent happens right on their own row instead of a
  second tab re-fetching the same roster. An Agent File / Profiling brief
  with no character sheet yet shows as its own row with dashes for the
  columns it has no data for. Recently Deleted lives below the table,
  restorable for 24 hours before the backend permanently purges it.
- **Music** — the Handler's broadcast side of Table Radio (see below).
- **Handler-session recovery race** (`test_acell_handler_session_race`) —
  regression test for a real live bug: if a Handler already has a saved
  password from a previous visit, the silent re-login that fetches a fresh
  session is still an in-flight request when Play/Cells/Sheet's own
  `<script>` blocks fire their first data fetch using whatever (possibly
  expired) session was already in `sessionStorage`. Those tabs used to just
  show "invalid or expired Handler session" and sit there forever, even
  after the silent re-login landed a valid new session moments later.
  Fixed by having the Handler-password module dispatch a
  `dg-acell-handler-ready` event once it lands a session, which Play/Cells/
  Sheet now listen for to retry. This test deliberately checks only the
  end state (does it recover at all), not an intermediate "still showing
  the stale error" snapshot — this suite's Playwright route mocking runs on
  a single dispatch thread, so an artificial delay meant to widen the race
  window ends up serializing every in-flight request behind it instead,
  making any fixed-timeout snapshot of the intermediate state unreliable.

### notes/index.html (shared/private Cell notebook)

One notebook per Cell: your own tab mounts a real, live Editor.js instance
(Header/List/Delimiter blocks, Bold/Italic/Highlight, paste-splitting from
Google Docs/Notion-shaped clipboard content); every other view — another
member's tab, the combined Shared feed — is a hand-rendered read-only HTML
feed built from the same stored block data, since Editor.js only supports
one editable document per instance. Privacy is per-block: toggling
**Circulate** on the focused block shares it to the Cell; everything else
stays private to its author and never appears anywhere else in the page,
not even hidden in the DOM.

- Auto-identifies the viewer from a device's saved Cover Identity or a
  manual Agent Code fallback (never a Cell picker — a player only ever
  picks *which of their own Agents*, never *which Cell*, since that's
  derived from the Agent). A first-time viewer picks an identity
  color/cursive display font (Nothing You Could Do / Shadows Into Light /
  Reenie Beanie), remembered afterward.
- **`?code=`** on the URL opens that specific Agent's notes directly,
  rather than the roster's most-recently-active one — but "Change Agent"
  still returns to the normal picker instead of re-forcing that URL's Agent
  open again.
- A real reload-bug fix: a block saved before the page loaded reappears in
  your own tab on a fresh open (own blocks used to only populate from a
  live `editorInstance.blocks.render()` call gated on Editor.js's own
  `isReady` promise, since public API methods aren't attached until its
  internal async init finishes).
- **Timeline** — the Shared tab only, groups shared blocks by date into
  separate sections with a header each, toggle-able back to a flat view,
  content unchanged either way.
- **Pin** — surfaces the focused block in its own "Pinned" section of the
  sidebar Index, ahead of the normal chronological/alphabetical listing.
- **Tags** — NPC/Location/Clue, added via a popover on the focused block,
  saved as `{type, label}` in the block's own `tags` field, shown as
  color-coded chips both in the popover and on the rendered block.
- **Search everywhere** — widens the sidebar Search into a combined
  "Search Results" spanning your own blocks (any privacy) and every other
  member's *shared* blocks; a hit on a shared block jumps to the Shared
  tab (since that's where it's actually visible), clearing the search
  restores the normal Index.
- **Plain Fonts** — an always-visible toggle reverting everyone's display
  back to the site's own Special Elite (headers) / Courier Prime (body)
  look while keeping each author's chosen ink color, independent of the
  per-viewer identity font picked above.
- Mobile: the block-type picker popover's dimming backdrop is forced onto
  its own GPU compositing layer below 650px — a known iOS Safari bug where
  a `position:fixed` element inserted into an already-scrolled page gets
  stuck at its creation-time scroll offset instead of tracking the real
  viewport, reported live and not reproducible in this suite's Chromium-
  based browser, so this is a best-effort fix rather than one this suite
  can directly verify.

### Table Radio (shared across every player-reachable page, plus `stats/`)

A persistent widget keeping a player "tuned in" to whatever the Handler
broadcasts from A-Cell's Music tab, staying loosely in sync via a
server-stamped `started_at` timestamp every device reads. Covers the main
track, Track Library, and per-channel playlist, plus the widget's
minimize/expand states and volume slider. (Ambient layers and one-shot
stinger sound effects were built and tested once but later deliberately
dropped for unusable procedurally-synthesized audio quality — see
`README.md`'s Table Radio section — so there's no live coverage for
either here anymore.)

### PWA / offline

`manifest.json` + `sw.js`: the service worker registers and takes control,
every page in `SHELL_FILES` is precached and still loads fully offline with
no JS exceptions, and the "update available" banner appears after a real
`controllerchange` event (not before) with a working Reload button. `sw.js`
runs stale-while-revalidate over the static shell only — real backend calls
are deliberately left alone so the app never serves stale campaign data
offline and calls it a feature. `CACHE_NAME` needs bumping on every shell
file change, including files that only ship client-side renames/behavior
changes (not just new files) — this was missed across an entire feature's
rollout once, leaving installed PWAs on phones stuck serving a stale
pre-rollout app shell (old tab names, old error text) until the version
string was finally bumped and the service worker had something to detect
as a real update.

## Known gap this suite documents, doesn't fix

Three separate, incompatible identity/save systems: the now-unlinked
`dg-id-creator.html`'s code loader expects a base64-JSON code prefixed
`DG-`; `dg-agent-portal.html` (including its Cover IDs tab's Fabricator)
uses short `PREFIX-XXXX` codes tied to the Apps Script backend; `stats/`'s
save/share system is its own localStorage + TinyURL-link scheme, unrelated
to either. Nothing generated on one loads on either of the others. This is
tracked as roadmap item #1 in the root README ("Unify `stats/`'s Share URL
with everything else") — fixing it is a schema/architecture decision, not a
bug fix, so it's left as a documented gap rather than silently patched.

## Vendored fixtures

`test/vendor/jszip.min.js` is a local copy of the same JSZip build
`sheets-export.js`/`sheets-import.js` load from cdnjs.cloudflare.com in
production, served in its place via `page.route` for
`test_stat_generator_sheets_roundtrip` since that CDN (like unpkg.com for
pdf-lib) is blocked from this sandbox. Update it if the app's own
`JSZIP_CDN` version pin ever changes.

`test/fixtures/kappablack-foundry.json` and `test/fixtures/kappablack-
export.toml` are both derived from real exports a user shared directly (the
only way to get Kappa Black's actual schema, since kappablack.com and its
GitHub source were both unreachable from this sandbox) — the `.toml` one is
byte for byte; the `.json` one is trimmed but structurally representative.

## Mock agents

`mock-agents.json` has five fictional Delta Green agents spanning different
professions, used to exercise the Agent Portal's cover-brief form fields and
the random agent generator's profession list. `stats/index.html` builds its
own characters end-to-end (professions, bio, stats) as part of its own test,
so it doesn't use this fixture.
