# Bug Fix Log

A complete, chronological record of every confirmed bug fixed on this
project, in the order it actually happened, with what was wrong and
how it was fixed. Kept for transparency — nothing here is summarized
away or dropped, including bugs this project itself introduced and
then fixed later.

New features, redesigns, and additions are *not* listed here unless a
real fix was bundled into the same commit — see the git log for the
full history of everything shipped. Backend (`backend/Code.gs`)
changes always require a manual paste-and-redeploy into the Apps
Script editor; pushing to GitHub alone never updates the live backend.

---

## Character Creator (`stats/`) — layout & mobile

**Missing function declaration broke every tab on Agent Portal.**
`saveEraPrompt`'s function header was missing, leaving its body as
orphaned top-level code — a syntax error that killed the whole script
block, so every function on the page (including `switchTab`) was
undefined and the tab strip did nothing. Fixed the declaration.

**Mobile layout: fixed-width layout forced horizontal scroll.** The
ported character creator had zero responsive CSS — an 800px text box,
a rigid 3-column flex row, no `box-sizing` reset. Added a
`box-sizing: border-box` reset and a `@media (max-width: 760px)` block
that stacks the layout. A CSS-ordering bug caught along the way: the
first version of that media query was inserted *before* the
unconditional rules it was meant to override, so equal specificity +
later-source-wins silently lost even when the query matched — moved to
the end of the stylesheet.

**Invisible active die-button text in Son of Sam theme.** The dice
roller's active-die button sets a near-black background via
`!important`, but the theme's blanket `button { color: #000000 }` rule
still applied on top — black text on near-black background. Scoped a
narrow override to `.theme-son-of-sam .dr-die-btn-active` only.

**Mobile overflow on every theme but Mobile.** The other five themes
(X-Files, Modern, Son of Sam, Field Notes, Live Play) were desktop-
first and genuinely broke on a phone. Root cause of most of it:
`<fieldset>` gets a default `min-width: min-content`, refusing to
shrink below its widest unbreakable content regardless of the layout
inside it — reset to 0, plus several genuinely fixed-width grids
(skills' 80px gap, biography's 160px label column, the equipment
picker, the wizard-promo toggle). Live Play's printed-form-style sheet
is the one deliberate exception, kept at its natural width with its
own horizontal scroll rather than redesigned.

**Overlapping skill rows on mobile everywhere but Mobile/Live Play.**
`renderSkillsGrid()` places every skill pair with an inline
`gridColumn`/`gridRow` computed for desktop — inline styles beat any
stylesheet rule, so the mobile media query's grid-column change alone
did nothing. Generalized the Mobile theme's existing `!important`
single-column override into the shared mobile block for every theme.

**Tab-strip clipping, cog panel legibility, radio dial squaring.**
Tab strip's border-radius showed black corner notches; fixed by
dropping it and reordering the active tab to the last wrapped row.
Settings cog was leaking each theme's paper-oriented ink color/font
onto its always-dark drawer (near-invisible text in Field Notes);
added drawer-scoped overrides. Field Notes' "no rounded corners" rule
was also squaring off theme-agnostic overlay widgets (the round
channel dial, the circular settings gear) since they're still DOM
descendants of `body.theme-field-notes` — excluded them. **Missed in
two more themes** (Son of Sam, Mobile) with the identical blanket
rule and no exclusion — same fix applied to both in a follow-up.

**Table Radio widget buttons stretching on `stats/index.html`.**
A page-specific mobile rule (`button { width: 100% }`) also grabbed
the Table Radio widget's plain `<button>` elements once appended to
`<body>` — Mute/Expand/Leave each tried to fill the panel width,
overflowing past the widget and overlapping form fields underneath.
Fixed with an explicit `width: auto` on the widget's own button class.

**Service-message text falling back to serif on A-Cell tabs.** Eight
empty-state/status strings across Play, Cells, Handouts, Sheet, and
Admin never declared their own `font-family`, rendering in plain serif
italic instead of the Courier Prime monospace used everywhere else.
Gave all eight the explicit font.

**Play tab's Motivations/Disorders and Sanity Adaptation fell back to
sans-serif.** Same missing-`font-family` bug, two more selectors.

---

## Character import (Kappa Black, Foundry VTT)

**Profession not carrying over on import, breaking outfit
derivation.** A real player's "Pilot" character came out of Export to
Agent File wearing a police uniform. Two bugs: (1)
`importFoundryJSONToEditor()` never touched the profession `<select>`
at all, so any prior profession silently stuck around; (2) where
profession *was* set, it assigned the human-readable title ("Pilot")
directly to the `<select>`'s `.value`, which only accepts the option's
internal key ("pilot_sailor") — a non-matching string is a silent
no-op. Added `matchProfessionKey()` to resolve a title (including
compound ones like "Pilot or Sailor") to its real key, wired into both
import paths.

**Unmatched Kappa Black profession failed silently.** Kappa Black
allows any free-text profession with no fixed list behind it (a real
report used "Prosecutor" — no match anywhere). The unmatched string
still got assigned to the `<select>`, silently failing and leaving
whatever was previously selected, with the real title lost outright.
Now falls back to the built-in "Building a New Profession" catch-all
and preserves the original imported title in Personal Details.

**Imports never reaching the Characters sheet ("Alistair bug").**
Every field in `applyImportedAgentData()` is set via `el.value = ...`,
which never fires `input`/`change` — and Cloud Save's auto-sync only
listens for those events. An imported character showed up in the local
roster but never synced to the backend (invisible to A-Cell
Admin/Sheet) until an unrelated later edit happened to trigger a real
save. Fixed with one synthetic `change` event dispatched at the end of
import, routing it through the normal save pipeline.

**Kappa Black's sanity-adaptation counts were dropped.** Kappa Black
stores violence/helplessness adaptation as flat incident counts (0–3),
not this sheet's per-incident checkboxes — the converter was
hardcoding an empty adaptations object instead of reading them. Added
`kappaBlackAdaptationFromCount()` to translate one into the other.

**"Open Agent File" could load a completely different, stale agent.**
`goToAgentFile()` navigated to a bare `#agent` hash, relying entirely
on `dg_last_agent` (a single browser-wide "most recently exported
agent" key) — stale whenever the export silently no-op'd (blank name)
or a different agent was exported earlier in the same browser, with no
error shown. A live report: a fresh Kappa Black import opened a
completely different, previously-exported agent instead. Now passes
the just-imported Agent's own code explicitly via `?code=`.

---

## Data-loss and Agent Code integrity

**Critical: recruiting over an existing character silently wiped it.**
`startRecruitFlow()` silently wiped the local sheet and began
auto-saving a blank character under an existing Agent Code the moment
a cloud lookup returned NOT_FOUND — a flaky lookup or a real timing gap
meant a live character's data could be progressively overwritten with
no warning and no undo. Now requires an explicit confirmation before
doing anything destructive.

**Root cause of the above: "Export to Agent File" minted an unrelated
code.** It always generated a brand-new random code, ignoring a
character's existing Cloud Save code — so a character built first and
exported afterward (a completely normal flow) ended up with two
disconnected codes, and Play/Recruit links from the Agent File
couldn't find the real character. This is what actually caused a real
player's reported data loss. Fixed to reuse the existing code whenever
one already exists.

**"Update Brief" minted a duplicate Agent Code, silently orphaning
edits.** `handleSubmit()` unconditionally minted a fresh code even
when the current Agent's code was already known — a returning player
clicking "Update Brief" got a brand-new, disconnected code instead of
updating their entry, and the update looked like it had vanished.
Fixed to reuse the existing code, but only when the form's `char_name`
still matches the currently-loaded Agent's — matching by name (not
just having a code in memory) is what actually distinguishes "editing
this Agent" from "describing a different one," since `autoRestore()`
loads the last-active Agent into memory on every fresh page visit
regardless of what gets typed next.

**Random Bio silently overwrote an existing character's identity.**
`generateRandomBio()` overwrote a character's name and every bio field
in place with no warning, even for an already-named, in-use character
— confirmed as the actual cause of a live data-loss report (a real
identity replaced under its existing Cloud Save code). Now gated
behind a confirmation naming the current character whenever a real
name is already set.

