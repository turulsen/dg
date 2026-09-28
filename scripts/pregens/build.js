#!/usr/bin/env node
/* Friendly pregens, step 2: fill in what the Agent Dossiers leave blank.

     node scripts/pregens/build.js pregens-raw.json [-o friendly/pregens.json] [--report REPORT.md] [--force-bonus]

   Input is extract.py's output. For every sheet this keeps the game
   mechanics (stats, derived attributes, skills, weapons) and generates
   everything the sheet leaves for the player to decide -- name, sex, age
   and DOB, nationality, education, physical description, distinguishing
   features, Bond names, Motivations -- using the same tables the stats
   app's own Random Bio / Random Motivation buttons roll on (stats/bio.js).

   Deterministic: every roll is seeded from the sheet's id, so re-running
   after adding more PDFs never reshuffles an Agent a player already met.
   Bump SEED_SALT below to re-roll everyone.

   Bonus skill points: the book's optional 8 x +20% package (stats/
   scripts.js BONUS_PACKAGES), picked per sheet in catalog.json. Some
   Dossiers already spend more than a profession package plus bonus
   points (USSS PPD: +690 over base vs. Federal Agent's 400 + 160), so a
   package is only added to a sheet whose skills sit below that line --
   see BONUS_ALREADY_SPENT and the report's "points over base" column.
   --force-bonus adds the package to every sheet regardless.

   Output is public (GitHub Pages): no verbatim sheet text goes in it --
   gear is reduced to an item list and the Personal Details notes are
   left out. */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SEED_SALT = 'friendly-v1';
const REF_YEAR = 2026;           // DOB = REF_YEAR - age
const BONUS_ALREADY_SPENT = 560; // a typical profession package (400) + 8 x 20 bonus

function loadGlobals(file, names) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  // eslint-disable-next-line no-new-func
  return new Function(src + '\nreturn {' + names.join(',') + '};')();
}
const { bioData, motivationsData } = loadGlobals('stats/bio.js', ['bioData', 'motivationsData']);
const BONUS_PACKAGES = (() => {
  const src = fs.readFileSync(path.join(ROOT, 'stats/scripts.js'), 'utf8');
  const i = src.indexOf('const BONUS_PACKAGES');
  const j = src.indexOf('\n];', i);
  // eslint-disable-next-line no-new-func
  return new Function(src.slice(i, j + 3) + '\nreturn BONUS_PACKAGES;')();
})();
const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, 'catalog.json'), 'utf8')).sheets;

