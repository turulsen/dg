# Features & Architecture Reference

A system-level reference for this project: what's built, what each
piece is actually *for*, how it works under the hood, and what's still
open. Written so someone without this project's history — a fresh
session working on the `firebase-migration` branch, say — can
understand what a bug report is actually describing without having to
reverse-engineer it from the code alone. Pairs with `BUGFIXES.md`
(every bug ever fixed, chronologically) and `README.md` (the shorter
player/Handler-facing overview).

**Branch note:** this document describes the architecture as it stands
on `claude/delta-green-agent-hub-sn79d4` — Google Sheets (via Apps
Script) as the backend, Google Drive for images/audio. A separate
`firebase-migration` branch (already partially merged to `main`) is
layering Firestore and Firebase Storage on top of this — see "Firebase
migration status" near the end. Where the two disagree, this doc is
describing the Sheets/Drive version; check which branch you're
actually looking at before trusting a specific function name.

---

## 1. Pages and what they're for

| Page | Who uses it | Purpose |
|---|---|---|
| `index.html` | Everyone | Boot-splash animation, then a two-card chooser: **Agent** (player) or **A-Cell** (Handler, password-gated). Entry point for the whole site. |
| `agent-hub.html` | Players | A player's own hub. Reads this browser's local Agent roster and renders one folder tab per Agent, plus "+ New Recruit". Each tab has **Play** (character sheet, loaded, Live Play on), **Agent File**, **Field ID**, a read-only mirror of Evidence filed for that Agent, and (if unassigned) a Cover Identity search box. |
| `dg-agent-portal.html` | Players | One Agent's dossier. Three tabs: **Profiling** (physical description + AI portrait prompt), **Agent File** (the assembled, read-only dossier — gated behind Profiling being complete), **Field IDs** (in-page fake-credential card generator). Backed by the Apps Script backend. |
| `stats/index.html` | Players | The actual Delta Green character sheet/creator — stats, skills, professions, Bonds, equipment, dice roller, Live Play tracker bar, five visual themes, import from five different formats, Cloud Save. This is a ported third-party project, see §2. |
| `a-cell.html` | Handler | The Handler's dashboard, password-gated. Tabs: **Play** (every Agent, simplified, for running the table), **Cells** (group Agents under a Handler), **Evidence** (file documents/photos, scoped to a Cell or campaign-wide), **Sheet** (dense Excel-style roster), **Music** (Table Radio broadcast controls), **Admin** (delete/restore Agents, including Agent-File-only entries). |
| `dg-id-creator.html` | Players | A standalone, older fake-ID-card generator. Superseded by the Field IDs tab's own Fabricator; kept in the repo, not linked from anywhere, no code system of its own left. |
| `notes/index.html` | Players & Handler | Player Notes — a shared/private notebook scoped to a Cell. See §3. |

Every page is a single self-contained HTML file with inline CSS/JS,
except `stats/` (a direct multi-file copy of the upstream project, kept
diffable) and `notes/` (its own small file set). No build step,
anywhere.

---

## 2. Character Creator (`stats/`)

**What it is:** the actual Delta Green character sheet. Point-buy or
dice-roll stats, 18 professions with contextual skill packages, bonus
skill points, Bonds, an equipment loadout picker, a general-purpose
dice roller, and export to PDF/Foundry VTT. It's a direct,
unminified port of a third-party open-source project — **[pigeon-
labs-stack's DELTA-GREEN-STATS](https://github.com/pigeon-labs-stack/DELTA-GREEN-STATS)**
— kept as a multi-file copy specifically so it can still be diffed
against upstream if ever worth re-syncing. This is what "Pigeon" means
whenever it comes up in this project's history; it is not itself an
import format.

**Five visual themes** (X-Files, Modern, Son of Sam, Field Notes,
Mobile) — all upstream, all made mobile-responsive by this project
(the upstream themes were desktop-first and genuinely broke on a
phone; see `BUGFIXES.md`'s mobile-layout section for the specifics).

**Live Play** is an orthogonal mode layered on top of whichever theme
is active (not a theme of its own) — a sticky HP/WP/SAN/BP tracker bar
across the top, meant for actual table use.

**Import**, one drop zone, five formats auto-detected and routed to
the right parser (`importAgentAuto()`): this hub's own printable/PDF
export, official published Delta Green Agent PDFs (same AcroForm field
names), a round-tripped Google Sheets export, Foundry VTT actor JSON
(native to the upstream project), and **Kappa Black** (`.toml`) — a
completely separate third-party character-builder app with its own
flat export format, parsed by a hand-rolled TOML parser scoped to
exactly what Kappa Black's export uses (`parseSimpleTOML()` /
`convertKappaBlackToAgentData()`), then reshaped into the same
Foundry-actor-shaped object every other importer produces so the
~150-line field-mapping function (`applyImportedAgentData()`) is
shared code, not duplicated per format.

**Cloud Save** (`stats/cloud-sync.js`): fully automatic background
sync to the backend, keyed by an Agent Code — starts the moment a real
name is entered, debounces every edit after that, no Start/Stop
button. This is what lets a character follow a player between devices
without a file changing hands.

**Export to Agent File** (`stats/agent-portal-export.js`): the "Open
Agent File" button sends a finished character to the Agent Portal
using the *exact same submission path* the Portal's own Profiling
form uses. It reuses the character's existing Cloud Save code (never
mints an unrelated second one), and carries over name, age range, sex,
nationality, profession, a derived build description, and a
profession-appropriate default outfit — nothing about physical
appearance beyond that, since a character sheet has no source for face
shape, eye color, hair, etc. Those stay for the Profiling form to fill
in by hand, which is why a just-exported Agent File visit lands back
on Profiling instead of the finished dossier — see §5.