**Duplicate Agent codes from stats/'s "Open Agent File" export.**
Same class of bug as above, a second time: exporting an imported or
Random-Bio'd character to the Agent Portal always minted a new code
even when Cloud Save had already auto-minted one on first edit — two
permanently disconnected sheet rows for what should have been one
Agent. Fixed to reuse the existing code via `getCloudCode()`.

**Ghost Agents: unclaimed roster entries stuck forever.** Cover
Identity's roster-replace logic preserved any prior local entry
lacking a `player_name` unconditionally and forever, with no
re-verification against the server — an Agent code that ever entered
local storage without a player_name (e.g. via a bare `?code=` link)
was permanently un-prunable, resurfacing on every future search.
Bounded the exception to a 24-hour grace window. (This grace window
was later reverted in a follow-up commit as part of a broader Recently
Deleted purge/display fix, once it was no longer needed.)

---

## A-Cell (Handler tools) & Table Radio

**False-positive "Broadcasting" status.** `set_now_playing` is a
no-cors POST, so a genuine backend failure looked identical to
success. The Music tab now does a real `get_now_playing` read-back
before claiming success, with an honest failure message otherwise.

**YouTube volume slider silently not working.** Three real gaps: (1)
`applyLiveMuteVolume()` treated a freshly-constructed `YT.Player`
object as ready to call `setVolume()` on, but a real embed
silently no-ops calls made before its handshake finishes — gated on an
explicit `ytPlayerReady` flag now. (2) The volume slider had no
fallback when a live-apply failed (unlike Mute, which already rebuilt
the embed on failure) — now falls back the same way. (3) Missing the
`origin` playerVar YouTube's docs recommend for the postMessage
channel. Also: dragging the slider while muted now un-mutes, since
applying volume nobody can hear isn't useful feedback.

**Track Library mp3s never actually played.** Google Drive's
`uc?export=download` hotlink served an interstitial instead of raw
audio bytes when embedded cross-origin (the same class of bug already
forced a proxy for reference images). Switched to
`drive.usercontent.google.com`, and URLs are rebuilt from the stored
Drive file ID on every read so already-uploaded tracks self-heal once
redeployed. (A later fix replaced this again with the Drive API v3
media endpoint — see "App Shell & Firebase Migration" below.)

**False "backend didn't confirm" on a real mp3 upload.** A normal
3-minute song upload showed a failure message even though it actually
succeeded. `DriveApp.createFile()` on a real file is genuinely slower
than every other write in this app (which only ever save small JSON
rows) — the verify step checked once, 1.5s after the POST resolved,
then gave up. Now retries with increasing delays (1.5s, 3s, 5s, 8s)
before reporting failure, and only suggests a missing redeploy once
retries are actually exhausted.

**Handouts photo uploads failing with "Could not reach the backend."**
The create/update POST used `keepalive: true` like every other write —
fine for small JSON, but `keepalive` requests are capped at 64KiB by
the browser itself, and a real photo's base64 data URI blows past
that. `fetch()` was rejecting before the request even left the
browser. Dropped `keepalive` from just this one POST.

**A-Cell password field corrupted real input on every keystroke.** The
custom X-masking read `input.value` on `input` to capture what was
typed, but by then the field had already been overwritten with X's
from the *previous* keystroke — every keystroke after the first read
"old X's + this one new real character," not the true cumulative
value. Typing the password character by character always failed;
only pasting worked. Fixed by computing each edit on `beforeinput`
(while the field still reflects its pre-edit state) and applying that
edit to a separate tracked value, never trying to recover real
characters from the already-masked display value.

**A-Cell Admin blind spot for Agent-File-only entries.** Admin's
delete list and Recently Deleted only ever read the Characters sheet,
so an Agent File / Profiling brief with no character sheet yet (e.g. a
duplicate/test entry) was invisible and undeletable through the UI.
Added a dedicated listing action and matching Admin UI section.

**A-Cell Handler auth reused the wrong password.** The clearance
gate's public flavor password ("MASTICATE") was wrongly reused as the
real Handler credential sent to the backend — A-Cell could only ever
work if the actual secret password was literally set to that string.
Split into a separate Handler Password control that's the only thing
talking to the login action. Also fixed the Play tab's list fetch
never sending its session token at all, unlike every other tab.

**A-Cell Handler-session race stuck Play/Sheet on stale sessions.**
When a Handler already had a saved password, the silent re-login on
page load was still in flight when Play/Sheet's own first data fetch
fired using whatever (possibly expired) session was already cached —
they'd show "invalid or expired session" forever, even after a valid
new session landed a moment later. Fixed by having the login module
dispatch a ready event once it lands a session, with Play/Sheet
listening and retrying. (A follow-up found Evidence's own fetch was
never wired to the same retry, and that the several tabs' fetches had
no response-sequencing at all — a stale response landing after a
fresher one could stomp correct data back into an error. Added a
generation-counter guard so a superseded response never overwrites a
newer one.)

**JSONP-wrapped auth-guard errors broke A-Cell entirely.** The new
token/session guards returned bare JSON on rejection even from a
GET/JSONP action — a `<script src=...>` tag can't execute a bare JSON
object as a statement, so the tag failed silently and the caller just
saw its own generic connection-timeout fallback, with no indication of
the real cause. Routed guard rejections through the same JSONP-
wrapping helper every other response uses.

---

## PWA / Cloud Save / standalone iOS

**`prompt()`/`confirm()`/`alert()` are disabled entirely in an
installed (standalone) iOS PWA** — exactly how this app is meant to be
used — so several flows looked like silent dead ends: "Load by Code"
(replaced `prompt()` with a real inline input), the recruit-flow
confirmation (replaced `confirm()` with a themed in-page dialog,
`dgConfirm()`), and "Open Character Sheet" (now passes the known Agent
Code through explicitly instead of relying on the sheet's own separate
lookup).

**Imports invisible to the backend** — same root cause and fix as the
Kappa Black import fix above (missing `change` event); listed here too
since the commit that shipped it also added the PWA "update available"
banner (`assets/sw-update.js`), wired into all pages so an already-open
tab notices a new deploy instead of silently running stale cached code
indefinitely.

**Character-load lag (8–10s to show a character).** On-screen timing
diagnostics showed the real split: backend response back in ~1.5s, but
the sheet not applying for ~8s. Root cause: init code ran on
`window.onload`, which waits for *every* subresource on the page,
including whatever Table Radio was currently streaming into an iframe
— on slow venue wifi, that alone could take seconds and had nothing to
do with the character being loaded. None of that init actually needs
external resources, just the parsed DOM — switched to
`DOMContentLoaded`. (The dice roller panel had the identical bug,
fixed the same way in a follow-up; a related timing-badge bug where a
fast load's correct numbers got silently overwritten by a stale
8-second-later reading was fixed alongside it.)

---

## Agent Portal (Profiling / Agent File)

**Decorative required-field validation didn't actually block
anything.** The Profiling form's `[required]` attributes were never
enforced — the submit button is `type="submit"` inside a form with
`onsubmit="return false"`, so the handler fired the POST unconditionally
regardless of which required fields were blank. A brief could submit
successfully and then permanently fail the Agent File's completeness
gate later, with no indication of what was missing. Now calls
`form.reportValidity()` first and bails if invalid.

**Cover/Profiling tab not pre-filling.** The tab only got populated
from one specific "restore by code" flow — opening an Agent via the
Agent Hub link, the roster drawer, or a bare revisit auto-restoring
the last agent all landed on (or could switch to) the tab without ever
filling it in, since each path only rendered the read-only dossier
view. Extracted the fill logic into a shared `populateCoverForm()` and
called it from all four entry points. (Very likely also the actual
source of earlier "profession not filled" reports after a Kappa Black
import — profession resolves fine into the character sheet's own
select; the gap was this separate form never reflecting it.) Fixing
this exposed a second, previously-dormant bug: a file input's `.value`
can't be set to anything but `''` without throwing, which the shared
function now guards against.

