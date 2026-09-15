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

**Part two of "when I play an ambient loop, I cannot stop that" -- the
Active Sounds panel above was real, but the exact same channel it was
first tested on still couldn't be stopped.** Live report with a
screenshot: toggling the ambient button glowed briefly then reverted,
while the loop kept audibly playing under the main track regardless.
Root cause: this migration's own gap. `ambient_layers` changed from an
array of bare id strings to an array of instance objects
(`{id, started_at, paused, paused_at, loop}`) in the same session --
but a channel already toggled on under the OLD shape (exactly the
channel used to test the NEW soundboard) still had a plain string
sitting in its row. Every new code path assumes an object and reads
`l.id` off each entry -- on a bare string that's `undefined`, so
`l.id === layerId` never matches it: the confirm-check in A-Cell's
toggle button treated it as never having landed (hence the immediate
revert), Stop/pause/seek/loop-toggle could never find it to act on,
and the Active Sounds panel/player widget either skipped it entirely
or (worse) rendered/loaded `assets/ambient/undefined.mp3` for it.
Meanwhile the loop kept playing because the ORIGINAL toggle-on POST,
back when the bare-string format was still live, had genuinely
succeeded -- there was just no longer any code path that could
recognize that entry as the same layer to turn it back off. Fixed with
a small `normalizeAmbientLayer_()` (Code.gs and, for defense-in-depth,
`assets/table-radio.js` and `a-cell.html` too, since Firestore reads
and stale in-memory state can still hand a client a bare string before
a fresh write flows through) that upgrades a bare string into the full
object shape on first touch. Applied at every ambient_layers read site
that mutates or returns the array, so it's fully self-healing -- the
very next toggle/pause/seek/stop/loop action on an affected channel
rewrites its row in the new shape permanently, with no separate
migration script needed. `setAmbientLayer_`'s turn-off branch was also
hardened to filter out every matching entry (not just the first found)
as belt-and-suspenders against a literal duplicate id landing in the
array while this bug was live.

**Also moved, not a fix:** the Active Sounds list now lives directly
under the main track's own scrubber inside the Now Playing panel
itself, not in a separate section below the ambient/stinger catalog
grids -- per feedback that "that area should be a control panel where
I can control every sound that is playing," one glance at the top of
the tab now shows the main track AND everything layered under it.