---

## 3. Player Notes (`notes/`)

**What it's for:** a shared/private notebook scoped to a Cell — the
place players actually jot down clues, NPC names, theories, and
in-character journal entries during and between sessions, with a
Handler-visible Shared feed alongside each Agent's own private tab.

**How it's built:** [Editor.js](https://editorjs.io/) as the block
editing engine (migrated from a hand-rolled contenteditable version
early on — see `BUGFIXES.md`'s Player Notes section for the editing-
instability bugs that motivated the switch). Blocks save individually
via `save_note_block`, polled every ~5s (`list_cell_notes`) so
Cell-mates see updates without a manual refresh.

**Circulate**: a per-block toggle a player can flip to make one of
their own notes visible to the whole Cell without moving it out of
their own tab — the note stays "theirs" but becomes readable by
everyone in the shared feed.

**Solo mode**: an Agent not yet assigned to any Cell still gets a
fully live, editable Notes panel — keyed to a synthesized
`solo:<agentCode>` pseudo-cell-id instead of blocking them entirely
with a wall of "ask your Handler." The Shared tab is hidden (nothing
to share with yet). The first time a Handler assigns that Agent to a
real Cell, `updateCellMembers()`'s `migrateSoloNotesToCell_()` carries
the solo notes forward onto the real cell_id automatically.

**Split View** (`stats/index.html`): the character sheet and Notes
side by side in two panes (desktop/tablet), or a full-screen flip
between them on a phone (Table Radio and the settings cog hide
themselves while Notes is fullscreen). A dice roll made by clicking a
skill inside Split View's *embedded* sheet iframe relays to the
outer page's visible dice panel via `postMessage`, since the iframe's
own dice panel is hidden by design there.

**Identity color/font**: each Agent picks (and the backend remembers,
via `save_agent_identity`) an ink color and handwriting-style font, so
Notes visually distinguishes who wrote what without needing names on
every line.

**Getting to the sheet from Notes**: the "← Agent Hub" backlink and
"Change Agent" button that used to sit at the top of `notes/index.html`
are gone -- replaced by **Split View** and **Character Sheet** buttons
(same spot the "Change Agent" button used to occupy), both navigating
to `stats/index.html?load=CODE` for whichever Agent's Notes are open
(`&split=1` added for the Split View one, picked up by a small addition
to `stats/cloud-sync.js`'s existing `?load=` handler -- mirrors the
already-existing `?live=1` pattern that jumps straight to Live Play).
The embed=fullscreen "Play" flip-back button (Split View's own way back
to the sheet when Notes is the mobile fullscreen pane, see above) is
untouched -- this only affects Notes reached normally, not embedded.
Split View hides below 900px width (`#split-view-btn`'s own media
query in `notes/index.html`), the same cutoff `stats/index.html`'s own
`#split-view-toggle-btn` already uses -- Character Sheet alone still
makes sense on a phone; Split View's two panes don't fit there.

---

## 4. Evidence Locker (formerly "Handouts")

**What it's for:** the Handler's way to hand out in-fiction documents
— case files, photos, clippings — either campaign-wide or scoped to a
specific Cell/Operation, with each item mirrored read-only into every
relevant Agent's own hub view.