**Profession field silently dropped from Briefs.** Profession was
collected by both the Profiling form and the stats/ auto-export, but
the backend's own column list never included it, so the value was
silently discarded before ever reaching the sheet. While tracing this,
found a second, more serious bug: a returning Agent's "Update Brief"
resubmission always appended a brand-new row instead of updating the
existing one — since lookups return the *first* matching row, any
correction submitted after the first one was permanently invisible,
shadowed by the earlier row. Converted to a real upsert by agent code.

**`face_plate_url` missing from Cover Identity's lookup response.** An
Agent with a generated Face Plate showed up correctly in their own
Agent File but never on the Agent Hub roster card, because the
player-name lookup never included that field (or `active_eras`) in
what it returned.

**Era never actually sent to the portrait-prompt generator.**
`autoGenerateEraPrompts(era)` built its prompt requests without
including `era` in the POST body at all, even though the backend
already has era-specific wardrobe logic waiting for it — so adding a
new era to an existing Agent never changed how their clothing was
described; it just kept reading however the model defaulted with no
period cue.

**Field Reference prompt defaulted to a headshot.** The backend's
prompt generator short-circuited into its face-lock (headshot) branch
whenever no injuries were sent — which is always true for the
Field Portrait/Reference buttons, since they never send injuries at
all. So an explicit full-body "Field Reference" request still produced
headshot-style text. The injuries-based fallback now only applies when
the mode itself is genuinely unset, not just injury-free.

**Outfit Plate generation used a stale or missing Face Plate
reference.** Outfit generation read the Face Plate reference from a
DOM `<img>` element that `saveGeneratedPlate()` replaces wholesale on
every generate/upload — so the very first Outfit Plate generated right
after a Face Plate (the normal order of operations) went out with no
reference at all. Now sources the reference from an in-memory cache of
the just-generated image instead, and Outfit generation refuses to run
until a real Face Plate exists.

**Random Agent Generator wasn't sex-aware.** `facial_hair` and
`hair_style` tables weren't sex-specific (a Female agent could roll a
handlebar mustache or a buzzcut), and one explicitly male-coded
clothing item ("wife-beater" in the criminal archetype) was replaced
with a neutral description.

**Outfit Plate came back cropped like a headshot.** Passing the
existing Face Plate image as a Gemini reference alongside a "full
body" text prompt made Gemini anchor hard on the reference's own tight
headshot framing — clothing was correct, but the composition wasn't.
Now explicitly tells the model the reference is for facial identity
only, not framing.

**Era age adjustment always described the Agent as the same age,
regardless of era.** `ageRangeForEra_()` shifts an Agent's age_range
per era (a character registered at 40 in the 2020s should read
noticeably younger in a 2000s portrait) relative to a "reference era" —
but that reference was whichever era got *added to the sheet first*,
not the era the player actually meant `age_range` to describe. A real
report: a character active in the 1990s at 40 should read as around 70
in a 2020s portrait, but every era's prompt kept reading "mid forties."
Now anchors to the explicit "Active Era" (`campaign_era`, set via the
existing Make Active Era button) when one has been chosen, falling
back to the old first-added-era behavior for an Agent that's never set
one. Existing, already-generated prompts don't self-update — each era
needs regenerating once to pick up the corrected age.

**Agent File silently bounced to Profiling after a character-sheet
import, with zero explanation.** A real report: import a character
(Kappa Black, Foundry JSON, Random Bio, or hand-built) and go to Agent
File — it doesn't show the character's info. Diagnosed and confirmed
the data transfer and backend storage both work correctly (name,
nationality, sex, profession, build, outfit all land intact) — but
`isProfilingComplete()` gates the actual dossier view behind every
Cover-tab `[required]` field having a value, and stats/ has no source
for the ~13 physical-appearance fields (face_shape, eye_color,
hair_..., posture, expression, vibe, etc). That gate is never
satisfied for a fresh import, so the page silently redirects to
Profiling — reading as "my info didn't carry over" when it actually
did. Added a one-time banner explaining what happened and what's still
needed, shown only when there's real carried-over data to explain.

**Legacy "Agent Roster" drawer showed the wrong Agent's data —
removed from the UI.** A real report: the page loaded one Agent's data
("Daniela Martinez") while a different one ("Eli Filagree") was
expected. Root cause: `autoRestore()`'s own "last active Agent on this
device" fallback was working correctly — it just wasn't obvious that a
separate, pre-dating-Agent-Hub "AGENTS ON FILE" drawer was the only
thing available to switch away from it, and that drawer is now
redundant with Agent Hub's real, server-backed way of choosing an
Agent. Hid the drawer's only entry point (`#roster-trigger`); the
underlying `dg_agent_roster` localStorage store it's built on was
deliberately left untouched, since per-Agent write-auth tokens,
Profiling's cross-page code-reuse check, and Dice Roller's own "which
Agent is active" fallback all still read it directly.

---

## Backend performance & security hardening

**Apps Script backend overload under concurrent live-session load.**
Root cause of A-Cell going unresponsive during a real 5-player session:
every single request — every 2-second radio poll from every open tab,
every load, every save — paid for a Drive-wide filename search just to
find the spreadsheet, plus two migration-check functions re-verified
already-satisfied columns with a fresh Sheets read on every request
forever, with zero caching or write-locking anywhere. Fixed by setting
the spreadsheet ID directly (removing the Drive search), caching
migration-verified flags, caching `get_now_playing` per channel for 2s
(invalidated on write), and adding `LockService` around the two write
paths most likely to collide under concurrent load.

**Silent 24-hour purge failure.** The Deleted-Agent sheets only ever
got their "Deleted At" header written at sheet-creation time — since
those sheets already existed from before the purge feature shipped,
the header was never retrofitted, and the purge function's header
lookup always returned "not found" and silently no-op'd forever, even
though the actual deletion timestamps were sitting there correctly all
along, just past the end of the recognized header row. Extracted a
self-healing header check called from both the create path and the
purge path.

**Deleted Agents never purging (a second, deeper cause).** Even after
the header fix above, purging still silently failed: the live
Characters/Briefs sheets had gained new columns many times over the
campaign's life, but the Deleted-sheet counterparts never got the same
treatment — only the "Deleted At" header itself was kept present, at
whatever column position its header row happened to end at. Since
every delete always appends the *full current-width* row, once the
live sheet grew wider than what the Deleted sheet's header last
reflected, "Deleted At" silently landed under a header naming a live
character field instead, and the real timestamp ended up further
right with no header at all — read back as a stray field value, not a
date. Added a reconciliation step that inserts any missing headers
before "Deleted At," and a force-purge for any row already corrupted
by this bug before the fix (verified against a standalone simulation
of a 3-column-to-4-column schema drift).

**Delta Green Briefs writes landing in the wrong column.** The brief-
submission row builder wrote every field *positionally* (column N
always got the Nth declared field's value), with no check against what
the live sheet's header row actually said column N was — any drift
(a column manually reordered in the Sheets UI over a long campaign)
meant whatever a player typed silently landed in the wrong cell. This
explained a report of Cover Identity's player-name search failing for
every player at once: their actual "Player Name" column was empty
because the value never landed there in the first place. Fixed at the
root: the row builder now resolves each field's target column by
*name* against the live header row, the same pattern already used
elsewhere in the file. Verified against a simulated drifted sheet
(Sex/Age Range swapped) — the old code wrote each into the other's
cell and player_name into an unlabeled column; the new code stores all
three correctly regardless of real column order.

**Cover Identity search missing a player whose name only lived in
their character sheet's own JSON.** The player-name lookup matched
only a dedicated "Player Name" column, but that column and the
character sheet's own embedded `bio.player_name` are two independent
storage locations that can disagree — an inline edit on the Sheet tab
only ever wrote the column, while the Sheet tab's own *display* read
exclusively from the JSON. A real report: "the Sheet tab plainly shows
my name, but Load My Agents still can't find me," for more than one
player. Fixed to match on either location. A follow-up found this fix
made every search parse every row's full character JSON unconditionally
— fine for a small roster, but reported live as the search timing out
once the roster grew — narrowed to only parse a row's JSON when the
dedicated column is genuinely blank, which is the actual rare case
this feature exists to catch. A second follow-up added an automatic
retry against transient backend overload.

**Backend hardening (external-review-driven, four stages plus a
security/correctness pass).** Ahead of and during an authentication
rollout: deleted a dead debug endpoint; added one shared response
helper closing an unvalidated-JSONP-callback injection risk (~17 sites
previously built `callback + '(' + json + ')'` manually) and a
missing-callback crash; fixed a Cell-creation function writing 5
values into a 6-column schema; added a duplicate-guard to character
restoration; moved Agent-code generation inside the existing write
lock with a real collision retry instead of trusting randomness alone;
added per-Agent tokens and Handler-password/session auth, gating every
player-owned write and every Handler/admin write appropriately;
closed two requester-spoofable reads; added a real ownership check so
a valid token no longer implied access to *any* note block in a Cell.
A dedicated correctness pass on top of that fixed: the write-lock
silently running unlocked (defeating its entire purpose) when it
couldn't be acquired, instead of failing closed; a strict allowlist
for which sheet column a write action can target, closing a path where
a valid token could be used to guess and overwrite an arbitrary column;
a failed Drive image upload silently saving its own error message as
if it were the successful image URL; and per-Agent rate limits on the
two actions that call paid external (Gemini) APIs, which previously
had none at all.

**Evidence Locker completely unable to create or update.** A sheet
migration only ever renamed the *tab*, never its own header cells — on
the real live spreadsheet, the ID column was still literally named the
old feature's internal name. Every create/update had been failing
closed since the feature's very first deploy (not a timing issue, as
first suspected) because the required-columns check correctly rejected
a header row missing the expected name. Fixed with a one-time header
rename in the existing migration path.

