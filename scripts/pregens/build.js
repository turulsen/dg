#!/usr/bin/env node
/* Friendly pregens, step 2: fill in what the Agent Dossiers leave blank.

     node scripts/pregens/build.js pregens-raw.json [-o friendly/pregens.json] [--report REPORT.md]

   Input is extract.py's output. For every sheet this keeps the game
   mechanics (stats, derived attributes, skills, weapons) and generates
   everything the sheet leaves for the player to decide -- name, sex, age
   and DOB, nationality, education, physical description, distinguishing
   features, Bond names, Motivations -- using the same tables the stats
   app's own Random Bio / Random Motivation buttons roll on (stats/bio.js).

   Deterministic: every roll is seeded from the sheet's id, so re-running
   after adding more PDFs never reshuffles an Agent a player already met.
   Bump SEED_SALT below to re-roll everyone.

   Skills: each Dossier's own Personal Details notes say what is still
   the player's to do, and this follows them to the letter --
     "Choose two from the following skills: >> Drive 60% >> ..." -> the two
       options that raise the Agent most (a "(choose one)" option gets a
       specialty that fits the profession);
     "Bonus skill points: Add +20% each to any six skills" -> exactly six
       +20% picks, max 80%, led by the profession's bonus package
       (catalog.json, stats/scripts.js BONUS_PACKAGES) and then the
       Agent's own strongest skills.
   Sheets whose notes say neither are complete as printed. Placeholder
   skills on the form ("Language 50%", "Science (Choose One) 60%",
   "Pilot ( ) 40%") get a specific specialty too.

   Output is public (GitHub Pages): no verbatim sheet text goes in it --
   gear is reduced to an item list and the Personal Details notes are
   left out. */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SEED_SALT = 'friendly-v1';
const REF_YEAR = 2026;           // DOB = REF_YEAR - age

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
const PARTNERS = ['Wife', 'Husband', 'Spouse'];
const FAMILY = ['Daughter', 'Son', 'Mother', 'Father', 'Brother', 'Sister'];
const OTHER_BONDS = ['Ex-spouse', 'Best friend since college', 'Childhood friend', 'Grandmother who raised them',
  'Priest at the family parish', 'Old roommate', 'Therapist'];
// People only this line of work gives you.
function workBonds(title) {
  if (/socom|marines|army|navy|soldier|special operator|sad-sog|seal|uscg|160th|720th/i.test(title)) return ['Teammate from the unit', 'Former squad leader', 'Buddy from basic training'];
  if (/\b(fbi|dea|atf|ice|cbp|usss|marshals|police|oceft|hrt|srt)\b|federal agent/i.test(title)) return ['Former partner on the job', 'Mentor at the academy', 'Witness they once protected'];
  if (/scientist|nsa|computer|epa|anthropolog|historian|nasa/i.test(title)) return ['Doctoral advisor', 'Research partner', 'Colleague from the lab'];
  if (/physician|nurse|hospital|trauma|firefighter/i.test(title)) return ['Colleague from the ER', 'Crew chief', 'Former patient'];
  if (/\b(cia|caci|mist)\b|intelligence|foreign service/i.test(title)) return ['Former station chief', 'Asset they recruited', 'Colleague from the agency'];
  return ['Business partner', 'Mentor from their first job'];
}
// No agency printed: the sheet's dropdown, preferring an entry that fits
// the job (the Firefighter's list starts with ATF/CBP/DEA field offices
// but also offers FEMA Urban Search and Rescue); else the agency in the
// title; else the Creator's employer table.
const EMPLOYER_HINTS = [
  [/firefighter/i, /fema|fire|rescue/i], [/pilot|sailor/i, /pilot|air|naval|usaf/i],
  [/physician|nurse|paramedic/i, /medical|health|paramed|cdc|fema/i], [/scientist/i, /research|scien|cdc|darpa|nasa/i],
  [/police/i, /ranger|police|protective/i], [/computer/i, /digital|engineer|technology|research/i],
];
const TITLE_AGENCIES = { ATF: 'Bureau of Alcohol, Tobacco, Firearms and Explosives', CBP: 'Customs and Border Protection',
  DEA: 'Drug Enforcement Administration', FBI: 'FBI', EPA: 'Environmental Protection Agency', NSA: 'National Security Agency' };