**Backend model:** an `Evidence` sheet (one row per item — title,
description, photo, restricted_to a Cell/Operation or blank for
everyone), an `Operations` sheet (folders under a Cell — one Operation
per Cell, see the sheet's own comment for why), and an `EvidenceSeen`
sheet tracking which Agent has opened which item (a purely cosmetic
"unseen" dot, no auth gate).

**Where it shows up:** A-Cell's Evidence tab (create/edit/delete,
full management), `agent-hub.html`'s read-only mirror per Agent
(fetches with that Agent's own code so the backend's Cell-membership
filter can correctly include Cell/Operation-restricted items), and
surfaced inside Player Notes too (Evidence Locker Stage 3). **[Updated
— verified against current code]** Photos upload directly to Firebase
Storage now (Phase 4, same as Face/Outfit Plates below) — the client
uploads the file itself and POSTs back the resulting URL;
`resolveEvidencePhoto_()` in `Code.gs` only still falls back to Google
Drive for a raw `data:` URI, i.e. an older client that never made this
switch. Also now dual-written to Firestore and read live via
`onSnapshot` on A-Cell's Evidence tab and `agent-hub.html`'s mirror —
see §12.

**Terminology note:** the UI-visible label is "Evidence," but this
started life as "Handouts" and some internal names (`HandoutNotes`, a
per-Agent-private-note-on-an-item feature, `save_handout_note`) still
use the old name. Not a bug, just an unrenamed internal detail.

---

## 5. Agent Portal / Profiling / Agent File

**What it's for:** the actual in-fiction "dossier" for an Agent — a
physical description brief (Profiling), an AI-assisted portrait-prompt
generator, and the assembled read-only Agent File view a player
returns to across sessions.