**Evidence items restricted to one Agent never showed up anywhere,
including for that Agent.** The Agent Hub's Evidence mirror did one
shared, anonymous fetch reused across every Agent's panel — but the
backend filters out any item with a restriction set at all when the
request carries no requesting Agent code, regardless of who it's
restricted to. So a Handler-restricted item was invisible to everyone,
including its one intended recipient. Fixed to fetch once per Agent
with their own code attached, letting the server's real Cell-
membership filter do the work instead of a client-side copy of the
same logic. Also fixed a related concurrency bug this surfaced: the
shared JSONP-callback naming scheme used only a timestamp, which a
single request could never collide on but several firing in the same
tick now could.

**Evidence PDF attachments broken, and slow uploads reported as false
failures.** A PDF picked via the photo field previewed as a broken
image and was saved with a hardcoded `.png` extension regardless of
real type — now detected and handled correctly client- and server-
side. Separately, the single fixed-delay read-back check on
create/update assumed a Drive photo upload always lands within 900ms,
which a real one doesn't always do — replaced with a short backoff
retry so a slow-but-successful upload no longer reports as a false
failure.

**Evidence PDFs opened a blank tab instead of the PDF.** A raw
`data:application/pdf;base64,...` URI opened via `window.open`/
`target="_blank"` is treated as a top-level navigation to an untrusted
data URI and silently blocked by Safari (and other browsers in some
versions) — no error, just a blank tab. Fixed everywhere a PDF's data
URI was opened this way by converting to a `blob:` URL first.

**Evidence photo flickering on every 5-second poll.** The modal's
render function rebuilt its entire body — including blanking the photo
back to a loading placeholder and re-fetching it from Drive — on every
single poll tick that found the modal open, even though the photo
itself never changes between polls. Now caches the resolved image per
item (keyed to its source link, so a genuinely swapped photo still
re-fetches) and skips the redundant work.

**Deleted Agents never purging, root-caused a third time —** see
"Deleted Agents never purging (a second, deeper cause)" above; this is
the same header-drift bug, listed once.

---

## Player Notes

**Keyboard/text disappearing while typing, roughly every 2–3
seconds.** Landed right on the poll interval. The render function does
a full `innerHTML` rebuild of the whole panel — doing that while a
field has focus destroys and recreates that DOM node, dropping focus
(and, on mobile, the keyboard) even though the underlying text was
fine the whole time. Poll-triggered renders now defer until the
focused field blurs; user-driven renders (adding/deleting a block,
switching tabs) are unaffected.

**Editing instability: a real grab-bag of four compounding bugs.**
(1) The blur handler trusted `e.relatedTarget` to tell "focus moved to
a sibling in-block control" apart from "the user left the block" —
unreliable on Safari (often `null`), so it failed open and tore down
the whole panel's DOM on nearly every in-block click before that
click's own handler could fire. Replaced with a `mousedown`-set flag
(mousedown always precedes blur) plus a deferred, state-checked
render. (2) The poll's merge logic only protected a block from server
clobber if the server didn't have a row for it *yet* — once a block
existed server-side, every poll could silently overwrite in-progress
or just-saved text with an older copy. Now any block being edited,
with a save pending, or recently touched keeps its local text. (3) A
listing function never actually returned each note's author code (only
as a dictionary key), so identity-based ink color/font never rendered
and edit permission in the combined Shared tab was always false. (4)
Enter didn't continue a bullet/numbered list with a new same-type
block.

**Notes mobile block-picker menu not dimming the background.** A
long-documented iOS Safari bug: `position: fixed` elements inserted
into an already-scrolled page get stuck at their creation-time scroll
offset instead of tracking the real viewport. The block-type picker's
mobile popover is exactly this kind of dynamically-inserted fixed
element. Forced both the backdrop and menu onto their own GPU
compositing layer, the standard fix for this WebKit quirk.

**Shared tab was a dead end.** Once in the combined Shared tab, there
was no way back to your own tab without hunting for it separately —
always offer a way back.

**Notes block-type picker hidden behind the app shell's own floating
widgets.** Once the app shell existed, its persistent Table Radio/Dice
Roller widgets live in the *parent* document, outside the content
iframe — a `position: fixed` parent element unconditionally paints
over its entire child iframe, no matter what z-index the iframe's own
content uses (an iframe boundary blocks CSS stacking context from
crossing it, not just outranking it). Notes' mobile block-type picker
was rendering correctly but sitting invisibly *behind* these widgets.
Added a small cross-frame API (`window.parent.dgShellSetWidgetsHidden`)
that Notes calls to temporarily hide the shell's widgets while its own
popover is open, restoring them on close.

---

## Split View (character sheet + Notes side by side)

**Notes iframe pointed at the wrong path.** Its `src` was a bare
`notes/index.html`, which resolves relative to the *character sheet's*
own location (`stats/`), not the site root — 404ing into a blank pane,
since `notes/` is actually a sibling directory, one level up.

**Fixed overlay buttons visually overlapped Notes' own header UI.**
The Split View toggle and settings cog, both pinned to a viewport
corner, sat directly on top of Notes' own header, which had no gap of
its own to absorb them. Gave the pane a top margin.

**Toggle button was nearly invisible.** The toggle's resting state had
no explicit colors, so a theme's higher-specificity button rule
(Mobile/Field Notes) silently repainted it as a flat near-black slab.
Promoted to its own theme-agnostic ID-selector styling.

**Dice rolls inside the embedded sheet never reached the visible
panel.** Clicking a skill inside Split View's embedded character-sheet
iframe rolled against that iframe's *own* dice panel, which is hidden
there by design — the roll genuinely happened, but the player could
never see it. Relayed skill-click rolls to the outer page's visible
dice panel via `postMessage`. (Broke again, twice, once the app shell
existed — see "App Shell & Firebase Migration" below.)

**Stacked instead of split on a portrait iPad width.** Two compounding
bugs: (1) the toggle-hidden and mobile-widget-shown thresholds agreed
with each other but neither matched the width where the two panes
could actually fit side by side — a portrait iPad's width sat past
"toggle is reachable" but nowhere near "the panes have room." Raised
both thresholds to where they actually need to be. (2) Even past the
corrected threshold, the container's `flex-wrap: wrap` was still
wrapping the Notes pane onto its own row, because flex-wrap decides
which row an item lands on using its *pre-shrink* hypothetical size,
not its size after shrinking — forcing `nowrap` directly then surfaced
a second issue, where the page footer (a flex sibling) got pulled onto
the same row and squeezed the Notes pane down to ~109px wide. Fixed
properly by giving the two panes their own dedicated flex row,
separate from the footer.

---

## Recent fixes (earlier session)

