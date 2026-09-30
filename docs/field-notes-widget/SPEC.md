# Field Notes widget — build spec

Status: **confirmed with revisions (round 2), being built.** Lives on
the working branch only.
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
  collections, renames nothing, and needs no rules deploy. The only new
  stored fields are additive and ignored by the live app:
  `briefs/{code}.standing_orders_ack_at` (§6) and
  `operations/{id}.active` (§5, Agent File).

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
  Delta Green triangle on the cover **in its own green** (the design
  greyed it out). Click the notebook to open it on the last page
  viewed; click the triangle to open straight to Dice.
- **Phone:** a round leather Dice button (green triangle) plus a small
  "Field Notes" tab, bottom-right, above the safe-area inset. Nothing
  covers page content (same rule the current pill and panel already
  follow).
- **Quick radio tune, both layouts:** a small pager chip next to the
  notebook: channel and a Tune In / Leave toggle, with a lit dot while
  the Handler is broadcasting. One tap tunes in without opening the
  notebook; the full pager is still inside.

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
| **Agent File** (pocket, dossier) | **Play (Live)** and **Open Agent File** buttons first. Then the quick look: name, Face Plate photo ("Take Photo" if none yet), Cell, the Cell's other members, Bonds, Operations with the active one marked | `characters/{code}` + `briefs/{code}` via `dgStore`, `cells` (`member_codes`), `operations` for that Cell. *Play* → `stats/?load=CODE`, *Open Agent File* → `dg-agent-portal.html?code=CODE`. **Active operation:** there's no such field today, so A-Cell's operation list gets an "Active" toggle (one per Cell, writes `operations/{id}.active`); until the Handler sets one, the newest operation shows as current |
| **Field ID** (pocket, credential) | Card preview: cover agency and era | Opens the real fabricator (`dg-id-creator.html`) for the full ID and print |
| **Requisition** (pocket, business card) | The **full** Request for Materiel & Disbursement form and its roll, rendered inside the notebook page | Requisition **only lives here**: Agent Hub's Requisition button opens the notebook on this pocket, and opening `requisition.html` directly forwards into the notebook. Its rolls go through the notebook's own Dice (no second dice panel) |
| **Radio** (pocket, pager) | Channel dial 1–5, now playing, progress, Tune In/Leave, mute, volume (this is also where table sound is managed) | The existing `table-radio.js` engine (Firestore `radio/{channel}`, iOS gain fix) keeps playing; only its floating pill is replaced by this pager face and the quick-tune chip (§3) |
| **Dice Roller** (the triangle) | D4–D20 and D%, target % or `2d6+3`, critical/fumble colours, recent rolls | The existing `dice-roller.js` roll logic and Cell-shared history (`dice_rolls`); Friendly identity and damage rolls kept |
| **Notes** (tab) | **Phone:** the quick strip: one note, a tag (NPC / Location / Clue), *Private to you* / *Shared with the Cell*, *Add Note*, your notes listed below, *Open Player Notes ↗*. **Desktop:** the full existing Player Notes (editor, block types, Circulate, Pin, tags, other Agents' tabs, Shared feed), moved into the notebook page | Both write the same `cells/{cellId}/notes/{blockId}` blocks the Notes page writes today, so a quick note on the phone shows up in the full notes on desktop. No Cell yet: the same solo pseudo-Cell Notes already uses |
| **Evidences** (tab) | Evidence released to this Agent: scope stamp, operation, title, date, body; your private remarks under each | Same Firestore `evidence` read and visibility filter Agent Hub uses; remarks are the existing private `evidence_remark` note blocks |
| **Rules** (tab) | Search box plus the eight Rules Reference sections and their sub-headings | Links jump to the matching section of `rules-reference.html` |
| **Settings** (tab) | **Character sheet settings** (everything in the sheet's cog today): Theme; Import Agent / New Recruit wizard; Fix a Character Creation Mistake; Cloud Save load by code; Export Printable / PDF / Google Sheet; Download / Upload / Clear Sheet, Share Link, Export to Agent File. **Plus:** Cover Identity (your real name), Boot splash, Reload My Agents | On the character sheet the buttons act on the open sheet; anywhere else they open the current Agent's sheet and run the action there. The sheet's own cog goes away where the notebook shows. **Boot splash** off skips the terminal animation, but the same screen still shows as the load screen while a page is actually loading. No Plain fonts toggle; no Table sound toggle (Radio owns sound) |

The design's placeholder data (Aurelio "PARADE" Vance, the sample
evidence, "Gergo") is replaced by the real Agent's data everywhere.

## 6. New-Agent onboarding: the five tenets

- **Armed when:** the character wizard finishes, or a new Agent is
  imported onto the sheet (drop zone, paste, file upload). From then on
  the Agent is "pending orders".
- **Shown when:** the player **leaves the sheet** after that (any
  navigation away: the shell's nav, a link, Back, or reopening the app
  later). The terminal comes up over whatever page they were heading to.
  Never on a normal page load for an Agent that already acknowledged.
- **Look:** green-on-black terminal, like the Clearance boot splash.
  The lines type in one at a time, ending in a prompt:
  `ACKNOWLEDGE STANDING ORDERS? [Y/N]`.
- **Keys:** `Y` (or tapping **Y**) acknowledges and saves
  (`briefs/{code}.standing_orders_ack_at`, plus a local flag).
  `N` or `Escape` closes it without saving, so it comes back the next
  time they leave the sheet.
- **After Y:** the Agent loads straight into its **Agent File** on the
  Profiling tab to take the Face Plate photo, and once a photo exists
  the next step offered is the **Field ID** (the business ID).
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
6. Five-tenets onboarding, then photo → Field ID hand-off.
7. Full test pass: new automated tests in `test/run_tests.py`, then the
   player journey on Chromium, WebKit (Safari/iPhone) and Firefox, on
   emulators only, never the live campaign. Then you test on the
   preview, and it merges only when you say so.