**Profiling → Agent File gate:** the Agent File tab only renders once
`isProfilingComplete()` considers every `[required]` field on the
Profiling form filled in. This is a deliberate design choice (a
half-finished record isn't worth showing as if it were done), but it's
also the mechanism behind a real, still-open UX gap: any character
sheet export (§2, Kappa Black or otherwise) only ever fills ~7 of the
~20 required fields (name, age, sex, nationality, profession, build,
outfit — never the ~13 pure-appearance fields like eye color or hair,
since a character sheet has no source for those), so a player landing
on their Agent File right after export gets bounced back to a
mostly-blank Profiling form instead, with no explanation of why. See
`BUGFIXES.md`'s "Recent fixes" and the diagnosis on this specific gap
handed to the firebase session separately — **this one is still open,
not yet fixed.**

**Per-era Field Portrait/Reference:** an Agent can have multiple
"eras" (decades) active — `active_eras` — each with its own Face
Plate/Outfit Plate images and AI-drafted portrait prompts, stored in
16 dedicated per-era sheet columns (`era_<era>_face_url`/`outfit_url`/
`mode0`/`mode1` for each of 90s/00s/10s/20s). This was a real, now-
fixed bug: for a long time, all eras silently shared 4 flat columns
and each new era overwrote the previous one's Plates/prompts.

**AI portrait generation:** `generate_prompt` drafts the actual
portrait description text via **Claude** (server-side, so the API key
never touches the browser), and `generate_plate_image` renders it into
an actual image via **Gemini**. Both are rate-limited per Agent
(10/10min and 3/10min respectively) since they call paid external
APIs. The generated image is then saved through the same `save_plate`
action a manual upload uses — one Drive-upload/Sheet-write path either
way.

**Field ID Fabricator:** an in-page (not separate-page) fake-
credential card generator — pick a cover agency and era, it renders a
period-styled card live, watermarked "PROP — NOT A GOVERNMENT
DOCUMENT."

**Agent Roster:** a persistent, multi-agent list in this browser's
`localStorage` (`dg_agent_roster`) — every Agent submitted, loaded by
code, or played in this browser, independent of the backend. Lets a
Handler or a multi-character player switch between several Agents
without re-entering a code each time. `agent-hub.html` renders this as
folder tabs directly.

**Cover Identity:** a real-name lookup (`find_by_player_name`) that
replaces this browser's *claimed* roster with every Agent tied to that
`player_name`, so a fresh device or a cleared browser can find a
player's existing Agents without knowing every Agent Code by heart. A
bare name match, deliberately — no PIN/auth (tracked as a real, later
roadmap item, not yet built). An Agent with no `player_name` at all
yet is preserved regardless of what's searched, rather than vanishing
the moment someone else's name is looked up on the same device.

---

## 6. A-Cell (Handler tools)

**Play tab:** every Agent on file, simplified, for running the table —
the Handler's primary in-session view.

**Cells tab:** named groups of Agents with an assigned Handler — the
organizing unit almost everything else (Evidence scoping, Notes'
Shared feed, Table Radio's "Cue For Cell") hangs off of. An Agent can
belong to multiple Cells. **"Unassigned Agents"** are surfaced here
too, with a click-to-assign popup (added alongside the Notes solo-mode
fix — previously these were shown but inert).

**Sheet tab:** a dense, Excel-style table across every Agent —
including a directly-editable Player Name column, useful for a Handler
backfilling identity info a player hasn't set themselves yet (this is
what lets Cover Identity eventually find that Agent).

**Admin tab:** soft-delete/restore an Agent (`delete_character`/
`restore_character` — archives rather than destroys, with a 24h auto-
purge of anything left in Recently Deleted), plus a separate listing
for Agent-File-only entries (a Profiling brief with no character sheet
yet) that the main delete list can't see.

**Music tab:** see §7.

**Auth:** the whole page is gated behind a shared Handler password
(`HANDLER_PASSWORD`, an Apps Script Script Property) — see §9 for how
that's actually enforced per-action.

---

## 7. Table Radio (shared music widget)

**What it's for:** keeps every player "tuned in" to whatever the
Handler is broadcasting from A-Cell's Music tab, staying loosely in
sync across page navigations via a server-stamped `started_at`
timestamp every device reads. A small persistent widget
(`assets/table-radio.js`) included on every player-reachable page.

**Layers:**
- **Main track** — the current YouTube/SoundCloud embed or uploaded
  mp3 the Handler set as Now Playing for a channel. Pause/Resume
  (freezes in place, doesn't restart) and Restart are separate from
  Set Now Playing (always restarts from 0:00).
- **Track Library** — mp3s uploaded once (to Drive), then cued on any
  channel without re-uploading; a per-channel **playlist** persists
  across reloads.

- **Ambient loops** — 7 real recorded loops (`assets/ambient/*.mp3`,
  GowlerMusic Halloween pack), toggled on/off per channel from A-Cell's
  Music tab soundboard and layered *under* the main track (or under
  silence — independent of whether a track is even set). Each active
  loop is a full instance object (`id, started_at, paused, paused_at,
  loop`), not a bare id — diffed against what's already looping rather
  than restarted wholesale on every Firestore snapshot, so an
  already-playing loop keeps its own position when some other layer or
  the main track changes, and can be paused, seeked, or un-looped
  independently via A-Cell's Active Sounds panel (below) without
  turning it fully off.
- **Stingers** — 18 one-shot sounds (`assets/stingers/*.mp3`, same
  pack), grouped in the soundboard as Screams & Laughter, Impacts &
  Weather, and Bells/Rhythm/Texture. Firing one appends a fresh
  instance (`id, fired_at, started_at, paused, paused_at, loop`) to an
  array of recent fires (non-looping ones trimmed to the last 5; a
  stinger a Handler turns into a loop is exempt from that trim and
  stays until explicitly stopped) rather than a single scalar, so two
  stingers fired close together both survive to play as separate,
  genuinely overlapping `<audio>` elements instead of the second
  clobbering the first. `fired_at` is a stable identity that never
  changes; `started_at` is a separate field pause/resume/seek actions
  are free to shift without disturbing that identity or a client's
  own "have I already played this one" bookkeeping.
- **Active Sounds panel** — A-Cell's Music tab lists every currently
  active ambient loop and stinger as its own row (real scrubber,
  Play/Pause, an unambiguous Stop, and a Loop toggle — all inline SVG,
  same reasoning as the Now Playing panel's icons below), each backed
  by its own headless preview `<audio>` for accurate duration/position.
  Every control calls a dedicated Code.gs action addressed at that one
  instance (`pause_ambient_layer`/`resume_ambient_layer`/
  `seek_ambient_layer`/`set_ambient_layer_loop`, and the stinger
  equivalents keyed by `fired_at`), so stopping or pausing one loop or
  SFX never touches any other sound playing at the same time — the real
  fix for "toggled a loop on and couldn't tell how to turn it off,"
  where a plain on/off toggle button was the only affordance and easy
  to lose track of.
- **Now Playing control panel** — A-Cell's Music tab has a dedicated
  panel (the wide column, above the Cue List) showing whatever's live
  on the dialed channel: a "Table Radio — CH. N" header, the track
  title, a scrubber with elapsed/duration labels, one shared Restart /
  Pause-Resume / Stop transport row (Pause-Resume is the bigger,
  highlighted center button — the one actually used mid-broadcast —
  with Restart/Stop smaller on either side), and a volume slider with a
  speaker icon, muted by default. Every icon (transport row, speaker)
  is inline SVG (`fill="currentColor"`, same approach as
  `assets/dice-roller.js`'s own die-face icons) rather than Unicode
  media-control glyphs or an emoji speaker — those render as full-color
  platform emoji on some devices, entirely font-dependent; the speaker
  icon itself swaps between a "volume" and a "muted" glyph depending on
  the slider's position. For an uploaded Track Library pick or any
  direct mp3/wav/ogg/m4a URL, the scrubber and volume are driven by a
  real headless `<audio>` element (no `controls` attribute — the
  browser's own native media-player chrome doesn't match this app's
  look) for accurate duration/position, not an estimate; it swaps to a
  fresh track automatically the moment a different one starts playing.
  Dragging the scrubber or hitting Pause/Resume sends the same
  `seek_now_playing`/`pause_now_playing`/`resume_now_playing` actions
  either way. A pasted YouTube/SoundCloud/generic URL has no cheap way
  to get a real embed+duration here, so its scrubber falls back to an
  elapsed-seconds-only draggable slider (no volume row, since there's
  no local audio engine to control). Players only ever see a
  **read-only** progress bar in the widget's own expanded panel
  (`assets/table-radio.js`), so nobody can scrub their own copy out of
  sync with the actual broadcast.

Both the soundboard and the scrubber dual-write straight onto the same
`radio/{channel}` Firestore document Now Playing already lives on
(`set_ambient_layer`/`trigger_stinger`/`seek_now_playing` in
`backend/Code.gs`), so the existing `onSnapshot` listener in
`assets/table-radio.js` picks up every toggle/fire/seek instantly with
no new listener, collection, or poll loop.

Real recorded SFX, replacing an earlier procedurally-synthesized
attempt (rain/wind/static ambient loops, a 13-sound stinger soundboard)
that was built, tested (399/399 Playwright checks passing), and
deliberately abandoned before merging to `main` -- that audio wasn't
convincing enough (only 4 gunshot variants were usable; explosions,
vocals, knock/creak weren't), so the branch was archived rather than
iterated on further. See `design-graveyard/table-radio-audio-soundscape`'s
own `RETROSPECTIVE.md` for the full account, including its own
recommendation (followed here) to use real recordings instead of
synthesis if revisited.

**Channel model:** 5 fixed channels, selected via a rotary-dial UI on
both the Handler and player sides (not free text — avoids the
typo/mismatch class of bug a text field invited).

---

## 8. PWA / Offline support

`manifest.json` + `sw.js` make the whole hub installable to a phone's
home screen and usable with no signal. `sw.js` runs a **stale-while-
revalidate** strategy over the static app shell (every page, script,
stylesheet, icon listed in `SHELL_FILES`) — instant load from cache,
refreshed in the background for next time — while deliberately never
touching any `script.google.com` (backend) call, so it can never serve
stale campaign data offline and call it a feature. `CACHE_NAME` gets
bumped on every shell-file change; a dismissible "update available"
banner (`assets/sw-update.js`) tells an already-open tab when a new
deploy has taken over.

**iOS standalone-PWA constraint worth knowing:** `window.alert()`/
`confirm()`/`prompt()` are silently disabled entirely inside a home-
screen-installed (standalone) PWA — they do nothing and return
immediately, which is exactly this app's primary intended use mode.
Every confirmation/prompt in this codebase uses real in-page UI
instead (inline text inputs, `dgConfirm()` in `stats/save-load.js`, or
a plain browser `confirm()` only on pages/flows confirmed not to need
standalone support) — if a fix ever reaches for a native dialog,
check whether the page it's on needs to work standalone first.

---

## 9. Backend architecture (`backend/Code.gs`)

**What it is:** a single Google Apps Script project (`Code.gs`, ~4000
lines) backing every `script.google.com` call across the whole site.
It lives outside this repo natively — Apps Script has no git
integration — so `backend/Code.gs` is a **checked-in mirror**, kept in
sync by hand: edit here, then paste the whole file over the live
project's `Code.gs` in the Apps Script web editor and create a new
deployment. **Pushing to GitHub alone never touches the live
backend** — this is the single most important thing to remember when
a "fix" doesn't seem to take effect.

Every page degrades gracefully when a given action isn't live on the
deployed backend yet — JSONP calls just fail silently — so this repo's
frontend can ship ahead of the deployed backend without visibly
breaking anything (until that action's own feature is used).

**Transport:** GET requests use JSONP (`?action=...&callback=...`,
literally a `<script src>` tag, since Apps Script's response can't set
CORS headers for a real cross-origin `fetch`); most writes are POST
requests with `mode: 'no-cors'`, which means **the client can never
read the response** — every write of this kind is fire-and-forget,
which shapes a lot of this codebase's design (see the note on
Agent-token auth below, and why brief submission just silently
upserts rather than confirming success back to the caller in a way the
UI can react to beyond an optimistic assumption).

**Auth model — read this before assuming a token check does
anything:**
- `requireHandlerAuth_()` checks a real password (`HANDLER_PASSWORD`
  Script Property) — this is real and enforced, gating every
  Handler/admin write.
- `requireHandlerSession_()` gates the three full-roster-dump GET/JSONP
  reads (`list_characters`, `list_agent_file_only`,
  `list_deleted_characters`) behind a short-lived opaque session token
  (`handler_login`, 6h TTL via `CacheService`) instead of the raw
  password, since a GET can't safely carry a real secret in a URL.
- **`requireAgentToken_()` is a permanent no-op — it always returns
  null (no error), on every call site.** A real per-Agent token system
  was built (an `AgentAuth` sheet, token minting, a Handler-mediated
  recovery flow) and then deliberately **removed** after weighing what
  it actually protected against: this app has essentially no real PII
  to leak, and the only workable claim mechanism for a fire-and-forget
  `no-cors` write is "whoever presents a token first, wins" — not real
  authentication, just a confusing race. The removal is a one-line
  revert (not deleted at each of its ~10 call sites) if the campaign's
  risk profile ever changes and this needs re-enabling for real. **Do
  not assume player-owned writes (Notes, medical log, AAR, Profiling)
  have any access control today — they don't, by design.**
- `doLookup()` (Agent lookup by code) and `find_by_player_name` are
  both intentionally unauthenticated — this app's whole access model
  is "the code is your key," and the fields exposed are fictional
  character content, not real personal data.
- **[Added — missing from this doc entirely]** A second, separate auth
  layer exists purely to gate live Firestore reads (Table Radio, Dice
  Roller, Player Notes, Evidence — see §12): `functions/index.js`'s
  `handlerLogin` and `exchangeAgentToken` Cloud Functions mint a
  Firebase custom token (uid `'handler'` with a `handler: true` claim,
  or the Agent Code itself with an `agentCode` claim), checked against
  `HANDLER_PASSWORD`'s own Firebase Secret Manager copy (independently
  of the Apps Script Script Property of the same name — the two are not
  automatically kept in sync). Firestore's own security rules
  (`firestore.rules`) then gate reads per-document off those claims,
  entirely separately from anything in `Code.gs` above. This is not
  the same system as `requireAgentToken_()`/`requireHandlerAuth_()` and
  has its own class of bugs — see `BUGFIXES.md`'s stale-Firebase-
  identity and Evidence-error-visibility entries.

**Performance patterns worth knowing before "optimizing" further:**
`CacheService` is used everywhere for short-TTL response caching
(`get_now_playing`, `list_cell_notes`, `getPlaylist`, migration-check
flags like `*_columns_ensured`) so a burst of simultaneous polls from
several open tabs shares one real Sheets read instead of one each.
`LockService` (`withScriptLock()`) wraps every scan-then-write path
that could plausibly collide under concurrent multi-player load
(character saves, Briefs upserts, delete/restore) — and **fails
closed** (a "server busy" response) rather than silently running
unlocked if the lock can't be acquired, which used to defeat its
entire purpose.

**Column resolution:** every sheet-writing function resolves a
field's target column by **name**, against that sheet's actual current
header row — never by a fixed array position — specifically because
this campaign's live spreadsheet has drifted from its originally-
declared column order more than once (a column manually reordered or
added directly in the Sheets UI), and a positional write silently
corrupts whichever field lands in the wrong cell when that happens.
`ensureBriefsColumns()`/`getOrCreateCharactersSheet()`/etc. self-heal
a sheet missing an expected column by appending it, gated behind a
cache flag so this doesn't re-scan on every single request.

---

## 10. Backend action reference

Every `action` this backend accepts, by area. `AGENT` = requires
`requireAgentToken_()` (currently a no-op — see §9), `HANDLER` =
requires the real Handler password, `SESSION` = requires a Handler
session token, `EITHER` = Agent-or-Handler, blank = unauthenticated by
design.

**Agent lookup & identity**
| Action | Auth | Purpose |
|---|---|---|
| *(bare `?code=`)* | — | `doLookup()` — fetch one Agent's full Briefs row by code. |
| `load_character` | — | Fetch one Agent's saved character sheet JSON by code. |
| `find_by_player_name` | — | Cover Identity: every Agent tied to a real player name. |
| `save_character` | EITHER | Upsert a character sheet JSON (Cloud Save, or Handler editing Player Name). |
| *(no `action` field)* | — | New Profiling brief submission / "Update Brief" resubmission — upserts the Briefs row by agent_code. |
| `update_field` / `update_medical` / `update_aar` | AGENT | Single-field write via a strict column allowlist (`FIELD_MAP`). |
| `save_plate` | AGENT | Save a Face/Outfit Plate image URL to its (era-specific) column. |
| `generate_prompt` | AGENT + rate-limited | Draft a portrait prompt via Claude. |
| `generate_plate_image` | AGENT + rate-limited | Render a Plate image via Gemini. |
| `save_agent_identity` | AGENT | Save an Agent's Notes ink color/font. |
| `reset_agent_token` | — | Vestigial — part of the removed Agent-token system (§9); should be dead code, verify before relying on it. |

**A-Cell / Handler**
| Action | Auth | Purpose |
|---|---|---|
| `handler_login` | HANDLER | Exchange the real password for a session token. |
| `list_characters` / `list_agent_file_only` / `list_deleted_characters` | SESSION | Full-roster reads for Admin/Play/Sheet. |
| `delete_character` / `restore_character` | HANDLER | Soft-delete / undo, Characters+Briefs together, atomically. |
| `update_character_field` | HANDLER | A-Cell Sheet tab's inline single-column edit. |
| `create_cell` / `update_cell_members` / `delete_cell` | HANDLER | Cell group management. |
| `list_cells` | — | Every Cell (names/handlers/members) — deliberately open, Notes' Cell-detection needs it unauthenticated. |

**Evidence Locker**
| Action | Auth | Purpose |
|---|---|---|
| `create_evidence` / `update_evidence` / `delete_evidence` | HANDLER | Manage one Evidence item. |
| `list_evidence` | — | Read (self-filters by Cell/Operation/restriction when given an agent_code). |
| `create_operation` / `update_operation` / `delete_operation` | HANDLER | Manage Operation folders. |
| `list_operations` | — | Every Operation. |
| `mark_evidence_seen` | — | Clear one Agent's "unseen" dot on one item — cosmetic only. |
| `save_handout_note` / `list_handout_notes` | AGENT | An Agent's private note on one Evidence item (legacy "handout" naming). |

**Player Notes**
| Action | Auth | Purpose |
|---|---|---|
| `save_note_block` / `delete_note_block` | AGENT | Create/edit/delete one note block. |
| `list_cell_notes` | AGENT | Every note block visible to the requesting Agent in a Cell. |

**Table Radio**
| Action | Auth | Purpose |
|---|---|---|
| `set_now_playing` / `pause_now_playing` / `resume_now_playing` | HANDLER | Control the current track for a channel. |
| `get_now_playing` | — | Read the current track — cached 2s. |
| `save_playlist` / `get_playlist` | HANDLER / — | Per-channel saved playlist. |
| `upload_track` / `delete_track` | HANDLER | Track Library management. |
| `list_tracks` | — | Every uploaded track. |
| `set_cell_channel` | HANDLER | "Cue For Cell" default channel. |

**Misc**
| Action | Auth | Purpose |
|---|---|---|
| `imgdata` | — | Proxies a Drive file as a base64 data URI (Drive's own hotlink URLs don't work cross-origin for images or audio). |

---

## 11. Data model (Google Sheets, one spreadsheet)

| Sheet | Purpose |
|---|---|
| `Delta Green Briefs` | One row per Agent's Profiling brief — the original/primary sheet (`SHEET_NAME`). Columns declared in the `COLUMNS` array; header names resolved dynamically (§9). |
| `Characters` | One row per Agent Code — the full character sheet JSON blob (`character_json`), upserted by Cloud Save. |
| `Cells` | Named Cell groups: handler, member codes, usual radio channel. |
| `CellNotes` | Player Notes blocks — cell_id, agent_code, content, Circulate flag, sort_order, tags/pins (Notes v2). |
| `AgentIdentity` | Per-Agent ink color/handwriting font for Notes. |
| `Evidence` | Filed documents/photos — title, description, photo (a Drive link), restricted_to. |
| `Operations` | Evidence folders, one per Cell. |
| `EvidenceSeen` | Which Agent has opened which Evidence item (cosmetic). |
| `HandoutNotes` | Per-Agent private notes on an Evidence item (legacy name). |
| `Tracks` | Track Library — uploaded mp3s (Drive file IDs), title/kind. |
| `RadioChannels` | Now Playing state per channel — track, paused/paused_at, loop, playlist_json. |
| `DeletedCharacters` / `DeletedBriefs` | Soft-deleted rows, purged 24h after `Deleted At` — column set kept reconciled against the live sheets' current width (a real, fixed bug — see `BUGFIXES.md`). |

No `AgentAuth` sheet exists despite being referenced in old comments —
it was part of the removed Agent-token system (§9) and was never
actually kept around once that was reverted to a no-op.

---

## 12. Firebase migration status (separate branch/effort)

A `firebase-migration` branch (with some of its work already merged
directly to `main`, ahead of this branch) is layering Firestore and
Firebase Storage onto specific surfaces, without yet replacing the
Sheets/Drive backend wholesale:

- **Phase 1** — a Firestore *dual-write bridge*: every existing Sheets
  write also mirrors into Firestore (best-effort, swallows its own
  errors so it can never break the real Sheets write), gated entirely
  off until two Script Properties are set. The Sheet stays the write
  path of record.
- **Phase 2/3** — Table Radio's Now Playing cut over to a live
  Firestore `onSnapshot` listener (replacing polling for that one
  surface), and a cross-page Dice Roller widget with live Firestore
  roll history.
- **Phase 4** — Face/Outfit Plate images, Evidence photos, Track
  Library mp3s, and Brief reference photos all cut over from
  base64-over-POST to a direct Firebase Storage upload (the client
  uploads straight to Storage, then POSTs the resulting URL rather
  than the image bytes).
- **Phase 5 [Added — missing from this doc, confirmed live]** — Player
  Notes and the Evidence Locker are both fully cut over to live
  `onSnapshot` reads (A-Cell's Evidence tab, `agent-hub.html`'s Evidence
  mirror, `notes/notes.js`) — not just dual-write. The Sheet is still
  the write path of record (every write still lands there first, then
  mirrors to Firestore), but for these two surfaces the read path has
  fully moved off Sheets/polling.

**[Corrected — verified against current code, this claim was wrong]**
This previously said Phase 4's Plate-image cutover changed the upload
transport only, without fixing the era-collision bug from §5. Checked
`dg-agent-portal.html`'s `saveGeneratedPlate()` (the function used by
both the file-picker and Gemini-generated paths under Phase 4's direct
Storage upload) directly: it builds `fieldKey = 'era_' + era + '_' +
(type === 'face' ? 'face_url' : 'outfit_url')` and saves through that
field unconditionally — the era-specific columns from §5 *are* in use
on the current Storage-upload path. No known era-collision bug remains
open as of this check.

The longer-term goal discussed (not yet built): a single-page "iframe
shell" — one outer page owning persistent Table Radio/Dice Roller
widgets, with an inner iframe swapping between the existing pages, so
music/dice state survives page-to-page navigation instead of resetting
on every load. Planned but not started as of this document.

---

## 13. Open / known-incomplete work

Pulled from the README's own roadmap section plus what's come up
since, kept honest about what's actually still missing rather than
implied-done:

- **Access control.** A-Cell is gated behind one shared password;
  individual Agent dossiers are reachable by anyone with the code;
  Cover Identity is a bare name match with no PIN. None of this is
  tied to real per-player identity. (Agent-token auth was built once
  and deliberately reverted — see §9 — this is a different, still-open
  question about *Handler-facing* access, not player writes.)
- **`stats/`'s Share URL** (a base64 character dump in a URL fragment)
  is a fourth, fully parallel save mechanism, untracked by the
  backend, invisible to Cover Identity, un-lookupable by a Handler.
- **A-Cell shared music curator/playlist-building UI** beyond the
  current Track Library + per-channel playlist (flagged as still open
  in the task history).
- **Agent File not prefilling fully after any character-sheet
  export** — see §5's Profiling-gate explanation; root-caused but not
  yet fixed as of this document.
- **The Firebase "one-page iframe shell" idea** — designed, not built.
- Two items the original external security review flagged and this
  project deliberately decided *not* to build, with reasoning kept in
  `Code.gs`'s own comments: a secondary `AgentIndex` sheet for O(1)
  lookups (this campaign's real scan cost is negligible at its actual
  scale), and a full XSS/input-sanitization audit (flagged as a real,
  separate follow-up, not bundled into the performance/security pass
  already done).