**Face/Outfit Plate images and prompts collided across eras.** Adding
a second era to an Agent File silently overwrote the first era's
Plates and prompts, because every era shared the same four flat sheet
columns despite the read side already anticipating era-specific ones
(a pre-existing comment admitted as much). Added 16 real per-era
columns and pointed every writer at them.

**Submitting a changed name over an already-open Agent File silently
spawned a disconnected new Agent.** A player who used Random Generate
on a page that already had a real Agent loaded, then hit Submit,
correctly (per the existing name-matching safeguard) created a new,
separate Agent rather than corrupting the original — but got no
warning that this was happening, and it read as the original character
having vanished. Added a confirmation gate, scoped to only fire when
the player actually *saw* that other Agent's file rendered this page
load — not just it being silently carried in memory by the normal
auto-restore-on-visit behavior, which is a legitimate, unremarkable
case of typing up a brand new character.

**Notes blocked entirely for an Agent not yet assigned to a Cell.** A
freshly-imported Agent with no Cell membership yet got a hard "isn't
assigned to a Cell yet, ask your Handler" wall with no way to write
anything. Added a solo-mode fallback keyed to a synthesized per-Agent
pseudo-cell, so the Agent can write and read their own notes
immediately; the Shared tab stays hidden since there's no one to share
with yet. When a Handler later assigns that Agent to a real Cell, their
solo notes are carried forward onto it automatically, and the Shared
tab appears. A-Cell's previously inert "Unassigned Agents" chips are
now clickable, opening a popup to assign directly to an existing Cell.

---

## App Shell & Firebase Migration

The app shell (`hub.html`) hoists one persistent copy of Table Radio
and Dice Roller outside the per-page content iframe, so they survive
in-shell navigation instead of restarting on every page. Most of the
bugs below are that same shape: something that only ever ran once, on
a real page load, quietly broke once it started running inside a
shell that persists across many logical "page views" without a real
reload.

**Service worker silently failing to install for over a week,
explaining "every browser behaves differently."** `sw.js`'s
`SHELL_FILES` list still pointed at `stats/dice-roller.js`, a path
that stopped existing when that file moved to `assets/dice-roller.js`
during the Dice Roller migration. `caches.addAll()` is atomic — one
404 in that list rejects the *entire* install, and a failed install
never replaces whatever service worker was already active. Any
browser that had a working service worker from before that file move
was stuck on that exact cache forever, never able to pick up a later
`CACHE_NAME` bump, while a browser with no service worker yet just
fell through to the network — which is why different
browsers/devices were showing completely different, inconsistent
states of the app through the rest of this migration. Not random
flakiness: one dead path silently broke the update mechanism itself.
Removed the dead path, added the real `assets/dice-roller.js` and the
missing `assets/shell-nav.js`, bumped `CACHE_NAME` so every
already-stuck browser finally gets a clean install.

**Dice Roller identity/roll-history going stale inside the shell —
fixed, then reverted after it caused a worse regression.**
`resolveRollContext()` resolves and caches which Agent a roll should
be attributed to once per panel build — safe when every page load
re-ran this script fresh, not safe once the shell hoists one copy for
the whole tab's lifetime (a player can land on Agent Hub with no
specific Agent yet, then navigate to their own character sheet with a
real Cloud Save code, all under the same never-rebuilt panel). First
fix: extended the existing Handler-login-change watcher to also watch
the current Agent Code and rebuild when it changes. Live testing found
this introduced a new, worse bug — a stuck, uncloseable duplicate
panel plus a genuine Firestore "permission-denied" write failure — so
it was reverted to the prior (merely "history doesn't persist," not
actively broken) behavior the same day, pending a proper fix with
local testing instead of another live guess.

