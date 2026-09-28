# Friendly pregens

Turns the Handler's fillable DD Form 315 pregens (the *Agent Dossiers* PDFs)
into `friendly/pregens.json`, which `friendly.html` reads.

```
pip install pypdf
python3 scripts/pregens/extract.py ~/Downloads/dossiers -o pregens-raw.json
node scripts/pregens/build.js pregens-raw.json --report pregens-report.md
python3 scripts/pregens/fill.py ~/Downloads/dossiers friendly/pregens.json -o printable/   # optional
# then bump CACHE_NAME in sw.js (friendly/pregens.json is a shell file)
```

- **extract.py** reads every PDF's form fields and prints what each sheet
  left blank. Its output holds the sheets' own gear/notes text verbatim, so
  it's a local working file — `pregens-raw*.json` is git-ignored.
- **build.js** keeps the sheet's numbers (stats, HP/WP/SAN/BP, skills,
  weapons, Bond scores) and does what each sheet leaves to the player:
  - **Identity:** name, sex, age/DOB, nationality, education, physical
    description, distinguishing features (stat descriptors), Bond names and
    relationships that fit the job (one partner at most), three Motivations
    with any "choose one" / "name them" resolved. Uses the Creator's own
    tables (`stats/bio.js`), seeded per sheet.
  - **Employer:** the agency the sheet pins; else one from the sheet's own
    EMPLOYER dropdown (18 generic sheets leave it on "Select or Enter
    Employer Name"), preferring one that fits the job; else the agency in
    the title.
  - **Skills, by the sheet's own notes.** "Choose N from the following
    skills" takes the N options that raise the Agent most (a "(choose one)"
    option gets a specialty that fits the profession). "Bonus skill points:
    Add +20% each to any N skills" makes exactly N picks, max 80%, never
    Unnatural -- led by the catalog's bonus package for that sheet, then the
    Agent's own strongest skills. A sheet whose notes say neither (11 of the
    62) is complete as printed.
  - **Blank lines on the form** ("Language 50%", "Science (Choose One)",
    "Pilot ( )") get a specific specialty.
  - **Sheet slips:** Unnatural filled in with SAN max still 99 is a value
    typed one line off (the Police Officer's Unarmed Combat 60%); it's moved
    back. A printed HP that differs from ⌈(STR+CON)/2⌉ (three sheets) is kept
    and flagged in the report.
  - **Names across the roster:** no first name twice, no surname more than
    twice. Built in `catalog.json` order, so append new sheets at the end --
    earlier Agents keep their names.

  `--report` writes a table of every decision per sheet.
- **fill.py** (optional) writes a print-ready copy of each PDF with the
  generated details filled into its blanks, so the paper sheet a player
  keeps HP and SAN on matches the one on screen. Print-only; don't commit.
- **Ids** are short Agent-Code-shaped slugs of the title (`FR-USSS-PPD`),
  which is what lets a Handler put a pregen in a Cell.

The published JSON carries no verbatim sheet text: gear becomes an item
list and the Personal Details notes are left out. Don't commit the PDFs —
this repo is a public GitHub Pages site.
