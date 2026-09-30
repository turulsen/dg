# Field Notes widget — build spec

Status: **draft for confirmation.** Lives on the working branch only.
Nothing here merges to `main` (so nothing reaches the live site) until
the widget is complete, tested, and signed off.

Source of truth for the look: the Claude Design artifact
(`58801fd4-…`), with the options chosen there:

| Option | Chosen |
|---|---|
| Motion | Snappy (0.25s open) |
| Pocket layout | Stacked flush |
| ID treatment | Polaroid clipped in |
| Tab style | Leather tabs |

## 1. Keeping it hidden while it's built

- All work stays on the working branch. `main` and the live GitHub Pages
  site are untouched, so the app keeps running as it does today.
- Fixes needed on the live app meanwhile go to `main` as usual, and the
  branch pulls `main` in regularly, so the widget is always built on the
  current app.
- **Private preview:** a Firebase Hosting preview channel (a temporary
  `*.web.app` address only people with the link can find). Deployed
  from Cloud Shell with one command from a checkout of this branch:
  `firebase hosting:channel:deploy field-notes --expires 30d`.
  `firebase.json` already has a Hosting config. Cloud Functions are
  `onCall`, which accept any origin, so sign-in works there unchanged.
- The preview talks to the **real** Firestore. So the widget may only
  **add**: it reads existing data and writes the same documents the
  existing pages already write (note blocks, dice rolls). It adds no new
  collections, renames nothing, and needs no rules deploy.

## 2. Where it appears

- Every page that carries the floating Table Radio pill and Dice panel
  today, **except A-Cell** (Handler side keeps its own tools). On those
  pages the notebook **replaces** the pill and the panel.
- Inside the app shell (`hub.html`) the notebook lives in the outer
  shell like Radio and Dice do today, so it (and the music) persist
  while the page inside changes. A page opened on its own (not inside
  the shell) loads the notebook itself; a page inside the shell doesn't
  (the same "no double widget" rule `table-radio.js` and
  `dice-roller.js` already use).
- The notebook sits **alongside** the shell's top navigation, not in
  place of it. The navigation gains a third button: **Agent Hub ·
  A-Cell · Friendly.**
- Pages with no Agent chosen yet (the Clearance chooser, a first visit
  to Agent Hub) still get the notebook: Dice, Radio, Rules and Settings
  work, and the Agent pockets say "Pick an Agent in Agent Hub first".
  On Friendly, the Agent is the pregen picked there.

## 3. Closed state

- **Desktop:** the leather "Field Notes" notebook bottom-right, with the
  Delta Green triangle on the cover. Click the notebook to open it on
  the last page viewed; click the triangle to open straight to Dice.
- **Phone:** a round leather Dice button plus a small "Field Notes" tab,
  bottom-right, above the safe-area inset. Nothing covers page content
  (same rule the current pill and panel already follow).

## 4. Open state

**Desktop:** a two-page notebook (max 900×620) on a dimmed backdrop.
Left page: the Polaroid ID card, then the four pocket cards stacked
flush. Right page: the selected pocket's or tab's content. Leather tabs
on the right edge. X button, Escape, or a click on the backdrop closes
it.

**Phone:** full screen. The header shows the Agent's name, the Dice
button and X. The pocket cards scroll sideways, the page takes the
middle of the screen, and the leather tabs sit at the bottom. Page
scroll is locked while the notebook is open.

## 5. Contents, wired to the real app