**Skill/stat rolls (including the dedicated SANITY ROLL button) did
nothing at all inside the shell — clicking just let you type into the
field.** The frameElement guard meant to stop a page loaded inside the
shell (or Split View's own sheet pane) from building a second,
duplicate floating panel used a bare `return`, which aborted the
*entire* script before it ever wired up `wireSkillInputs()` — the
listener that turns a click on a skill/stat value into a roll instead
of ordinary text-field focus. Split the guard into
`SUPPRESS_OWN_PANEL`: still skips building this instance's own panel,
but the skill-click listener now always runs (it's the only document
that ever has real skill inputs to listen on), relaying a caught roll
via `postMessage` to whichever ancestor frame actually has a visible
panel. Verified locally with a stub sheet loaded into the shell: no
duplicate panel, and a skill click correctly rolls on the shell's one
real panel.

**The same relay didn't reach Split View when opened from a sheet
already inside the shell.** Once Split View's sheet pane was folded
into the same `SUPPRESS_OWN_PANEL` guard above, that nests two levels
deep (`hub.html` → shell content iframe → Split View's own sheet
iframe) — and the previous one-hop relay (`window.parent`) landed on
the *middle* frame, which is itself suppressed and therefore never
listens. Changed the relay target to `window.top`, which always
reaches the one frame that actually isn't suppressed and has a real
panel, regardless of how many levels deep the roll originated.
Verified locally with a two-level-deep stub (shell → sheet → Split
View's own pane): the roll now lands correctly on the true top-level
panel.

**stats/index.html's own "← Agent Hub" back-link was never hidden
inside the shell.** agent-hub.html, a-cell.html, and
dg-agent-portal.html each got a small inline script hiding their own
back-link when loaded inside the shell's content iframe (redundant
with the shell's own persistent nav) — this one page was missed at
the time. Same treatment applied.

**A-Cell's Evidence tab showed "No evidence filed here yet" with no
indication anything was actually broken.** The Evidence tab needs its
own Firebase sign-in (separate from A-Cell's own password gate) to
read from Firestore as the Handler, via a Cloud Function that checks
the Handler password against a *second*, independent copy of that
secret in Firebase's own Secret Manager (not the same store as Apps
Script's `HANDLER_PASSWORD` Script Property). If that sign-in fails —
e.g. the Firebase-side secret was never set, or is out of sync — the
old code only logged it to the browser console; the UI showed exactly
the same text as a genuinely empty Evidence sheet. Now surfaces the
real error inline instead. While in this code, found and removed a
harmless-but-confusing byte-for-byte duplicate of the
`ensureHandlerSignedIn()` function and its backing variable, defined
twice in the same file (Evidence's own listener needed it; Track
Library's upload/delete flow already had its own separate copy from
before Evidence existed).

**Restoring an Agent by code returned "not found" even for a real,
active Agent (Eli Filagree).** Root-caused via a read-only Apps Script
diagnostic: the character sheet itself was fine (Characters sheet had
real, current data) — but the Delta Green Briefs sheet had ZERO rows
for that Agent Code. `doLookup()`/`doGet()` correctly return
`NOT_FOUND` when no Brief exists; the Agent Portal's Cover tab and
"RETURNING AGENT" code box both read exclusively from that sheet, so a
character who was imported/played but never had `stats/`'s "Open Agent
File" button clicked had no Agent File at all, on any device, forever.
Not a caching bug — the earlier working theory (a `localStorage`-wipe
navigation artifact) was directly disproven by this same failure
persisting through an explicit, decoupled code-restore test.

**Same gap, closed for every entry point, not just the one button.**
Once the above was confirmed, the fix was applied at the choke point
instead of only where it was first noticed: `loadAgentFile()` (the
Hub's own "Agent File" link, via `openSpecificAgent()`) and
`loadAgentCode()` (the Cover tab's restore box) now both call a new
`autoCreateBriefFromCharacterThenRetry_()` on a `NOT_FOUND` — it fetches
the Agent's existing Characters-sheet data, and if a real character
exists, auto-creates a minimal Brief (name/profession/nationality/sex)
from it and retries the lookup once, instead of just reporting "not
found" for an Agent who very much has a character on file. Mirrors
`stats/agent-portal-export.js`'s existing "Open Agent File" auto-export,
just triggered reactively from every read path instead of only that one
button. A retry guard (`retrying`/`!retrying`) prevents this from ever
looping more than once even if the auto-create attempt itself fails.

**A-Cell's Evidence Locker showed "No evidence filed here yet" in
Brave, with the identical account and data working fine in Safari.**
A live diagnostic ruled out both the Sheet and the Firestore mirror --
every Evidence item's `cell_id`/`visible_to` were confirmed correct on
both. Root cause: Firestore's default real-time listener transport
(WebChannel, a long-lived streaming connection) gets silently blocked
by Brave's Shields (and some ad-blocker extensions) since it resembles
a tracking connection -- `onSnapshot()` then never fires at all, with
no error surfaced (a genuinely different failure mode from the earlier
Handler-sign-in-failure fix, which does surface an error). Fixed
project-wide, not just in A-Cell: every page with a Firestore listener
(`a-cell.html`, `agent-hub.html`, `notes/notes.js`,
`assets/dice-roller.js`, `assets/table-radio.js`) now calls
`firestore().settings({ experimentalAutoDetectLongPolling: true })`
immediately after `initializeApp()`, falling back to plain HTTP
long-polling instead of the streaming transport that gets blocked.

**A-Cell's Evidence Locker showed "No evidence filed here yet" in
Safari too, on a browser that had definitely uploaded evidence
successfully, and survived a full page reload.** The earlier Brave
fix above was real but not the whole story. Root cause, found by
reading the actual Firestore security rules and every Firebase
sign-in helper in the codebase side by side: `ensureHandlerSignedIn()`
(`a-cell.html`), `ensureAgentSignedIn()` (`notes/notes.js`,
`assets/dice-roller.js`) all did `if (auth.currentUser) { resolve(...);
return; }` -- trusting *whoever* happened to already be signed in to
Firebase on this device, rather than verifying it was actually the
identity being requested. Firebase Auth sessions persist per-origin
across page loads (IndexedDB, not per-page), so a browser used to test
both a player page (which signs in as a specific Agent) and A-Cell
(which needs the Handler) picked up the leftover Agent session as if
it were the Handler -- Firestore's rules then correctly denied most of
the Evidence collection for that identity, which looked like "just
empty" with no error, and never self-corrected on reload since the
stale session lives in IndexedDB, not the page. `dg-agent-portal.html`
and `agent-hub.html`'s own sign-in helpers already did this correctly
(verify the signed-in uid matches, or unconditionally re-sign-in) --
this was inconsistency across the codebase, not a missing pattern.
Fixed all three to check `auth.currentUser.uid` against the expected
identity (`'handler'`, or the Agent Code -- both are literally the
custom token's uid, set by `handlerLogin`/`exchangeAgentToken` in
`functions/index.js`) before trusting it, falling through to a real
sign-in otherwise. `assets/dice-roller.js`'s version had a second bug
alongside it: its cache had no per-Agent key at all, so once any Agent
signed in through that widget, every later call for a *different*
Agent Code silently reused that first identity too, not just the
missing-Handler case.

**A phone that had a page open from before a batch of fixes kept
running the old JS indefinitely -- reload included -- showing old UI,
old bugs, and a stale local roster all at once.** Two real gaps in the
service worker's own update mechanism, not a one-off: (1)
`navigator.serviceWorker.register()` never passed `{ updateViaCache:
'none' }`, so the browser's own check for a new `sw.js` could be
answered from ordinary HTTP cache instead of hitting the network --
`sw.js` bumping `CACHE_NAME` means nothing if the browser never
re-fetches `sw.js` to notice the byte that changed. (2) There was no
periodic re-check at all -- browsers only check for a new service
worker on navigation, so a tab opened once and left open (exactly how
this app gets used at a live table, or during a testing session) never
noticed a new deploy on its own. Fixed both: registration now forces a
network check, and `assets/sw-update.js` pokes `registration.update()`
every 5 minutes and whenever the tab becomes visible again (the common
iPad case -- Safari backgrounded mid-session, then switched back to).
Separately, and directly self-inflicted: `sw.js`'s own header
explicitly says to bump `CACHE_NAME` on any change to a file listed in
`SHELL_FILES` (`a-cell.html`, `agent-hub.html`, `dg-agent-portal.html`,
`notes/notes.js` all are) -- several fixes shipped in the same session
as this one touched those files without bumping it, which is very
likely why a device that had been open since before them kept showing
old behavior through every one of them. Bumped now; the standing rule
going forward is to bump `CACHE_NAME` in the same commit as any change
to a `SHELL_FILES`-listed file, not just when remembered.

**A failed Firestore dual-write could fail completely silently, with
nothing logged anywhere -- not even in this project's own Executions
log.** `firestoreDualWrite_`/`firestoreDualPatch_`/`firestoreDualDelete_`
(`backend/Code.gs`) all call `UrlFetchApp.fetch` with
`muteHttpExceptions: true`, which is correct and deliberate -- a
Firestore/network hiccup must never fail the player's actual Sheet
save, which is the write of record. But `muteHttpExceptions` also means
a non-2xx response (a bad field value, an expired token, wrong project)
never throws, so the surrounding `try/catch` never fires either --
nothing ever inspected the response's actual status code. A dual-write
could fail on every single call and the Sheet row would still save
looking completely normal, while the corresponding Firestore document
silently never existed. This is indistinguishable, from the player's
side, from "I added evidence and it saved fine" while the live
Evidence Locker permanently shows nothing for it. Added
`logFirestoreDualWriteFailure_()`, now called after every dual-write
attempt, which checks the actual response code and logs the real HTTP
status + body on failure -- the "log-but-swallow" behavior this
section's own header comment always claimed, now actually true. Also
added a read-only diagnostic (`diagnoseEvidenceFirestore_`, run via
`runDiagnoseEvidenceNow()`) that checks every Evidence sheet row
against its Firestore mirror doc and reports any that are missing, plus
a one-shot repair (`backfillMissingEvidenceToFirestore_`, run via
`runBackfillEvidenceNow()`) that re-sends every row through the same
dual-write call to self-heal any gaps found -- both safe to re-run.
Not yet confirmed whether this was the actual cause of a live "evidence
added but not showing" report (diagnostic needs to be run against the
real Sheet first), but the swallowed-error gap itself is real and now
fixed regardless of that outcome.

**Part two of "A-Cell's Evidence tab showed 'No evidence filed here yet'
with no indication anything was actually broken" (see that entry,
above) -- the first fix was real but incomplete, and the exact same
user-visible symptom came right back.** That earlier pass added real
error-surfacing to `startEvidenceListener()`'s sign-in-failure and
`onSnapshot` error handlers ("Could not load Evidence (Handler sign-in
failed): ..." / "... (Firestore): ..."), writing it straight into
`listEl.innerHTML`. It never actually stopped showing, though --
`fetchAll()` (loads Cells/Operations from the separate,
still-unmigrated Apps Script backend) calls `renderList()`
unconditionally on every refresh, regardless of whether the Firestore
listener succeeded, and both fire off the very same
`dg-acell-handler-ready` event -- so the real error was written
correctly, then overwritten within moments by the next
Cells/Operations-driven re-render showing the plain empty-Locker text
again. A live failure was still indistinguishable from a genuinely
empty Locker, just one layer deeper than before: this time confirmed
via `runDiagnoseEvidenceNow()` first showing all 16 Evidence rows
genuinely exist in Firestore, and "All Cells" still showing nothing --
ruling out a lost write and a Cell/Operation placement mismatch, and
pointing at this exact client read/render path a second time. Added a
persistent `evidenceLoadError` flag that `renderList()` now checks
first (cleared only on a real successful snapshot); the listener's
failure paths set it and call `renderList()` directly instead of
writing `innerHTML` inline, so the message now survives every later
re-render instead of being silently wiped within moments of appearing.

**Diagnostic tooling, not a fix yet: A-Cell's Evidence tab now shows a
real-time Firestore pipeline status on screen.** After the fixes above
still left a genuinely-fresh, correctly-signed-in device showing no
evidence and no error, and after ruling out a lost write, a
Cell/Operation mismatch, and a Firestore-project mismatch (all
confirmed via `runDiagnoseEvidenceNow()` / `runShowFirestoreProjectIdNow()`)
-- the only thing left unverified was what the live client's own
sign-in/listener pipeline was actually doing in real time, which no
amount of server-side diagnostics can show, and which isn't visible on
a device with no devtools access. Added a small status line
(`#evidence-fs-status`) in the Evidence toolbar that updates live
through every stage: "signing in…" → "signed in as \<uid\>, waiting for
snapshot…" → "snapshot received, N doc(s) @ \<time\>", or the real error
text at whichever stage actually fails. Turns the previously fully
invisible async chain into something readable on screen without
needing a computer at all.

**Self-correction, same day: the status line above was itself invisible
on a phone.** Placed in the Evidence toolbar's flex row with
`margin-left:auto` to push it right, on a screen actually showing
nothing there at all -- that row has no `flex-wrap`, so on a narrow
phone width it silently overflowed off the right edge instead of
wrapping, with no horizontal scroll to reveal it. Confirmed via a live
screenshot: the toolbar rendered normally, buttons and refresh
timestamp all visible, with no status text anywhere -- exactly the
"looks like nothing happened" failure mode this line exists to prevent,
just relocated to the tool that was supposed to fix it. Moved to its
own full-width row below the toolbar instead of sharing that row.

**Root cause found, via the status line above: Evidence's Firestore
sign-in could hang forever, with no error, ever, and no way to recover
short of a full reload.** The new status line showed "Firestore:
signing in..." stuck indefinitely. Traced to `loadScriptTag()`
(a-cell.html's own Firebase-SDK loader, used to fetch
app/auth/functions/storage/firestore compat scripts on demand): it set
`s.onload = cb` but had **no `s.onerror` at all**. Any one of those
script requests failing -- blocked, a dropped mobile connection, a
flaky CDN response, exactly the kind of thing a real phone on real
signal hits -- left `cb` never called, and nothing else waiting on it
either: the whole `ensureFirebaseApi()` chain, and therefore
`ensureHandlerSignedIn()`'s promise, just hung forever, neither
resolved nor rejected. This is very likely the actual explanation for
"I loaded up many, could manage them, then all of a sudden they
disappeared" from earlier today -- not a permanent misconfiguration
(ruled out via the project-ID check), but a pipeline that silently,
permanently wedges itself the moment one script request fails, with
literally nothing --no error, no timeout, no retry -- to recover it
short of a full reload (and a full reload on the same flaky connection
just hangs again). Added a real `s.onerror` handler plus a 15s timeout
backstop (in case `onerror` itself doesn't fire for every failure
mode), both of which now properly reject `ensureHandlerSignedIn()`'s
promise -- which the earlier `evidenceLoadError`/status-line fixes
already know how to surface as a real, visible, non-clobbered error
instead of an infinite silent hang.

**That fix alone didn't finish the job -- confirmed live: still stuck
on "signing in..." after a full minute, well past the new 15s
script-load timeout.** That means the SDK scripts themselves were
loading fine, and the actual hang was one level deeper: the live
`httpsCallable('handlerLogin')(...)` call to the Cloud Function (or
`signInWithCustomToken()` right after it), neither of which the
previous fix touched at all -- the Firebase SDK's own default
`httpsCallable` timeout is 70s, and `signInWithCustomToken()` has no
documented timeout guarantee at all, either of which could sit
silently well past what anyone waiting on a phone would consider
"working." Added `withTimeout_()`, a small helper that races a promise
against its own hard deadline (20s each), wrapped around both calls,
plus finer-grained status-line checkpoints ("loading SDK…" → "SDK
loaded — calling handlerLogin()…" → "got token — exchanging for a
session…") so the next report pinpoints exactly which stage is
actually stuck, rather than everything collapsing into one generic
"signing in…" that could mean any of four completely different
things.

**Still stuck, even confirmed against the exact deployed commit and a
full "Clear History and Website Data -- All time" + fresh reopen: the
status stayed on the plain, generic "signing in" text, with none of
the new checkpoint text ever appearing.** That result is genuinely hard
to reconcile with the code as read -- a full data clear plus a fresh
tab load leaves nothing to fall back to but the current deploy, and the
first checkpoint (`setFsStatus('Firestore: loading SDK…')`) fires
synchronously, before any network call, so it should be visible near-
instantly if this code is really what's running. Rather than keep
guessing at narrower and narrower causes inside the sign-in pipeline
specifically, added a page-wide uncaught-error/unhandled-rejection
catcher as literally the first script in `<head>`, before anything
else on the page -- a small dismissible on-screen banner showing the
real error message/stack for ANYTHING that throws or rejects anywhere
on the page, not scoped to Evidence or Firebase at all. The working
theory shifting: several individually-verified-correct fixes in a row
all failing to change the observed behavior on this one device is
itself a signal that the actual blocker may be something entirely
outside every path checked so far -- a JS error elsewhere on the page
preventing this code from ever running as expected is one real
possibility this can now surface, on a device with no devtools access,
that nothing built so far could have caught.

**ROOT CAUSE, found via the banner above on the very next report:
`TypeError: window.firebase.firestore is not a function` at
a-cell.html:2210, thrown as an UNCAUGHT exception (not a promise
rejection) -- which is exactly why every fix to the sign-in promise's
own error handling never mattered, no matter how correct each one was
in isolation. This bug never had anything to do with sign-in at all.**
`ensureFirebaseApi()`'s load chain requests
app -> auth -> functions -> storage -> firestore, in that order --
firestore-compat.js loads LAST. But
`window.firebase.firestore().settings({experimentalAutoDetectLongPolling:true})`
(the Brave fix from earlier today) was called immediately after
`initializeApp()`, at the very START of that chain -- before
firestore-compat.js had ever been requested, let alone loaded.
`window.firebase.firestore` was genuinely undefined at that point,
every single time this code path ran. It only ever appeared to work
because of load-order luck: if some OTHER widget on the page (Table
Radio, Dice Roller) happened to finish initializing Firebase (all
pieces, correctly ordered on THEIR pages) first, the `apps.length`
guard skipped this broken block entirely. A completely fresh device
with nothing pre-loaded -- exactly the state days of "clear cache and
reload" troubleshooting kept forcing -- made this script's own chain
race to go first every time instead, crashing on every single load,
permanently aborting the whole callback chain with an exception nothing
downstream could catch (an uncaught throw inside an async callback
doesn't reject a Promise someone is awaiting -- it just becomes an
unhandled global error), which is exactly why the sign-in promise
never resolved OR rejected no matter how long anyone waited: it was
never going to, the code that would eventually call resolve/reject
never even ran.

Checked the other 4 files that got the same Brave/long-polling fix
today (`agent-hub.html`, `notes/notes.js`, `assets/dice-roller.js`,
`assets/table-radio.js`) -- all four load `firebase-firestore-compat.js`
**second**, immediately after `firebase-app-compat.js`, before ever
calling `.settings()`. Only `a-cell.html`'s two self-contained loader
blocks (Evidence's own, and Track Library's separate copy) had
reordered the chain to load firestore last, breaking this. Fixed both:
`isFirstInit` is now captured at the true first-and-only-knowable
point (`!window.firebase.apps.length`, before firestore-compat.js
changes what that check could still mean), and the `.settings()` call
itself is deferred into firestore-compat.js's own load-completion
callback in both blocks -- Track Library's copy also never requested
firebase-firestore-compat.js at all before this fix, relying entirely
on some other script having loaded it first; it now loads it directly
like the other four files always did.

This is very likely THE actual explanation for the entire day's
Evidence saga -- "worked fine, loaded many, then all of a sudden
disappeared," every subsequent "still nothing" after every genuinely
correct earlier fix, and the "signing in" status that could never
move no matter how long anyone waited. Every earlier fix shipped today
(the swallowed-dual-write logging, the clobbered-error-message fix,
the missing script onerror/timeout, the handlerLogin/signInWithCustomToken
timeouts) was real and independently correct, and none of them were
wrong to make -- they just could never have mattered while this
specific line kept the whole chain from ever reaching them.

**CONFIRMED FIXED, live on the reporting device:** all 16 Evidence
items now render correctly (photos, titles, Cell/Operation tags) with
the status line reading "Firestore: snapshot received, 16 doc(s)."
Closes out the entire day's Evidence saga.

**Follow-on: a residual, content-free `"Script error."` appeared ~9s
after Evidence loaded successfully -- not blocking anything, but the
new JS-error banner couldn't say what it actually was.** This is
standard browser behavior, not a new bug: an error thrown from inside
a cross-origin `<script src>` (Firebase's SDK, served from
`gstatic.com`, a different origin than this page) reports to
`window.onerror` as a generic, content-free "Script error." -- no
message, no file, no line -- unless that script tag opts in with
`crossorigin="anonymous"`, which `loadScriptTag()` (both copies) never
set. `gstatic.com` already sends the necessary CORS header for this,
so it costs nothing to add. Added to both loader blocks so any real
future error from these scripts actually shows its real message
instead of this useless placeholder.

**Password masking made mistyped passwords impossible to proofread
before submitting, on request.** A-Cell's clearance gate had a custom
X-masking scheme (built to match the terminal aesthetic, not native
`type="password"` dots) tracking the real value separately from the
displayed X's; the Handler-password and Sheet-tab password fields used
plain `type="password"`. All three now show the real typed characters
directly -- the clearance gate's shadow-value tracking (`realValue` +
its `beforeinput`/`input` handlers) is removed entirely rather than
kept unused, since `input.value` is now itself always the real value.

**"Double banner on top of screen" on mobile, with the lower one's
Reload button seemingly not tappable.** `assets/sw-update.js` runs
independently on every page, including both `hub.html` (the outer
shell) and whatever page is loaded into its `#dg-shell-content`
iframe, since it's included on all of them. Browsing via the shell,
BOTH documents detect the same service-worker update (one scope covers
the whole origin) and each renders its own `position:fixed` banner
within its own document -- two banners stacking on screen, with the
inner iframe's own Reload button only reloading the iframe's `src`,
not the whole page, which read as "nothing happens" when tapped. Now
short-circuits entirely (no registration, no banner) when running
inside `#dg-shell-content` -- the outer shell's own instance already
covers the whole app, and a real reload of the outer page re-navigates
the iframe fresh too.

**Dice Roller's Roll button rendered purple on request-reported pages
instead of matching the rest of the panel.** Bundled into the same
restyle commit as the widget's palette-matching change (a redesign, not
a bug fix on its own -- not logged here for that part). Real, separate
bug found while in there: `#dr-manual-row button` (the Roll button
next to the manual target/expression input) only ever set layout
properties (padding/font/width) -- no color, background, or border at
all, unlike every other control in the panel. It fell through to
whatever generic `button` styling the embedding page happened to
define instead of the panel's own accent color, which is what read as
"purple" on at least one page/theme. Given its own explicit styling
(border/color/background, hover state) matching the rest of the panel,
same pattern the die pills and handler gate already used.

**Switching Track Library tracks played the old and new mp3
simultaneously, with no way to stop the one that was playing before.**
Live report: picking a different uploaded track for a channel didn't
replace the broadcast, it layered on top of it, and there was no UI
control left that could reach the earlier one to silence it.
`renderEmbed()` (`assets/table-radio.js`) rebuilds the embed by
replacing `#dg-radio-embed-wrap`'s `innerHTML`, which removes the old
`<audio id="dg-radio-audio">` element from the document -- but a
playing `HTMLMediaElement` does NOT stop just because it's been
detached; it keeps decoding and playing, orphaned, until explicitly
paused (there's no fixed GC timeline to rely on instead). Once
replaced, `getElementById('dg-radio-audio')` only ever returns the
*new* element, so the old one becomes permanently unreachable from any
button on the page -- exactly "can't stop the one that was playing
before." `destroyActivePlayers()` (called at the top of every
`renderEmbed()`) only ever tore down the YouTube/SoundCloud player
objects; it never touched the plain `<audio>` case at all. Fixed by
having it explicitly `pause()` and clear the `src` of whatever
`#dg-radio-audio` element still exists, before the replacement happens.
One subtlety: pausing that old element fires its own `'pause'`
listener, which is written to treat an *unprompted* pause as a
playback interruption to recover from and calls `.play()` right back on
it (see the iOS Safari interruption-recovery fix elsewhere in this
file) -- without guarding against that, this fix would have paused the
old element only to have its own recovery code immediately resume it.
Fixed by setting `intentionalPause = true` before pausing it, which
that listener already checks and respects; the next real track's own
`renderEmbed()` branch resets it to that new track's actual state as
soon as one exists.

**A-Cell Music tab redesign, bundled into the same commit as the fix
above (not logged here for the redesign itself, see FEATURES.md):** the
Handler's Pause/Restart/Stop controls moved into a new "Now Playing"
panel with a real embedded, real-scrubber preview for uploaded/direct
tracks (a headless `<audio>` element driving a custom-styled play/
pause + scrubber row, not the browser's own native `<audio controls>`
chrome, which doesn't match this app's look) -- while building it,
confirmed the same detached-audio-element issue could never have
affected this panel specifically, since it reuses one persistent
`<audio>` element and only ever reassigns its `.src`, which browsers
already handle by stopping
and replacing playback with no equivalent orphaning risk.

**The Now Playing panel's Restart/Pause/Stop icons rendered as
full-color platform emoji instead of plain icons, and the audio preview
looked like a generic OS media player instead of matching the rest of
the app.** Live report, with a screenshot: the transport buttons showed
chunky colored glyphs sitting in blue rounded squares, and the preview
below them was a plain grey system scrubber. Root cause of the first
part: the icons were literal Unicode characters (`⏮`⏸`⏹`, the
"Miscellaneous Technical" block) -- how these render is entirely up to
whatever font/emoji-substitution table the visiting device happens to
use, completely outside this app's control, and several platforms
substitute a full-color emoji glyph for exactly this block. Root cause
of the second part: the preview used a real `<audio controls>` element,
which deliberately renders using the browser/OS's own native media-
player chrome (by design, for accessibility and consistency with the
rest of the OS) -- there's no way to reskin that to match a specific
site's look. Fixed by replacing the Unicode icons with inline SVG
(`fill="currentColor"`, so it always renders as one flat glyph in
whatever color the surrounding CSS sets -- the exact same technique
`assets/dice-roller.js`'s own die-face icons already use, just not
carried over here the first time), and by dropping the `controls`
attribute entirely -- the `<audio>` element is now a headless engine
only, with a hand-built play/pause button, scrubber (`<input
type="range">`, styled with `accent-color` like every other slider in
this app), and elapsed/duration readout standing in for what
`controls` used to draw, matching the panel's actual visual language
instead of the visiting device's own media-player skin.

**Toggling an ambient loop on in A-Cell gave no reliable way to tell it
was actually off again.** Live report: "when I play an ambient loop, I
cannot stop that." Root cause wasn't a playback bug -- toggling the
grid button correctly sent `active: '0'` and the backend correctly
removed the layer -- it was a UX gap: a single toggle button is the
only affordance, with no separate confirmation of current state beyond
its own highlight, and no way to see or manage a loop once several are
running at once. `ambient_layers` (and `stingers`) were also flat
scalars/bare ids with no way to pause, seek, or re-loop one specific
already-playing instance independently of turning it fully off. Fixed
at the root: both are now full instance objects
(`{id/fired_at, started_at, paused, paused_at, loop}`, mirroring the
main track's own started_at/paused_at/loop fields) with dedicated
Code.gs actions (`pause_ambient_layer`/`resume_ambient_layer`/
`seek_ambient_layer`/`set_ambient_layer_loop`, and the stinger
equivalents keyed by `fired_at` since the same stinger id can fire
several independent overlapping instances) built on two small shared
helpers (`updateSoundInstance_`/`removeSoundInstance_`) rather than
nine near-duplicate functions. A-Cell's new Active Sounds panel lists
every currently-active loop and stinger as its own row with a real
scrubber, Play/Pause, an unambiguous Stop button, and a Loop toggle --
each backed by its own headless preview `<audio>` for accurate
duration/position, the same pattern the main track's Now Playing
preview already uses. `assets/table-radio.js`'s `applyAmbientLayers_`/
`applyStingers_` were updated to read the richer instance shape and
apply pause/seek/loop changes to an already-playing element in place
(diffed by an instance key, same discipline as the main track's own
preview-instance tracking), and a stinger's own `<audio>` element is
now tracked by `fired_at` (not fired-and-forgotten) so a Handler
stopping one from the Active Sounds panel silences it for every
listener immediately, not just the Handler's own device.