function employerFor(r, rec, profile) {
  const opts = rec.employer_options || [];
  if (opts.length) {
    const hint = EMPLOYER_HINTS.filter(h => h[0].test(rec.title))[0];
    const fit = hint ? opts.filter(o => hint[1].test(o)) : [];
    return pick(r, fit.length ? fit : opts);
  }
  const agency = /^([A-Z]{2,5})\b/.exec(rec.title);
  if (agency && TITLE_AGENCIES[agency[1]]) return TITLE_AGENCIES[agency[1]];
  return pick(r, profile.employers);
}
// "Central Intelligence Agency - Special Activities Division" -> "CIA":
// the education line has one short box on the paper form.
const AGENCY_SHORT = {
  'Central Intelligence Agency': 'CIA', 'Bureau of Alcohol, Tobacco, Firearms and Explosives': 'ATF',
  'Drug Enforcement Administration': 'DEA', 'Customs and Border Protection': 'CBP', 'Environmental Protection Agency': 'EPA',
  'National Security Agency': 'NSA', 'Immigrations and Customs Enforcement': 'ICE', 'U.S. Secret Service': 'the Secret Service',
  'U.S. Marshals Service': 'the Marshals', 'U.S. Coast Guard': 'the Coast Guard', 'National Parks Service': 'the Park Service',
  'U.S. Marine Corps': 'the Marines', 'U.S. Army': 'the Army', 'U.S. Navy': 'the Navy', 'U.S. Air Force': 'the Air Force',
};
function agencyShort(employer) {
  let e = String(employer).split(/\s+-\s+|,\s+(?=[A-Z][a-z]+ (?:Directorate|Division|Operations))|\s+\(/)[0].trim();
  e = e.replace(/^ATF\b.*/, 'ATF');
  if (AGENCY_SHORT[e]) return AGENCY_SHORT[e];
  const hit = Object.keys(AGENCY_SHORT).filter(k => e.indexOf(k) === 0)[0];
  if (hit) return AGENCY_SHORT[hit];
  return e.length > 28 ? e.split(/\s+or\s+/)[0] : e;
}
const NEMESES = ['who walked free', 'who knows what they did', 'who vanished with the evidence', 'who got their partner killed'];
const ORGANIZATIONS = ['a private military contractor', 'a doomsday cult', 'a biotech firm with no public address',
  'a cartel that owns a county sheriff', 'a think tank that funds strange research', 'a militia in the hills'];
// The picker's category chips. Order matters: a tactical team inside a
// police agency (FBI HRT, ATF Tactical Operations) plays as special ops.
const GROUPS = [
  ['Medical & Rescue', /hospital corps|nurse|physician|trauma rescue|search and rescue|firefighter/i],
  ['Intelligence', /\b(nsa|caci)\b|sad-pag|intelligence|foreign service/i],
  ['Special Ops & Tactical', /socom - (?!4th)|special operator|sad-sog|force recon|mspf|\b(hrt|fast|srt|sog)\b|counter assault|tactical operations|border tactical|msrt|hitron|taclet/i],
  ['Military', /army|marines|navy|soldier|uscg|socom/i],
  ['Federal Agents & Police', /\b(atf|cbp|dea|usss|ice|fbi)\b|oceft|federal agent|police|marshals/i],
];
function groupFor(title) {
  const g = GROUPS.filter(x => x[1].test(title))[0];
  return g ? g[0] : 'Civilians & Specialists';
}
function isPartner(rel) { return PARTNERS.indexOf(rel) !== -1; }
const LANGUAGES = ['Spanish', 'Arabic', 'French', 'Russian', 'Mandarin', 'Pashto', 'German', 'Portuguese', 'Korean', 'Farsi'];

function pick(r, arr) { return arr[Math.floor(r() * arr.length)]; }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function skillKeyToName(key, skills) {
  const norm = s => s.toLowerCase().replace(/[^a-z]+/g, '_');
  const hit = skills.find(s => norm(s.name) === key) || skills.find(s => norm(s.name).startsWith(key));
  return hit ? hit.name : null;
}

const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
function countWord(w) { return NUMBER_WORDS[String(w).toLowerCase()] || parseInt(w, 10) || 0; }

// What the sheet's notes leave for the player: "Choose N ...: >> Skill X%"
// groups and the number of +20% bonus picks. Returns nothing for a sheet
// whose notes say neither (it's complete as printed).
function parseInstructions(notes) {
  const lines = String(notes || '').split(/\n/).map(l => l.trim());
  const choices = [];
  let bonusPicks = 0;
  for (let i = 0; i < lines.length; i++) {
    const c = /^Choose\s+(?:any\s+)?(\w+)\b(.*)$/i.exec(lines[i]);
    if (c && countWord(c[1])) {
      const options = [];
      for (let k = i + 1; k < lines.length && /^»/.test(lines[k]); k++) {
        const o = /^»\s*(.+?)\s+(\d+)\s*%/.exec(lines[k]);
        if (o) options.push({ name: o[1].trim(), value: parseInt(o[2], 10) });
      }
      if (options.length) choices.push({ count: countWord(c[1]), onlyNew: /already have/i.test(c[2]), options });
    }
    const b = /^Bonus skill points:.*?\bany\s+(\w+)\s+skills?/i.exec(lines[i]);
    if (b) bonusPicks = countWord(b[1]);
  }
  return { choices, bonusPicks };
}

// Specialties for a "(choose one)" option or a blank on the form, by
// what the Agent actually does.
function languagesFor(title) {
  if (/cbp|ice|uscg|dea|police|marshals|atf|fbi|epa/i.test(title)) return ['Spanish', 'Portuguese', 'French', 'Mandarin'];
  if (/nsa|caci/i.test(title)) return ['Russian', 'Mandarin', 'Arabic', 'Korean', 'Farsi'];
  if (/anthropolog|historian/i.test(title)) return ['Latin', 'Ancient Greek', 'Arabic', 'French', 'German'];
  if (/scientist|physician|nurse|program|lawyer|computer|media/i.test(title)) return ['Spanish', 'French', 'German', 'Mandarin'];
  return ['Arabic', 'Russian', 'Pashto', 'Farsi', 'Mandarin', 'French', 'Spanish', 'Korean'];
}
function sciencesFor(title) {
  if (/nsa|computer|caci/i.test(title)) return ['Mathematics', 'Physics', 'Engineering'];
  if (/epa/i.test(title)) return ['Chemistry', 'Biology', 'Geology'];
  if (/ranger/i.test(title)) return ['Biology', 'Geology', 'Botany'];
  if (/physician|nurse|hospital|trauma/i.test(title)) return ['Chemistry', 'Pharmacology', 'Biology'];
  if (/anthropolog|historian/i.test(title)) return ['Geology', 'Biology'];
  return ['Chemistry', 'Physics', 'Biology', 'Geology', 'Astronomy'];
}
function craftsFor(title) {
  if (/eod|explosive|nsa|computer/i.test(title)) return ['Microelectronics', 'Electrician', 'Mechanic'];
  if (/criminal|isa/i.test(title)) return ['Locksmithing', 'Electrician', 'Mechanic'];
  return ['Mechanic', 'Electrician', 'Carpentry', 'Microelectronics'];
}
const MORE_CRAFTS = ['Microelectronics', 'Electrician', 'Mechanic', 'Locksmithing', 'Gunsmithing', 'Carpentry', 'Plumbing'];
function artsFor(title) {
  if (/camera|media/i.test(title)) return ['Photography', 'Creative Writing', 'Videography'];
  if (/mist/i.test(title)) return ['Graphic Design', 'Photography', 'Creative Writing'];
  return ['Creative Writing', 'Photography', 'Painting'];
}
function militaryScienceFor(title) {
  if (/navy|uscg|seal|sailor/i.test(title)) return ['Sea', 'Land'];
  if (/soar|720th|pilot|nasa/i.test(title)) return ['Air', 'Land'];
  return ['Land', 'Sea'];
}
function pilotsFor(title) {
  if (/navy|uscg|seal|raider|sailor|marine interdiction/i.test(title)) return ['Small Boat', 'Helicopter', 'Airplane'];
  if (/soar|hitron/i.test(title)) return ['Helicopter', 'Airplane'];
  return ['Airplane', 'Helicopter', 'Small Boat'];
}
const SPECIALTY_POOLS = {
  'Foreign Language': languagesFor, 'Science': sciencesFor,
  'Craft': title => craftsFor(title).concat(MORE_CRAFTS.filter(c => craftsFor(title).indexOf(c) === -1)),
  'Art': artsFor, 'Military Science': militaryScienceFor, 'Pilot': pilotsFor,
};
// "Language (Spanish)" / "Language" / "Science (   )" / "Pilot ()" ->
// { kind, spec } with spec '' when the form left it blank.
function splitSpecialty(name) {
  const m = /^(Foreign Language|Language|Science|Craft|Art|Military Science|Pilot)\s*(?:\((.*)\))?\s*$/i.exec(String(name).trim());
  if (!m) return null;
  let kind = m[1].toLowerCase() === 'language' ? 'Foreign Language' : m[1].replace(/\b\w/g, ch => ch.toUpperCase()).replace('Of', 'of');
  if (/^military science$/i.test(kind)) kind = 'Military Science';
  if (/^foreign language$/i.test(kind)) kind = 'Foreign Language';
  let spec = (m[2] || '').replace(/_+/g, '').trim();
  if (/^\(?choose (one|another|any)\)?$/i.test(spec)) spec = '';
  return { kind, spec: spec ? cap(spec) : '' };
}
// First specialty from the profession's pool the Agent doesn't have
// yet, or null when every one is taken (the option is then skipped).
function freshSpecialty(r, kind, title, skills) {
  const pool = (SPECIALTY_POOLS[kind] || (() => []))(title);
  const free = pool.filter(sp => !skills.some(s => s.name === kind + ' (' + sp + ')'));
  return free.length ? free[0] : null;
}

// Every skill on the form (base value when blank), specialties and extra
// skills with their blanks filled, then the notes' choices and bonus.
function buildSkills(r, rec, pkgLabel) {
  const title = rec.title;
  const skills = rec.skills.map(s => ({ name: s.name, value: s.value, base: s.base }));
  const filled = [];
  const addSpecial = (raw, value) => {
    const sp = splitSpecialty(raw);
    if (!sp) { skills.push({ name: raw, value, base: 0 }); return; }
    let spec = sp.spec;
    if (!spec) { spec = freshSpecialty(r, sp.kind, title, skills) || 'Other'; filled.push(sp.kind + ' (' + spec + ')'); }
    skills.push({ name: sp.kind + ' (' + spec + ')', value, base: 0 });
  };
  rec.specialties.forEach(s => addSpecial(s.kind + ' (' + (s.name || '') + ')', s.value || 0));
  rec.other_skills.forEach(s => addSpecial(s.name, s.value || 0));

  const get = name => skills.find(s => s.name === name);
  const resolve = name => {
    const sp = splitSpecialty(name);
    if (!sp) return name;
    const spec = sp.spec || freshSpecialty(r, sp.kind, title, skills);
    return spec ? sp.kind + ' (' + spec + ')' : null;
  };

  // A new Agent never has Unnatural. A sheet showing it with SAN max still
  // at 99 (real Unnatural lowers it) is a slip into the neighbouring field
  // -- on the Police Officer sheet the profession's Unarmed Combat 60% sat
  // in Unnatural while Unarmed Combat stayed at base.
  const fixes = [];
  const unnatural = get('Unnatural');
  if (unnatural && unnatural.value > 0 && (rec.derived.san_max == null || rec.derived.san_max === 99)) {
    const unarmed = get('Unarmed Combat');
    if (unarmed && unarmed.value === unarmed.base && unnatural.value > unarmed.value) {
      fixes.push('Unnatural ' + unnatural.value + '% on the sheet is Unarmed Combat');
      unarmed.value = unnatural.value;
    } else {
      fixes.push('Unnatural ' + unnatural.value + '% on the sheet dropped (SAN max is 99)');
    }
    unnatural.value = 0;
  }
  const { choices, bonusPicks } = parseInstructions(rec.notes);

  // "Choose N": the options that raise the Agent most; ties broken by a
  // seeded shuffle so two sheets with the same list don't all match.
  const chosen = [];
  choices.forEach(group => {
    const opts = group.options.map(o => ({ o, k: r() })).sort((a, b) => a.k - b.k).map(x => x.o)
      .map(o => {
        const name = resolve(o.name);
        if (!name) return { skip: true };
        const cur = get(name);
        const have = cur && cur.value > (cur.base || 0);
        return { name, value: o.value, gain: o.value - (cur ? cur.value : 0), skip: group.onlyNew && have };
      })
      .filter(o => !o.skip && o.gain > 0 && !chosen.includes(o.name))
      .sort((a, b) => b.gain - a.gain);
    opts.slice(0, group.count).forEach(o => {
      const cur = get(o.name);
      if (cur) cur.value = o.value; else skills.push({ name: o.name, value: o.value, base: 0 });
      chosen.push(o.name + ' ' + o.value + '%');
    });
  });

  // Bonus: exactly the number of +20% picks the notes allow, one per
  // skill, never past 80 -- profession package first, then the Agent's
  // own strongest skills.
  const bumped = [];
  const bump = name => {
    const cur = get(name);
    if (!cur || name === 'Unnatural' || cur.value >= 80 || bumped.includes(name) || bumped.length >= bonusPicks) return;
    cur.value = Math.min(80, cur.value + 20);
    bumped.push(name);
  };
  if (bonusPicks) {
    const pkg = BONUS_PACKAGES.find(p => p.label === pkgLabel);
    (pkg ? pkg.skills : []).forEach(k => {
      let name = null;
      if (k === '?foreign_language') name = skills.filter(s => /^Foreign Language/.test(s.name) && s.value < 80).map(s => s.name)[0] || null;
      else if (k === '?military_science') name = skills.filter(s => /^Military Science/.test(s.name)).map(s => s.name)[0] || null;
      else if (k === '?art') name = skills.filter(s => /^Art \(/.test(s.name)).map(s => s.name)[0] || null;
      else if (k === '?craft') name = skills.filter(s => /^Craft \(/.test(s.name)).map(s => s.name)[0] || null;
      else if (k === '?anthro_arch') name = 'Anthropology';
      else if (k.charAt(0) === '?') name = null;
      else if (/\(/.test(k)) name = get(k) ? k : null;
      else name = skillKeyToName(k, skills);
      // Only what the Agent is already trained in (30%+): a package's
      // Ride 10 -> 30 is a wasted pick for a Coast Guard rescuer.
      if (name && get(name) && get(name).value >= 30) bump(name);
    });
    skills.filter(s => s.value > 0 && s.value < 80).sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
      .forEach(s => bump(s.name));
  }
  return {
    skills: skills.map(s => ({ name: s.name, value: s.value })),
    report: { filled, chose: chosen, fixes, bonus: { package: pkgLabel || null, picks: bonusPicks, applied: bumped } },
  };
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
  // Across the roster: no first name twice, no surname more than twice
  // -- five "Evans" at one table is confusing. opts.names carries what
  // the Agents built before this one already use.
  const names = opts.names || { first: {}, last: {} };
  let first, last;
  for (let tries = 0; tries < 40; tries++) {
    first = pick(r, bioData.firstNames[nameKey]);
    last = pick(r, bioData.lastNames);
    if (rec.name || (!names.first[first] && (names.last[last] || 0) < 2)) break;
  }
  names.first[first] = (names.first[first] || 0) + 1;
  names.last[last] = (names.last[last] || 0) + 1;
  const mi = String.fromCharCode(65 + Math.floor(r() * 26));
  const name = rec.name || (first + ' ' + mi + '. ' + last);

  const tactical = TACTICAL.test(rec.title);
  const age = tactical ? 27 + Math.floor(r() * 14) : 26 + Math.floor(r() * 30);
  const dob = (1 + Math.floor(r() * 28)) + ' ' + MONTHS[Math.floor(r() * 12)] + ' ' + (REF_YEAR - age);

  const profile = profileFor(rec);
  const years = Math.max(2, Math.min(age - 22, 3 + Math.floor(r() * 14)));
  // The sheet's own agency when it pins one; else one of the agencies its
  // EMPLOYER dropdown offers; else the Creator's employer table.
  const employer = rec.employer || employerFor(r, rec, profile);
  const education = rec.education || (pick(r, profile.educations) + '. ' + years + ' years with ' + agencyShort(employer).replace(/\.$/, '') + '.');

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
  // Family, the people this job puts in your life, and old friends --
  // one partner at most, no relationship twice.
  const usedRel = [];
  const partner = pick(r, PARTNERS);
  const pools = [[partner].concat(FAMILY), workBonds(rec.title), OTHER_BONDS];
  for (let i = 0; i < bondCount; i++) {
    const src = rec.bonds[i] || {};
    let rel = null;
    for (let tries = 0; tries < 40 && !rel; tries++) {
      const roll = r();
      const cand = pick(r, pools[roll < 0.55 ? 0 : roll < 0.8 ? 1 : 2]);
      if (usedRel.indexOf(cand) === -1) rel = cand;
    }
    rel = rel || 'Old friend';
    usedRel.push(rel);
    const relSex = /wife|mother|daughter|sister|grandmother/i.test(rel) ? 'female' : /husband|father|son|brother|priest/i.test(rel) ? 'male' : (r() < 0.5 ? 'male' : 'female');
    const bFirst = pick(r, bioData.firstNames[relSex]);
    const bLast = (FAMILY.indexOf(rel) !== -1 || isPartner(rel)) ? last : pick(r, bioData.lastNames);
    bonds.push({
      name: src.name || (bFirst + ' ' + bLast),
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
      // "Protect a Bond (choose one)", "Never letting a particular Bond
      // down (choose one)": one of this Agent's own Bonds.
      const bondName = pick(r, bonds).name;
      t = t.replace(/\s*\(choose one\)/i, '').replace(/a (particular )?Bond\b/i, bondName);
      // "Protect my family" -> "... from failure"; "Revenge against…" ->
      // "Revenge against the Unnatural". An individual or organization
      // the table leaves to the player gets a name here.
      const object = what => {
        if (/individual/i.test(what)) return pick(r, bioData.firstNames[r() < 0.5 ? 'male' : 'female']) + ' ' + pick(r, bioData.lastNames) + ', ' + pick(r, NEMESES);
        if (/organization/i.test(what)) return pick(r, ORGANIZATIONS);
        return what.charAt(0).toLowerCase() + what.slice(1);
      };
      if (c === 'Protection') t += ' from ' + object(pick(r, motivationsData.protectionObjects.filter(o => !/future/i.test(o))));
      if (c === 'Opposition') t = t.replace(/\s*(…|\.\.\.)\s*$/, '') + ' ' + object(pick(r, motivationsData.oppositionObjects));
      motivations.push(t);
    }
  }

  const built = buildSkills(r, rec, cat.bonus);
  const skills = built.skills;
  skills.sort((a, b) => a.name.localeCompare(b.name));

  return {
    id: rec.id,
    title: rec.title,
    group: groupFor(rec.title),
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
    // What was the player's to decide, and what this build decided --
    // skill names only, nothing from the sheet's own prose.
    generated: rec.missing,
    filled: built.report.filled,
    chose: built.report.chose,
    fixes: built.report.fixes,
    bonus: built.report.bonus,
    hp_rule: Math.ceil((stats.STR.value + stats.CON.value) / 2),
  };
}

function main() {
  const args = process.argv.slice(2);
  if (!args[0]) { console.error('usage: build.js pregens-raw.json [-o out.json] [--report report.md]'); process.exit(2); }
  const opt = (flag, dflt) => { const i = args.indexOf(flag); return i === -1 ? dflt : args[i + 1]; };
  const out = opt('-o', path.join(ROOT, 'friendly', 'pregens.json'));
  const report = opt('--report', null);
  const raw = JSON.parse(fs.readFileSync(args[0], 'utf8'));
  // Built in catalog.json order, so name de-duplication is stable: a sheet
  // added later (appended to the catalog) can't rename an earlier Agent.
  const order = Object.keys(catalog);
  const rank = t => (order.indexOf(t) === -1 ? 1e6 : order.indexOf(t));
  const names = { first: {}, last: {} };
  const pregens = raw.slice().sort((a, b) => rank(a.title) - rank(b.title) || a.title.localeCompare(b.title))
    .map(rec => build(rec, { names })).sort((a, b) => a.title.localeCompare(b.title));
  const have = new Set(pregens.map(p => p.title));
  const pending = Object.keys(catalog).filter(t => !have.has(t)).sort();
  // One pregen per line: small to download, still diffable.
  fs.writeFileSync(out, '{"version":1,"pending":' + JSON.stringify(pending) + ',"pregens":[\n' +
    pregens.map(p => JSON.stringify(p)).join(',\n') + '\n]}\n');
  console.log(pregens.length + ' pregens, ' + pending.length + ' pending -> ' + out);

  if (report) {
    const lines = ['# Friendly pregens: what each sheet was missing', '',
      '| Sheet | Agent | Blanks filled | "Choose N" taken | Bonus +20% | Check |', '|---|---|---|---|---|---|'];
    pregens.forEach(p => {
      const b = p.bonus;
      const bonusCell = !b.picks ? 'none (complete as printed)'
        : b.applied.length + '/' + b.picks + ' (' + (b.package || 'own skills') + '): ' + b.applied.join(', ');
      const check = [p.derived.hp !== p.hp_rule ? 'sheet HP ' + p.derived.hp + ', rule gives ' + p.hp_rule + ' (kept sheet)' : '']
        .concat(p.fixes).filter(Boolean).join('; ');
      lines.push('| ' + [p.title, p.name + ', ' + p.sex + ', ' + p.age, p.filled.join(', ') || '-',
        p.chose.join(', ') || '-', bonusCell, check].join(' | ') + ' |');
    });
    lines.push('', 'Every sheet also got: name, sex, age/DOB, nationality, education (unless printed), physical description, ' +
      'distinguishing features (unless printed), Bond names and relationships, three Motivations.');
    if (pending.length) lines.push('', 'Still to extract (' + pending.length + '): ' + pending.join('; '));
    fs.writeFileSync(report, lines.join('\n') + '\n');
  }
}

if (require.main === module) main();
module.exports = { build, gearItems, rng };