**Every Table Radio button had a noticeable, and reportedly ~10s,
delay before an action was actually audible at the table.** Live
report: "the buttons have a very annoying latency, they dont react
immediately." Real playback everywhere is driven by each listener's
`onSnapshot` on the `radio/{channel}` Firestore document, not the
Sheet -- but every write function here (`setNowPlaying`,
`pauseNowPlaying`, `resumeNowPlaying`, `updateSoundInstance_`,
`removeSoundInstance_`, `setAmbientLayer_`, `triggerStinger_`,
`seekNowPlaying_`) did its `sheet.getRange(...).setValues([row])` call
FIRST and only fired the matching `firestoreDualWrite_`/
`firestoreDualPatch_` afterward. Apps Script's Sheets I/O has real,
sometimes multi-second, per-call latency of its own -- every action
was paying that cost before the one write that actually matters for
audible playback even started. Reordered all eight functions to fire
their Firestore write/patch first and the Sheet write second; both
dual-write helpers already log-but-swallow their own errors, so this
doesn't change failure-safety -- a Firestore hiccup still leaves the
Sheet (the real source of truth, and what A-Cell's own JSONP
`get_now_playing` reads back to confirm) written correctly, just no
longer gating how soon the change is heard. Doesn't eliminate Apps
Script Web App dispatch/cold-start latency itself, which is a separate,
already-documented platform characteristic (see "Backend performance &
security hardening" below) -- this only removes the extra, unnecessary
delay this session's own Sheets-first ordering was adding on top of it.

**CI's QA harness (`test/run_tests.py`) hardcoded a dev-sandbox Chromium
path, and separately, its Notes/Evidence-in-Notes tests were mocking a
backend the app no longer reads content from.** Two distinct bugs, both
only surfaced once GitHub Actions CI actually got wired up (this
session's own addition, see `VERSIONING.md`) and could finally run this
suite in a clean environment for the first time.

1. `main()` called `p.chromium.launch(executable_path="/opt/pw-browsers/chromium", ...)`
   -- a path specific to the Claude Code sandbox this file was
   originally authored in, not a real path on a GitHub Actions runner
   or any machine that just ran `playwright install` normally (which
   puts the browser in Playwright's own default cache location
   instead). Every CI run failed at that exact line, immediately, 100%
   reproducible, regardless of what the triggering commit actually
   changed. Fixed by making `executable_path` opt-in via a
   `DG_TEST_CHROMIUM_PATH` env var (unset by default), matching the
   existing `DG_TEST_BASE` env-var-with-default pattern already in this
   file, and falling back to Playwright's own standard resolution.

2. Once that was fixed and the suite could finally run to completion in
   CI for the first time, it surfaced ~38 failures concentrated entirely
   in Notes (`test_notes_v2_editorjs`, `test_notes_evidence_integration`,
   cascading into further crashes later in each of those same test
   functions) plus one cross-iframe timing issue and one genuinely stale
   assertion. First hypothesis (a slow/cold CI runner racing a handful of
   fixed `page.wait_for_timeout(N)` calls that should have been
   `wait_for_condition` polling instead) was wrong -- verified locally
   with the polling fix applied and the exact same failures still
   happened, with generous 8-second timeouts. Real cause: `notes/notes.js`
   was migrated to live Firestore `onSnapshot` listeners for actual note
   and Evidence content as part of this project's own earlier Firebase
   migration (Phase 5) -- its own code comment says so plainly, "Reuses
   `list_cell_notes` purely for its bundled identities map, discarding
   `res.notes` now that the two \[Firestore\] listeners above own note
   content." But the test fixtures for Notes were never updated to
   match -- they still only mocked the old Apps Script JSONP endpoint,
   whose note/Evidence content the app has been silently discarding ever
   since that migration. These tests have likely produced no real
   content-flow coverage since then, invisible only because CI could
   never run far enough to expose it. `install_radio_firestore_stub`
   already existed for Table Radio's own single-document Firestore
   listener, but nothing equivalent existed for Notes' collection+
   `.where()`-clause queries or the `ensureAgentSignedIn()` Auth+Functions
   sign-in step both Notes' and Evidence's listeners sit behind. Added
   `NOTES_FIRESTORE_STUB`/`install_notes_firestore_stub()`/
   `push_firestore_snapshot()` (a more general stub: fake Auth
   `signInWithCustomToken`, fake Functions `httpsCallable('exchangeAgentToken')`,
   and a Firestore collection stub matching listeners by exact
   collection-path + `.where()`-chain rather than a single document id),
   wired into both broken test functions and into `test_mobile_notes_fullscreen`
   (which embeds `notes/index.html` in an iframe and was hitting the
   same real-network-call problem even though it doesn't check Notes
   content itself). Also fixed in the same pass: `test_notes_code_url_param`
   asserted a "Change Agent" button (`#change-context-btn`) that was
   deliberately removed and replaced by Split View/Character Sheet
   buttons in an earlier commit -- notes/index.html's own code comment
   confirms the removal was intentional; the test was simply never
   updated to match, so it was replaced with an assertion on the actual
   current replacement UI. And `test_mobile_notes_fullscreen`'s own
   cross-iframe `#notes-play-btn` visibility check raced Playwright's
   `frame_locator` frame-attachment bookkeeping against a raw
   `contentDocument` DOM read that can resolve a tick earlier -- fixed by
   polling via `frame_locator` itself instead of mixing the two APIs.
   Verified locally (all 4 previously-broken test functions, 83 checks,
   0 failures) before shipping; CI's full 666-check run is the real
   confirmation.

**Follow-up: that fix was itself incomplete -- one Notes test function
was missed, plus one already-passing-locally check turned out to be a
genuine CI-only flake.** Confirmed by actually watching the resulting
CI run complete rather than assuming green: it went from 42 failures to
31, not zero.

1. `test_notes_reload_shows_own_previous_blocks` -- a small, separate
   regression test (deliberately not folded into `test_notes_v2_editorjs`,
   see its own docstring) covering a returning player's own already-
   saved notes reappearing on a fresh page load -- was never touched by
   the pass above and still only seeded its pre-existing block through
   the old JSONP `list_cell_notes` fixture, the exact same discarded-by-
   the-app data path the rest of this fix addressed. Fixed the same way:
   `install_notes_firestore_stub()` plus a `push_firestore_snapshot()`
   call once both listeners subscribe.
2. `test_mobile_notes_fullscreen`'s Play-pill visibility check
   (`#notes-play-btn`) failed on the real CI run despite passing locally
   in isolation. Reproduced properly this time by running the *entire*
   suite locally in one sequential pass (matching how CI actually runs
   it, not just the 4 previously-broken functions in isolation) --  it
   passed there too, 673/697. The button's visibility is set
   synchronously at script-parse time from a URL param
   (`notes/index.html`'s `embed=fullscreen` check), with no dependency
   on Firestore, Auth, or any async chain at all -- there is no
   plausible app-side race left to fix here. Concluded this is a
   genuine CI-runner-only timing flake (the suite runs ~700 checks
   sequentially in one browser by that point, and GitHub Actions'
   shared runners are meaningfully slower/more contended than this
   session's own sandbox) rather than evidence of a real bug, and left
   it as-is rather than papering over a single flake with speculative
   test changes.

Lesson repeated from the entry above: "verified locally" and "verified
in CI" are not the same claim, even when the local run is the complete
suite and not just the previously-broken functions -- confirm the
actual CI result before calling a fix done.

**Second follow-up, and closing note on this whole saga:** the fix
above (`test_notes_reload_shows_own_previous_blocks`) shipped clean --
CI run 34049802043 (attempt 1) showed that specific gap and the
mobile-fullscreen flake both gone. But it also showed 3 *different*
Notes checks failing for the first time ("pasting Docs-shaped HTML
auto-splits into a real Header/List block", "its gdrive-backed photo
resolves and renders as a real image") in test functions that commit
never touched. Rather than push another speculative fix, re-ran the
exact same commit's failed jobs with no code change
(`rerun_failed_jobs`) as a controlled check: if the same 3 fail again,
that's a real deterministic bug; if a different set (or none) shows up,
that's more of the same CI-runner timing flakiness already diagnosed
for the mobile-fullscreen check. Result: attempt 2 had **zero** Notes
failures at all -- the only failure that changed between attempts was
an unrelated, pre-existing `stats-terminal` outfit check (which is
itself random-roll-based and has flickered between runs all along, see
its own near-identical sibling failure earlier in this same file's
history). Conclusion: the Notes/Evidence Firestore-mock migration work
is done and fully verified -- three separate CI attempts across two
commits show 0 recurring, deterministic Notes-content failures; every
Notes-area failure seen was either the two real gaps now fixed above,
or one-off timing noise under GitHub Actions' shared runners that
doesn't reproduce on a bare re-run. The remaining ~27-29 failures on
every one of these runs (`hub`/`acell`/`shell`/`radio`/`stats-terminal`)
are pre-existing and unrelated to Notes -- present in CI before any of
this session's Notes work started -- and out of scope here.

**Correction to the above: most of those "pre-existing/unrelated"
failures were neither.** Asked to actually check them individually
rather than take that dismissal at face value, most turned out to be
real and in-scope -- tracked in
[GitHub issue #7](https://github.com/turulsen/dg/issues/7). Fixed in
this pass:

1. **Real, live production bug, not test-only**: `#dg-radio` (Table
   Radio widget, `assets/table-radio.js`) had `z-index: 9999` in
   `stats/styles.css`, while `#settings-panel` (and its backdrop) had
   `z-index: 9500`/`9400` -- lower. Confirmed via Playwright's own
   pointer-event interception trace: with the Settings panel open, the
   widget visually sits on top of it wherever it docks on screen and
   blocks clicks on panel content underneath (e.g. "Export Google
   Sheet"), for real users, not just this test. Root cause of
   `test_stat_generator_sheets_roundtrip`'s crash -- confirmed by
   calling `exportToSheets()` directly (bypassing the click entirely),
   which worked perfectly; only the click was ever the problem. Fixed
   by raising `#settings-panel`/`#settings-panel-backdrop` to
   `10000`/`9990`, clearing every floating widget's z-index.
2. **CI-load timing flake, not a real bug**: `test_foundry_import_
   profession_and_outfit`'s and `test_kappablack_toml_import`'s
   outfit-export checks used a fixed `page.wait_for_timeout(500)`
   after clicking Export to Agent File instead of polling for the
   captured POST body -- reproduced 0/14 failures in isolation, so
   this only ever lost the race under GitHub Actions' shared-runner
   contention. Converted to `wait_for_condition`.
3. **Two stale tests, not app bugs** -- the app was already correct,
   the test was never updated after a prior, deliberate change:
   - `test_acell_music`'s Pause/Resume assertions checked
     `button.textContent`, but this session's own earlier SVG-icon
     transport redesign moved that state into the `title` attribute
     instead (an icon-only button has no visible text anymore).
   - `test_acell_gate`'s password field check asserted X-masking, but
     X-masking was deliberately removed per a-cell.html's own code
     comment on `grantAccess()` ("was hiding real mistyped-password
     mistakes with no way to proofread before hitting Enter").

**Still open, larger than first scoped** (issue #7 tracks progress):
A-Cell's Evidence tab (Handler view) and Agent Hub's Handouts tab went
through the same Phase 5 Firestore-Auth migration as Notes, but their
test fixtures never got a Firestore/Auth stub -- same bug class as the
Notes fix above, different UI surface. Digging into it surfaced more
than a missing stub, though: Evidence's photo/PDF attachments were
*also* separately migrated to direct-to-Storage uploads (Phase 4,
`uploadEvidencePhotoIfNeeded_()`), so `test_acell_evidence_pdf`'s own
assertions (checking for a `data:application/pdf` URI in the
`create_evidence` POST body) test behavior that no longer exists
either -- it's not just a missing mock, some of the test's own claims
are stale. `test_acell_evidence_create_verify_retries` has a similar
problem one level deeper: the retry-polling logic it exercises
(`verifyEvidenceWrite_`) was rewritten to poll the live
Firestore-fed `evidenceItems` array directly instead of its own
separate `list_evidence` JSONP fetch, so the test's whole delayed-
JSONP-response mechanism no longer matches what the code actually
does. The shared Firestore stub (`NOTES_FIRESTORE_STUB`/
`install_notes_firestore_stub()`) was extended with `.orderBy()`
support, a `handlerLogin` Functions response, and a `storage()` stub
(`ref().put()`/`.delete()`) to cover all of this, but wiring it into
the 5 affected test functions -- correctly simulating Storage-URL
photos instead of data URIs, and re-timing the retry test around a
delayed Firestore push instead of a delayed JSONP response -- is not
done yet.

**Follow-up: all 5 wired in, and two more real, live bugs surfaced
along the way (not just missing mocks) -- both fixed.** Issue #7's
remaining scope, finished:

1. `test_acell_evidence`'s create/edit flow needed one more piece
   besides the stub itself: `showForm()`'s "+ New Evidence" button
   toggles the form closed only once `verifyEvidenceWrite_`'s *own*
   delayed polling of `evidenceItems` confirms the write (up to several
   seconds) -- a slower, separate path from the live listener push,
   which updates the rendered list far faster. Pushing a snapshot
   immediately (as a real Firestore dual-write essentially never does
   in well under a second) exposed a genuine race: clicking "+ New
   Evidence" again before that slower polling closes the still-open
   form just toggles it shut instead of opening a fresh one. Added a
   short wait for the form to actually close between steps -- this
   mirrors realistic pacing (nobody re-opens the form within
   milliseconds of a successful create) rather than a product bug
   worth changing app behavior over.

2. **Real, live bug, found while updating `test_acell_evidence_pdf`
   for the new Storage-URL photo format:** the PDF-detection logic
   that decides whether to render a labeled "View PDF" box instead of
   a broken `<img>` (`a-cell.html`'s card rendering, its edit-form
   preview restore, and `notes/notes.js`'s Evidence detail modal) only
   ever checked for a `data:application/pdf` URI prefix. That was the
   *only* format a PDF's stored value could take before Phase 4 -- but
   Evidence photos (and PDFs; `uploadEvidencePhotoIfNeeded_()` doesn't
   discriminate by file type) upload straight to Firebase Storage now,
   and `resolveEvidencePhoto_()` in `Code.gs` only rewrites `data:`
   URIs to `gdrive:` links, leaving a Storage HTTPS URL to pass through
   completely unchanged. A PDF uploaded via the *current* code path has
   silently rendered as a broken image ever since Phase 4 shipped, in
   every one of these three places, with no test ever catching it since
   none of them exercised a real Storage-URL PDF end to end. Added a
   shared `isPdfUrl_()` helper to both files (checks the legacy `data:`
   prefix OR a `.pdf` extension in the URL's path, before any query
   string -- a real Firebase Storage download URL appends
   `?alt=media&token=...`) and switched all three raw-stored-value call
   sites to it. The two call sites that check an *already-resolved*
   data URI from the `gdrive:` Drive-proxy path were left alone --
   those are still always real data URIs, correctly.

3. **Second real, live bug, found while wiring the Storage stub into
   `test_acell_music`:** Track Library uploads in A-Cell's Music tab
   were completely broken -- clicking Upload MP3 hung forever on
   "Uploading…", no error, ever. `a-cell.html`'s own comment (since
   removed) explained why: `ensureHandlerSignedIn()` used to have a
   second copy in the Music tab's own `<script>` block, matching the
   Evidence tab's, and was deleted on the mistaken belief it was a
   redundant duplicate. Each `<script>` tag in this file is its own
   IIFE with its own scope -- a function declared in one is not visible
   from another, `<script>` tags sharing a page do not merge scopes.
   The Track Library upload/delete flow was left calling an undefined
   function, which throws synchronously *before* its own
   `.then()`/`.catch()` chain is even constructed (since
   `ensureHandlerSignedIn()` is the very first call in that chain, not
   something invoked from inside an already-attached `.then()`) -- so
   nothing ever caught it, and the status text set just before that
   call (`'Uploading…'`) simply never got a chance to change. Restored
   the duplicate (`ensureHandlerSignedIn`, `withTimeout_`,
   `_handlerAuthPromise`), reusing this IIFE's own already-correct
   `ensureFirebaseApi()`.

All three `test_acell_evidence*` functions, both `test_agent_hub_
handout*` functions, and `test_acell_music` pass in full locally
(189/189 checks across every test touched by this and the preceding
entry, 0 failures) -- issue #7 is done pending the real CI run's own
confirmation.

Lesson worth restating from this whole saga: a "just check the
existing failures" ask surfaced two live, currently-shipped bugs
(broken PDF rendering, completely broken Track Library uploads) that
had nothing to do with test infrastructure at all -- they were hiding
*behind* a test-infrastructure gap that happened to also make them
fail for the "wrong" reason. Dismissing a batch of failures as
"pre-existing, unrelated, out of scope" without individually checking
each one is exactly how a real bug like this stays shipped indefinitely.

**Second follow-up: the real CI run surfaced 5 more of the exact same
missing-stub pattern, plus one gap the stub itself introduced.**
Checking CI's actual result (not stopping at "189/189 locally") turned
up:

- `test_acell_handler_session_race`'s one Evidence-specific check was
  testing the old, pre-Phase-5 `list_evidence`/`handler_session` JSONP
  race -- Evidence's read side moved to a Firestore listener with its
  own, separate auth caching (`ensureHandlerSignedIn()`/
  `_handlerAuthPromise`) that doesn't have this particular staleness
  problem anymore. Re-pointed that one check at the stub (its other
  three checks, about `list_characters`/Cells, are unrelated and still
  valid).
- Four `shell`-area tests (`test_shell_content_swap_preserves_
  hoisted_widgets`, `test_shell_nav_tracks_in_page_navigation`,
  `test_shell_hides_widgets_for_notes_popover`,
  `test_shell_back_link_hidden_inside_shell`) all load agent-hub.html
  and/or a-cell.html inside `hub.html`'s shell without ever intending
  to test Evidence at all -- but both pages' Evidence listeners start
  unconditionally on load (Phase 5), reaching the real backend in CI
  (this sandbox silently fails such unmocked external calls instead,
  which is why none of this showed up locally until checking the real
  run). Installed the stub in all four; two of them also needed a
  seeded Handler session, since "No A-Cell session" is a real, correct
  rejection the stub alone doesn't paper over -- and a clean sign-in is
  the least surprising simulated state for tests that aren't about
  Handler auth at all.
- `test_stat_generator_sheets_roundtrip` never mocked
  `**/script.google.com/**` at all, on the assumption nothing on that
  page called it -- but stats/index.html makes its own background
  JSONP call on load, which went out to the real production backend in
  CI. That's the actual origin of the "Unexpected token ':'" pageerror
  that never reproduced locally in two earlier attempts: a bare JSON
  body loaded as a `<script>` tag's content throws exactly that,
  the instant the parser hits the first key's colon. (Same failure
  signature `test_shell_nav_tracks_in_page_navigation` had already
  hit and documented once before, in its own comment on this exact
  bug shape -- worth remembering next time it shows up somewhere else.)
  Added a proper JSONP-aware mock, matching every other test's own
  convention.
- Wiring the stub into more tests than it had ever run in before
  surfaced a gap in the stub itself: `dice-roller.js`'s own
  cross-page roll-history feed calls `.limit()` on its Firestore
  query, which the stub's query builder never implemented -- invisible
  before because `window.firebase` simply didn't exist in those tests,
  so dice-roller.js took its real-network-attempt path instead (which
  this sandbox also fails silently). Added `.limit()` as a no-op
  passthrough alongside the existing `.orderBy()`.

All of the above, plus everything from the previous two entries, now
passes locally (248/248 across every test function touched across this
whole investigation). Issue #7 closed pending this run's own CI
confirmation -- which, per the lesson above, is the only check that
actually counts.

**Third follow-up, and the one that finally found the systemic version
of these bugs.** That run's own CI result (10 failures down from 24)
turned up 2 more instances of already-diagnosed patterns and, this
time, went looking for every OTHER copy of each pattern in the file
instead of fixing just the one CI happened to hit:

- `test_import_agent_auto_detect` had the exact same missing-JSONP-
  wrapper bug as the sheets-roundtrip fix two entries up -- a bare
  `lambda r: r.fulfill(..., body='{"status":"OK"}')` mock for
  `**/script.google.com/**`, always returning unwrapped JSON even for
  a `callback=`-bearing JSONP GET. Grepping for that exact lambda
  string found **14 byte-identical copies** scattered across the file,
  every one of them a latent landmine waiting for whichever page
  happened to make one unscripted JSONP call during its test. Replaced
  all 14 with a new shared `route_apps_script_ok(page)` helper
  (JSONP-aware, otherwise identical) instead of patching them one at a
  time as CI happened to surface each.
- `test_hub_clearance_lands_in_shell` lands in a-cell.html via the
  shell with no Firestore stub and no Handler session seeded -- same
  "No A-Cell session" local rejection (not a network failure) already
  fixed in four sibling shell tests two entries up; this one just
  hadn't been caught yet. Same fix.

One more failure in that run, `test_shell_back_link_hidden_inside_
shell` timing out mid-navigation with a bare Playwright asyncio
warning (`Task was destroyed but it is pending!`, from
`Page._on_route()`, not any application code) rather than a captured
JS error or assertion mismatch, reproduced 0/8 locally in isolation --
consistent with the CI-runner-load timing flakes already documented
multiple times in this file (mobile-notes-fullscreen, the outfit-export
checks, the Notes gdrive-photo timing), not a new bug. Left as-is
rather than guessing at a fix for a failure that isn't reproducible.

Lesson on top of the lesson: when a fix pattern shows up more than
once, grep the codebase for every other copy of it immediately rather
than waiting for CI to surface each one on its own -- this exact
14-copies-of-one-bug shape is exactly what "just fix what's currently
failing" misses.

## Live Play theming (X-Files, Son of Sam, Field Notes)

Live Play was refactored from one hardcoded "Field Document" paper
look to a `--lp-*` CSS custom-property token system so each Edit-mode
theme gets its own Live Play identity (colors + fonts) instead of
forcing the same look regardless of active theme. The rollout surfaced
several real bugs, reported from an actual phone against the live
site, fixed across a few rounds:

**Field Notes' palette didn't match the rest of the hub's shared
paper/ink look, and the Modern (Catppuccin) theme was being retired.**
Realigned Field Notes' `--lp-*` tokens and Live Play's defaults to
`assets/theme-folder.css`'s actual palette/fonts (the system
`index.html`/`agent-hub.html`/`a-cell.html` already use), and removed
Modern entirely (64 rule blocks plus its `--ctp-*` custom properties)
per explicit request rather than trying to theme it too.

**Field Notes' Live Play textareas showed a checkered grid instead of
the hub's lined paper, and used a calligraphy font instead of the
Editor's typewriter font.** The checkered look came from `.lp-ta`'s
pre-existing two-directional `linear-gradient` background (present
since the original port, inconsistent with the rest of the hub's
single-direction ruled look) -- replaced with a horizontal-only
`repeating-linear-gradient` tinted via `color-mix()` from `--lp-ink` so
it themes correctly everywhere, not just Field Notes. The calligraphy
font came from a separate `--lp-font-hand` token (`'Permanent Marker',
cursive`) used across ~12 call sites as a deliberate "editable field"
cue -- once it turned out to cover nearly all visible LP sheet data,
not a minor accent, it was removed entirely in favor of the shared
`--lp-font-mono` (Courier Prime) used everywhere else.

**X-Files' Live Play font didn't match its own Edit mode.**
`.theme-xfiles.live-play`'s `--lp-font-*` tokens were set to
`'JetBrains Mono'` on an incorrect assumption; X-Files actually has no
theme-level `font-family` at all and inherits the page's base
`body { font-family: 'Courier New', monospace }`. Fixed all three
X-Files font tokens to `'Courier New', monospace`.

**X-Files/Son of Sam: readonly/typewritten Live Play text was
unreadable ("black on green/red").** `--lp-ink-soft` (used for
readonly biography fields via `.lp-proxy[readonly]`) was too close in
brightness to `--lp-paper-bg` for both themes -- the "dim = readonly"
convention only works on Field Notes' bright cream paper, not near-
black paper. Brightened `--lp-paper-bg`/`--lp-page-bg-soft` (more
contrast headroom against the page background) and `--lp-ink-soft`
substantially for both themes; `--lp-ink` itself was deliberately left
alone since it's meant to match Edit mode's exact `--primary-color`.

**Same "unreadable text" complaint came back after the above fix
shipped -- a second, unrelated bug, not an incomplete first fix.**
Fresh phone screenshots still showed literal *black* input text on
green/red paper on every theme, including X-Files/Son of Sam where
`--lp-ink` is green/red, not black. Root cause: a pre-existing global
rule, `input[type="text"], input[type="number"], textarea, select {
color: var(--text-color); ... }` (`stats/styles.css` ~line 1144), has
specificity `(0,1,1)` (element + attribute selector) -- one rung above
every `.lp-proxy`/`.lp-stat-inp`/`.lp-feat-inp`/`.lp-skill-val`/etc.
class selector `(0,1,0)` that was supposed to set the real per-theme
ink color. It silently won on every literal `<input>` in Live Play
(stats, skills, bonds, distinguishing features, name field --
confirmed via `getComputedStyle` across ~59 inputs per theme, all
`rgb(0, 0, 0)`), while `<textarea>` elements were unaffected because
that same global selector list's bare `textarea` clause has only
`(0,0,1)` specificity, below `.lp-ta`'s `(0,1,0)` -- which is exactly
why the textareas (Wounds/Gear/Personal Details) looked fine while
every stat score, skill %, and bond name did not. It happened to look
correct on Field Notes only because `var(--text-color)` resolves to
`--lp-tracker-bg`, which is near-black there anyway -- purely
coincidental, not a real fix, and the same collision would have bitten
Field Notes too the moment its ink or tracker color ever diverged.
Fixed by adding `color: var(--lp-ink)` (and a `[readonly]`-scoped
`var(--lp-ink-soft)` override) to the existing `#lp-sheet
input[type="text"], #lp-sheet input[type="number"]` block -- an
ID-scoped selector `(1,0,1)` already used in this same file to win
against this exact global rule for padding/border/font, just never
extended to `color`.

**Third report, same complaint: "you just put a red filter on the
whole thing."** The specificity fix above was real, but it exposed a
much older, deeper mistake underneath it: `--lp-ink` had been set to
each theme's `--primary-color` (X-Files' green, Son of Sam's red) from
the very first round of this work, on the never-actually-checked
assumption that a theme's accent color IS its text color. It isn't.
Checked properly this time via `getComputedStyle` against real Edit
mode (not grep, not the token names) on `#cs-name`/`.stat-value`/
textareas: X-Files' green (`:root`'s very first `--primary-color`,
literally commented "X-Files Theme Colors") and Son of Sam's red are
both border/legend/button accent colors ONLY -- actual body and value
text renders in `--text-color`, a near-white `#ffffff`/`#f0f0f0` in
both themes. Son of Sam goes further: a dedicated, clearly-commented
rule ("Handwritten font for filled/generated content", `stats/
styles.css` ~line 943) renders every actual typed/generated value --
inputs, textareas, `.stat-value`, bond text -- in `'Rock Salt'`, a
cursive font, distinct from the `JetBrains Mono` used for labels/
legends; X-Files has no such second font, just the color split. Live
Play was mirroring neither: `--lp-ink` stayed the accent color and
`--lp-font-mono` (Rock Salt's Live Play analogue -- the font every
`.lp-proxy`/`.lp-stat-inp`/`.lp-skill-val`/etc. actually renders in)
stayed `JetBrains Mono` for Son of Sam, which is exactly what reads as
"a red filter over Field Notes" instead of a real distinct identity.
Fixed by setting `--lp-ink` to the same near-white as each theme's real
`--text-color`, `--lp-font-mono` to `'Rock Salt', cursive` for Son of
Sam specifically (matching its real dual-font design), and
`--lp-ink-soft` (the dim/readonly variant) to a plain dim gray for both
instead of a tinted-accent dim, since "dim white" is what real Edit
mode's own readonly-equivalent contrast would look like. Red/green stay
exactly where Edit mode actually uses them: borders, buttons, tracker
chrome, section-header bars.

**Self-inflicted regression while writing the fix above -- the exact
comment-injection bug from earlier this session, again.** The
X-Files rewrite's own explanatory comment included the literal string
`":root { /* X-Files Theme Colors */ }"` to name where the mistaken
green value came from -- and that embedded `*/` closed the CSS comment
early, corrupting everything after it up to the next real `*/`,
silently dropping the entire `.theme-xfiles.live-play` rule (confirmed
via live `document.styleSheets` inspection: the rule simply wasn't
registered, so the base `.live-play` Field Notes defaults leaked
through under the X-Files class instead). Caught immediately this time
by verifying the fix live instead of trusting the source edit --
reworded the comment to describe the same `:root` block without
literal `/* */` syntax inside it. Worth a standing rule: never quote
literal `/* ... */` CSS-comment syntax inside a CSS comment, in this
file or any other.

**"ROLL IMPROVEMENTS"/"APPLY & CLEAR MARKS" unreadable in X-Files and
Son of Sam Live Play.** `.lp-btn-advance` only overrides `background`
to `--lp-accent-warm`; its text color still comes from `.lp-btn-sm`'s
`color: var(--lp-header-text)`, chosen to work against the black
header bar `.lp-btn-sm` is normally seen on. The moment a theme's warm
accent isn't safely dark, that assumption breaks: X-Files' bright green
header-text over its own bright amber accent-warm, and Son of Sam's
bright red header-text over its own dark red accent-warm, both read as
"unreadable" -- confirmed from an actual phone screenshot. Field
Notes' dark gold accent-warm still works fine under the inherited
white, so only `.theme-xfiles .lp-btn-advance` (black text) and
`.theme-son-of-sam .lp-btn-advance` (white text) needed an explicit
override.

**X-Files' New Recruit block flickered green-then-black on every
load, not just its intended decorative headers.** A blanket
`.theme-xfiles body, .theme-xfiles * { animation: textFlicker 20s
infinite; }` rule applied the CRT-glow keyframe animation to literally
every element on the page, including plain body/label text with no
glow to begin with -- what read as "New Recruit glows up in green then
fades to black" was that animation's zero-glow phase landing on text
that should have just been static. Removed the blanket rule and
`@keyframes textFlicker` entirely; replaced with a static (non-
animated) version of the same glow, scoped only to the decorative
headers it was meant for (`.page-title`, `.lp-dg-title`, `.stats-
section h2`, `.site-intro strong`).

**Son of Sam's "Return to Sheet" mode toggle nearly invisible.**
`.dg-mode-toggle.dg-mode-active`'s colors (`#1a0d0d` background,
`#6a2a2a` border) were tuned against Son of Sam's old paper-tinted
red background, from before that background was flattened to solid
black in an earlier fix -- against pure black the button had almost no
contrast left. Brightened to `#2a1010`/`#9a4a4a`/`#e8a8a8` (and the
matching `:hover` state) so it reads clearly again.

**Bond names truncated in the Live Play Bonds table.** `.lp-bond-
name-input` was a single-line `<input>`; real bond text (e.g. "Taylor
Kim (They/Them) -- Tech Sergeant, Air Force") routinely runs longer
than the column width and had nowhere to go but cut off. Converted
the field to a `<textarea>` with `field-sizing: content` so it wraps
and auto-grows instead of truncating -- the table row's fixed `height`
already behaves as a minimum, not a cap, so it grows to fit without
any further change.

**Field Notes' "Import Pasted Text" paste box unreadable.** The new
always-visible `#agent-paste-area` textarea (promoted from a collapsed
`<details>` to the primary import path) sat directly on the theme's
dark desk-colored page background, but Field Notes' "written on the
lines" input styling (`background: transparent; color: #1c1608` dark
ink) assumes it's inside a cream-paper fieldset panel -- every other
input on the page has one, this new standalone box didn't, so its dark
ink rendered as near-invisible dark-on-dark. Fixed by giving
`#agent-paste-details` its own scoped cream-paper card background
(`.theme-field-notes #agent-paste-details`) so the existing ink color
actually has paper to sit on.

**Live report: New Recruit's paste box rendered as a solid color-
filled block in the settings drawer for an already-played (Live Play,
creation-committed) Agent -- X-Files solid green, Son of Sam solid
red -- effectively unusable and alarming enough to read as "the page
is broken."** Root cause: `#settings-panel` has its own long-standing
rule set that forces plain neutral drawer colors onto `button`/
`select`/`input[type="text"]` specifically to override each theme's
(and Live Play's) CSS custom-property reskinning, which is otherwise
correct for controls sitting on the theme's own paper background but
unreadable/wrong on this always-dark drawer -- see that rule's own
comment in `styles.css`. `textarea` was never added to that list,
because until this same round the New Recruit paste box was a
collapsed `<details>` nobody actually opened from inside the drawer.
Promoting it to an always-visible primary import path (see above)
made the gap immediate: while Live Play is on, `.live-play`'s
`--input-bg` points at `--lp-tracker-value`, which each theme
redefines to its own bright accent -- exactly the color the box was
filling with. Added `#settings-panel textarea` (and its placeholder)
alongside the existing button/select/input rules.

**Live report: hundreds of dummy/test Agents ("Test Creation Lockout
Agent", "Priya Anand" repeated, unnamed `AGNT-XXXX` placeholders) piled
up in the live Characters sheet, far too many to delete one at a time
through A-Cell's existing per-row Delete button (its own password
re-entry per row).** Root cause found while investigating: of the 92
functions in `test/run_tests.py`, 30 never set up their own
`page.route("**/script.google.com/**", ...)` mock, and several of
those fill in `#cs-name` with shared fixture names (most commonly
"Priya Anand") -- which triggers `cloud-sync.js`'s real debounced
auto-save. In this sandbox that's silently harmless (the hostname is
already unreachable here by network policy, and those same unmocked
tests already pass against that blocked network) -- but GitHub
Actions CI has full internet access and runs this exact suite on
every push to `main`/`firebase-migration`, so it has been writing a
real row into the live Characters sheet on every single CI run this
whole time. Fixed at the root rather than patching 30 call sites:
`test/run_tests.py`'s `main()` now wraps `browser.new_page` once so
every test's page defaults to aborting `**/script.google.com/**`
outright; a test that sets up its own more specific mock afterward
still wins (Playwright resolves the most-recently-registered handler
first), so this can't quietly regress the next time a test is added
without its own mock either.

That stops new dummy rows, but doesn't clear the hundreds already
there. Added bulk delete to A-Cell's Sheet tab: a checkbox per row,
"Select Matching" (substring match against Agent Name) and "Select
Unnamed" (matches a row whose Agent Name is still just its own Agent
Code, e.g. `AGNT-87JW` -- never renamed, almost always one of these
dummy rows) as one-click shortcuts, then a single password entry
deletes every selected row instead of one prompt per row. Each
selected row still gets the same soft-delete (`action:
'delete_character'`, restorable from Recently Deleted for 24 hours)
the single-row button already used, fired with bounded concurrency (4
at a time) rather than one at a time, skipping the existing single-
delete flow's own per-row re-verify step for speed -- one list refresh
at the end shows whatever's left, and anything that failed to delete
is still selectable and safe to retry.

---

## Dice Roller panel freezing mid-screen instead of staying docked

Real player report: the hoisted Dice Roller widget (`#dr-panel`,
position:fixed in the parent document via hub.html's shell, present on
every page) would freeze floating mid-screen -- overlapping whatever
page content happened to be there -- instead of staying docked at its
real corner/bottom-sheet spot, on iOS Safari specifically. A full page
reload always fixed it, which is the signature of this file's own
already-documented WebKit bug: "position:fixed elements can freeze at
a stale scroll-relative spot instead of staying docked" (see
`buildPanel()`'s existing comment). The already-shipped fix only
re-snapped the panel via a `visibilitychange` listener (forcing a
reflow when the tab is backgrounded and returns) -- real, but partial:
it only covers the tab-switch/lock-screen trigger, not whatever else
(most likely plain scrolling) also desyncs a fixed element's position
on WebKit. Added the same GPU-layer-promotion fix already used
elsewhere in this project for the identical bug class (Notes' block-type
picker popover, `notes/notes.css`): `transform:translateZ(0)` plus
`backface-visibility:hidden` on `#dr-panel` itself, so WebKit
continuously re-evaluates the fixed position against the real viewport
instead of needing an event to notice and correct a stale one. Shipped
as its own small, isolated fix on top of `main` (not the stalled
141-commit branch) -- bumped `sw.js` to `v94`. Full suite: 765/765
passing.

## Post-mortem: what actually broke in the 2026-09-10 cutover attempt

Investigated after rolling `main` back (see `CLAUDE.md`'s "Deploy
discipline" section for the timeline). `a-cell.html` itself is
byte-for-byte identical between the pre-cutover commit and the
141-commit branch's tip -- confirmed via `git diff`, ruling it out
directly. But `a-cell.html` is normally viewed *through* `hub.html`'s
shell, which hoists `assets/dice-roller.js`'s and
`assets/table-radio.js`'s widgets into the parent document as
position:fixed elements present on every shell page, regardless of
which content page is iframed -- so a bug in either of those two
files would show up identically everywhere, matching what was
reported (the same "Script error." flood and stuck widget on the
clearance screen, A-Cell, and the character sheet alike).

Both files got the identical change in this session's "missing
onerror/timeout on Firebase script loaders" fix: `s.crossOrigin =
'anonymous'` added to their `<script src="https://www.gstatic.com/
firebasejs/...">` loader, specifically so a load failure would surface
a real error instead of hanging silently forever. Leading hypothesis,
NOT yet confirmed: if `www.gstatic.com` doesn't actually serve a
matching `Access-Control-Allow-Origin` header for an anonymous-mode
request to these specific SDK files, setting `crossOrigin` would make
Safari refuse to run the script at all (a real load failure, not just
reduced error detail) -- and with two independent widgets each on
their own retry schedule after a failed Firebase init, that lines up
with the observed ~2-second-paired repeating "Script error." flood
better than any other change in the diff. Could not verify directly:
this sandbox's own network policy blocks `www.gstatic.com` outright
(confirmed via the agent-proxy's own status endpoint -- a policy
denial, not a real response from Google), so there was no way to check
gstatic's actual CORS headers for these files from here.

Deliberately NOT re-attempted tonight: re-running the full 141-commit
cutover blind, a second time, on the same night as the first incident.
Before any future attempt, this specific hypothesis needs an actual
check (does gstatic.com return CORS headers for these paths, tested
from a real network) and, if confirmed, a fix that keeps the
onerror/timeout logic (the real, valuable part of that change) while
dropping the `crossOrigin` attribute if it turns out to be the
regression.

---

## Investigation tool: page-wide JS-error telemetry, generalized to every page

Not a fix -- a debugging aid added while investigating the 2026-09-10
production incident (see `CLAUDE.md`'s "Deploy discipline" section for
that timeline). That incident's post-mortem, and a long follow-up
investigation across this and several later sessions, ruled out every
specific hypothesis checked against the code (the `crossOrigin`
gstatic-CORS theory, backend `Code.gs`'s actual live-deployed content,
Firestore rules/indexes, every `onSnapshot` listener, a cross-widget
Firestore `.settings()` race that had genuinely broken `a-cell.html`
once before but was already fixed pre-incident) without finding the
actual cause. The one thing every one of those dead ends had in
common: there was no way to see what a real device actually threw at
the moment of failure. `a-cell.html` already had exactly this tool --
a small `window.addEventListener('error'/'unhandledrejection', ...)`
catcher showing a dismissible on-screen banner with the real message/
stack, added months earlier during the original Evidence sign-in
debugging -- but only on that one page, and with nowhere for the
report to go except that one screen, at that one moment, if someone
happened to be looking.

Extracted into a shared `assets/js-error-banner.js` and added as the
first script tag on all 11 pages (previously a-cell.html only), so a
crash on the clearance/access screens, Dice Roller, or a character
sheet -- everything the Sept 10 reports actually named -- gets the
same visibility a-cell.html already had. Also now POSTs a best-effort
report to a new `log_client_error` backend action (`ClientErrors`
sheet, 14-day retention) -- a plain `fetch(..., {mode:'no-cors'})`
with zero Firebase dependency, deliberately, so a failure IN Firebase
loading itself is still reported instead of being the one class of
bug most likely to also break the one channel that could report it.
Self-limits against the exact "same error flooding every couple
seconds" shape the incident showed: each distinct error/rejection
(by kind+message+filename+line) stops both re-rendering the banner
and reporting to the backend after 3 repeats, and every page load caps
at 25 total backend reports regardless of how many distinct errors
occur; the backend adds its own per-session_id cap (40/hour) as
defense in depth. Bumped `sw.js`'s `CACHE_NAME` to `v95` (new
`SHELL_FILES` entry) -- one further than this branch's own prior work
(the crossOrigin investigation above never shipped a code change, so
`main` was still at the Dice Roller iOS fix's `v94`).

Cut over directly to `main` as its own isolated change (cherry-picked,
not merged) rather than through the stalled 141-commit branch --
that branch's actual incident cause is still unconfirmed, so nothing
else from it rides along. `BUGFIXES.md`'s own history reflects that:
this entry follows straight from `main`'s last one above, with none of
the working branch's other intervening entries (a test-harness fix and
a separate `sw.js` URL-prefix bug, neither reviewed or approved for
`main` yet).

**Not yet redeployed to the live Apps Script backend** -- per this
file's own standing rule, `backend/Code.gs` is a git-tracked mirror
only; `log_client_error` won't actually persist anything until this
file is pasted into the Apps Script editor and redeployed. The
client-side banner works regardless (degrades gracefully -- a failed
report is caught and dropped, never blocks or breaks the banner
itself). Full suite re-run against this cutover's actual `main` tip
(not just the working branch it was authored against): 773/773
passing, zero failures.

## The clearance screen's "Opening…" tap feedback never actually became
## visible on either card

A real report: tapping either Clearance card on `index.html` (Agent or
A-Cell) never showed the "Opening…" label swap/dim feedback that's
been in this page since `2c9956c`, even though the underlying
navigation itself worked fine.

Root cause: the click handler applied its visual state (`cc-tapped`/
`cc-nav-pending` classes, the "Opening…" text swap) and then did
nothing to stop the card's own plain `<a href>` from navigating away in
that same tick -- whether the browser actually painted the change
before tearing down the document for the new page was pure timing
luck, and a *faster*-loading destination (a warm service-worker cache
for `hub.html`, exactly what this app is built to provide) made that
luck worse, not better, since there was even less time for a repaint
to sneak in.

Fixed by calling `preventDefault()` on the click, then deferring the
actual `window.location.href` navigation by a double
`requestAnimationFrame` -- one frame to apply the class/text changes,
a second to guarantee the browser has actually painted them -- before
navigating on. Same fix shape as this app's own `dg-agent-loading` gate
elsewhere for "a state change that never got the chance to render
before something else took over." Bumped `sw.js`'s `CACHE_NAME` to
`v100` (`index.html` is `SHELL_FILES`-listed).

## The Character Creation Wizard sometimes stayed open, "Step 1 of 8",
## with the real Agent's data already loaded and visible underneath it

A real report, traced from two days of repeating `ClientErrors` rows
all tied to one specific Agent Code across three different pages
(`agent-hub.html`, `a-cell.html`, `hub.html`) -- a strong signal
something about loading that one Agent's data was hitting the same
broken path repeatedly, everywhere it was touched. Play → that Agent
opened the multi-step Character Creation Wizard instead of the real
sheet, but the real sheet's data was loading correctly underneath it
(Live Play's own toggle showed "RETURN TO SHEET," meaning `?load=`
itself had succeeded) -- the wizard was the wrong thing staying on
screen, not a failed load.

Root cause: a race between `?load=`'s two outcomes.
`startRecruitFlow()` (`stats/cloud-sync.js`) opens the wizard when
`?load=` reports `NOT_FOUND` for this Agent Code -- but nothing ever
closed that wizard back down if a *real* character load for the same
code landed moments later (a delayed/duplicate response, or this
device's own local autosave restore finishing after the wizard had
already opened). Once genuinely open, the wizard is its own DOM
overlay, entirely separate from the simple New-Recruit-block-vs-
character-sheet swap `dgCharacterMode.update()` already handles, so it
had no way to know a real load had since succeeded and it should get
out of the way.

Fixed the symptom directly rather than chasing the exact race:
`onApplied` (the `?load=` handler's own callback for "real character
data was just successfully applied," `stats/cloud-sync.js`) now calls
`window.dgWizard.deactivate()` unconditionally -- a successful real
load is unambiguous proof this Agent isn't a new recruit, and
`deactivate()` is already a safe no-op if the wizard was never open.
Doesn't yet explain why `?load=` reported `NOT_FOUND` for an Agent
with real data in the first place (possibly related to the general
backend-latency/"busy" reports tracked in GitHub issue #9) -- this
fix stops the wizard from getting stuck on screen when it happens,
not the underlying false `NOT_FOUND`. Bumped `sw.js`'s `CACHE_NAME`
to `v104` (`stats/cloud-sync.js` changed).

## "Server is busy" with only one real player online, general
## backend lagginess, and a likely contributor to false NOT_FOUND
## character loads

Traced from GitHub issue #9's report: a Handler logged in as a player
(the only person online at the time) and got "Server is busy -- please
try again in a moment" on the first load attempt. That exact text only
ever comes from `withScriptLock()` failing to acquire
`LockService.getScriptLock()` -- a single lock shared across *every*
request this backend handles, not per-user.

Root cause: `saveCharacter()` runs on every autosave (`SYNC_DEBOUNCE_MS`
in `stats/cloud-sync.js` -- roughly every 4 seconds while anyone has a
sheet open and is actively editing) and, while holding that same
shared lock, used to (1) read the *entire* Characters sheet -- every
other character's full Character JSON blob included -- just to find
one row by Agent Code, the same expensive full-sheet-read pattern
`doLookupCharacter()`'s own comment already documented fixing
elsewhere, and (2) make a synchronous network call to Firestore
(`firestoreDualWrite_()`) still inside the lock. Every other locked
write in this file (another player's save, a delete, an evidence mark,
this app's own error telemetry) had to queue behind whichever autosave
happened to be mid-flight, and enough queueing hits the lock's 10s
timeout -- explaining "busy" even with one person online, since a
single browser's own several concurrent requests (radio polling,
widget sign-ins, autosave) can collide with each other without any
second real user involved. Also a plausible contributor to real
characters intermittently coming back `NOT_FOUND` (see the Wizard fix
above) if platform-level request congestion built up behind enough of
these slow locked sections.

Fixed `saveCharacter()` to do a targeted single-column scan for the
row (same shape as `doLookupCharacter()`'s existing optimization) and
touch only the changed cells, and moved the `firestoreDualWrite_()`
call to run after the lock releases -- it's already documented as
additive-only and best-effort, with no correctness reason to extend
the locked critical section. Also removed `withScriptLock()` entirely
from `logClientError()`: a diagnostic-row append doesn't need
exclusive locking for correctness, and doing it anyway meant every
error report -- including the exact repeating-error bursts this
telemetry exists to catch -- competed with real player writes for the
same lock, worst precisely when the backend was already struggling.

Backend version bumped to v85. **Needs a manual redeploy to the live
Apps Script project** before any of this takes effect.

## Issue #8 shipping plan, step 1 (re-shipped): purge permanently-deleted
## Agents from Agent Hub's local roster

Re-applied `agent-hub.html`'s `checkAgentFileExists()`/
`purgeIfFullyDeleted()` (originally shipped in `186982c`, reverted in
`0e4c65b` when a Character Creation Wizard bug appeared right after
its cache-bump). That investigation (see the Wizard fix above) proved
this code wasn't the cause -- any commit bumping `sw.js`'s
`CACHE_NAME` would have surfaced the same pre-existing, unrelated bug
by forcing a fresh fetch of the already-buggy files -- so this is step
1 of issue #8's plan to re-introduce the 4 originally-reverted commits
one at a time, now that the actual root cause (the lock-contention fix
directly above) is live. Bumped `sw.js`'s `CACHE_NAME` to `v105`
(`agent-hub.html` changed).

## Issue #8 shipping plan, step 2: dice_rolls permission-denied --
## Cell membership never reached Firestore

Re-applied from originally-reverted commit `28e4871` (renumbered
`v85`→`v86` in this backend since v85 was already used by the
lock-contention fix above). Root cause: `firestore.rules`'
`isCellMember(cellId)` checks membership by reading `cells/{cellId}`'s
own `member_codes` field *in Firestore*, but `updateCellMembers()` --
the only place Cell membership is ever set -- had only ever written
that assignment to the Sheet. That Firestore document either didn't
exist or reflected nobody for every Cell in the campaign, so the
check silently failed for every real member of every real Cell since
`dice_rolls` first shipped (live symptom: "Roll not saved:
permission-denied" + empty roll history for an Agent who WAS actually
in the Cell).

`updateCellMembers()` now dual-writes the whole Cell row
(name/handler/member_codes/channel) to Firestore on every membership
change, matching every other Sheets write path in this file. Added a
one-shot repair, `backfillCellsToFirestore_()`/
`runBackfillCellsToFirestoreNow()`, to mirror every existing Cell's
current membership immediately instead of waiting for each one to be
re-saved through the now-fixed path.

Backend version bumped to v86. **Needs a manual redeploy to the live
Apps Script project** (on top of the v85 redeploy already done), then
run `runBackfillCellsToFirestoreNow()` once from the Apps Script
editor's Run dropdown.

**Both confirmed live** during an actual play session the same day:
the Cell-membership backfill fixed the permission-denied roll error
immediately, and the user reported the app "actually faster than
before," not just unbroken.

## Issue #8 shipping plan, step 3: Firebase script-tag loaders can hang
## forever with no error

Split out of originally-reverted commit `1b71af0` (that commit bundled
this fix together with step 4's long-polling switch below; shipping
them separately, per the plan, to isolate which one(s) actually
caused the two prior reverts). Root cause of the 2026-09-10 incident
and its 2026-09-11 live reproduction: every page's Firebase
`<script>`-tag loader set `onload` but never `onerror`, so a
dropped/blocked request left `ensureFirebaseApi()` callers hanging
forever with no error at all -- exactly the "stuck mid-screen, no
error, needs a reload" symptom reported live (Dice Roller stuck,
black screen behind it).

Adds `onerror` + a 15s timeout to every Firebase `<script>` loader
(`agent-hub.html`, `a-cell.html`'s two independent loaders,
`notes/notes.js`, `assets/table-radio.js`, `assets/dice-roller.js`)
and wires a real `err` callback through every `ensureFirebaseApi()`
caller so failures reject/reset state instead of hanging silently.
Deliberately does NOT touch `experimentalAutoDetectLongPolling` in
this step -- that's step 4, shipped separately so each change gets
its own live signal. Purely client-side, no backend/Code.gs changes,
no Apps Script redeploy needed. Bumped `sw.js`'s `CACHE_NAME` to
`v106` (five `SHELL_FILES`-listed files changed).

## Dice Roller freezing mid-screen after a scroll, not just lock/unlock

Live report, same session as the above: after tapping an Agent from
Clearance and scrolling while the new page was still settling, the
Dice Roller panel froze floating mid-screen instead of staying docked
at its real fixed position -- the same underlying iOS Safari
`position:fixed`-freeze bug `assets/dice-roller.js` already had a
workaround for (forcing a reflow on `visibilitychange`, added for the
screen lock/unlock case), but triggered here by a plain scroll instead
of backgrounding the tab, which that listener never covered.

Added a debounced `scroll` listener that reruns the same reflow trick
(toggle `display` off and back on) once scrolling actually settles
(150ms after the last scroll event) rather than on every tick, so this
doesn't reintroduce the scroll jank the debounce exists to avoid.
Purely client-side, `assets/dice-roller.js` only. `sw.js` `CACHE_NAME`
bumped to `v107`.

## Issue #8 shipping plan, step 4: force Firestore long-polling instead
## of auto-detecting

Split out of originally-reverted commit `1b71af0` (step 3 above shipped
the other half of that commit). Switches every
`experimentalAutoDetectLongPolling: true` to `experimentalForceLongPolling:
true` across all 6 Firestore init sites (`agent-hub.html`, `a-cell.html`'s
two independent loaders, `notes/notes.js`, `assets/table-radio.js`,
`assets/dice-roller.js`). Auto-detect tries Firestore's default streaming
transport (WebChannel) first and only falls back to long-polling after it
fails; on Brave, some ad-blockers, and some mobile networks/carriers that
silently block or interfere with WebChannel, that probe-then-fallback
dance was itself throwing repeatedly from inside the cross-origin
Firestore script -- the repeating "Script error." flood from the
2026-09-11 incident reports and `ClientErrors` telemetry. Forcing
long-polling from the start skips that failing dance entirely on exactly
the networks that need it, at the cost of slightly higher latency
everywhere else.

This is the one change from the 4 originally-reverted commits with the
least certain payoff -- it can only really be judged by whether reports
of stuck/empty real-time listeners (Notes, Evidence, Table Radio, Dice
history) drop off after this ships, not by anything visible in testing
here. Purely client-side, no backend/Code.gs changes. `sw.js` `CACHE_NAME`
bumped to `v108`.

## Issue #8 shipping plan, step 5 (final): New Recruit box flashing
## before a real cloud character loaded via Play

Last of the 4 originally-reverted commits, re-applied unchanged from
`ec86b65`. The `?load=` reveal-gate's own safety timeout -- 8s, meant
as a last resort for a request that never resolves at all -- was
firing on loads that were merely slow (Apps Script cold starts, a
large Character JSON payload, a slow mobile connection), prematurely
revealing the still-default New Recruit UI before the real
`onApplied`/`onSettled` callback got the chance to swap in the correct
sheet a moment later. Bumped the timeout in `stats/cloud-sync.js` from
8s to 15s, matching the standard already used elsewhere in this
codebase for a load that's slow but likely to still succeed.

With this step, all 4 of the commits reverted after the original
2026-09-11/12 incident are back on `main`, each re-shipped and tested
individually per issue #8's plan, now that the actual root cause (the
`saveCharacter()`/`logClientError()` lock contention fixed earlier the
same day) is confirmed live and working. Purely client-side. `sw.js`
`CACHE_NAME` bumped to `v109`.

## Every page's Clearance load / A-Cell password screen taking over a
## minute to even appear, on a weak connection

Live report, same night: entering A-Cell from Clearance took over a
minute for the password screen itself to show up -- not a backend
call, not auth, just the static HTML rendering. Root cause found by
checking every page's `<head>`: every single page in this app
(`index.html`, `agent-hub.html`, `a-cell.html`, `hub.html`,
`stats/index.html`, `notes/index.html`) loads
`assets/js-error-banner.js` as a plain, render-blocking `<script src>`
tag with neither `async` nor `defer`, placed near the very top of
`<head>`. A render-blocking script forces the browser to fully
download AND execute it before continuing to parse the rest of the
document at all -- on a weak connection, that one small file stalling
holds up the ENTIRE page, including static content like a password
`<input>` that's sitting right there in the HTML with nothing else to
wait on.

Added `async` (not `defer` -- see below) to all 6 copies of this
script tag. `async` lets the browser keep parsing/rendering the rest
of the page while this script downloads in the background, fixing the
actual complaint, while still executing the script as soon as it's
ready rather than deferred until the whole document finishes parsing.
`defer` was considered and rejected: this file's whole job is catching
early JS errors via `window.addEventListener('error'/'unhandledrejection',
...)`, and several pages here have other, earlier, non-deferred inline
`<script>` blocks -- deferring the error banner past all of those would
create a blind spot for exactly the class of early-load error this
telemetry exists to catch. `async` avoids that: for a small same-origin
file, it should still attach its listeners very early, just without
blocking the parser first. Verified safe against the script's own code
-- it only attaches top-level event listeners, and its one immediate DOM
touch already guards for `document.body` not existing yet
(`document.body || document.documentElement`).

Purely client-side, no backend changes. `sw.js` `CACHE_NAME` bumped to
`v110` (6 `SHELL_FILES`-listed files changed).

## Revert: forcing Firestore long-polling made Table Radio (and every
## other real-time feature) badly laggy -- ~44s to start audio, ~10s
## to pause

Live report during an actual game session, hours after issue #8 step
4 shipped `experimentalForceLongPolling` across all 6 Firestore init
sites: choosing a track took ~44 seconds to actually start playing,
and pausing had a ~10-second lag -- a feature the user explicitly
described as previously snappy/immediate. Queueing a track (a
local-only UI update, no round trip) stayed instant, isolating the
regression to real-time sync latency specifically, not page load or
backend writes (both already ruled out/fixed earlier the same night).

Step 4's own justification undersold the cost: auto-detect tries
Firestore's fast streaming transport (WebChannel) first and only
falls back to long-polling if it fails, which is rare; forcing
long-polling for every user trades that rare failure (silently stuck
listeners on Brave/some ad-blockers/some mobile networks) for a
universal, severe latency hit on every real-time update, on every
network, for everyone -- "slightly higher latency" turned out to mean
tens of seconds for the app's most latency-sensitive real-time feature
(Table Radio), not a marginal cost.

Reverted all 6 sites (`agent-hub.html`, `a-cell.html`'s two loaders,
`notes/notes.js`, `assets/table-radio.js`, `assets/dice-roller.js`)
back to `experimentalAutoDetectLongPolling`. The original 2026-09-11
incident this was meant to fix (repeating cross-origin "Script error."
floods, stuck listeners) is still covered by the loader `onerror`/
timeout hardening from issue #8 step 3, which addresses the actual
silent-hang symptom without touching every user's real-time latency.
If a genuine Brave/ad-blocker WebChannel-block report resurfaces, it
should be handled narrowly (e.g. detecting that specific failure and
falling back per-client) rather than forcing degraded transport for
every user up front.

Purely client-side, no backend changes. `sw.js` `CACHE_NAME` bumped to
`v111`.

## Second render-blocking resource on every page: the Google Fonts
## stylesheet

Follow-up to the js-error-banner.js render-block fix above -- that fix
helped (over a minute down to ~30-40s) but didn't fully solve it,
because every page has a SECOND render-blocking resource: the Google
Fonts stylesheet, loaded as a plain `<link rel="stylesheet"
href="https://fonts.googleapis.com/css2?...">`. Unlike the same-origin
error-banner script, this is cross-origin -- the browser needs a whole
new DNS lookup + TLS handshake to a different server before it can even
start fetching the CSS, on top of the fetch itself, all before it's
allowed to render anything. `&display=swap` in the URL is a common
point of confusion: it only controls how *text* renders using fallback
fonts once this CSS has already loaded -- it does nothing to stop the
`<link>` itself from blocking the page in the meantime.

Applied the standard non-blocking pattern to all 6 pages (`index.html`,
`agent-hub.html`, `a-cell.html`, `hub.html`, `stats/index.html`,
`notes/index.html`): `media="print" onload="this.media='all'"` loads
the stylesheet without blocking render, then applies it for real once
it's ready (falls back to system fonts briefly on a slow connection,
which is far preferable to blocking the whole page), with a
`<noscript>` fallback for the no-JS case. Also added the missing
`fonts.gstatic.com` preconnect (only `stats/index.html` had it) --
that's the actual origin the font FILES load from, a third hop after
the CSS itself resolves.

Purely client-side, no backend changes. `sw.js` `CACHE_NAME` bumped to
`v112`.

## A-Cell's Now Playing panel getting permanently stuck on the previous
## track/pause state

Live report during the same session: pressing Play on a Track Library
entry (Combat) actually started the audio (table-radio.js's own
Firestore `onSnapshot` listener picked up the change immediately, same
as always) but A-Cell's own dedicated Now Playing panel kept showing
the previous track (Abyss) indefinitely. Reloading the page (six times,
confirmed) didn't help, ruling out a stale-session/cache explanation.
Pause/Resume and the seek scrubber showed the same class of symptom --
"nothing happens" after clicking, no recovery.

Root cause: `setNowPlaying()`/`sendTransportAction_()`/`sendSeek_()` in
this file each do their write, wait exactly 900ms, then make ONE
`get_now_playing` check to confirm it landed and update the panel's
`current` state -- with no retry if that single check fails. `mode:
'no-cors'` POSTs can't be read to confirm success directly, so this
verify step was the ONLY thing that ever updated the panel after a
Handler action. If that one check happened to land before the Apps
Script Sheets write had actually committed (`getNowPlaying()` reads the
Sheet directly on every cache miss, and this file's own `jsonpGet()`
has no retry of its own) -- entirely possible given real Apps Script
write latency and every open tab on every page also polling
`get_now_playing` every 2 seconds -- the panel was left stranded on
stale state with **no other mechanism to ever self-correct**: the
`setInterval` tick that keeps the scrubber moving only re-reads the
already-stale local `current` object, it never re-fetches from the
backend.

Added a 2-attempt retry with backoff (matching
`agent-hub.html`'s existing `CI_LOOKUP_RETRY_DELAYS_MS` pattern for the
identical class of problem: a one-shot Apps Script check racing real
write latency) to all three verify call sites
(`verifyNowPlaying()`/`verifyTransportAction_()`/`verifySeek_()`)
before actually giving up and showing the "backend didn't confirm"
message. Purely client-side, `a-cell.html` only. `sw.js` `CACHE_NAME`
bumped to `v113`.

## The same no-retry fragility, one level down: every A-Cell list load
## (Track Library, Cells, Characters, Evidence) could fail permanently
## on one dropped request

Live report, same session: "Could not load the Track Library" recurred
intermittently on a weak connection, unrelated to the Now Playing panel
fix above. Root cause was the same class of bug, one layer deeper:
`a-cell.html` has 4 independent copies of a `jsonpGet()` helper (one
per tab section -- Cells, Evidence, Sheet/Admin, Music), and every one
of them gave a JSONP request exactly one 7-second window to succeed,
with no retry at all. A single dropped or slow request under a weak
signal -- exactly the conditions reported all session -- permanently
failed whatever list was loading (Track Library, Cells, Characters,
Agent File Only, Deleted Characters, Evidence), with the Handler's only
recourse being to switch tabs and back or reload.

Added the same 2-attempt retry with backoff (1s, 1s) to all 4
`jsonpGet()` copies, so a single dropped request no longer means a
permanent failure. Purely client-side, `a-cell.html` only. `sw.js`
`CACHE_NAME` bumped to `v114`.

## Follow-up: the retry above wasn't enough on a connection that can't
## finish ANY single request within 7 seconds

Confirmed live, same session, after two full reloads with the retry
fix above already live: "Could not load the Track Library" still
happening every time. Retrying a request 3 times at the same 7-second
timeout doesn't help if the underlying connection genuinely can't
complete a request within 7 seconds at all right now -- every attempt
was doomed the same way, so more attempts at the same timeout just
means failing slower, not succeeding. Bumped all 4 `jsonpGet()` copies'
per-attempt timeout from 7s to 15s (retry count unchanged), giving a
genuinely slow-but-eventually-successful request room to actually land
instead of being cut off at exactly the point it might have finished.
Purely client-side, `a-cell.html` only. `sw.js` `CACHE_NAME` bumped to
`v115`.

## One-shot sound effects (and ambient loop toggles) kept the same ~8s
## latency even after the Firestore-before-Sheets reorder above -- because
## they were never actually writing to Firestore from the fast path at all

Live report, same session, after Track Library was loading fine again:
"Second play still lags 8s on short tracks... one shot sound effects
has the same latency... that worked perfectly before." Per this repo's
own protocol, checked `BUGFIXES.md` first for the earlier
Firestore-before-Sheets reorder entry above, then verified against the
current `backend/Code.gs`: `setAmbientLayer_`, `triggerStinger_`,
`updateSoundInstance_`, and `removeSoundInstance_` all still correctly
fire their `firestoreDualPatch_()` before `sheet.getRange(...).setValues()`
-- no regression, that fix is intact. Checked git tag `v1.0.0` too, at
the user's request -- byte-for-byte identical ordering there as well,
confirmed via `git show v1.0.0:backend/Code.gs`. So the "it worked
perfectly before" latency was never eliminated by that reorder, because
the reorder only changed which write happens first WITHIN one Apps
Script request -- it never removed Apps Script itself from the critical
path. Every ambient/stinger action still went browser -> Apps Script
(`doPost`) -> Firestore write -> Sheet write, so the one Web App
dispatch/cold-start cost (spinning up the whole ~5000-line script) that
gates the ENTIRE request sat in front of the Firestore write regardless
of which write happened first inside it. Confirmed via git history that
this was true from the very first commit that created these two
functions (`53913bf`, "Add Table Radio soundboard..."), not a later
regression -- `firestoreDualPatch_` was already being called there, just
from server-side code, same as today.

The actual fix: cut Apps Script out of the loop entirely for these two
specific actions. `firestore.rules`' `match /radio/{channel} { allow
write: if isHandler(); }` already permitted a Handler to write directly,
and A-Cell already holds a real Firebase Auth session with that custom
claim via `ensureHandlerSignedIn()`/`handlerLogin()` (used for Evidence
and Track uploads) -- the groundwork was already in place, just never
used for these two buttons. `renderAmbientGrid()`'s toggle handler and
`renderStingerGroups()`'s fire handler in `a-cell.html` now open a
Firestore `runTransaction()` straight against `radio/{channel}`,
replicating the exact same read-merge-write logic `setAmbientLayer_`/
`triggerStinger_` do server-side (including `STINGER_HISTORY_LENGTH`'s
trim, mirrored client-side as a constant kept in sync by hand), so
`table-radio.js`'s existing `onSnapshot` listener hears the change the
instant the transaction commits -- no Apps Script round trip in the
critical path at all.

Deliberately did NOT also keep calling the old Apps Script action
afterward as a "background Sheet sync": tried reasoning through it and
rejected it -- that action independently recomputes the array from the
Sheet's (now stale, since the client no longer updates it) state and
overwrites Firestore with its own version a few seconds later, which
for a stinger means firing the exact same sound a second time (stingers
have no id-based idempotency by design -- see `triggerStinger_`'s own
comment on always appending a fresh instance). That would have
reintroduced the "sound plays twice" bug fixed earlier this same
session, just via a new path. So the Sheet's `ambient_layers`/`stingers`
columns are now stale/unused going forward -- an accepted tradeoff,
since nothing else reads them (the Sheet was never a meaningful
historical log for one-shot SFX). Main-track play/pause/resume/seek and
the Active Sounds panel's per-instance pause/resume/seek/loop/stop
controls are unchanged and still Apps-Script/Sheet mediated -- out of
scope for this fix, since they weren't what was reported laggy tonight.
Purely client-side, `a-cell.html` only, no backend/Code.gs change and
no redeploy needed. `sw.js` `CACHE_NAME` bumped to `v116`.

## Post-mortem from an actual live game session: A-Cell took several
## tries to log in, and the Play tab's Agent list failed to load

The Handler ran a full session on the fixes above and reported back a
list of what was still broken, worst first: Track Library intermittently
failing (already tracked), Live Rolls still permission-denied (already
tracked, needs a deployment check outside this repo), Cells and the Play
tab's Agent list failing to load, some ×5 skill rolls not working, and
cross-device caching inconsistency on iOS/Mac. Two of these had concrete,
fixable root causes in `a-cell.html`.

**"Remove second handler authentication, unnecessary"** (the Handler's
own words) pointed at something real: `a-cell.html` has always had TWO
independent copies of `ensureFirebaseApi()`/`ensureHandlerSignedIn()` --
one for the Evidence tab, one for the Track Library tab -- each in its
own `<script>` block/IIFE (see this file's own history: an earlier
attempt to delete the second copy outright broke Track Library, since
each block's functions aren't visible from the other, restoring it).
Two copies means opening A-Cell could fire the `handlerLogin()` Cloud
Function TWICE in parallel the moment both the Evidence listener and the
Track Library tab initialized -- two competing network calls (each with
its own 20s timeout) instead of one, which under a weak signal at the
table is a plausible explanation for "took me 4 tries to come in to
A-Cell." Fixed properly this time instead of just deleting the
duplicate: the Evidence block's `ensureHandlerSignedIn` is now exposed
as `window.__dgHandlerAuth`, and the Track Library block's own copy is a
thin function that delegates to it -- still a real, locally-scoped
function (so the historical failure mode doesn't recur), just no longer
duplicating the actual sign-in work. Removed the now-dead second copies
of `ensureFirebaseApi()`/`loadScriptTag()`/`withTimeout_()`/
`FIREBASE_CONFIG` alongside it.

**"Could not load the Agent list"** in the Play tab, and no Cells in
its filter dropdown, live during the session: `fetchList()`/
`fetchCells()` (the Play tab's own hand-rolled JSONP calls, not the
shared `jsonpGet()` helper) turned out to be two MORE copies of the
exact no-retry, 7-second-timeout pattern already fixed everywhere else
tonight (Cells tab, Evidence, Sheet/Admin, Music) -- missed earlier
because they were deliberately out of scope when that fix shipped (the
live complaint at the time was Track Library specifically). Added the
same 2-attempt retry with backoff (1s, 1s) and bumped the timeout from
7s to 15s, matching every other copy. `fetchList()`'s existing
`listFetchGen` staleness guard (so a slow, superseded call can't stomp a
newer one's result) is threaded through the retries via a `myGen`
parameter rather than re-incremented on each attempt, so all retries of
one logical fetch still share the same generation.

Both fixes purely client-side, `a-cell.html` only. Full Playwright suite
run afterward: 756/765, all 9 failures the known gstatic.com-blocked-by-
sandbox-proxy ones, unrelated (148/148 a-cell tests passed). `sw.js`
`CACHE_NAME` bumped to `v117`.

## Handler feedback after the retry fixes above: "A-Cell dies" with
## several players online -- retries alone weren't good enough

Direct instruction from the Handler, after a full game session running
the fixes above: "Play didn't work once from my three play sessions.
This is not good enough when 4 players are online, A-Cell dies. Info
doesn't load after Firebase migration also an issue: no tracks
available, no cells. The only consistent and fast loading thing is
Evidence." That last sentence is the actual diagnosis: Evidence (and
Notes) were rewritten to read live from Firestore back in Phase 5 of
this migration; the Play tab's Agent list and the Cells filter never
were, and were still doing exactly what they'd always done -- polling
Apps Script via JSONP, retries or not. More retries on a fundamentally
un-scalable path (one Apps Script Web App dispatch per Handler, per
poll, competing with every player's own requests) was never going to
fix "dies under load" the way moving to a push-based Firestore listener
already had for Evidence.

Checked what's actually available before writing anything: `characters/
{agentCode}`, `briefs/{agentCode}`, and `cells/{cellId}` are ALL already
public-read in `firestore.rules` and already kept live-updated by every
relevant Code.gs write (`saveCharacter()`, the Briefs submit handler,
`updateCellMembers()`) via `firestoreDualWrite_`/`firestoreDualDelete_`
-- this data was already there, just never read from that side for this
one tab. Rewrote the Play tab's `fetchList()`/`fetchCells()` in
`a-cell.html` into `startCharacterListeners()`/`startCellsListener()`:
live `onSnapshot` reads on `characters` + `briefs` (merged client-side
the same way `listCharacters()` already merges them server-side --
`character_json` parsed for `bio`/`derived`, `briefs`' `face_plate_url`
overlaid) and on `cells`, feeding the exact same `allCharacters`/`cells`
shape `applyFilter()`/`renderList()`/`renderDashboard()` already
expected, so none of that rendering code changed at all. No password or
session needed for any of it (these reads were already public), so this
tab is now also immune to the `dg_acell_session` staleness race a
separate test (`test_acell_handler_session_race`) was written for --
it never has a session to race in the first place. Refresh is no longer
a real network call; onSnapshot already means every open tab sees a
new/edited character or Cell mid-session, not on the next manual click
or the next poll interval.

One real, deliberately-accepted gap: `updateCellMembers()` was the ONLY
place that ever dual-wrote `cells/{cellId}` -- `createCell()` itself
never did, so a brand-new Cell with no members assigned yet was invisible
to this new listener until its first membership change (the old JSONP
path, reading the Sheet directly, always saw it immediately). Closed by
adding the same `firestoreDualWrite_('cells', ...)` call to
`createCell()` too (`backend/Code.gs`, bumped to v87) -- this one
**does** need the usual manual paste-and-redeploy into the Apps Script
editor before it takes effect; the `a-cell.html` changes need no
redeploy at all.

Track Library was NOT migrated the same way despite being named in the
same report ("no tracks available") -- checked first, and unlike
Characters/Cells, nothing ever dual-writes a `tracks/{trackId}`
Firestore doc at all (the `firestore.rules` entry for it has sat unused
since it was scaffolded). Migrating that read properly needs a real
backend addition (dual-write in `uploadTrack()`/`deleteTrack()` plus a
one-time backfill for tracks uploaded before it, same shape as the
existing `backfillCellsToFirestore_()` repair) -- left for a follow-up
pass rather than rushed in alongside this fix.

Testing this uncovered a real gap in the test suite itself, not just
the app: `test_acell_play` and `test_acell_handler_session_race` were
still mocking the now-unused `list_characters`/`list_cells` JSONP
endpoints for the Play tab specifically, so the first full run after
this change showed ~20 tests silently missing (a crash from the
un-mocked live `window.firebase.firestore()` calls hitting the real
Firebase SDK loader with no network, aborting the rest of that test
file) rather than a clean pass/fail count -- the kind of "count just
looks a little off" signal that's easy to wave away as the
already-known flaky mobile-notes test instead of a real regression.
Confirmed which it was by re-running against the prior commit (clean)
and against this change (consistently short by the same ~20) before
concluding it was real. Fixed by pointing both tests at the SAME
general-purpose Firestore stub Notes/Evidence already use
(`install_notes_firestore_stub`/`push_firestore_snapshot`, no new stub
code needed -- it already supports a plain `.collection(x).onSnapshot()`
with no `.where()`), rewriting their fixtures to push `characters`/
`briefs`/`cells` documents instead of faking the JSONP responses, and
updating the "Refresh pulls updated stats" case to instead push an
updated live snapshot and confirm the open Agent's view updates on its
own -- the more accurate thing to test now that Refresh itself no
longer re-fetches. Full suite after: 755/765, all 10 failures the known
gstatic.com-sandbox-block ones plus one pre-existing sub-pixel color-
rounding flake, 148/148 a-cell tests passing. `sw.js` `CACHE_NAME`
bumped to `v118`.

## Track Library ("no tracks available"), migrated to Firestore the
## same way, per explicit direction: "yes, migrate, this should have
## been done"

Direct follow-up to the Play tab migration above. Unlike Characters/
Cells, `tracks/{trackId}` had a `firestore.rules` entry (public read,
Handler-only write) that had sat completely unused since it was
scaffolded -- nothing in `Code.gs` ever wrote to it, `uploadTrack()`/
`deleteTrack()` only ever touched the Sheet. Track Library was already
the furthest along toward Firestore of anything in this app (Phase 4:
the mp3 file itself already goes straight from the browser to Firebase
Storage, bypassing Apps Script entirely for the upload itself) -- the
only thing still routing through Apps Script was the tiny
`{title, storage_url}` metadata record.

Went further than a dual-write mirror here, per the standing direction
("I don't want [the Sheet] if it only creates issues"): new uploads and
deletes now write/delete `tracks/{trackId}` in Firestore **directly**
from the browser (`ensureHandlerSignedIn()` then
`firestore().collection('tracks').doc(trackId).set(...)`/`.delete()`),
with **no Apps Script POST at all** in either path anymore --
`uploadTrack()`/`deleteTrack()` in `Code.gs` are untouched but no
longer called by the new client code. The list itself (`fetchTracks()`
→ `startTracksListener()`) is a plain `onSnapshot` on `tracks`, public-
read, no Handler session needed to view it. A one-shot
`backfillTracksToFirestore_()`/`runBackfillTracksToFirestoreNow()`
(Code.gs v88, same shape as the Cells backfill) mirrors every track
uploaded before this shipped, including rebuilding a legacy Drive-
hosted track's URL from `drive_file_id` the same way `listTracks()`
itself already does, so nothing existing goes missing. **Needs the
usual manual paste-and-redeploy, then run
`runBackfillTracksToFirestoreNow()` once from the Apps Script editor.**

One real, accepted gap: deleting a legacy Drive-hosted track (uploaded
before Phase 4) no longer trashes its Drive file, since that requires
`DriveApp` and only `Code.gs`'s own (now-bypassed) `deleteTrack()` can
do that -- the Firestore doc is still correctly removed either way, so
it disappears from the Library and stops being offered to players, it
just leaves an orphaned file sitting in Drive. Same tradeoff already
accepted for the ambient/stinger soundboard cutover earlier tonight.

Testing this required extending the shared Firestore test stub
(`install_notes_firestore_stub`, used by Notes/Evidence/Radio/Play):
its collection-ref mock only ever supported `.onSnapshot()` on a
collection/query, never a doc-level `.set()`/`.update()`/`.delete()`
write, because nothing tested here had ever written straight to
Firestore from a test page before. Added those three, recorded into a
new `window.__dgFirestoreWrites` array (mirrors the existing `posts`
list already used to inspect Apps Script POSTs) plus a
`firestore_writes()` Python helper -- general-purpose, not
tracks-specific, so the next surface that writes Firestore directly
doesn't need to repeat this. Rewrote `test_acell_music`'s Track Library
section to assert on those writes plus an explicit
`push_firestore_snapshot()` (simulating the listener picking the write
up) instead of the old Apps Script POST/`list_tracks` mocking, and
dropped the "slow-landing upload retries" regression test entirely --
it tested `DriveApp`-specific latency and a retry loop that no longer
exist in this path. Full suite: 756/767, only the same two pre-existing,
unrelated failure categories. `sw.js` `CACHE_NAME` bumped to `v119`.

## Aside, in response to "if [Live Rolls permission-denied] was never
## deployed, why did it work before?" -- it did, and the rule hasn't
## changed since

Checked per the standing protocol before answering. Commit `2d341ed`
("Firestore rules: fix Handler's Live Rolls collection-group query",
2026-08-27) added the exact `match /{path=**}/rolls/{rollId} { allow
read: if isHandler(); }` rule current `firestore.rules` still has today
-- confirmed byte-identical via `git show 2d341ed:firestore.rules` vs.
the live file, zero diff. That commit's own message states it was
"Verified via a direct REST round-trip against the **deployed** rules"
at the time -- so this genuinely did work once, refuting the "maybe it
was never deployed" theory from earlier tonight. Since the rule text in
git hasn't moved since, and Evidence (which depends on the exact same
`ensureHandlerSignedIn()`/`isHandler()` custom-claim machinery) works
fine, a code-level regression is now the least likely explanation.
Left unresolved, but the most likely remaining one: `firestore.rules`
deploys are just as manual as Apps Script's (`firebase deploy --only
firestore:rules`, never triggered by `git push`) -- a later deploy for
some unrelated change (Evidence's `visible_to` fix, the per-Cell
`dice_rolls` membership fix, etc.) could plausibly have been pushed
from a checkout that predated this rule, silently reverting it on the
live project with nothing in git to show for it. Not fixable from this
repo -- needs a fresh `firebase deploy --only firestore:rules` from the
current file to rule this out for certain.

## Initiative Tracker (DEX), first slice of the Field Notes Widget
## architecture -- Agent Hub post-it + A-Cell Cell-wide Dashboard

First concrete piece of the larger Notebook Widget rework the user
scoped out (Clearance -> Agent Hub terminal login -> Agent Roster,
persistent yellow-post-it initiative tracker on both the Roster and
A-Cell's own Play tab). Shipped standalone since it's self-contained
and testable on its own, ahead of the widget shell itself.

Both surfaces read `csStats.DEX` out of the exact same `character_json`
blob already being parsed for other fields -- no new Firestore read,
no new backend action:

- **a-cell.html (Cell Dashboard)**: `rebuildAllCharacters()` now also
  pulls `state.dex` out of the same parsed `character_json` it already
  reads `bio`/`derived` from. `renderDashboard()` gets a new
  `initiativeTrackerHtml()` block -- a yellow sticky note (same look as
  the Handler Password note above it) listing every Cell member ranked
  by DEX descending, which is Delta Green's own initiative order.
  Renders above the existing HP/WP/SAN/BP rows; empty when nobody in
  the filtered Cell has a numeric DEX yet (e.g. no character sheet).

- **agent-hub.html (Agent Roster)**: a new `startDexListenerFor(code)`,
  structurally mirroring the existing `startEvidenceListenerFor(code)`
  right below it, but simpler -- `characters/{code}` is public-read
  (see `firestore.rules`), so this needs no per-Agent
  `exchangeAgentToken` sign-in, just a plain
  `.collection('characters').doc(code).onSnapshot(...)`. Renders into a
  small `.dex-postit` (same yellow sticky-note CSS language as Cover
  Identity) in each Agent's dossier header; `:empty` hides it entirely
  for an Agent with no character sheet on file yet, so it never shows a
  bare label with nothing after it.

**Bug caught during testing, not shipped**: the first version called
`startDexListenerFor(a.code)` directly inside `renderRoster()`'s own
`agents.forEach` loop. `renderRoster()` is invoked once at the top of
the page's `<script>` block on every load -- and on a returning visit
where `dg_agent_roster` already has Agents in it (i.e. almost every
real visit), that first call happens synchronously, before the script's
own execution pointer has reached the `const dexListenerStartedByCode`
declaration further down the same file. That's a same-scope temporal-
dead-zone `ReferenceError`, thrown synchronously inside the `forEach`
callback -- which aborts the whole loop immediately, silently dropping
every Agent tab after whichever one was being built when it threw.
Reproduced locally: a two-Agent roster rendered only the first Agent's
tab, no console-visible symptom beyond a `pageerror` most manual
testing wouldn't be watching for. The existing `startEvidenceListenerFor`
right next to it never hits this same trap because `loadHandouts()`
only ever calls it from inside an async JSONP callback, which always
fires after the whole script has finished its first synchronous pass
top to bottom (real callback timing did the ordering work for it,
by accident). Fixed by deferring the new call the same way
(`setTimeout(() => startDexListenerFor(a.code), 0)`) rather than
reordering the file -- gets the same "runs after the script's own
top-level execution finishes" effect the Evidence path already relied
on, without moving a large, working block of code around to chase a
declaration-order dependency.

Testing this required extending the shared Firestore test stub
(`install_notes_firestore_stub` in `test/run_tests.py`) again: its
`doc()` mock only ever supported `.set()`/`.update()`/`.delete()`
(added for the Track Library direct-write cutover) -- nothing tested
here had ever listened to a single DOC before, only collection queries.
Added `.onSnapshot()` on the doc mock (tracked via an `isDoc` flag in
the same `window.__dgFirestoreListeners` array) plus a
`push_firestore_doc_snapshot()` Python helper, mirroring
`push_firestore_snapshot()`'s collection-query version. New
`test_agent_hub_dex_postit` covers both the live-DEX and no-character-
sheet-yet cases; `test_acell_play` gained a DEX-sorted multi-member
Cell Dashboard assertion (deliberately excluding the Agent already
selected from an earlier step in that same test, so the Cell-filter
switch actually clears the stale single-Agent view and shows the
Dashboard rather than leaving her dossier on screen -- see
`renderList()`'s own "still there" comment in `a-cell.html`). `sw.js`
`CACHE_NAME` bumped to `v120`.

Not yet built: the rest of the Field Notes Widget architecture this
was scoped out of (the persistent cross-page notebook widget itself,
replacing Table Radio + Dice Roller everywhere but A-Cell; the
terminal-gated "five tenets" onboarding flow; Requisition/Radio/Notes/
Settings folded into the widget's own tabs). Tracked separately --
this entry covers only the initiative tracker slice.

## Priority reset, per explicit direction: bugs/performance/Sheet
## removal first, notebook widget v2 only once that's done and tested

User's own framing: "I never want to see again errors like cell
couldn't load, track couldn't load, agents couldn't load." Read as a
standing bar, not a one-time complaint -- fixed the first concrete
instance found (below) rather than only reassuring that it's already
handled.

**A-Cell's Cells tab (Handler-side Cell/membership admin, separate
from the already-migrated Play tab) was STILL reading `list_cells`/
`list_characters` over JSONP**, with only a 3-attempt retry (added
2026-09-14) standing between it and exactly this "Could not load
Cells" message on a weak connection -- the retry narrowed the window,
it didn't close it. Migrated its reads the same way Play's already
went (`db.collection('characters').onSnapshot(...)` /
`db.collection('cells').onSnapshot(...)`, both public-read per
`firestore.rules`): no more JSONP round trip for this tab's reads at
all, and no Handler session needed before it can show anything either
(previously it wouldn't load until `list_characters`'s own session
check passed). Writes (`create_cell`/`update_cell_members`/
`delete_cell`) stay Apps Script POSTs -- Handler actions need the
server-side password check -- but confirming one landed no longer
needs a second JSONP read-back: the live listener already keeps
`cells` current, so `waitForCellsCondition_()` just polls that
already-live in-memory array instead.

**Real gap this migration surfaced and fixed**: `deleteCell()` in
`Code.gs` never dual-wrote its delete to Firestore at all --
`createCell()` and `updateCellMembers()` both mirror to
`cells/{cellId}`, but nothing ever mirrored a *delete*. Harmless while
the Cells tab still read from the Sheet, but under the new live
listener it would have meant a deleted Cell never actually
disappearing from the Handler's own screen. Added
`firestoreDualDelete_('cells', cellId)` right after the Sheet row
delete (Code.gs bumped to v89 -- needs the usual manual
paste-and-redeploy).

**Bug caught mid-implementation, not shipped**: the test rewrite for
this (`test_acell_cells`) needed the shared Firestore stub
(`install_notes_firestore_stub`) extended for a second time today --
`push_firestore_snapshot()` only ever delivered a snapshot to the
FIRST listener matching a given collection path/`where()` chain, which
was fine while at most one tab ever listened to a given query at once.
Now that both Play and Cells independently listen to plain
`characters`/`cells` with no `where()` at all, only one of the two ever
saw a pushed snapshot in a test, silently starving whichever tab's
listener wasn't first in the list -- exactly the kind of thing that
would never show up outside a test (real Firestore already fans one
write out to every matching listener). Fixed by having
`push_firestore_snapshot()` deliver to every matching listener, not
just `.find()`'s first hit.

Also spent a while chasing what looked like real flakiness in the
rewritten test (different assertions failing on different runs, same
code) before finding the actual, boring cause: this test's own
Apps-Script route mock had dropped JSONP-callback wrapping for GET
requests entirely (a bare JSON body loaded via `<script src>` throws
"Unexpected token ':'" -- see `route_apps_script_ok`'s own comment) --
other tab modules on the same page (Evidence, Sheet, Music) still fire
JSONP GETs unconditionally on load regardless of which tab is visible,
so this threw a real, repeated pageerror on every run, which was
apparently enough event-loop noise to make the test's own POST/listener
timing genuinely unreliable. Fixed by restoring the JSONP-aware
fallback; 4 clean back-to-back runs after, versus roughly 1-in-3
failing before.

Full suite: 760/770, the same 10 pre-existing gstatic.com-sandbox-block
failures as before this change, nothing new.

Two more `fetchAll()`-style JSONP read sites remain elsewhere in
`a-cell.html` (noticed while doing this one, not yet migrated) -- next
in line for the same treatment if the "get rid of the Sheet where
possible" direction continues.

## Character sheet: Photo + Initiative (DEX) + Agent File, in the Live
## Play tracker bar (first slice of the character-sheet side of the
## Field Notes Widget architecture)

Design settled via two direct questions rather than guessing: (1)
extend the existing sticky Live Play tracker bar (photo + DEX item
prepended, Agent File button appended) rather than a new always-on
element, so the plain stat-building screen stays uncluttered and only
the "at the table" view gains this; (2) Agent File opens as a plain
link to `dg-agent-portal.html`, same navigation Agent Hub's own button
already uses, not an inline modal.

- **DEX/Initiative**: reads the same `#DEX-value` stat span
  `lpSyncBar()` already reads for HP/WP/SAN's max values -- one more
  `setText()` call in an existing, already-frequently-invoked sync
  function, no new state or event needed.
- **Photo**: new `stats/lp-tracker-photo.js` -- a live
  `briefs/{code}.face_plate_url` Firestore doc read, public-read same
  as `characters`/`cells` (see `firestore.rules`), so no per-Agent
  sign-in needed, unlike Evidence. Keyed off `window.dgCloudSave.
  getCloudCode()`; re-checked (not just read once) from inside
  `lpSyncBar()` too, since that's the only hook already firing
  whenever a fresh Cloud Save code gets minted for a just-named
  character. Legacy Drive-hosted face plates (`gdrive:FILE_ID`)
  resolve through the same `imgdata` JSONP proxy `a-cell.html`'s own
  `resolveFacePlateInto()` uses, for the same Drive-access-rules
  reason.
- **Agent File button**: reuses the existing global `dgGoToAgentFile()`
  (agent-portal-export.js) already wired to the settings cog's own
  "Open Agent File" -- not a new navigation path, just a second, more
  visible way to reach the same one.

This is the first page on the character-sheet side of the app to load
the Firebase SDK at all (Cloud Save itself is still plain Apps Script
JSONP) -- deliberately the same lazy on-demand loader pattern every
other widget here already uses (a plain `window.firebase.firestore`
check first, real network fetch only if nothing else on the page has
already loaded it), so this doesn't cost a real user anything until
they've actually got a Cloud Save code to look up a photo for.

Mobile: the tracker bar was already packed tight enough to drop its
dice-quick-roll button entirely on a 390px screen (see that rule's own
comment). Photo and the Agent File button drop too there for the same
reason -- conveniences, not something needed mid-roll -- while DEX
stays (same shrink-to-content shape as BP, no width pressure); both
already reachable via Settings -> Open Agent File on mobile regardless.

New `test_lp_tracker_photo_dex_agent_file`: placeholder-before-naming,
DEX match, button presence, and the live photo update once a Face
Plate lands in Firestore. `sw.js` `CACHE_NAME` bumped to `v121`
(`stats/lp-tracker-photo.js` added to `SHELL_FILES`).

Not yet built, still gated on finishing the bugs/performance/Sheet-
removal pass first per explicit direction: the rest of the Notebook
Widget itself (see the entry above).

## Follow-up: `test_acell_cells`'s bulk-add assertion really was flaky,
## not just sandbox noise — found the actual bug in `wait_post_and_sync`

Raised directly: "I start to suspect that issues surface that we fixed
before because you are not doing proper due diligence." Fair, and this
is exactly the kind of thing that check is for — a full-suite run
after the Cells migration above showed `test_acell_cells`'s bulk-add
assertion failing once in ~776 checks, on a step that passed cleanly
every time in isolation. Traced instead of shrugged off as noise.

Root cause: `wait_post_and_sync()` (the test helper simulating a
Handler write's server-side dual-write landing) called
`wait_for_condition()` once (default 25s), then called `sync_cells()`
**unconditionally** afterward — including on a timeout. If the POST
genuinely took longer than 25s to arrive under a loaded full-suite run
(plausible after several hundred prior Chromium page contexts, even
though each closes cleanly), the helper would silently push whatever
`cells_state` already held, still missing the write it was meant to be
waiting for, with nothing marking that the wait had actually failed.
Every later DOM-level `wait_for_condition()` in the test then had
nothing left to ever succeed on, so the failure surfaced as a
generic-looking assertion failure tens of seconds later, nowhere near
its real cause.

Fixed by merging the wait and the sync into one retry loop (40s total)
that only calls `sync_cells()` once the expected POST is actually
observed — a timeout now correctly leaves `cells_state` untouched and
lets the caller's own DOM check fail for the real reason, rather than
masking it with a stale push. 3 clean re-runs of `test_acell_cells`
alone after the fix, plus a fresh full-suite run to confirm no
recurrence at scale.

## Correction to the entry directly above: that fix was real, but "no
## recurrence" was premature -- it recurred, and here's the actual
## evidence for why

Said "confirmed no recurrence" too soon. A later full-suite run hit
the exact same test again (a different assertion within it this time),
and dismissing that as "probably sandbox flakiness" without checking
would have been exactly the kind of non-due-diligence being called out
directly in this session. Instrumented it instead: temporarily printed
`cells_state` (the test's own source of truth) alongside the actual
rendered DOM the moment the assertion's condition was false, then
looped the isolated test until it reproduced (took ~10 back-to-back
runs in a tight loop).

Caught with the actual evidence in hand: `cells_state` was already
correct (`Cell Bravo` had `OWEN-CS12` in its `member_codes`) at the
moment of failure, but Bravo's rendered `.cell-members` still said "No
members yet." -- so `sync_cells()`'s `push_firestore_snapshot()` call
carrying the right data either hadn't been processed by the page yet,
or was processed and then visually stale. Everything in the actual
`onSnapshot` handler chain (`a-cell.html`'s Cells module) is synchronous
JS with no `setTimeout`/scheduling of its own, so this isn't a logic
bug in the migrated code -- it's the test's own generous (40s) wait
still not being enough under a specific kind of load: reproducing it at
all required running the isolated test in a tight repeated loop with a
fresh full Chromium launch/teardown every iteration, materially more
aggressive CPU/process contention than one normal CI run (or one
Handler actually using the app) ever produces. Consistent with the
existing accepted class of environment-only flakes already documented
elsewhere in this file (the gstatic.com-sandbox-block failures, the
sub-pixel color-rounding one) -- logged here explicitly, with the
diagnostic evidence, rather than silently upgraded from "found a real
bug" to "confirmed fixed" a second time without checking.

No further code change from this -- the earlier `wait_post_and_sync()`
fix stands (it fixed a real, separate masking bug), this is a note
that "flaky under load" was the correct read for the *recurrence*,
backed by an actual diagnostic dump rather than assumed.

---

## JSONP-unaware test mocks resurfacing the already-diagnosed `Unexpected token ':'` pattern

Found while running the full suite as part of preparing the 2026-09-10
cutover (see "Deploy discipline" in `CLAUDE.md`): 7 assertions failed
with the exact `pageerror: Unexpected token ':'` signature this file
already diagnosed once (see "Second follow-up" above, and
`route_apps_script_ok()`'s own docstring) -- a `<script
src=...&callback=X>` JSONP call getting a bare, unwrapped JSON body
back throws exactly this the instant the parser hits the first key's
colon. Per `CLAUDE.md`'s bug-fixing protocol, this was recognized as
the same already-documented pattern needing to be *finished*, not a
new bug: two test-local mock functions (`test_foundry_import_
profession_and_outfit`/`test_kappablack_toml_import`/`test_kappablack_
toml_import_triggers_cloud_save`/`test_agent_file_export`/
`test_random_bio_cloud_code_race`'s shared `capture()` idiom, and
separately `test_cloud_save`'s and `test_stats_load_by_code_query_
param`'s own otherwise-JSONP-aware mocks) still had a plain `else:
route.fulfill(..., body='{"status":"OK"}')` fallback for any GET that
didn't match their one specifically-handled case -- exactly the shape
`route_apps_script_ok()`'s docstring already names as the bug class,
just not yet swept from every remaining hand-rolled mock in the file.
Made all seven JSONP-aware (checks `callback=` in the URL, wraps the
response as `cb({...})` with `content_type: application/javascript`
when present), preserving each test's own POST-capture side effects.
Full suite: 773/773 passing, zero failures -- confirmed clean before
proceeding with the 141-commit cutover to `main` this same session.

---

## `sw.js`: offline shell caching silently disabled on the real site's actual URL

Found while chasing an unrelated single `Script error.` report on a
Firebase Hosting preview channel: that channel's own URL has no path
prefix at all (`https://<project>--<channel>.web.app/...`), so it
couldn't have exercised this bug either way, but reasoning about *why*
it couldn't led straight to a real, separate bug in the same file.
`isShellRequest()` stripped a hardcoded `/^\/dg-campaign\//` prefix off
every request's pathname before checking it against `SHELL_FILES` --
but a GitHub Pages project site is served from `/<repo-name>/`, and
this repo's actual name on GitHub is `dg`, not `dg-campaign` (README.md
says as much directly: `https://turulsen.github.io/dg/`). The regex
never matched anything on the real, live URL, so every asset request's
pathname kept its leading `/dg/` segment, which then also failed the
exact-match SHELL_FILES check, and the bare-basename fallback only ever
matches SHELL_FILES entries that are themselves basenames (`index.html`,
`hub.html`, ...) -- not `assets/`- or `stats/`-prefixed entries like
`assets/dice-roller.js`. Net effect: every request for a nested shell
asset silently fell through `isShellRequest()` to `return false`,
which the fetch handler treats as "let the browser handle it
natively" -- not a visible error, no console output, just the entire
stale-while-revalidate offline strategy this file exists to provide
quietly never applying on the one place it actually needed to. Local
dev (bare origin, no subpath) and every Firebase preview channel
happened to make this invisible, since neither serves from a repo-name
subpath either -- which is exactly why this had never shown up in this
sandbox's own test suite (`test_pwa_offline` runs against
`DG_TEST_BASE`, always a bare origin) despite being wrong on production
this whole time.

Fixed by deriving the prefix from `self.registration.scope` instead of
a hardcoded literal -- the one thing that's actually guaranteed correct
everywhere this exact `sw.js` gets registered (bare-origin local dev,
a Firebase preview channel, and whatever subpath GitHub Pages happens
to serve from today or after any future repo rename), rather than
re-guessing a string that already went stale once. Bumped `CACHE_NAME`
to `v93` in the same commit, per this file's own standing rule
(re-landed here as `v122`, since `main` had moved on independently
between when this fix was authored and when it was rebased in).
**Caveat:** no test environment available here serves from a repo-name
subpath, so this fix is reasoned from reading `isShellRequest()`
against README.md's documented Pages URL, not confirmed by reproducing
the disabled-caching symptom directly against the real site. One
independent data point in the fix's favor, found by accident while
pushing this exact commit: `git push` to this session's `dg-campaign`
remote came back with "This repository moved. Please use the new
location: https://github.com/turulsen/dg.git" -- GitHub itself
confirming the canonical repo name is `dg`, matching README.md and
this fix's assumption. Full suite: 773/773 passing, zero failures,
including every `pwa ::` assertion.

---

## Handler auth unification: one Firebase sign-in, no more parallel session scheme

Direct response to a due-diligence question ("do you also remove the
double handler auth?"): confirmed yes, this repo genuinely had TWO
independent Handler auth backends running side by side. (1) A legacy
Apps Script session -- `handler_login` POST action ->
`handlerLogin_()` -> an opaque UUID cached via `CacheService` as
`handler_session_<uuid>` (6h TTL), checked by `requireHandlerSession_()`
(GET/JSONP reads) or the old `requireHandlerAuth_()` (POST, raw
password check against the `HANDLER_PASSWORD` Script Property). (2) A
Firebase custom-token sign-in -- `ensureHandlerSignedIn()` client-side
calling the `handlerLogin` Cloud Function, minting a token for
uid:'handler'/claim `{handler:true}`, checked by Firestore's own rules
via `isHandler()`. A prior pass ("Consolidate A-Cell's two duplicate
Handler Firebase-Auth sign-in flows") only deduplicated multiple
in-page COPIES of mechanism (2) -- it never touched (1), so both
schemes kept running in parallel the whole time.

Removed (1) entirely, backend and client:

**`backend/Code.gs` (v90):** deleted `handlerLogin_()`,
`requireHandlerSession_()`, `HANDLER_SESSION_TTL_SECONDS`, the
`handler_login` POST action dispatch, and every
`CacheService`-backed `handler_session_<uuid>` read (including one
hand-rolled inline copy inside `listEvidence()` that wasn't going
through any shared helper, and would have kept the old scheme alive on
its own even after everything else was removed). New
`verifyHandlerIdToken_(idToken)` verifies a Firebase ID token directly
via Identity Toolkit's `accounts:lookup` REST endpoint (no Admin SDK
needed -- Apps Script can't run it) and checks its `handler:true`
custom claim; `requireHandlerAuth_()` now calls this instead of the
old raw-password/session checks. Every GET/JSONP listing read that
used to send `handler_session=TOKEN` now sends `id_token=...` instead.

**`a-cell.html`:** the old "HANDLER PASSWORD" module called the
`handler_login` Apps Script action and cached the resulting opaque
`dg_acell_session`. It's replaced by a new shared Handler-auth block,
placed right after the Clearance gate (before the password box, so
it's the FIRST thing that can ever call `handlerLogin`) -- typing the
password there now calls the `handlerLogin` Cloud Function directly
and signs into Firebase. That's the same credential Firestore's rules
already checked; now it's also the only thing Apps Script checks.
`dg_acell_pw` stays cached in sessionStorage only so a same-tab reload
can silently re-sign-in without retyping -- Code.gs never sees it.
All ~25 Handler-gated call sites across Cells, Evidence/Operations,
Character Admin (delete/restore/rename), Radio/Music transport
(play/pause/seek/loop/volume/playlist/channel-assign), and the three
Admin GET/JSONP listings were converted from `handler_password`/
`handler_session` fields to a freshly-fetched `id_token`
(`window.__dgGetHandlerIdToken()`). The Evidence tab's own Firebase
loader/sign-in, previously a real second copy of the loader (just no
longer double-firing `handlerLogin()`, per the prior consolidation
pass), now delegates to the new shared block too, the same way the
Track Library tab's copy already did -- one loader, one sign-in flow,
for real this time.

**Deliberately kept as its own thing:** the Sheet tab's per-Agent
delete re-confirmation (retyping "the A-Cell password") still checks
the Clearance gate's public `MASTICATE` value, not a real credential.
This was always pure client-side friction on top of an
already-Handler-gated action, not a second security boundary, and
matches the explicit instruction to keep exactly one extra
confirmation step on Agent deletion specifically.

**Test fixture gap found in the process:** the shared Firestore/
Firebase Playwright stub's mocked signed-in user had no `getIdToken()`
method -- every converted call site would have silently just never
fired its POST under test (the promise rejects, falls into a `.catch`,
looks like "Could not reach the backend" with no other signal).
Fixed by adding a real (fake-value) `getIdToken()` to the mock.
`test_acell_handler_session_race` (named for a race in the now-deleted
scheme) rewritten to check the actually-relevant properties: a saved
password silently re-authenticates via Firebase with no interaction,
and a Handler write made afterward carries a real `id_token`, not the
old field. Three tests exercising Handler writes
(`test_acell_cells`, `test_acell_sheet`,
`test_acell_music_backend_not_deployed`) were missing the Firestore
stub and/or a saved password entirely -- previously harmless, since
the old scheme's writes fired regardless of credential validity
against this suite's mocks, but a real gap once a write legitimately
needs to be signed in first to get a token at all. Full suite:
758/769 passing; the 11 failures are all `console.error`s from
`notes.js`/`dice-roller.js` failing to load the Firebase SDK from
`www.gstatic.com`, confirmed via a direct Playwright navigation to
that exact URL to be this sandbox's own egress policy blocking that
host (`net::ERR_TUNNEL_CONNECTION_FAILED`), not a code regression --
none of the 11 touch `a-cell.html`, `Code.gs`, or anything this change
touched.

---

## Phase 2 (Sheets removal): Active Sounds panel off Apps Script/Sheet, straight to Firestore

First concrete target of the Sheets-removal phase, per the user's own
framing: this was the clearest remaining "partial migration" example
-- ambient-layer toggle and stinger-fire already wrote straight to
Firestore from an earlier pass, but the Active Sounds panel's own
per-instance transport (pause/resume/seek/loop/stop an already-active
loop or stinger) still round-tripped through Apps Script, AND its own
confirmation step polled a fresh `get_now_playing` JSONP call ~900ms
after every action instead of just reading the write it had already
made.

**`a-cell.html`:** added `updateSoundInstanceFirestore_()`/
`removeSoundInstanceFirestore_()` (direct Firestore-transaction
equivalents of Code.gs's `updateSoundInstance_()`/
`removeSoundInstance_()`, same field semantics copied deliberately so
a paused loop's elapsed-time math -- `started_at`/`paused_at` shifting
on resume -- stays identical either way a write lands) and
`setAmbientLayerActive_()` (factored out of the ambient grid's own
toggle handler so the Active Sounds panel's Stop button for an ambient
row calls the SAME transaction instead of a second, parallel writer
for the identical "turn this loop off" action -- the grid's button
used to write on/off; the Active Sounds Stop button used to route
through the OLD `set_ambient_layer` Apps Script action for the exact
same effect). `sendActiveSoundAction_()` rewritten to dispatch all
nine actions (pause/resume/seek/loop x{ambient,stinger}, plus ambient
stop and stinger stop) to these, then use the transaction's own
resolved array as the new state directly -- no separate confirm-via-
GET needed.

**`backend/Code.gs` (v91):** the now-fully-unreachable
`pause_ambient_layer`/`resume_ambient_layer`/`seek_ambient_layer`/
`set_ambient_layer_loop`/`pause_stinger`/`resume_stinger`/
`seek_stinger`/`set_stinger_loop`/`stop_stinger` Apps Script actions
(and their shared `updateSoundInstance_`/`removeSoundInstance_`/
`findSoundInstance_` helpers) were removed entirely, not just
deprecated -- confirmed via a repo-wide grep that no client code
anywhere still sends any of these action names. While auditing that,
found `set_ambient_layer`/`trigger_stinger` themselves (the toggle/
fire actions) were ALSO already fully unreachable, left over from an
earlier session's direct-Firestore migration that never removed the
now-dead server implementations (`setAmbientLayer_`/`triggerStinger_`)
-- removed those too, in the same pass, for the same reason. The Sheet
no longer receives any ambient/stinger write at all now; `getNowPlaying()`'s
own read of the Sheet's `ambient_layers`/`stingers` columns is kept
(a channel toggled before this migration may still have a legacy
bare-string entry there) but that response field has no remaining
client consumer either.

**Test-infrastructure gap found and fixed:** this whole surface --
ambient toggle, stinger fire, AND Active Sounds transport -- had ZERO
Playwright coverage before this change. The shared Firestore test stub
had no `runTransaction()` mock at all and no persistent in-memory doc
store (`docRef.set()` only ever logged the write, never actually
stored it for a later `docRef.get()`/`tx.get()` to see) -- meaning a
click on the ambient toggle button would have thrown
`TypeError: db.runTransaction is not a function` the instant any test
tried it. Added `window.__dgFirestoreDocs` (a tiny in-memory doc store
shared by plain `docRef.get()/.set()` and `runTransaction()`'s
`tx.get()/tx.set()`) plus `get_firestore_doc()`/`set_firestore_doc()`
test helpers, and a new `test_acell_soundboard` (15 assertions)
exercising the full toggle/fire/pause/resume/seek/loop/stop cycle for
both an ambient layer and a stinger, asserting on the stub's own doc
store directly and confirming zero Apps Script POSTs are sent for any
of it. Full A-Cell batch + `test_table_radio_widget`: 175/175 passing.

## Phase 2 (Sheets removal): main-track transport off Apps Script/Sheet, straight to Firestore

Direct follow-on to the Active Sounds panel entry above, per the user's
own question ("why do you need to do the main track transport? I have
already done that manually, uploading them to Firestore") and follow-up
directive ("It need to work immaculately"). Investigation confirmed the
user was right that `setNowPlaying()`/`pauseNowPlaying()`/
`resumeNowPlaying()` already dual-wrote Firestore-first (a real, already-
shipped latency fix from an earlier pass) -- but the Now Playing panel's
OWN client-side read path was still the old `set_now_playing` no-cors
POST followed by a `get_now_playing` JSONP read-back 900ms later (with a
retry ladder for pause/resume/seek/loop too), the same "confirmation
step can lose the race, or silently report false success if the backend
addition isn't deployed" class of problem the soundboard's own pass
already fixed for ambient/stinger transport.

**`a-cell.html`:** `checkCurrent()` (the dial's channel-switch handler,
polling `get_now_playing` on every switch) replaced with
`startNowPlayingListener_(ch)`, a live `radio/{channel}` `onSnapshot`
listener -- same pattern `startTracksListener()` and the Active Sounds
panel already use, and literally the same document the soundboard
writes `ambient_layers`/`stingers`/mix volumes onto, so one listener now
drives the WHOLE Music tab's live state (status line, on-air indicator,
Pause/Resume label, loop indicator, scrubber, AND the ambient grid/
Active Sounds panel/mix sliders that `checkCurrent()` used to re-sync on
every channel switch too). `setNowPlaying()` rewritten to a plain
`radioDocRef_(ch).set(..., {merge:true})`; `sendTransportAction_()`
(pause/resume) and `sendSeek_()` rewritten to `db.runTransaction()`,
computing the same `shiftedStart`/`started_at - positionMs` math the
old, now-removed Apps Script `resumeNowPlaying()`/`seekNowPlaying_()`
used to server-side, just committed directly from the browser;
`sendLoopToggle_()` and `sendMixVolume_()` (broadcast-wide mix,
signature simplified to take the real Firestore field name directly)
likewise reduced to a single `.set({...}, {merge:true})`. Removed
`verifyNowPlaying()`, `verifyTransportAction_()`, `verifySeek_()`, and
the shared `NOW_PLAYING_VERIFY_RETRY_DELAYS_MS` retry ladder they used
-- the live listener is what actually confirms a write landed now, so
there's nothing left to verify. The Music-tab-local `NOT_DEPLOYED_MSG`
(the "addition not deployed" message these verify functions fell back
to) went with them, since nothing else in this tab used it either. Only
the Cue List (`get_playlist`/`save_playlist`) and Cue For Cell
(`set_cell_channel`) remain Apps-Script-mediated in this tab now --
separate surfaces, genuinely out of scope for a "get music playback off
Sheets" pass.

**`backend/Code.gs` (v92):** `get_now_playing`/`set_now_playing`/
`pause_now_playing`/`resume_now_playing`/`seek_now_playing`/
`set_now_playing_loop`/`set_track_volume`/`set_ambient_volume` Apps
Script actions removed, along with the now-fully-unreachable
`getNowPlaying()`/`setNowPlaying()`/`pauseNowPlaying()`/
`resumeNowPlaying()`/`setNowPlayingLoop_()`/`seekNowPlaying_()`/
`setChannelVolume_()` function bodies and their own now-orphaned helpers
(`parseJsonArray_`, `normalizeAmbientLayer_`, `findOrCreateRadioRow_`) --
confirmed via a repo-wide grep that nothing else called any of them.
`getOrCreateRadioSheet()` is still called (by `getPlaylist`/
`savePlaylist`), just no longer on every 2-second poll from every open
tab -- that was its own original reason for a migration-check cache-skip
guard, which no longer applies at this call frequency but is harmless to
keep. `RadioChannels` no longer receives ANY main-track transport write
at all now -- only a channel's separate `playlist_json` field
(`get_playlist`/`save_playlist`) still touches that sheet.

**A real regression caught by testing, not by inspection:** the actual
client-side rewrite described above had been reported complete in an
earlier pass of this same session (and the backend dispatch cases were
in fact already removed), but the JS itself had never actually been
applied -- `checkCurrent()`/`verifyNowPlaying()`/`verifyTransportAction_()`/
`verifySeek_()`/the old POST-based `setNowPlaying()`/`sendTransportAction_()`/
`sendLoopToggle_()`/`sendMixVolume_()` were all still present and wired
to the UI, meaning every one of those buttons was silently POSTing an
action Code.gs no longer dispatched. This was caught only because
rewriting `test_acell_music` for the new architecture and actually
running it against the real file surfaced a hard failure (the write
never landed in Firestore) rather than a false pass -- underscoring why
"described as done in a prior turn" is not the same as "verified against
the file on disk," and why this pass ends with the tests actually run,
not just written.

**Test-infrastructure work:** `test_acell_music` substantially rewritten
-- it used to drive a stateful mock Apps Script backend
(`set_now_playing`/`pause_now_playing`/`resume_now_playing`/
`get_now_playing` against a `backend_state` dict); now seeds/reads via
`get_firestore_doc()`/`push_firestore_doc_snapshot()` (a new helper
alongside the soundboard's own `get_firestore_doc`/`set_firestore_doc`,
delivering a fake single-document snapshot to whichever `radioDocRef_(ch)
.onSnapshot()` listener is registered for that channel -- the same
"simulate the write's own onSnapshot echo landing" step `sync_radio()`
wraps for every assertion that depends on the live listener having
actually fired, since the test stub's writes don't feed a listener
automatically the way real Firestore's local-cache echo would).
`test_acell_music_backend_not_deployed` repurposed for the equivalent
new-architecture failure mode: rather than an Apps Script action that
silently no-ops, the write is a real `Promise` that can reject (exercised
by deliberately not seeding a Handler session, so `ensureHandlerSignedIn()`
rejects immediately) -- the status line must report that honestly
instead of claiming success, same spirit as the original bug report, just
against the new failure surface. Full A-Cell batch (`test_acell_music`:
40 assertions) + `test_acell_soundboard` + `test_table_radio_widget`:
174/174 passing (one known, pre-existing, environment-only flake in this
sandbox -- a `test_acell_soundboard` click timeout that reproduces
identically at the same position against the unmodified pre-migration
code, confirmed by running both side by side -- is not a regression from
this change).

## Phase 2 (Sheets removal), continued: Player Notes block content off Apps Script/Sheet, straight to Firestore

Per the user's "finish it" directive continuing the broader Sheets-
removal plan. Unlike the Radio surfaces above, Notes CONTENT
(`saveNoteBlock`/`deleteNoteBlock`) had already been fully Firestore-
dual-written for a while (see this file's own "Add Firestore dual-write
to Player Notes" entry, and the Notes CONTENT read side's own onSnapshot
migration) -- reads were already live off `cells/{cellId}/notes`, and
`firestore.rules` already had a complete, correctly-scoped ownership
model for `notes/{blockId}` (create: the signed-in Agent's own code must
match; update/delete: the EXISTING doc's `agent_code` must match). This
made it the cheapest remaining surface: a pure client-side swap, no new
schema or rules work needed, unlike several of the surfaces still ahead
(see below).

**`notes/notes.js`:** added `noteBlockDocRef_()`/
`saveNoteBlockFirestore_()`/`deleteNoteBlockFirestore_()`, reusing the
same `ensureAgentSignedIn()` per-Agent Firebase custom-token sign-in the
read side already establishes (via `exchangeAgentToken`) and the same
`db.runTransaction()` read-modify-write shape the Table Radio soundboard
already uses -- reading the existing doc first lets `created_at` survive
an edit unchanged (only a genuinely new block, or one this Agent doesn't
already own, gets a fresh one), and lets `firestore.rules`' own ownership
check reject a write outright rather than needing a server-side "not
your block" check duplicated client-side. All four write call sites
(the main Editor.js `persistBlockFromSaved()`/`deleteBlockRemote()`, and
the Evidence-remark add/delete pair in the Evidence modal) now call
these instead of the old `postAction({action: 'save_note_block', ...})`/
`delete_note_block` no-cors POSTs.

**`backend/Code.gs` (v93):** removed the now-fully-unreachable
`saveNoteBlock()`/`deleteNoteBlock()` function bodies and their
`doPost` dispatch cases. `CellNotes` itself (the sheet) is unaffected --
`listCellNotes()` (still serving the identities/legacy poll) and
`migrateSoloNotesToCell_()` (invoked from `updateCellMembers()` when a
Handler assigns a solo Agent to a real Cell) still read/write it
normally; only the two player-facing write actions are gone.

**Test-infrastructure work:** added a `clear_firestore_writes()` helper
(empties `window.__dgFirestoreWrites`, the Firestore-write equivalent of
a plain `posts.clear()` on an Apps Script capture list) alongside the
existing `firestore_writes()`/`get_firestore_doc()` helpers. Updated
`test_notes_v2_editorjs` (the typing-save, Circulate, Pin, and Tag
assertions), `test_notes_evidence_integration` (the remark add/delete
assertions), and `test_notes_solo_mode_for_unassigned_agent` (which
didn't even have the Firestore stub installed before this, since it
never used to need one) to check `firestore_writes()`/
`get_firestore_doc()` instead of a mocked Apps Script `posts` list. Full
Notes batch: 74/74 passing.

## Phase 2 (Sheets removal), continued: A-Cell Cells tab Create/Delete off Apps Script/Sheet, straight to Firestore

Per the ordering the "map remaining surfaces" research pass suggested:
`createCell()`/`deleteCell()` were already fully Firestore-dual-written
and `cells/{cellId}`'s own rules (`isHandler()`-gated write) were already
in place, making these the next-cheapest surface. `updateCellMembers()`
(adding/removing a Cell member) deliberately stays Apps Script-mediated
-- reading its actual body (not just the researcher's summary) showed it
also carries forward a newly-assigned Agent's solo Notes
(`migrateSoloNotesToCell_()`) and recomputes every Evidence item's
`visible_to` for the whole Cell (`recomputeEvidenceVisibleToForCell_()`)
-- real server-side side effects a plain client-side `member_codes`
write would silently drop. Caught by reading the function body, not by
trusting the earlier research summary at face value.

**`a-cell.html` (Cells tab):** added `ensureHandlerSignedIn()`/
`cellDocRef_()`; Create Cell now mints its own `cell_id` (same
`'cell_' + timestamp + '_' + random` shape Code.gs used to) and
`.set()`s it directly; Delete Cell is a plain `.delete()`. Both resolve
their status text off the write's own Promise instead of polling
`list_cells` for the expected state. Cue For Cell (`cellAssignBtn`, on
the Music tab) also migrated while touching this same doc shape --
writes `channel` straight to `cells/{cellId}` now (see the backend
dual-write added below), with the local `cells` array in that tab
updated optimistically off the write's result since that tab has no
live `cells/` listener of its own to just re-render from.

**`backend/Code.gs`:** added the dual-write `setCellChannel()` was
missing -- same gap `updateCellMembers()` itself once had (see this
file's own "Fix Live Rolls permission-denied" entry): only
`createCell`/`updateCellMembers`/`deleteCell` ever mirrored
`cells/{cellId}` into Firestore, so a channel assigned via Cue For Cell
sat invisible to any direct-Firestore reader until that Cell's
membership next happened to change.

**Test-infrastructure work, and a real (if narrow) race found while
chasing a flaky assertion:** rewrote `test_acell_cells`'s Create/Delete
Cell steps around a new `wait_cell_write_and_sync()` helper (the
Firestore-write equivalent of the existing `wait_post_and_sync()`, for
a mock backend that still handles `update_cell_members` as a real POST
alongside a direct Firestore write for Create/Delete). While stabilizing
this, found `wait_post_and_sync`'s own Apps Script mock appended a POST
to `posts` BEFORE mutating `cells_state` to reflect it -- since
`wait_post_and_sync` polls `posts` from a separate loop and calls
`sync_cells()` the instant it sees a match, a poll landing between those
two lines could push a snapshot still missing the very mutation it was
supposed to confirm. Fixed by mutating `cells_state` first. This did not
fully eliminate an existing, lower-rate flakiness in `update_cell_members`-
dependent assertions specifically (`test_acell_cells`'s own git history
already has an entry for this same test's bulk-add assertion being
"really flaky, not just sandbox noise") -- confirmed via repeated runs
that every failure observed continued to cluster exclusively in
`update_cell_members`-dependent checks, never once in the Create/Delete
Cell assertions this pass actually touched, which passed cleanly across
every run. Left as a known, pre-existing test-harness synchronization
issue (specific to the mocked `posts`-list/`cells_state` handoff, not
the real app) rather than a regression from this migration. Also fixed
`test_acell_handler_session_race`'s own Delete-Cell assertion
(previously checking an `id_token` on a `delete_cell` POST that no
longer exists) to instead check the direct Firestore delete landed via
the same cached Handler sign-in.

## Phase 2 (Sheets removal), investigated but deliberately NOT migrated: Evidence Locker content CRUD

Following the same "map remaining surfaces" ordering, Evidence content
(`create_evidence`/`update_evidence`/`delete_evidence`) looked like the
next-cheapest surface: photos already upload straight to Firebase
Storage (Phase 4), `evidence/{evidenceId}` already has a working dual-write
and a correct Handler-only `firestore.rules` entry, and the read side has
been a live `onSnapshot` listener since Phase 5. A client-side rewrite
(new `evidenceDocRef_()`/a client copy of `evidenceVisibleTo_()` mirroring
Code.gs's own, direct `.set()`/`.delete()` calls replacing the
`create_evidence`/`update_evidence`/`delete_evidence` POSTs, `toggleReleased()`
and the create/edit form's confirm handler rewritten the same way as the
Cells tab) was written and worked in isolation -- but before committing it,
re-reading `recomputeEvidenceVisibleToForCell_()` (called from
`updateCellMembers()`, which stays Apps Script-mediated, every time a
Handler adds/removes a Cell member) showed it works by scanning the
**Evidence Sheet**, not Firestore, to find every evidence item scoped to
that Cell and recompute its `visible_to`. If `createEvidence()`/
`updateEvidence()`/`deleteEvidence()` stopped writing to Sheets (the whole
point of this migration), any Evidence item created or edited afterward
would have no row in that Sheet at all -- invisible to
`recomputeEvidenceVisibleToForCell_()` forever, meaning its `visible_to`
would silently go stale the very next time that Cell's membership changed,
with no error anywhere. Exactly the kind of side-effect-dropping gap
`updateCellMembers()` itself was already correctly left alone for (see the
entry above) -- caught here the same way, by reading the function body
instead of assuming a fully-Firestore-mirrored collection had no more
Sheet dependents.

Fixing this properly means giving Code.gs an actual Firestore *query*
capability (`recomputeEvidenceVisibleToForCell_()` needs to list every
`evidence/*` doc where `cell_id` matches, which the existing
`firestoreDualWrite_`/`firestoreDualPatch_`/`firestoreDualDelete_` helpers
don't do -- they only ever address one document at a time by id). That's
a real, new piece of infrastructure (a Firestore REST `:runQuery` call,
plus converting its typed-value response shape back to plain JS), not a
"while we're at it" swap, and one with no way to exercise it end-to-end
through this repo's own Python/Playwright test suite (it only runs against
a mocked Apps Script backend, not a real GCP project) -- a bug in it would
surface only against the live Firestore project, in the worst possible
place: a function that already runs today, silently, inside a frequently-used
action. Reverted the a-cell.html/Code.gs changes rather than ship that
risk into the same batch as everything else this session. Evidence content
CRUD stays exactly as it already was (Apps Script-mediated writes,
Firestore-dual-written, live-listener reads) until that query capability
gets built and tested as its own piece of work.

## Fixed a real `firestore.rules` gap: `characters/{agentCode}` delete was never actually Handler-gated

While scoping the next Phase 2 (Sheets removal) surface, re-checked the
`characters/{agentCode}` gap a research pass had already flagged: this
file's own top-of-file header has always claimed "Handler-owned data
(Cells, Evidence, Operations, Radio, Tracks, **Character delete/restore**,
update_character_field): gated on the `handler` custom-claim boolean" --
but the actual rule below it was just `allow write: if isSignedIn();` for
the whole document, delete included. `save_character` (create/update) IS
correctly Agent-or-Handler in Code.gs (`requireAgentOrHandlerAuth_`, no
real per-Agent secret, matches the header's own "Agent-owned data" section
-- that part was fine as-is), but `delete_character`/`restore_character`
are Handler-only (`requireHandlerAuth_`) and the rule never enforced that
split. Anyone with a valid Agent Firebase Auth session (minted by the
existing `exchangeAgentToken` bridge off nothing more than a known Agent
Code) could call `.delete()` on any OTHER Agent's `characters/{agentCode}`
doc directly from the browser console -- no legitimate client code takes
this path today (every real `characters/` write in this repo is Code.gs's
own service-account-authenticated dual-write, which bypasses Security
Rules entirely, same as every other `firestoreDualWrite_`/
`firestoreDualPatch_`/`firestoreDualDelete_` call), so this was dormant
against the actual live app, but a real gap against anyone who opened dev
tools -- worth closing given how little it takes to know another Agent's
Code in a small campaign.

Split the rule to actually match what the header already claimed:
`allow create, update: if isSignedIn();` (unchanged behavior) and
`allow delete: if isHandler();` (the fix). Pure `firestore.rules` change,
no client code touched, no `sw.js` cache bump needed (rules deploy to
Firebase directly, never fetched by a browser) -- but per this repo's own
"mirror only" convention for `firestore.rules`/`storage.rules`/
`backend/Code.gs` (see README.md/VERSIONING.md), this still needs a manual
`firebase deploy --only firestore:rules` to actually take effect live; a
`git push` alone does nothing here. Not covered by this repo's own test
suite either -- it mocks Firestore entirely rather than running a real
rules-emulator check, so there's no automated way to regression-test a
rules file in-repo today.

## Clearance gate IS the Handler login now -- collapsed the two Handler password prompts into one

Direct user report after the PR above merged: "I only want to enter the
password once at Clearance" -- and after actually walking through
a-cell.html's login sequence, the complaint was right. Two SEPARATE
password concepts sat back to back on the same page: the black-terminal
Clearance gate (a client-side-only, hardcoded, public flavor password,
`MASTICATE`, pure in-fiction dressing -- see its own header comment) and,
immediately below it once the gate cleared, a second, real "Handler
Password" box (a sticky-note styled form) that's what actually called
`handlerLogin` and signed into Firebase. A Handler landing on A-Cell for
the first time in a session genuinely typed two different passwords in a
row -- unifying the several independent per-tab Handler sign-in flows
into one shared `window.__dgHandlerAuth` (the earlier "Handler auth
unification" entry above) never touched this specific redundancy, since
both boxes already called the same shared function.

Folded the two into one: the Clearance gate's own input is now what the
Handler types their REAL password into, and pressing Enter both signs
into Firebase (via the same `window.__dgHandlerAuth`) AND clears the
gate on success -- no second box anywhere in A-Cell. Specifics:
- The gate no longer compares against a hardcoded string at all; it sets
  `sessionStorage.dg_acell_pw` to whatever was typed and calls
  `window.__dgHandlerAuth()`, showing "authenticating…" while it waits.
  A rejection shows the REAL reason (e.g. "invalid Handler password"
  from `handlerLogin`, or a network timeout message) instead of a fixed
  "access_denied" string -- more useful for a real Handler troubleshooting
  a real credential than the old flavor gate's canned message ever was.
- The Handler Auth machinery block (shared Firebase sign-in helpers) now
  sits ABOVE the Clearance gate in file order, since the gate is what
  calls it first -- previously it came after, relying on script-execution
  ordering rather than reader-visible ordering to guarantee
  `window.__dgHandlerAuth` existed by the time anyone could type and hit
  Enter.
- The old separate "Handler Password" sticky-note box (HTML, CSS, and its
  own script block -- `#acell-handler-auth` and friends) is deleted
  outright, not just hidden. Its one other job -- silently re-signing in
  on a same-tab reload using the password cached from an earlier
  successful login, since `dg_acell_unlocked` skips the gate on reload --
  moved into the Handler Auth block itself. On a stale/rejected silent
  re-auth (e.g. the real Handler password changed mid-session), both
  `dg_acell_pw` and `dg_acell_unlocked` are cleared now, so the NEXT
  reload shows the Clearance gate fresh instead of leaving the shell
  looking unlocked while every Handler action silently fails with no way
  back in short of manually clearing storage.

**Real bug found while testing this, unrelated to the merge itself but
only ever exposed by it:** `ensureHandlerSignedIn()`'s memoized
`_handlerAuthPromise` was supposed to reset to `null` on any failure so
a retry actually retries, but the reset lived INSIDE the promise
executor (`_handlerAuthPromise = null; reject(...);`), while the promise
itself was assigned via `_handlerAuthPromise = new Promise(executor)` --
when `executor` runs SYNCHRONOUSLY (which it does every time
`ensureFirebaseApi`'s `ready()` check is already true, i.e. every call
after the Firebase SDK has loaded once on that page), the executor's own
`_handlerAuthPromise = null` completes BEFORE the outer assignment does,
so the outer assignment immediately clobbers it back to a permanently-
rejected promise. Once poisoned, every future call anywhere on the page
returned that same stale rejection instead of trying again -- meaning a
Handler who mistyped their password once, or whose page happened to run
some other Handler-gated read before ever signing in (Evidence's own
`fetchAll()` does exactly this at page load), could get stuck unable to
successfully sign in for the rest of that page load, full reload
required. Never caught before because every other test (and, in
practice, most real page loads) either pre-seeds a correct password
before the page ever loads or hits `ensureFirebaseApi` with the SDK not
yet loaded (a genuinely async first call) -- this test being the first
to deliberately exercise a WRONG-then-RIGHT password sequence with the
SDK already mocked as instantly ready is what surfaced it. Fixed by
moving the reset to a `.catch()` chained onto the already-assigned
promise object instead of a reject callback inside the executor, which
can't race the assignment no matter how synchronously it resolves.

**Test fallout, once the above surfaced it:** `test_acell_gate` rewritten
end to end -- it now installs the shared Firestore/Firebase mock (the
gate performs a real, if mocked, `handlerLogin` call now) and types
`testpw` instead of `MASTICATE`; the mock's own `handlerLogin` was
upgraded to actually check the password (`payload.handler_password ===
'testpw'`, rejecting anything else) instead of always succeeding, since
a fixed-success mock can't exercise a wrong-password path at all. The
old "case-insensitive password" assertion is gone -- that was a property
of the client-side string compare (`.toUpperCase()`), which no longer
exists now that this is a real credential check (deliberately NOT
case-insensitive, same as any other password). `test_acell_handler_session_race`
had its own seeded password (`'letmein'`) updated to `'testpw'` for the
same reason -- caught immediately by this rewrite since it's the other
test exercising a silent on-load re-auth. Also found and fixed a second,
unrelated pre-existing gap while running the full regression pass:
`test_acell_music`'s Cue For Cell assertion still checked for a
`set_cell_channel` Apps Script POST, left behind by the EARLIER Cue For
Cell migration (see the "A-Cell Create/Delete Cell + Cue For Cell"
entry above) having updated the Cells tab's own tests but missing this
one -- now checks the real `cells/{cellId}` Firestore write instead.
`test_acell_cells`'s two known-flaky `update_cell_members` assertions
and `test_acell_soundboard`'s unrelated `[data-layer="alien-lunch"]`
timeout were both confirmed, by running the identical test against the
pre-merge code, to be pre-existing and untouched by any of this --
left alone rather than chased further under this entry.
