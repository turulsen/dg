# Field Notes widget — build spec

Status: **built (round 2), awaiting the Handler's test on the preview.**
Lives on the working branch only. §9 lists where the build differs from
the plan above it, and why; §10 is how to try it.
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
| **Field ID** (pocket, credential) | Card preview: cover agency and era, with the Face Plate | *Make Field ID* opens the Agent File's IDs tab (`dg-agent-portal.html?code=CODE#ids`, the same place Agent Hub's Field ID button goes); *Blank ID Creator* opens the standalone `dg-id-creator.html` |
| **Requisition** (pocket, business card) | The **full** Request for Materiel & Disbursement form and its roll, rendered inside the notebook page | Requisition **only lives here**: Agent Hub's Requisition button opens the notebook on this pocket, and opening `requisition.html` directly forwards into the notebook. Its rolls go through the notebook's own Dice (no second dice panel) |
| **Radio** (pocket, pager) | Channel dial 1–5, now playing, progress, Tune In/Leave, mute, volume (this is also where table sound is managed) | The existing `table-radio.js` engine (Firestore `radio/{channel}`, iOS gain fix) keeps playing; only its floating pill is replaced by this pager face and the quick-tune chip (§3) |
| **Dice Roller** (the triangle) | D4–D20 and D%, target % or `2d6+3`, critical/fumble colours, recent rolls | The existing `dice-roller.js` roll logic and Cell-shared history (`dice_rolls`); Friendly identity and damage rolls kept |
| **Notes** (tab) | **Phone:** the quick strip: one note, a tag (NPC / Location / Clue), *Private to you* / *Shared with the Cell*, *Add Note*, your notes listed below, *Open Player Notes ↗*. **Desktop:** the full existing Player Notes (editor, block types, Circulate, Pin, tags, other Agents' tabs, Shared feed), moved into the notebook page | Both write the same `cells/{cellId}/notes/{blockId}` blocks the Notes page writes today, so a quick note on the phone shows up in the full notes on desktop. No Cell yet: the same solo pseudo-Cell Notes already uses |
| **Evidences** (tab) | Evidence released to this Agent: scope stamp, operation, title, date, body, photo; your private remarks under each | Same Firestore `evidence` read and visibility filter Agent Hub uses; remarks are the same private `handout_notes` Agent Hub's Evidence "Your Notes" writes (so both show the same remark) |
| **Rules** (tab) | Search box plus the eight Rules Reference sections and their sub-headings; tapping one reads that section right in the notebook (search terms highlighted) | Reads `rules-reference.html` itself, so the notebook never goes out of date with the page; *Open full page* jumps to its section |
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
- **Look:** green-on-black terminal, like the Clearance boot splash:
  the clearance agreement is signed, the briefing gets its own random
  code name, then the lines type in one at a time, ending in the
  briefing's own question: `CAN WE CALL ON YOU? [Y/N]`.
- **Keys:** `Y` (or tapping **Y — you can call on me**) accepts and
  saves (`briefs/{code}.standing_orders_ack_at`, plus a local flag).
  `N` or `Escape` closes it without saving, so it comes back the next
  time they leave the sheet.
- **After Y:** the Agent loads straight into its **Agent File** on the
  Profiling tab to take the Face Plate photo, and once a photo exists
  the next step offered is the **Field ID** (the business ID).
- **Text:** the recruitment briefing a new Agent hears after signing
  (the Handler's reference, round 3), in our own simplified words, not
  the rulebook's:

  > **CLEARANCE BRIEFING — NEED TO KNOW**
  >
  > 1. **It has happened before.** Unnatural incursions are real, and
  >    they kill.
  > 2. **Knowing spreads it.** Exposure does the damage; only a cover-up
  >    stops it.
  > 3. **We are few.** A small, secret task force exists to stop them.
  > 4. **The work is necessary.** It is also clandestine, and not always
  >    legal.
  > 5. **Ask nothing.** Explanations don't come. Looking into us is
  >    forbidden; you learn only what you need to know.
  >
  > We need your silence. **Can we call on you? [Y/N]**

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

## 9. As built — changes from the plan above

- **Roll slip.** A roll started from the page (a skill tap on the sheet,
  Friendly's skill and weapon buttons) shows its result in a small dark
  card above the closed notebook instead of opening the whole notebook
  over the sheet — opening it on every roll meant an extra tap to close
  it each time at the table. The slip has no dimmed backdrop, fades after
  ~9s, and a tap anywhere else on the page puts it away (as the old dice
  panel did). *Open* moves the roller onto the notebook's Dice page.
- **Field ID** goes to the Agent File's IDs tab (§5), which is where the
  app's real Field ID already lives; `dg-id-creator.html` is a blank,
  standalone creator with no link to an Agent.
- **Settings on the sheet** show the common sheet controls directly
  (Theme, exports, backups, Share Link, Load by Code, Fix a Creation
  Mistake) and *Import, backup & more…* opens the sheet's own full
  settings panel for the rest (New Recruit / Import). Off the sheet, one
  button opens the current Agent's sheet with the notebook on Settings.
- **A-Cell** stays exactly as it was when visited directly. Inside the
  Hub shell, going to A-Cell makes the notebook step aside and puts the
  Radio pill and Dice panel (with the Handler's Live Rolls feed) back.
- **Active operation**: a flag (⚑) on each operation folder in A-Cell's
  Evidence tab. Setting one clears the others in that Cell.
- **Notes page** (`notes/index.html`) visited on its own now also gets
  the notebook, Radio and Dice (it had none before). Inside the notebook
  it drops its own title and sits on the notebook's paper.
- **Engines**: `table-radio.js` gained `window.dgRadio` (tune, leave,
  mute, volume, resume, state) and `dice-roller.js` a roll-start signal
  plus relays so Friendly inside the Hub shell rolls as its pregen. Both
  stand down inside frames marked `data-dg-embed` (the notebook's own
  embedded pages), like they already did inside the shell.
- **Not done**: Firefox isn't installed in the build sandbox, so the
  cross-browser pass is Chromium + WebKit (Safari's engine) only.

### Round 3 (feedback on the preview)

- **Look.** Pebbled leather with patina and saddle stitching (`.fn-stitch`)
  on the cover and the open book. The left page is a **card holder**:
  three deep leather pockets with stitched, thumb-notched lips, each
  holding a card — the Agent File card (Polaroid photo, name, code),
  the Field ID business card, the Requisition slip. The right page is a
  **booklet**: offset page edges underneath, foxing, a gutter shadow and
  a dog-eared corner. The Delta Green triangle (cover, dice strap, phone
  header) is toned olive to match the radio instead of bright green.
- **Radio**: no pocket any more. The chip beside the closed notebook
  opens a **pager** — a small dark device with a shadow, an LCD
  (channel, track, progress), a channel dial and Tune / Sound / Volume
  keys. No flavor text. Escape or × puts it away.
- **Dice** hang on a leather strap under the book; the strap opens the
  Dice page.
- **Agent File** is one paper shared with the Agent Hub's folders
  (`assets/agent-sheet.js` + `.css`, `window.dgAgentSheet`): Polaroid
  (the yellow Take Photo post-it covers all of it until a Face Plate
  exists), name, HP/WP/SAN/BP, Play and Open Agent File, a short
  physical description (built from the Agent File's profiling fields,
  else the sheet's own), the **Cell in bold** with its members indented
  under it, Operations with the Active one stamped, then Friendly's
  dossier layout for stats, skills (tap to roll), weapons and Bonds.
  In the Hub the paper sits in each Agent's folder without the photo and
  name the folder already shows.
- **Field ID** pocket: a business card for the Agent's agency when the
  cover workplace (`cover_agency`, the sheet's Employer) matches one of
  the app's agencies (FBI, DEA, ATF, US Marshals, DOJ OIG, Secret
  Service, ICE, CBP, NCIS, FinCEN, Postal Inspection, NYPD, Shelby
  County Sheriff, M-EPIC — the ID Creator's list); otherwise a Delta
  Green card.
- **Requisition** sits straight on the paper (no dark page behind it).
- **Notes** on a desktop take **both pages**: tabs, index and Evidence
  (with its Operation filter) on the left page, the toolbar and editor
  on the right, one fold between. The Notes tab clicked again drops to
  the quick-notes page; its button (or the tab) goes back. The spread's
  *Character Sheet* button now leaves for the sheet instead of loading it
  inside the notebook (where there was no way back).
- **Evidences** filter by Operation (all / each Operation / Unfiled).
- **Rules** open with the five tenets as *The Agent's Oath*, then a
  search box and a collapsed list of sections (tap one to open it).
- **Settings**: Theme (on the sheet), Cover Identity, *Fix a Creation
  Mistake*, one **Export ▾** menu, backups, Load by Code, the rest of
  the sheet's settings, Boot splash. One button language across the
  notebook: red for the main action, ink for the second, plain outline
  for the rest.
- **Friendly → character sheet**: *Make this my Agent* on a pregen's
  dossier opens a new, real character sheet with that Agent filled in
  (`dgAgentSheet.pregenToState()`), saved under the player's Cover
  Identity with its own new Agent Code, and arms the Standing Orders
  like a finished wizard does.
- **Elsewhere**: intro paragraphs under RESTRICTED/page titles removed on
  every page, Clearance cards shortened and the notes under them gone,
  and *Delta Green — Hub* in the top bar goes to Clearance. The doubled
  nav bar (Friendly's and the ID Creator's back links loading the whole
  Hub inside the Hub) is fixed: those links hide in the shell, and any
  page that finds the Hub inside itself breaks out.

### Round 4

- **Radio and dice back inside the notebook.** The card pockets are
  shorter; under them, on the left page, sit the radio (the same pager
  device, fully working: dial, Tune, Sound, Volume) and a dice tin
  showing the last result, which opens the Dice page. The strap under
  the book is gone. With the notebook shut, the chip beside it still
  pops the pager up. On a phone the open notebook's header has a radio
  button that brings the pager up over the book.
- **Notes spread laid out as two pages.** Left page: *Notes* on top with
  the Shared / per-Agent tabs sitting on the page's head rule, then
  *Index* and *Evidence* (with its Operation filter) as sections. Right
  page: search (and *Search everywhere*) over the block tools in a head
  band of the same height, ruled at the same line, then the editor. The
  *Plain fonts* switch is left out of the spread.

### Round 5

- **Field ID uses the Field IDs templates.** The hand-made business card
  is gone. The Field ID pocket and page draw the Agent's credential with
  the same per-agency, per-era templates and agency seals as the Agent
  File's Field IDs tab: credential books for the 1990s, CR80 cards later,
  each agency's colors and photo side. The agency comes from the cover
  workplace; the era is the Agent's Active Era (else first era, else the
  2020s). The name, title and Agent Code are filled in, plus the Face Plate
  when there is one. With no agency on file it is the Program's own card
  (the 2010s design for a 1990s Agent, since the Program issued none
  then). The templates, seals and renderer moved out of
  `dg-agent-portal.html` into `assets/field-id-cards.js`
  (`window.dgFieldIdCards`), which the Field IDs tab now loads too, so
  there is one copy. Field Notes loads it only when it draws the card.

### Round 6

- **A real book's proportions.** The two halves are the same width with
  the spine in the middle; the index tabs (Notes, Evidences, Rules,
  Settings) stick out past the right page's edge over the cover instead
  of taking width from the page.
- **Pages with depth.** The right page sits on a block of stacked pages
  (outer edge and bottom) and curves up out of the gutter. The open
  Notes spread has its page block on both outer edges, and the paper
  starts at the same height as the single page.
- **Notes tabs on the paper.** The Shared / per-Agent tabs stand on the
  paper's top edge like index tabs, the open one running into its page.
  "Notes" sits on the left page's head rule, level with the right page's
  tools.
- **Page turns.** Changing pages (desktop) turns the page: a leaf hinged
  at the spine lifts the old page, shades as it rises, swings over and
  lands on the left showing its blank back, with the next page already
  under it. It is skipped for the Notes spread and when the device asks
  for reduced motion.

## 10. Trying it on the private preview

From Cloud Shell (the repo is public, so the clone needs no login):

```
cd ~ && rm -rf dg-preview && git clone -b claude/new-session-thjzt6 https://github.com/turulsen/dg.git dg-preview && cd dg-preview
npx -y firebase-tools@latest hosting:channel:deploy field-notes --expires 30d --project dg-app-b3447
```

It prints a `https://dg-app-b3447--field-notes-….web.app` address. That
deploys **only** a copy of the pages to that address: the live site,
Firestore rules and Cloud Functions are untouched. The preview is its
own web address, so its browser storage starts empty — type your Cover
Identity on the Hub's loading screen to load your Agents. It uses the
real Firestore (see §1 for what it may write). Re-run the second command
after each new push to refresh the preview.