/* ── seeded RNG (mulberry32 over a string hash) ── */
function hash(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}
function rng(seed) {
  let a = hash(seed);
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ── same descriptor bands as stats/scripts.js getDescriptor() ── */
const DESCRIPTORS = {
  STR: [[3, 'Feeble'], [5, 'Weak'], [9, 'Average'], [13, 'Muscular'], [17, 'Huge']],
  DEX: [[3, 'Barely mobile'], [5, 'Clumsy'], [9, 'Average'], [13, 'Nimble'], [17, 'Acrobatic']],
  CON: [[3, 'Bedridden'], [5, 'Sickly'], [9, 'Average'], [13, 'Perfect health'], [17, 'Indefatigable']],
  INT: [[3, 'Imbecilic'], [5, 'Slow'], [9, 'Average'], [13, 'Perceptive'], [17, 'Brilliant']],
  POW: [[3, 'Spineless'], [5, 'Nervous'], [9, 'Average'], [13, 'Strong willed'], [17, 'Indomitable']],
  CHA: [[3, 'Unbearable'], [5, 'Awkward'], [9, 'Average'], [13, 'Charming'], [17, 'Magnetic']],
};
function descriptor(stat, v) {
  let d = '';
  DESCRIPTORS[stat].forEach(([min, text]) => { if (v >= min) d = text; });
  return d;
}

/* Which stats/bio.js professionProfiles entry (employers/educations)
   fits a sheet -- by its PROFESSION field first, then its title. */
const PROFILE_BY_WORD = [
  [/navy seal|green beret|raider|special tactics|isa|sad-sog|special operator|force recon|marsoc|160th/i, 'special_operator'],
  [/marine|army|soldier|navy|cav|mtn|mist|mspf|security force|combat camera/i, 'soldier'],
  [/federal agent|fbi|dea|atf|usss|ice|marshal|cbp|oceft|hrt|swat|srt/i, 'federal_agent'],
  [/police|taclet|msrt|msst|hitron/i, 'police_officer'],
  [/nurse|paramedic|hospital corps|trauma/i, 'nurse_paramedic'],
  [/physician/i, 'physician'],
  [/firefighter/i, 'firefighter'],
  [/pilot|sailor|nasa|search and rescue|marine interdiction/i, 'pilot'],
  [/case officer|sad-pag/i, 'intelligence_case_officer'],
  [/analyst|caci|targeting|nsa/i, 'intelligence_analyst'],
  [/computer/i, 'engineer'],
  [/scientist|epa/i, 'scientist'],
  [/foreign service/i, 'foreign_service_officer'],
  [/lawyer|executive/i, 'lawyer'],
  [/media/i, 'media_specialist'],
  [/program manager/i, 'program_manager'],
  [/criminal/i, 'criminal'],
  [/anthropolog|historian|ranger/i, 'anthropologist'],
];
function profileFor(rec) {
  for (const [re, key] of PROFILE_BY_WORD) {
    if (re.test(rec.title) || re.test(rec.profession)) return bioData.professionProfiles[key];
  }
  return bioData.professionProfiles.default;
}

const TACTICAL = /seal|beret|raider|special tactics|isa|sad-sog|special operator|recon|160th|hrt|fast|srt|sog|counter assault|tactical|hitron|msrt|border tactical|mspf|taclet/i;
const FAMILY = ['Spouse', 'Wife', 'Husband', 'Daughter', 'Son', 'Mother', 'Father', 'Brother', 'Sister'];
const OTHER_BONDS = [
  'Ex-spouse', 'Best friend since college', 'Former partner on the job', 'Mentor at the academy',
  'Childhood friend', 'Estranged father', 'Grandmother who raised them', 'Teammate from the unit',
  'Priest at the family parish', 'Neighbor who watches the kids', 'Old roommate', 'Therapist',
];
const LANGUAGES = ['Spanish', 'Arabic', 'French', 'Russian', 'Mandarin', 'Pashto', 'German', 'Portuguese', 'Korean', 'Farsi'];

function pick(r, arr) { return arr[Math.floor(r() * arr.length)]; }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function skillKeyToName(key, skills) {
  const norm = s => s.toLowerCase().replace(/[^a-z]+/g, '_');
  const hit = skills.find(s => norm(s.name) === key) || skills.find(s => norm(s.name).startsWith(key));
  return hit ? hit.name : null;
}

// Adds a package's 8 x +20 (capped at 80, per the rulebook) and says
// what it did, so the sheet can show the bonus as its own line.
function applyBonus(r, rec, skills, pkgLabel) {
  const pkg = BONUS_PACKAGES.find(p => p.label === pkgLabel);
  if (!pkg) return { package: pkgLabel, applied: [], note: 'unknown package' };
  const applied = [];
  const bump = (name) => {
    let s = skills.find(x => x.name === name);
    if (!s) { s = { name, value: 0 }; skills.push(s); }
    const before = s.value;
    s.value = Math.min(80, s.value + 20);
    if (s.value > before) applied.push(name);
  };
  const used = new Set();
  pkg.skills.forEach(k => {
    let name = null;
    if (k === '?foreign_language') {
      const lang = LANGUAGES.find(l => !used.has(l) && !skills.some(s => s.name === 'Foreign Language (' + l + ')')) || pick(r, LANGUAGES);
      used.add(lang);
      name = 'Foreign Language (' + lang + ')';
    } else if (k === '?military_science') {
      name = /navy|uscg|seal/i.test(rec.title) ? 'Military Science (Sea)' : /air|soar|720th|pilot/i.test(rec.title) ? 'Military Science (Air)' : 'Military Science (Land)';
    } else if (k === '?art') {
      name = /camera|media/i.test(rec.title) ? 'Art (Photography)' : 'Art (Creative Writing)';
    } else if (k === '?craft') {
      name = /eod|explosive/i.test(rec.title) ? 'Craft (Microelectronics)' : 'Craft (Mechanic)';
    } else if (k === '?anthro_arch') {
      name = 'Anthropology';
    } else if (k.charAt(0) === '?') {
      // "choose any": the Agent's best professional skill still under 80
      const cand = skills.filter(s => s.value < 80 && !used.has(s.name)).sort((a, b) => b.value - a.value)[0];
      name = cand && cand.name;
    } else if (/\(/.test(k)) {
      name = k;
    } else {
      name = skillKeyToName(k, skills);
    }
    if (!name) return;
    used.add(name);
    bump(name);
  });
  return { package: pkg.label, applied };
}

// "Agency badge and identification card, medium pistol (usually .40 or
// 9mm) in a belt holster, ..." -> ["Agency badge and ID card", "Medium
// pistol", ...]: the item, not the sheet's own sentences.
function gearItems(text) {
  if (!text) return [];
  const items = [];
  text.replace(/\([^)]*\)/g, '').split(/[.;]\s*/).forEach(sentence => {
    sentence = sentence.replace(/^(maybe|also|usually)\s+/i, '').replace(/^.*\b(includes?|carried in [^,]*?)\s+/i, '');
    sentence.split(/,\s*(?:and\s+|or\s+)?|\s+and\s+(?=[a-z])/i).forEach(part => {
      let s = part.trim().replace(/^(either|a|an|and|or|two|one)\s+/i, m => /two|one/i.test(m) ? m : '');
      s = s.replace(/\s+(in|on|with|for|printed|usually|carried)\b.*$/i, '').trim();
      if (s.length < 3 || s.split(' ').length > 6) return;
      items.push(cap(s));
    });
  });
  return Array.from(new Set(items)).slice(0, 18);
}

function build(rec, opts) {
  opts = opts || {};
  const r = rng(SEED_SALT + ':' + rec.id);
  const cat = catalog[rec.title] || {};
  const stats = {};
  ['STR', 'CON', 'DEX', 'INT', 'POW', 'CHA'].forEach(k => {
    const v = rec.stats[k];
    stats[k] = { value: v, x5: v * 5, feature: rec.features[k] || descriptor(k, v) };
  });

  const sexRoll = r();
  const sex = rec.sex || (sexRoll < 0.58 ? 'Male' : sexRoll < 0.98 ? 'Female' : 'Non-binary');
  const nameKey = sex === 'Male' ? 'male' : sex === 'Female' ? 'female' : 'non-binary';
  const first = pick(r, bioData.firstNames[nameKey]);
  const last = pick(r, bioData.lastNames);
  const mi = String.fromCharCode(65 + Math.floor(r() * 26));
  const name = rec.name || (first + ' ' + mi + '. ' + last);

  const tactical = TACTICAL.test(rec.title);
  const age = tactical ? 27 + Math.floor(r() * 14) : 26 + Math.floor(r() * 30);
  const dob = (1 + Math.floor(r() * 28)) + ' ' + MONTHS[Math.floor(r() * 12)] + ' ' + (REF_YEAR - age);

  const profile = profileFor(rec);
  const years = Math.max(2, Math.min(age - 22, 3 + Math.floor(r() * 14)));
  const employer = rec.employer || pick(r, profile.employers);
  const education = rec.education || (pick(r, profile.educations) + '. ' + years + ' years with ' + employer.replace(/\s*-\s*.*$/, '') + '.');

  // Physical description -- stats/scripts.js generateRandomBio()'s own
  // STR+CON banding and sentence shapes, rolled on the same tables.
  let physical = rec.physical;
  if (!physical) {
    const sc = stats.STR.value + stats.CON.value;
    const tier = sc >= 30 ? 'high' : sc >= 24 ? 'athletic' : sc >= 18 ? 'average' : 'low';
    const pool = sc >= 30 ? bioData.notableFeatures.high_str_con : sc < 18 ? bioData.notableFeatures.low_str_con : bioData.notableFeatures.neutral;
    const height = stats.STR.value >= 16 ? 'tall' : stats.STR.value >= 12 ? 'average' : 'short';
    physical = cap(pick(r, bioData.buildDescriptors[tier])) + ', ' + pick(r, bioData.heightDescriptors[height]) + '. ' +
      cap(pick(r, bioData.hairColors) + ' ' + pick(r, bioData.hairStyles)) + ' hair, ' + pick(r, bioData.eyeColors) + ' eyes. ' +
      cap(pick(r, pool)) + '.';
  }

  // Bonds: as many as the sheet has score boxes filled, each at the
  // sheet's own score (= CHA by the rules).
  const bondCount = Math.max(1, rec.bonds.length);
  const bonds = [];
  const usedRel = new Set();
  for (let i = 0; i < bondCount; i++) {
    const src = rec.bonds[i] || {};
    let rel;
    do { rel = r() < 0.6 ? pick(r, FAMILY) : pick(r, OTHER_BONDS); } while (usedRel.has(rel) && usedRel.size < 12);
    usedRel.add(rel);
    const relSex = /wife|mother|daughter|sister|grandmother/i.test(rel) ? 'female' : /husband|father|son|brother|priest/i.test(rel) ? 'male' : (r() < 0.5 ? 'male' : 'female');
    const bFirst = pick(r, bioData.firstNames[relSex]);
    const bLast = FAMILY.indexOf(rel) !== -1 && !/spouse|wife|husband/i.test(rel) ? last : pick(r, bioData.lastNames);
    bonds.push({
      name: src.name || (bFirst + ' ' + (/spouse|wife|husband/i.test(rel) ? last : bLast)),
      relationship: rel,
      score: src.score != null ? src.score : stats.CHA.value,
    });
  }

  // Motivations: three rolls on the Briefing Documents' tables, one per
  // category, with "choose one" resolved against this Agent's own Bonds.
  let motivations = rec.motivations ? rec.motivations.split(/\n+/) : [];
  if (!motivations.length) {
    const cats = new Set();
    let guard = 0;
    while (motivations.length < 3 && guard++ < 40) {
      const c = motivationsData.categoryByD12[Math.floor(r() * 12)];
      if (cats.has(c)) continue;
      cats.add(c);
      let t = motivationsData.tables[c][Math.floor(r() * 10)];
      t = t.replace(/a (particular )?Bond \(choose one\)/i, bonds[0].name);
      if (c === 'Protection' && !/Protect/.test(t)) t += ' - from ' + pick(r, motivationsData.protectionObjects);
      if (c === 'Opposition') t += ': ' + pick(r, motivationsData.oppositionObjects);
      motivations.push(t);
    }
  }

  // Skills: every skill on the form (base value when left blank), then
  // the sheet's specialties and extra languages, then any bonus points.
  const skills = rec.skills.map(s => ({ name: s.name, value: s.value }));
  rec.specialties.forEach(s => skills.push({ name: s.kind + ' (' + (s.name || '?') + ')', value: s.value || 0 }));
  rec.other_skills.forEach(s => skills.push({ name: s.name, value: s.value || 0 }));
  const overBase = rec.skills.reduce((t, s) => t + (s.value - s.base), 0) +
    rec.specialties.reduce((t, s) => t + (s.value || 0), 0) +
    rec.other_skills.reduce((t, s) => t + (s.value || 0), 0);
  let bonus = { package: cat.bonus || null, applied: [], points_over_base: overBase, already_spent: overBase >= BONUS_ALREADY_SPENT };
  if (cat.bonus && (opts.forceBonus || !bonus.already_spent)) {
    Object.assign(bonus, applyBonus(r, rec, skills, cat.bonus));
  }
  skills.sort((a, b) => a.name.localeCompare(b.name));

  return {
    id: rec.id,
    title: rec.title,
    profession: rec.profession,
    employer,
    name,
    sex,
    age,
    dob,
    nationality: rec.nationality || cat.nationality || 'American',
    education,
    physical,
    stats,
    derived: {
      hp: rec.derived.hp != null ? rec.derived.hp : Math.ceil((stats.STR.value + stats.CON.value) / 2),
      wp: rec.derived.wp != null ? rec.derived.wp : stats.POW.value,
      san: rec.derived.san != null ? rec.derived.san : stats.POW.value * 5,
      san_max: rec.derived.san_max != null ? rec.derived.san_max : 99,
      bp: rec.derived.bp != null ? rec.derived.bp : stats.POW.value * 4,
    },
    skills,
    bonds,
    motivations,
    weapons: rec.weapons.map(w => {
      const o = { name: w.name, skill: w.skill };
      ['range', 'damage', 'ap', 'kill_damage', 'kill_radius', 'ammo'].forEach(k => { if (w[k]) o[k] = w[k]; });
      return o;
    }),
    gear: gearItems(rec.gear),
    special_training: rec.special_training,
    bonus,
    generated: rec.missing,
  };
}

function main() {
  const args = process.argv.slice(2);
  if (!args[0]) { console.error('usage: build.js pregens-raw.json [-o out.json] [--report report.md]'); process.exit(2); }
  const opt = (flag, dflt) => { const i = args.indexOf(flag); return i === -1 ? dflt : args[i + 1]; };
  const out = opt('-o', path.join(ROOT, 'friendly', 'pregens.json'));
  const report = opt('--report', null);
  const raw = JSON.parse(fs.readFileSync(args[0], 'utf8'));
  const forceBonus = args.indexOf('--force-bonus') !== -1;
  const pregens = raw.map(rec => build(rec, { forceBonus })).sort((a, b) => a.title.localeCompare(b.title));
  const have = new Set(pregens.map(p => p.title));
  const pending = Object.keys(catalog).filter(t => !have.has(t)).sort();
  fs.writeFileSync(out, JSON.stringify({ version: 1, pregens, pending }, null, 1) + '\n');
  console.log(pregens.length + ' pregens, ' + pending.length + ' pending -> ' + out);

  if (report) {
    const lines = ['# Friendly pregens: what each sheet was missing', '',
      '| Sheet | Generated | Points over base | Bonus package |', '|---|---|---|---|'];
    pregens.forEach(p => {
      const b = p.bonus;
      const bonusCell = !b.package ? 'none set in catalog.json'
        : !b.applied.length ? 'not added (' + b.package + '): sheet already over ' + BONUS_ALREADY_SPENT
          : b.package + ': +20 to ' + b.applied.join(', ');
      lines.push('| ' + p.title + ' | ' + p.generated.join(', ') + ' | ' + b.points_over_base + ' | ' + bonusCell + ' |');
    });
    if (pending.length) lines.push('', 'Still to extract (' + pending.length + '): ' + pending.join('; '));
    fs.writeFileSync(report, lines.join('\n') + '\n');
  }
}

if (require.main === module) main();
module.exports = { build, gearItems, rng };