| Where | What it shows | Data / action |
|---|---|---|
| **Agent File** (pocket, dossier) | Name, profession, code, cover, era, demographics, bonds; the profiling status | Current Agent's `characters/{code}` + `briefs/{code}` via `dgStore`. Buttons: *Open Agent File* (`dg-agent-portal.html`), *Play (Live)* (`stats/?load=CODE`) |
| **Field ID** (pocket, credential) | Card preview: cover agency and era | Opens the real fabricator (`dg-id-creator.html`) for the full ID and print |
| **Requisition** (pocket, business card) | Item and justification fields | Opens `requisition.html` with them pre-filled; the roll stays on that page. (The design's in-notebook "File Request" has no backend today, so the widget won't pretend it was filed.) |
| **Radio** (pocket, pager) | Channel dial 1–5, now playing, progress, Tune In/Leave, mute, volume | The existing `table-radio.js` engine (Firestore `radio/{channel}`, iOS gain fix) keeps playing; only its floating pill is replaced by this pager face |
| **Dice Roller** (the triangle) | D4–D20 and D%, target % or `2d6+3`, critical/fumble colours, recent rolls | The existing `dice-roller.js` roll logic and Cell-shared history (`dice_rolls`); Friendly identity and damage rolls kept |
| **Notes** (tab) | **Phone:** the quick strip: one note, a tag (NPC / Location / Clue), *Private to you* / *Shared with the Cell*, *Add Note*, your notes listed below, *Open Player Notes ↗*. **Desktop:** the full existing Player Notes (editor, block types, Circulate, Pin, tags, other Agents' tabs, Shared feed), moved into the notebook page | Both write the same `cells/{cellId}/notes/{blockId}` blocks the Notes page writes today, so a quick note on the phone shows up in the full notes on desktop. No Cell yet: the same solo pseudo-Cell Notes already uses |
| **Evidences** (tab) | Evidence released to this Agent: scope stamp, operation, title, date, body; your private remarks under each | Same Firestore `evidence` read and visibility filter Agent Hub uses; remarks are the existing private `evidence_remark` note blocks |
| **Rules** (tab) | Search box plus the eight Rules Reference sections and their sub-headings | Links jump to the matching section of `rules-reference.html` |
| **Settings** (tab) | Plain fonts, Table sound, Boot splash; Cover Identity (your real name); Reload My Agents; Clear Local Cache | The existing per-device settings (`dg_notes_plain_fonts`, the radio's mute, the boot-splash flag, `dg_cover_identity`) — one place instead of scattered |

The design's placeholder data (Aurelio "PARADE" Vance, the sample
evidence, "Gergo") is replaced by the real Agent's data everywhere.

## 6. New-Agent onboarding: the five tenets

- **When:** once, at the moment a brand-new Agent is finalised (the
  character wizard's last step), and never on a normal page load. A
  second new Agent gets it again.
- **How:** the green-on-black terminal look of the Clearance boot
  splash. The five lines type in one at a time, then **I understand**
  closes it and the Field Notes notebook gives one short pulse:
  "Your field notes are in the corner."
- **Stored:** nothing in Firestore. A local flag stops it reappearing
  on a reload during the same finalisation.
- **Text:** our own simplified wording of the Program's priorities,
  not the rulebook's text:

  > **STANDING ORDERS — READ AND ACKNOWLEDGE**
  >
  > You will never speak of the Program. Not to family, not to anyone.
  >
  > 1. **Stop it.** Ending the threat comes before everything else.
  > 2. **Contain it.** The fewer people who learn of it, the fewer it
  >    can reach.
  > 3. **Leave no trace.** Nothing may point back to the Program.
  > 4. **Bring it home.** Recover what you can: evidence, samples,
  >    anything that shouldn't exist.
  > 5. **Save who you can.** The last priority, not the least.

## 7. Look

The design's leather notebook, with its inside pages built from the
paper, ink and tab styling that Notes and the Agent Hub folders already
use (`assets/theme-folder.css`: `#f4eed8` paper, Special Elite /
Courier Prime, the red `#8b1a1a` stamp colour), so it reads as part of
the same app. No React: plain JS and CSS like the rest of the site.
The design's two images (the DG triangle and the RESTRICTED header)
are already in `assets/`.

## 8. Build order

Each step is testable on the preview before the next:

1. Widget shell: closed and open states, desktop and phone, pockets
   and tabs, on every player page and in `hub.html`, plus the Friendly
   nav button. Old pill and panel still hidden only where the notebook
   shows.
2. Dice and Radio moved onto the existing engines.
3. Agent File, Field ID, Requisition, Rules, Settings.
4. Notes: phone quick strip; full Notes on desktop.
5. Evidences with private remarks.
6. Five-tenets onboarding.
7. Full test pass: new automated tests in `test/run_tests.py`, then the
   player journey on Chromium, WebKit (Safari/iPhone) and Firefox, on
   emulators only, never the live campaign. Then you test on the
   preview, and it merges only when you say so.
