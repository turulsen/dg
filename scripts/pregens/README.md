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
  weapons, Bond scores) and generates the blanks: name, sex, age/DOB,
  nationality, education, physical description, distinguishing features
  (stat descriptors), Bond names and relationships, three Motivations. It
  uses the Creator's own tables (`stats/bio.js`) and is seeded per sheet,
  so adding more PDFs later never re-rolls an Agent someone already played.
  Change `SEED_SALT` to re-roll everyone.
- **Bonus skills.** `catalog.json` names a bonus package per sheet
  (`BONUS_PACKAGES` in `stats/scripts.js`). It's only added when the sheet
  sits below a profession package plus bonus points (560 over base) —
  some Dossiers are already built well past that (USSS PPD: 690 over
  base). `--force-bonus` adds it everywhere; the report shows the numbers.
- **fill.py** (optional) writes a print-ready copy of each PDF with the
  generated details filled into its blanks, so the paper sheet a player
  keeps HP and SAN on matches the one on screen. Print-only; don't commit.
- **Ids** are short Agent-Code-shaped slugs of the title (`FR-USSS-PPD`),
  which is what lets a Handler put a pregen in a Cell.

The published JSON carries no verbatim sheet text: gear becomes an item
list and the Personal Details notes are left out. Don't commit the PDFs —
this repo is a public GitHub Pages site.
