# Features & Architecture Reference

A system-level reference for this project: what's built, what each
piece is actually *for*, how it works under the hood, and what's still
open. Written so someone without this project's history — a fresh
session working on the `firebase-migration` branch, say — can
understand what a bug report is actually describing without having to
reverse-engineer it from the code alone. Pairs with `BUGFIXES.md`
(every bug ever fixed, chronologically) and `README.md` (the shorter
player/Handler-facing overview).

**Branch note:** most of this document describes the architecture as it
stood on `claude/delta-green-agent-hub-sn79d4` — Google Sheets (via Apps
Script) as the backend, Google Drive for images/audio. **That backend is
retired as of v2.0.0 (2026-09-30, Code.gs v97):** every page now reads
and writes Firestore and Firebase Storage directly (see §12). The page
and feature descriptions (§1–§8) still hold; §9–§11 (Apps Script
actions, the Sheets data model) are history now — useful for old
records and the one-time migration, not for how a live call works.
Check the current code before trusting a specific function name.

---

## 1. Pages and what they're for

| Page | Who uses it | Purpose |
|---|---|---|
| `index.html` | Everyone | Boot-splash animation, then a three-card chooser: **Agent** (player), **Friendly** (one-shot player, pregen) or **A-Cell** (Handler, password-gated). Entry point for the whole site. |
| `friendly.html` | One-shot players | Pick a pregenerated Agent (`friendly/pregens.json`, built by `scripts/pregens/`) and play: read-only dossier, every stat/skill/weapon rolls via the Dice Roller, HP/WP/SAN kept on paper. No Firebase sign-in unless the pregen is in a Cell (then its id — a valid Agent Code shape, e.g. `FR-USSS-PPD` — signs in through `exchangeAgentToken` like any Agent and rolls into that Cell's `dice_rolls` feed; no backend or rules change was needed). The Dice Roller takes its identity from the page (`dgDice.setIdentity`), never from the device's own roster. |
| `agent-hub.html` | Players | A player's own hub and each Agent's whole file: one folder tab per Agent in this browser's roster, plus "+ New Recruit" (the creation wizard since v3.0.0, §5). An Agent's tab has the Agent File paper, which since v2.7.0 is the character sheet (§5; the rest lives in the Field Notes notebook), and **Appearance ▾ / Era photos ▾ / Cell ▾** drop-downs beside the photo (§5), Evidence, and (if unassigned) a Cover Identity search box. `?code=CODE[#appearance|#photos]` opens one Agent. |
| `dg-agent-portal.html` | -- | Retired (the three-tab Agent Portal); forwards old addresses to Agent Hub / the Fabricator. See §5. |
| `stats/index.html` | Players | Retired in v3.0.0 (creation is Agent Hub's New Recruit, play is the Agent File); reachable only from the notebook's Settings → Old character sheet. The old Delta Green character sheet/creator — stats, skills, professions, Bonds, equipment, dice roller, Live Play tracker bar, three visual themes, import from five different formats, Cloud Save. This is a ported third-party project, see §2. |
| `a-cell.html` | Handler | The Handler's dashboard, password-gated. Tabs: **Play** (every Agent, simplified, for running the table), **Cells** (group Agents under a Handler), **Evidence** (file documents/photos, scoped to a Cell or campaign-wide), **Sheet** (dense Excel-style roster), **Music** (Table Radio broadcast controls), **Admin** (delete/restore Agents, including Agent-File-only entries). |
| `dg-id-creator.html` | Players | A standalone, older fake-ID-card generator. Superseded by the Field IDs tab's own Fabricator; kept in the repo, not linked from anywhere, no code system of its own left. |
| `notes/index.html` | Players & Handler | Player Notes — a shared/private notebook scoped to a Cell. See §3. |
| `field-id.html` | Players | The Field ID Fabricator (was the Agent Portal's Field IDs tab): agency/era credential cards from `assets/field-id-cards.js`. Lives in the Field Notes notebook; opened directly it forwards there. |
| `the-incursion.html` | Players | The Incursion tables (what first brought the Agent to Delta Green): read them, roll them, or pick lines with the shared picker (`assets/incursion.js`). Linked from Agent Hub. See §2. |

**Field Notes notebook (live since v2.1.0):** a leather notebook (`assets/field-notes.js`/`.css`)
on every player page, replacing the floating Table Radio pill and Dice
Roller panel and folding Agent File, Field ID, Requisition, Radio, Dice,
Notes, Evidence, Rules and Settings into one place. Not on A-Cell. Full
design and the record of each feedback round:
`docs/field-notes-widget/SPEC.md`.

**Split mode (v2.9.0, PR #69; desktop only).** The **Split** brown tab
(`data-fn="split"`, under Settings) puts the Agent File on the left page
(`[data-fn-slot=split-left]`, in place of `.fn-holder`) and the brown
tabs' pages on the right. `state.split` and `state.splitView` are kept in
`localStorage` as `dg_fn_split` / `dg_fn_split_view`; Evidences is the
default.
- **Notes** shows the whole Notes page (`notes/index.html?embed=notebook`,
  `[data-fn-slot=embed-notes]`) instead of the two-page spread.
- `show('agentfile')` lands on the right-page view, since the file is
  already on the left.
- A roll from the left page turns the right one to the Dice Roller
  (`onRollStart`).
- `renderSplitLeft()` redraws the left paper only when the Agent or their
  loaded record changes.
- The Field ID Fabricator's two-page spread still takes over both pages.
- While Split is on, the card holder's pockets and the radio pager are
  out of reach.
- A phone (≤759px) never splits, and the tab is hidden there.

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

**Three visual themes** (X-Files, Son of Sam, Field Notes) — all
upstream, all made mobile-responsive by this project (the upstream
themes were desktop-first and genuinely broke on a phone; see
`BUGFIXES.md`'s mobile-layout section for the specifics). A fourth
upstream theme, Modern (Catppuccin Mocha), was later removed as
redundant with the other three; Field Notes was also realigned to the
same paper/ink/typewriter system (`assets/theme-folder.css`) the rest
of the hub already uses, rather than its own separate cardboard/
marker-pen look. A separate, non-upstream **Mobile** theme (auto-applied
below a 768px screen width) was retired later still: its own CSS
predated the Field Notes dark-desk realignment above and had gone
stale against it, and everything it did beyond that was either
redundant with the responsive fixes below or with Field Notes' own
current styling. Phones now land on Field Notes by default instead.

**Live Play** is an orthogonal mode layered on top of whichever theme
is active (not a theme of its own) — a sticky HP/WP/SAN/BP tracker bar
across the top, meant for actual table use. Above it, the Cell's
initiative row lists the Cell in DEX order (`stats/lp-initiative.js`);
a KIA Agent (HP 0 or below on their saved sheet) drops out of it.

**Bonds after creation (v2.2.0).** Once an Agent is committed (first
Live Play), the Bond *generator* hides, as the Bonus Points panel does;
`+ Add Bond` replaces it for Bonds gained in play: under the Bonds list
in Edit mode, under Live Play's Bonds table (to Edit mode with a blank
Bond, `dgAddBond()`), and on the Agent File, which opens
`stats/index.html?load=CODE&add_bond=1`. The sheet writes the Bond
itself (its save covers the whole list, so nothing else edits Bonds in
`characters/{code}`).

**One Agent, one code (v2.2.0).** When a blank sheet mints a new Agent
Code and the player already has an Agent of that name (this device's
roster, or `dgStore.findByPlayerName` in Firestore), the sheet asks
whether to update that Agent instead (`checkForTwin` in
`stats/cloud-sync.js`). Update moves the data and any pending briefing
onto the existing code and sends the new one to Recently Deleted.

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

**Appearance step (unreleased, same branch):** the creation wizard's
step 4 of 10 (`#cs-appearance-fieldset`, shown only inside the wizard;
`stats/appearance-sheet.js`) -- how the Agent looks, the part of the Agent
File's Appearance brief a sheet can't work out (face, eyes, hair,
posture, expression, the feel of the person). Saved straight to
`briefs/{code}`, the same fields Agent Hub's Appearance edits (§5); "Fill
the rest at random" fills only blanks, suited to the sex on the sheet and
the profession (`assets/appearance-gen.js`); loading an Agent brings it
back from the brief. Finishing the wizard runs the sheet's own export
(identity, build, outfit), so a new Agent's Agent File is complete.

**Motivations and Mental Disorders, apart (v2.6.0, PR #66):** the Biography had one free-text box for both. Motivations
keep that box (`#cs-motivations`, `bio.motivations`); Mental Disorders
are their own list (`stats/disorders-sheet.js`, the hidden
`#cs-disorders` -> `bio.disorders`, an array of names). Each row is a
dropdown of the Rules reference's disorders (`assets/disorders.js`,
`window.dgDisorders`: the 18 from `rules-reference.html`'s Violence /
Helplessness / Unnatural tables, each with its kinds, trigger and
effect, shown under the row) or **Other…** with the Handler's own
words. Live Play shows and edits the same list under its own MENTAL
DISORDERS heading. An older save has no `bio.disorders`: on load,
`splitText()` moves lines marked `Disorder: …` or starting with a known
disorder's name (or alias: DID, OCD, PTSD spelled out, Claustrophobia…)
out of Motivations into the list. The printed DD Form 315 (PDF export),
the Sheets export and the printable sheet still have one box 12 for
both: `combine()` writes Motivations, then one `Disorder: …` line per
disorder, so a re-import (PDF, Sheets, Kappa Black, older Foundry)
splits them again. Foundry: a disorder is a `motivation` item carrying
it in `system.disorder` (`crossedOut: true`, the motivation it
replaced), read back the same way. A-Cell's dossier lists them under
their own heading with each one's trigger. The Random Motivation button
had pushed the Motivations box under its label at 160px wide in every
theme; it now sits in the field column.

**The Incursion (unreleased, on `claude/new-session-thjzt6` with the
Field Notes notebook):** what first brought the Agent to Delta Green,
part of the Agent the way Motivations are. One module,
`assets/incursion.js` (`window.dgIncursion`), holds the five tables
(Environment D4, Vector D6, Cover Story D8, Complication D10, Incursion
D12, worded exactly as `the-incursion.html` always had them) and a
picker: roll all, roll or choose any one line (mix and match), and/or
write it freehand. The text follows the picks until the player writes
their own; "Rewrite from the lines above" hands it back. Value shape:
`{ picks: {environment, vector, cover, complication, incursion}, text,
custom }` (picks are 1-based rows, 0 = not chosen). Where it lives:
- the character sheet's Incursion fieldset (after Biography) and its own
  creation-wizard step (`stats/incursion-sheet.js`), saved in the sheet
  state as `bio.incursion`;
- the Agent's record, `characters/{code}.incursion`, with `by`
  (`player`/`handler`) and `updated_at`, written by
  `dgStore.saveIncursion()` (merge, so the sheet's autosave never wipes
  it). When the sheet loads, the record's copy wins;
- read on the notebook's Agent File page and its orders terminal
  (`>incident_on_file:`), via `dgAgentSheet.incursionText()`;
- A-Cell's dossier shows it, and the Handler can edit it there
  (`set_incursion`), using the same picker;
- `the-incursion.html` uses the same picker in place of its old roll UI.

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

**[Retired with the Field Notes notebook]** Split View's buttons are
hidden wherever the notebook runs (`assets/field-notes.css`); the
notebook's Notes sit beside any page. Described below as it was.

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

**Restricting an item to Agents** (A-Cell): the checklist and the
"Restricted to:" line show Agent names, not Agent Codes (Agent File
name first, then the sheet's, Friendlies as "Friendly: name"); the
stored value is still the codes.

**Opening an attachment (players; v2.6.0, PR #66):** a
filed photo opens full-screen in `assets/evidence-viewer.js`
(`window.dgEvidenceViewer.open(src, title)`) wherever a player sees
Evidence: the notebook's Evidence page ("Tap to enlarge" under the
photo), Agent Hub's Evidence (the thumbnail) and Notes' evidence modal.
The viewer zooms the photo itself -- pinch, drag to pan, double-tap or
double-click, mouse wheel, `+`/`−`/Fit buttons, Escape or Close -- with
`touch-action:none` on its stage, because pinching the notebook (a
fixed, scaled overlay) zoomed the whole page around a thumbnail on iOS
Safari. Framed in the notebook (Notes), it opens on the top page. A PDF
is never put in an `<img>`: it's an **Open PDF** link (`pdfHref()`: a
Storage URL as is, a `data:` PDF as a `blob:` URL) that Safari's own PDF
viewer opens and zooms in a new tab.

**Terminology note:** the UI-visible label is "Evidence," but this
started life as "Handouts" and some internal names (`HandoutNotes`, a
per-Agent-private-note-on-an-item feature, `save_handout_note`) still
use the old name. Not a bug, just an unrenamed internal detail.

---

## 5. Agent Portal / Profiling / Agent File

**Now one page, on Agent Hub (unreleased, on `claude/new-session-thjzt6`
with the Field Notes notebook).** The three-tab Agent Portal is retired:
each Agent's Agent Hub tab is their whole file -- the hub's header (photo,
name, line, stamps, Play), the Agent File paper (`agent-sheet.js`: Cell,
Operations, the sheet), **Appearance** (the Profiling brief below) and the
**era photos** (the Agent File's era stack below), then Evidence. The
Profiling and Agent File code moved as it was into `assets/agent-file.js`
(+ `.css`, scoped under `.af-root`): same functions, element ids and
Firestore writes, ONE instance that Agent Hub moves into whichever tab is
open (`dgAgentFile.mount(slot, code)`; `park()` while the hub rebuilds;
`focus('appearance'|'photos')`; `dg-agent-file-saved` /
`dg-agent-file-state` events back to the hub). The form always saves under
the open Agent's code, so renaming renames (the portal guessed the code
from the name or roster). The gate below still holds, as presentation:
Appearance stays open with "N of 22 still to fill in" (and a callout under
Play) until complete, then folds with Edit; the era photos wait until
then. The wizard has an **Appearance** step (`stats/appearance-sheet.js`)
that writes the same fields straight to `briefs/{code}`, and finishing the
wizard runs the sheet's export, so a new Agent arrives with a complete
Agent File. The random generator's tables are shared,
`assets/appearance-gen.js`. The Field IDs tab became `field-id.html`,
embedded in the notebook's Field ID page. `dg-agent-portal.html` only
forwards old addresses (`?code=` -> the Agent's tab, `#cover` -> their
photos, `#ids` -> the Fabricator). What follows describes the pieces as
they were built on the portal; they work the same in their new place.

**The Agent File paper's vitals and Cell (v2.6.0, PR #66).**
The same paper is the notebook's Agent File page and Agent Hub's tab, so
both get these. Next to HP/WP/SAN/BP sits **Roll SAN**: a d100 Sanity
roll against current SAN through the Dice Roller (in the notebook it turns
to the Dice page, as every roll on that page does). Each Cell member
shows with their photo (`dgStore.mainPhoto` of their brief, else its
`face_plate_url`). Tapping a member opens a card under the list: a
larger polaroid, name (KIA stamped), cover name, and their current
HP/WP/SAN/BP from `characters/{code}` `derived`; tap again to close.
`AS.cellMember` returns `photo` and `derived`; `AS.wireMembers(el,
members, loadPhoto)` fills the thumbnails and opens the card, each page
passing its own photo loader (the notebook's `setImage`, Agent Hub's
`loadFacePlate`, or the URL as is for `https:`/`data:`). The listener is
wired once per element and reads the latest members on each tap, since a
page can redraw the paper as more data arrives.

**The paper wears as SAN falls (v3.1.0, PR #72; v2 milestone M3).**
- **Stages:** `assets/agent-paper.js` sets `data-sanity-tier` on the
  Agent File (`wearTier`: 0 at SAN 50+, 1–4 by tens, 5 at 9–1, 6 at 0).
  `assets/agent-wear.css` is generated by `scripts/agent-wear/build.py`;
  edit the script, not the CSS. It draws the wear with `:has()` on the
  whole page the file sits on: Agent Hub's `.paper` (its `::before`,
  z-index 6, above `.paper-content`) and the notebook's `.fn-paper` (its
  `::after`, which replaces the dog-ear while worn). So the stains belong
  to the real sheet, and the wear clears when the notebook turns to
  another page. Every texture is an inline SVG (fractal-noise grain,
  mottling, foxing, a fold, a broken coffee ring, a stain with a tide
  line, ragged blood), defined once as a `--w-*` custom property. Stages:
  grain and faint yellowing; + a fold and foxing; + a coffee ring; + a
  water stain; + the first blood, with the torn edge; + spatter at 0. The
  layer draws at 90% (`WEAR_OPACITY`), and the last stages stay light on
  purpose, so the sheet is playable when INSANE. The ink colour darkens
  a step per stage.
- **Torn edge (stages 5–6):** a mask on the page itself, inside its
  padding so no data is cut. It is 14px deep at the top and bottom (10px
  below 560px, where Agent Hub's page pads 12px) and a gentler 8px (6px)
  on the sides. It lifts while the Appearance reference-image viewer
  (`#aar-detail-overlay`, fixed inside the page) is open, so that viewer
  isn't clipped.
- **INSANE stamp:** from SAN 9 it is placed on the header name: Agent
  Hub's `#ah-title-CODE` via the mount's `stampHost`, or the paper's own
  `.as-name` (`data-wear-stamp`, with `--insane` / `--fill` set by
  `wearVars`). It is worn and patchy from 9 to 6 (about 35%→70%), and
  from 5 the gaps fill in until it is solid at 0. On phones it is smaller
  and starts at the name's left edge.
- **Disorder stamps:** `placeDisorders` scatters one 9px stamp per
  Mental Disorder over the header. On Agent Hub that is `.paper-header`
  and the 34px below its rule (the mount's `disorderArea`); in the
  notebook it is `.as-head`. It rejection-samples positions clear of
  buttons, inputs, the name, the meta lines, the vitals, the INSANE stamp
  and each other. A crowded header lets a stamp spill 36px lower before
  dropping it. The seed is `code|name`, so every spot is the same on each
  drawing and earlier stamps don't move when one is added. The inks go
  red, violet, blue-black in turn. A new one gets `.ap-dis-new` (a
  thump). Stamps are re-placed on resize and once the fonts load.
- **Motion and the off switch:** a new stage fades in
  (`.ap-wear-change`); there is no motion with `prefers-reduced-motion`.
  The notebook's Settings → "Paper wears as SAN falls" (`localStorage`
  `dg_paper_wear`) sets `html.dg-no-wear`, which turns off the wear, the
  tear and both kinds of stamp. The CSS is loaded on Agent Hub and in the
  notebook only, so A-Cell stays clean.
- Tests: `test_agent_file_wear`, `test_agent_file_disorder_stamps`.

**The Agent File as the character sheet (v2.7.0, PR #67; v2 milestone
M1).** The paper is now the sheet an Agent plays from, in the notebook
and on Agent Hub. Plan and milestones: M1 (this), M2 the New Recruit
wizard, imports and PDF export, with the old sheet only behind Settings
(v3.0.0), M3 the sanity meter's look, M4 deleting `stats/` once the user
decides.
- **`assets/agent-rules.js`** (`window.dgRules`): the rules as pure
  functions on the saved state, no page code. Max values (HP = ⌈(STR+CON)/2⌉,
  WP = POW, SAN = POW×5 capped at 99 − Unnatural), clamped `adjust`,
  `stepBp` (± POW), the skills list with specialties, marks
  (`lpCheckedSkills`; never Unnatural, only at 1%+), `improve` (+1D4 per
  mark), `sanLoss(state, amount, kind)` returning the events it sets off
  (`disorder` | `insanity` | `breaking` | `zero` | `incident`), `adapt`,
  `addBond` (score = CHA), Motivations (`bio.motivations`, rolled from
  `stats/bio.js`'s `motivationsData`) and Mental Disorders (`bio.disorders`;
  a disorder triggers on a loss of 2+ when `dgDisorders` says its trigger
  is losing 2+ SAN). `normalizeBio` splits an older combined text.
- **`assets/agent-live.js`** (`window.dgAgentLive.session(code, char)`):
  one session per Agent Code shared by every paper on the page. `update`
  applies a change and saves 700ms later through `dgStore.saveCharacter`
  (merge into `characters/{code}`); an `onSnapshot` on that document takes
  another device's change unless a save of its own is pending. Edit mode is
  a copy (`beginEdit` / `cancelEdit` / `commitEdit`); leaving with unsaved
  edits asks first.
- **`assets/agent-paper.js`** (`window.dgAgentPaper.mount(el, ctx)`) draws
  play and Edit modes with delegated `data-a` actions; post-its go in a
  full-page `#ap-posts`. Rolls go through the Dice Roller, which now
  dispatches `dg-dice-result` (and posts it into child frames); the paper
  falls back to a local roll after 6 s.
- **New fields** in `character_json`: `sanLog` (incidents and episodes),
  `adapted{violence,helplessness}`. Everything else uses the old sheet's
  fields (`derived`, `sanity`, `lpCheckedSkills`, `lpWeapons`, `lpNotes`,
  `equipment`, `bonds`, `bio`), so no migration.
- **Save from Edit** calls `dgFieldNotes.oath({code, name, changes})`: the
  changes and the five lines, then `CAN WE CALL ON YOU? [Y/N]`, resolving
  true on Y and false on N/Escape.
- **Agent Hub:** Play, the DEX post-it and `#af-vitals-section` are gone;
  `dgAgentFile`'s instance moves into the drop-down under the photo
  (`focus('appearance')` and an incomplete brief open it). The notebook's
  Rules page opens with `missionHtml()` instead of the Oath.
- Not changed: Firestore rules, Cloud Functions, Code.gs. The old sheet
  (`stats/`) still works next to it.

**The Agent File in parts, and its drop-downs (v2.8.0, PR #68).** Play-
testing found the one long paper hard to read, so it's grouped:
- **Five numbered parts** (`part()` in `agent-paper.js`, `data-part`):
  `stats`, `skills`, `psyche` (Bonds, Motivations | Mental Disorders,
  Sanity adaptation), `kit` (Weapons, Wounds | Gear & Armor), `record`
  (Incursion, Operations; not in Edit). Edit adds part 0, `personal`
  (Personal data and the physical description). A jump index
  (`data-a=jump`) scrolls to each. **Find a skill…** (`data-u=skill-find`)
  hides the rest and is re-applied after every redraw.
- **Looks:** the parts' headings are styled by a class on the paper,
  `ap-look-form` (default) / `ap-look-folder` / `ap-look-stamp`, from
  `localStorage` `dg_paper_look`. The notebook's Settings → Agent File look
  sets it (`dgAgentPaper.setLook`); every paper on the page switches at once,
  other frames through the `storage` event.
- **Drop-downs beside the photo.** On Agent Hub, `.ah-drop-btns` holds
  Appearance ▾ (the drop now opens with the physical description,
  `#ah-desc-CODE`, above the Profiling form), Era photos ▾ (`#af-photos`
  moved into `#ah-era-CODE` as the form is into `#ah-appear-CODE`, and sent
  home before `park()`; `focus('photos')` opens it) and Cell ▾ (drawn by
  the paper: `api.toggleCell()`, the open state kept on the element across
  redraws). A CSS grid puts them in a row beside the name on a desktop and
  in a column under the photo at 560px and below. The paper is mounted with
  `appearanceOutside: true` there. In the notebook the paper draws its own
  folds under the photo: Appearance (the description), Era photos (each
  active era's Face and Outfit Plates from `ctx.brief`, and a link to make
  them on Agent Hub) and Cell.
- A narrow paper (the notebook page) stacks the two-column parts and puts
  the statistics in rows of three (a container query on `.as-paper.ap`).

**The brief read recovers (v2.9.0, PR #69).** A failed read of
`briefs/{code}` no longer leaves "Could not load" and locked Era photos
until a reload (`BUGFIXES.md`).
- `dgStore.getDoc` tries a get() that failed for lack of a connection
  (offline, `unavailable` or the timeout) once more through `onSnapshot`,
  within 12s.
- `agent-file.js`'s `afLoad_` shows "Still loading" with the reason and
  **Try again**, and Era photos waits. It retries after 3s, 8s, 20s, then
  every 30s, and on `online` or `visibilitychange`.

**New Recruit: the creation wizard (v3.0.0, PR #70; v2 milestone
M2).** Agent Hub's **+ New Recruit** tab is a twelve-step wizard
(`assets/recruit-wizard.js` / `.css`, data in `assets/recruit-data.js`).
It replaces the old sheet's creator: `stats/` is now reached only from
the notebook's Settings ("Old character sheet → Open ↗").
- **Steps:**
  - **0 Start:** build one, or bring one in through a single drop zone,
    a Friendly pregen, or Load by Agent Code; a draft found on the device
    can be resumed or discarded.
  - **1 Statistics:** point buy (72, each 3–18), 4D6 drop lowest (tap two
    values to swap them) or fully random. Each statistic has an explainer
    in our own words and a distinguishing feature suggested from its
    score (`STAT_INFO`, `suggestFeature`), editable.
  - **2 Profession:** the Agent's Handbook's 18 (`stats/professions.js`),
    The Complex's 20 grouped by agency (`COMPLEX`), an Agency postings
    filter (~60 `POSTINGS`: a Handbook profession with agency, employer,
    suggested bonus skills and kit), or Build your own (10 skills, 400
    points ± 50 per Bond, 60% cap). The chosen one's detail opens under
    its own group: every skill at its value, profession skills red bold,
    suggested bonus skills black bold, Bonds, employer, kit.
  - **3 Bonus skills:** 8 × +20%, 80% cap, not Unnatural; the
    profession's suggestions are pre-placed; packages (`BONUS_PACKAGES`,
    copied from `stats/scripts.js`); specialties added by name.
  - **4 Damaged Veteran** (Agent's Handbook p.39, `VETERAN`): Extreme
    Violence, Captivity, Hard Experience (four skills +10%, may pass 80%;
    one Bond fewer), Things Man Was Not Meant to Know (a disorder from the
    Unnatural list). The changes are applied and listed.
  - **5 Personal data:** name, codename, past employer, Random Bio
    (`stats/bio.js`). Going on makes the Agent Code
    (`dgStore.submitBrief`, filed under the device's Cover Identity) or
    updates that brief.
  - **6 Bonds:** count from the profession; the generator's categories
    (Family, Friends, Delta Green, Other Governments, Underworld;
    `BOND_CATS`/`bondList` regroup `stats/bonds.js`, LGBTQ dropped), ⚄
    Another, and **Generate** for a description
    (`generateBondDescription`, §12).
  - **7 Motivations & Mental Disorders**, **8 Incursion**
    (`dgIncursion.mount`), **9 Equipment:** the profession's kit
    (`KITS`/`kitFor`, matched to `stats/equipment-data.js`; catalog
    weapons go on the weapons table with their skill %).
  - **10 Profiling:** the play era (written to the brief as
    `active_eras`/`campaign_era`), then the Agent File's own Appearance
    brief and era page (`dgAgentFile.reload` into the wizard's slot).
  - **11 Review & Contract:** **Sign the Contract** opens the full
    clearance briefing (`dgFieldNotes.contract`: `oath()` with
    `contract:true`). Y files the Agent (character `creationCommitted:
    true`, `standing_orders_ack_at` on the brief, the Incursion via
    `saveIncursion`, the roster, `dg_stats_cloud_code`) and opens their
    tab (`dg-recruit-filed`); N goes back with nothing lost.
- **The saved character** is rebuilt from the wizard's choices each time
  (`dgRecruit.build(W)`), in the sheet's own v1 shape: `skills`,
  `specialtyInstances`, `bonds` at CHA, `sanity`/`adapted` for a Veteran,
  `bio` (with `codename`, `pastEmployer`, `posting`, Complex keys as
  `profession`), `lpFeat`, `equipment`, `lpWeapons`, plus a `recruit`
  note of how it was made.
- **The draft** (`W`) is kept in `localStorage` (`dg_recruit_draft`);
  once there's a code it is also saved to `characters/{code}` with
  `creationCommitted:false` on each step. Discard sends a coded draft to
  Recently Deleted (`deleteOwnAgent`).
- **Imports** (`assets/agent-import.js`, `dgAgentImport.read(file)`):
  Foundry VTT actor, Kappa Black `.toml` (or its Foundry `.json`), this
  site's v1 save, the printable sheet's embedded state, the DD Form 315
  PDF and the Sheets `.xlsx` (the last two through the old sheet's own
  readers, with `window.dgSaveLoad` briefly a catcher). An import starts
  at Personal data; statistics, skills and profession come from the file.
- **Deep links:** `agent-hub.html?recruit=CODE#new` (an Agent with no
  sheet: Agent Hub's and the notebook's **Recruit**), `?recruit=friendly
  &pregen=ID` (Friendly's **Make this my Agent**), `?recruit=resume`.
- **Elsewhere:** a Cell member can be picked as a new Bond in play
  (relationship "Delta Green"); Breaking Point crosses off a Motivation
  (`bio.motivationsCrossed`); saving an edit shows the Mission & Standing
  Orders, priorities in capitals. Notes' Split View opens the notebook's
  Split and "Character Sheet" is now "Agent File". The notebook's Settings
  export a DD Form 315 from the saved character (`stats/pdf-export.js`,
  its template now found next to the script). On a phone the terminal
  (Contract, Standing Orders, saving an edit) scrolls and has big Y / N
  buttons. Profiling's Random Agent Generator lists The Complex's
  professions (own clothing over the nearest Handbook look,
  `COMPLEX_LOOKS`) grouped by agency, starting on the Agent's own; era
  prompts have **Redraft**.

**What it's for:** the actual in-fiction "dossier" for an Agent — a
physical description brief (Profiling), an AI-assisted portrait-prompt
generator, and the assembled read-only Agent File view a player
returns to across sessions.

**Profiling → Agent File gate:** the Agent File tab only renders once
`isProfilingComplete()` considers every `[required]` field on the
Profiling form filled in — 22 fields total. This is a deliberate
design choice (a half-finished record isn't worth showing as if it
were done). Any character sheet export (§2, Kappa Black or otherwise)
only ever fills 9 of those 22 (`char_name`, `age_range`, `sex`,
`nationality`, `build`, and the four outfit fields) — never the 13
pure-appearance fields like eye color, hair, posture, or vibe, since a
character sheet has no source for those. **This is intentional, not a
bug:** appearance can't be derived from stats, so the remaining fields
are always meant to be completed by the player by hand or via the
Random Agent Generator, regardless of import source. A player landing
on Profiling right after an export previously had no explanation for
why the form still looked incomplete — fixed by a one-time banner
(`2f39fe9`, Sep 3) that explains the carryover without relaxing the
gate itself. No further fix is needed here.

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

**Sheet tab:** a dense, Excel-style table across every Agent: Cell,
Handler, Agent Name, Agent Code, Player Name, Created, Last Updated,
Online. Player Name is directly editable, useful for a Handler
backfilling identity info a player hasn't set themselves yet (this is
what lets Cover Identity eventually find that Agent). Created and Last
Updated come from Firestore's own document times (earliest
`createTime`, latest `updateTime` across the Agent's `characters/` and
`briefs/` docs, read through the REST API, which the web SDK doesn't
expose). HP and SAN left this table in v2.2.0; they're on the Play tab.

**Play tab's Initiative Tracker** leaves out KIA Agents (derived HP 0
or below), the same rule as the players' Live Play initiative row.

**Admin tab:** soft-delete/restore an Agent (`delete_character`/
`restore_character` — archives rather than destroys, with a 24h auto-
purge of anything left in Recently Deleted), plus a separate listing
for Agent-File-only entries (a Profiling brief with no character sheet
yet) that the main delete list can't see.

**Handler's Live Rolls** (the dice panel on A-Cell only -- including A-Cell
inside the Hub shell; on every other page the roller is the current
Agent's, even in a tab logged into A-Cell): every Cell's rolls, via a
`collectionGroup('rolls')` listener. A filter at the top narrows it to
one Handler's Cells (the Cell's `handler` field) or a single Cell,
filtered on the device and remembered there (`dg_dice_cell_filter`).
The Handler password is shared, so this is a view filter, not access
control: any Handler can still pick "all Cells". Players' own feeds
read only their Cell's `dice_rolls/{cellId}/rolls`.

**Music tab:** see §7.

**Session Notes tab (v2.3.0; uploaded pages v2.4.0):** the Handler's own prep pages for each
scenario, a Hungarian and/or English version, plus an optional note.
Each version is either an uploaded `.html` page or a link (opened in a
new tab; a claude.ai page can't be framed).
- **Uploaded pages** open inside A-Cell, full-screen, in an `<iframe
  srcdoc>` sandboxed *without* `allow-same-origin`, so the page can't
  reach A-Cell's storage, Handler sign-in or Firestore. Dice Roller and
  Tune In are hidden while it's open, in the Hub shell too.
- **Remembered edits:** pages like the claude.ai Handler notes keep their
  ticks, counters and notes in `localStorage`, which throws in such a
  frame. So a small script injected ahead of the page swaps in a
  `localStorage` that starts from the saved state and posts every change
  to A-Cell. A-Cell saves it to Firestore (debounced, and on close), so
  ticks follow the Handler between devices.
- **Firestore**, Handler-only (`match /session_notes/{document=**}`):
  `session_notes/{id}` (title, description, `url_hu`/`url_en`,
  `file_hu`/`file_en` {name, size, uploaded_at}), `…/files/{lang}`
  (the page's HTML, up to ~900 KB, a Firestore document's limit) and
  `…/state/{lang}` ({items, updated_at}). Nothing is in this public repo.
  Only `https://` links are accepted. Loaded the first time the tab is
  opened. The rule needs `firebase deploy --only firestore:rules`.

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
  across reloads. Uploaded tracks and pasted YouTube/SoundCloud/direct
  URLs share the SAME Cue List (a "+ Queue" button on every Track
  Library row adds it in, tagged `kind: 'audio'`, alongside whatever
  "+ Add to Playlist" already queued) — one mixed queue, e.g. a YouTube
  video, then an uploaded track, then another YouTube video, in whatever
  order they're added.
- **Auto-advance** — a Handler-local checkbox (Cue List header,
  persisted to `localStorage`, not per-channel broadcast state, since
  A-Cell itself is what drives Now Playing forward — there's no
  separate server-side "radio station" process) that steps to the next
  Cue List entry when the current one finishes. Detecting "finished"
  differs by kind: an uploaded/direct track's real headless `<audio>`
  engine already fires a native `ended` event; YouTube/SoundCloud have
  no such signal visible to A-Cell (which has never embedded a real,
  audible player for those — only the manual fallback seek slider), so
  a hidden, always-muted detector player (a real `YT.Player` or
  `SC.Widget`, loaded on demand the same chain-safe way
  `assets/table-radio.js` already loads those APIs) is spun up purely to
  catch `ENDED`/`FINISH` and never otherwise heard. A generic URL
  (neither audio, YouTube, nor SoundCloud) has no detectable "finished"
  signal, so Auto-advance simply doesn't fire for it — the Handler still
  moves on manually, same as before this feature existed. A track with
  Loop on is exempt (advancing away from a loop the Handler explicitly
  asked for would defeat the point).

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
- **Stingers** — 24 one-shot sounds (`assets/stingers/*.mp3`, same
  pack, plus six added 2026-10-07: cat and dog whimpers, two child
  laughs and whispers in the dark), grouped in the soundboard as
  Screams & Laughter, Impacts & Weather, Bells/Rhythm/Texture, and
  Creatures & Voices. A new one needs its file in `assets/stingers/`
  (MP3: iOS doesn't reliably play Ogg) and an entry in A-Cell's
  `STINGER_GROUPS`; `test_stinger_files_exist` checks the two match. Firing one appends a fresh
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
- **Active Sounds panel** — lives directly under the main track's own
  scrubber, inside the Now Playing panel itself (not a separate section
  below the ambient/stinger catalog grids) — one glance at the top of
  the Music tab shows the main track and everything layered under it.
  Lists every currently active ambient loop and stinger as its own row
  (real scrubber, Play/Pause, an unambiguous Stop, and a Loop toggle —
  all inline SVG, same reasoning as the Now Playing panel's icons
  below), each backed by its own headless preview `<audio>` for
  accurate duration/position. Every control calls a dedicated Code.gs
  action addressed at that one instance (`pause_ambient_layer`/
  `resume_ambient_layer`/`seek_ambient_layer`/`set_ambient_layer_loop`,
  and the stinger equivalents keyed by `fired_at`), so stopping or
  pausing one loop or SFX never touches any other sound playing at the
  same time — the real fix for "toggled a loop on and couldn't tell how
  to turn it off," where a plain on/off toggle button was the only
  affordance and easy to lose track of.
- **Now Playing control panel** — A-Cell's Music tab has a dedicated
  panel (the wide column, above the Cue List) showing whatever's live
  on the dialed channel: a "Table Radio — CH. N" header, the track
  title, a scrubber with elapsed/duration labels, one shared Restart /
  Pause-Resume / Stop / Loop transport row (Pause-Resume is the bigger,
  highlighted center button — the one actually used mid-broadcast —
  with Restart/Stop/Loop smaller on either side), and a volume slider
  with a speaker icon, muted by default. The Loop toggle flips the
  CURRENT track's loop flag in place via a dedicated
  `set_now_playing_loop` action — no restart, no jump back to 0:00,
  unlike the separate "Loop this track" checkbox in the Broadcast form
  above (which only takes effect on the next Set Now Playing); it lights
  up the same green on/off ring the Active Sounds rows' own Loop button
  uses. Every icon (transport row, speaker) is inline SVG
  (`fill="currentColor"`, same approach as
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
- **Mix (broadcast-wide)** — two sliders in A-Cell's Music tab (`04 //
  Mix`), separate from the Now Playing panel's own volume slider (which
  is explicitly a Handler-local preview control, muted by default).
  These change what every listener at the table actually hears: a
  `track_volume`/`ambient_volume` mix level (0-100, default 100 when
  never set) stored on the channel's `radio/{channel}` document
  (`set_track_volume`/`set_ambient_volume` in Code.gs, same
  Firestore-first dual-patch pattern as every other live control) and
  applied by every listener's `table-radio.js` ON TOP of their own local
  volume slider — final volume is `localVolume × (mix / 100)`, never a
  replacement for the listener's own control. `ambient_volume` covers
  both ambient loops AND stingers (both are "soundscape" layers,
  distinct from the one "music" track), so a Handler can fade the music
  down while bringing SFX/ambience up, or the reverse, for the whole
  table at once — lets e.g. a tense stinger read as louder than the
  background music without the Handler needing everyone to touch their
  own device.

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

**iPhone/iPad playback (v2.2.0).** Safari plays nothing before the
page's first tap, and lets an `<audio>` element start on its own only
once that same element was played or loaded inside a tap. So every tap
(in the outer page *and* in same-origin frames, e.g. the Hub shell's
`#dg-shell-content`, where most taps land) wakes the AudioContext,
unlocks a few spare elements (a muted 10 ms silent clip played inside
the tap), and retries anything the browser refused. Tracks, ambient
loops and stingers take a spare element and hand it back when done
(`takeAudioEl_`/`releaseAudioEl_`), so after the first tap a song change
or a stinger starts with no Resume. The main track asks for
`crossorigin` whenever the CORS probe says yes, so the next tap can wire
the *playing* track into the gain node (the only volume control iOS
honours) instead of waiting for the next track. Background:
`BUGFIXES.md`, "Table Radio silent after the Storage CORS config".

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

## 12. Firebase migration status (done: the Sheet is retired in v2.0.0)

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

- **Status, 2026-09-30: the Sheet is retired (Code.gs v97).** Every
  page reads and writes Firestore directly: characters, Agent Files,
  Cells, Operations, Evidence, Notes, identities, seen marks, handout
  notes, playlists, Recently Deleted, dice rolls, Radio and the error
  log. Shared player-side calls are in `assets/dg-store.js`; A-Cell's
  Handler actions are in its own `window.dgAcellApi`. AI prompt and
  image generation are Cloud Functions (`generatePrompt`,
  `generatePlateImage`), with the keys in Secret Manager. They were
  only deployed on 2026-10-01. Since v2.2.0 they return any failure as a
  readable message, logged to `functions:log`, instead of the SDK's
  bare "internal". Their rate-limit counter (`rate_limits/`) is the
  functions' only Firestore use; the runtime service account needs
  `roles/datastore.user` for it, and `roles/storage.objectAdmin` for
  reference photos and `dailyBackup` (it had neither: `PERMISSION_DENIED`
  in the logs, 2026-10-05). A failing counter now lets the call through. The only
  Apps Script call left is the Drive image proxy (`imgdata`), for old
  `gdrive:` links the one-time Drive → Storage move couldn't carry.
  Going live needs the one-time steps in
  `docs/firebase-migration/SHEET-RETIREMENT.md` (deploy rules and
  functions, run the copy); see BUGFIXES.md "The Sheet is retired".

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

**[Corrected — this shipped]** The longer-term goal discussed here was
a single-page "iframe shell" — one outer page (`hub.html`) owning
persistent Table Radio/Dice Roller widgets, with an inner iframe
swapping between the existing pages, so music/dice state survives
page-to-page navigation instead of resetting on every load. This went
live `c1219e1` (Aug 29, "app shell live, linked from index.html"),
followed by a series of `Cut over:` fix commits through early
September addressing bugs the shell surfaced (Dice Roller state going
stale, Split View, Notes block picker, back-navigation, duplicate
widgets). Live and current — no longer just planned.

**Node.js 22 (v3.0.1).** `functions/package.json` asks for Node 22: Google
retires Node 20 for Cloud Functions on 2026-10-30, and deploys of a Node
20 codebase stop working then.

**Cloud Functions in v3.0.0 (PR #70).** New `generateBondDescription`
(the New Recruit wizard's Bond **Generate**: same sign-in and Anthropic
key as `generatePrompt`, 20 calls per 10 minutes per Agent, an emulator
canned reply). `functions/ai-prompts.js` now labels the Agent's age in
the character spec and requires it in every mode's instructions; before,
the prompts usually dropped it. Both need `firebase deploy --only
functions` once; an era prompt written before it can be written again
with **Redraft**.

---

## 13. Open / known-incomplete work

**Currently-open items live in GitHub Issues, not here** —
`https://github.com/turulsen/dg/issues`. This section used to carry the
live list directly, which meant two places could say different things
about whether something was still open; see `VERSIONING.md` for the
full reasoning on the split (Issues = live status board, `BUGFIXES.md`
= narrative archive of what shipped, this section = closed/decided
matters worth a permanent note).

As of 2026-10-10 (checked again for v3.1.0), four open tracked issues (#10 is closed; see
`BUGFIXES.md`'s "Issue #10's actual root cause"): #5 (Handler-facing access
control — shared A-Cell password, dossiers reachable by Agent Code, no
per-player identity), #8 (Agent Hub: long load screen then empty
character sheet — a regression from four commits already reverted off
`main`, root cause not yet confirmed), #9 (app feels laggy/unresponsive
overall on phone, incl. a "backend is busy" error with only one real
user online), #39 (Table Radio's main-track volume/mix control on iOS
Safari and Brave — the code side is finished, see `BUGFIXES.md`'s
"Issue #39, finished"; the bucket CORS config is applied, and v2.2.0
fixed the two things that still kept iOS volume and autoplay from
working in the Hub shell -- see §7, "iPhone/iPad playback". The issue
stays open until it's confirmed on a real device).

**Resolved, kept here as a permanent record (not re-opened as issues):**

- ~~Agent File not prefilling fully after character-sheet export~~ —
  not a bug. Appearance fields can't be derived from a stat block by
  design; players complete them manually or via the Random Agent
  Generator. The confusing bounce-with-no-explanation was fixed with a
  banner (`2f39fe9`). See §5.
- ~~The Firebase "one-page iframe shell" idea~~ — shipped, see §12.
- ~~`stats/`'s Share URL is a fourth save mechanism untracked by the
  backend/Cover Identity/Handler lookup~~ (issue #6) — not actually
  true of the current code. `applyState()` in `stats/save-load.js`
  (which `loadFromURL()`'s share-link path already routes through, same
  as every other importer) mints a real Agent Code and pushes to the
  backend via `ensureCloudCode()`/`pushToCloud()` the moment a named
  character loads — verified live: a built share link produced a real
  Agent Code and the exact same `save_character` payload (including the
  `player_name` field Cover Identity/Handler lookup key off) any other
  import produces. A share-linked character with a name is fully
  tracked like any other; an unnamed one isn't trackable via any import
  path, which is consistent, not share-link-specific.

**Deliberately decided *not* to build** (not open work — a closed
decision, kept here rather than as a "wontfix" issue since there's
nothing left to track): two items the original external security
review flagged, with the actual reasoning kept in `Code.gs`'s own
comments — a secondary `AgentIndex` sheet for O(1) lookups (this
campaign's real scan cost is negligible at its actual scale), and a
full XSS/input-sanitization audit (flagged as a real, separate
follow-up, not bundled into the performance/security pass already
done).
