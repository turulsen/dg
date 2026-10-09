/* The Agent File's rules, with no page code: derived values, the skill
   list, failed-roll marks and the end-of-session improvement, SAN loss
   and what it sets off, adaptation, Bonds, Motivations, Mental Disorders.
   Everything works on the character sheet's saved state (v1, the
   `character_json` in characters/{code}), changing it in place, so the
   Agent File, A-Cell and Friendly keep reading the same shape.

   Dice: functions that need a roll take a `roll(expr, label)` returning
   a Promise of the total (the Agent File passes the Dice Roller's, so it
   shows in the history); the default rolls locally.

   Rules are as written in the Handler's Guide / Agent's Handbook; the
   wording in the app stays our own (the site is public).

   window.dgRules */
(function () {
  'use strict';
  if (window.dgRules) return;

  var STATS = ['STR', 'CON', 'DEX', 'INT', 'POW', 'CHA'];
  // Same keys as the character sheet (stats/scripts.js CONFIG.SKILLS),
  // `heavy_machiner` included: saved Agents use these keys.
  var SKILLS = [
    ['accounting', 'Accounting', 10], ['alertness', 'Alertness', 20], ['anthropology', 'Anthropology', 0],
    ['archeology', 'Archeology', 0], ['art', 'Art', 0, true], ['artillery', 'Artillery', 0],
    ['athletics', 'Athletics', 30], ['bureaucracy', 'Bureaucracy', 10], ['computer_science', 'Computer Science', 0],
    ['craft', 'Craft', 0, true], ['criminology', 'Criminology', 10], ['demolitions', 'Demolitions', 0],
    ['disguise', 'Disguise', 10], ['dodge', 'Dodge', 30], ['drive', 'Drive', 20], ['firearms', 'Firearms', 20],
    ['first_aid', 'First Aid', 10], ['forensics', 'Forensics', 0], ['heavy_machiner', 'Heavy Machinery', 10],
    ['heavy_weapons', 'Heavy Weapons', 0], ['history', 'History', 10], ['humint', 'HUMINT', 10], ['law', 'Law', 0],
    ['medicine', 'Medicine', 0], ['melee_weapons', 'Melee Weapons', 30], ['military_science', 'Military Science', 0, true],
    ['navigate', 'Navigate', 10], ['occult', 'Occult', 10], ['persuade', 'Persuade', 20], ['pharmacy', 'Pharmacy', 0],
    ['pilot', 'Pilot', 0, true], ['psychotherapy', 'Psychotherapy', 10], ['ride', 'Ride', 10], ['science', 'Science', 0, true],
    ['search', 'Search', 20], ['sigint', 'SIGINT', 0], ['stealth', 'Stealth', 10], ['surgery', 'Surgery', 0],
    ['survival', 'Survival', 10], ['swim', 'Swim', 20], ['unarmed_combat', 'Unarmed Combat', 40], ['unnatural', 'Unnatural', 0]
  ];
  // Specialties: suggestions only, any name may be written in.
  var SPECIALTY_OPTIONS = {
    art: ['Acting', 'Creative Writing', 'Forgery', 'Journalism', 'Painting', 'Photography', 'Scriptwriting', 'Illustration'],
    craft: ['Architect', 'Carpenter', 'Electrician', 'Gunsmith', 'Locksmith', 'Mechanic', 'Microelectronics', 'Plumber', 'Machinist', 'Welder'],
    foreign_language: ['Arabic', 'Chinese', 'French', 'German', 'Japanese', 'Korean', 'Persian', 'Russian', 'Spanish'],
    military_science: ['Land', 'Sea', 'Air'],
    pilot: ['Airplane', 'Helicopter', 'Boat', 'Drone', 'Small Craft'],
    science: ['Biology', 'Chemistry', 'Engineering', 'Geology', 'Mathematics', 'Physics']
  };
  var SPEC_LABEL = { art: 'Art', craft: 'Craft', foreign_language: 'Foreign Language', military_science: 'Military Science', pilot: 'Pilot', science: 'Science' };
  var LABEL = {}; SKILLS.forEach(function (s) { LABEL[s[0]] = s[1]; });
  var KINDS = ['violence', 'helplessness', 'unnatural'];

  function num(v, d) { v = parseInt(v, 10); return isNaN(v) ? (d == null ? 0 : d) : v; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function uid() { return 'x' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }
  function localRoll(expr) {
    var m = /^(\d*)d(\d+)$/i.exec(String(expr).trim());
    if (!m) return Promise.resolve(num(expr));
    var n = num(m[1], 1) || 1, t = 0;
    for (var i = 0; i < n; i++) t += Math.floor(Math.random() * num(m[2])) + 1;
    return Promise.resolve(t);
  }

  /* ── Statistics and derived values ── */
  function stats(state) {
    var src = state.csStats || state.stats || {}, out = {};
    STATS.forEach(function (k) { out[k] = num(src[k], 0); });
    return out;
  }
  function setStat(state, k, v) {
    v = clamp(num(v, 0), 0, 30);
    state.stats = state.stats || {}; state.csStats = state.csStats || {};
    state.stats[k] = v; state.csStats[k] = v;
  }
  // Maximums from the statistics. SAN's starting maximum is POW×5; SAN can
  // be restored up to 99 − Unnatural.
  function maxes(state) {
    var s = stats(state);
    return { hp: Math.ceil((s.STR + s.CON) / 2), wp: s.POW, san: s.POW * 5, sanCap: 99 - skillValue(state, 'key:unnatural') };
  }
  function derived(state) {
    state.derived = state.derived || {};
    var d = state.derived, m = maxes(state);
    if (d.hp == null || d.hp === '') d.hp = m.hp;
    if (d.wp == null || d.wp === '') d.wp = m.wp;
    if (d.san == null || d.san === '') d.san = m.san;
    if (d.bp == null || d.bp === '') d.bp = num(d.san) - stats(state).POW;
    ['hp', 'wp', 'san', 'bp'].forEach(function (k) { d[k] = num(d[k]); });
    return d;
  }
  // − / + on HP, WP and SAN: never below 0, never above the maximum.
  function adjust(state, which, delta) {
    var d = derived(state), m = maxes(state);
    var hi = which === 'san' ? Math.max(m.sanCap, d.san) : Math.max(m[which], d[which]);
    d[which] = clamp(d[which] + delta, 0, hi);
    return d[which];
  }
  // Breaking Point: SAN − POW, stepped by POW in Edit mode.
  function stepBp(state, dir) { var d = derived(state); d.bp = Math.max(0, d.bp + dir * Math.max(1, stats(state).POW)); return d.bp; }
  function resetBp(state) { var d = derived(state); d.bp = Math.max(0, d.san - stats(state).POW); return d.bp; }

  /* ── Skills ── */
  // One flat list: base skills, specialties, the sheet's custom and
  // Live Play rows. id: 'key:<k>' | 'spec:<id>' | 'cust:<i>' | 'lpc:<i>'.
  function skillList(state, opts) {
    var all = opts && opts.all, out = [];
    var sk = state.skills || {}, specs = state.skillSpecs || {};
    SKILLS.forEach(function (s) {
      if (s[3]) return;
      var v = sk[s[0]] == null ? s[2] : num(sk[s[0]]);
      out.push({ id: 'key:' + s[0], key: s[0], label: s[1] + (specs[s[0]] ? ' (' + specs[s[0]] + ')' : ''), value: v, kind: 'base' });
    });
    (state.specialtyInstances || []).forEach(function (i) {
      if (!i) return;
      out.push({ id: 'spec:' + i.id, key: i.key, specialty: i.specialty || '', label: (SPEC_LABEL[i.key] || LABEL[i.key] || i.key) + (i.specialty ? ' (' + i.specialty + ')' : ''), value: num(i.value), kind: 'spec' });
    });
    // Older sheets kept a specialty skill's value under its key.
    Object.keys(SPEC_LABEL).forEach(function (k) {
      if (sk[k] != null && num(sk[k]) > 0 && !(state.specialtyInstances || []).some(function (i) { return i && i.key === k; })) {
        out.push({ id: 'key:' + k, key: k, label: SPEC_LABEL[k] + (specs[k] ? ' (' + specs[k] + ')' : ''), value: num(sk[k]), kind: 'base' });
      }
    });
    (state.customSkills || []).forEach(function (c, i) {
      if (c && c.name) out.push({ id: 'cust:' + i, label: c.name, value: num(c.value), kind: 'custom' });
    });
    (state.lpCustomSkills || []).forEach(function (c, i) {
      if (c && c.name) out.push({ id: 'lpc:' + i, label: c.name, value: num(c.val), kind: 'lpcustom' });
    });
    out.forEach(function (s) { s.marked = isMarked(state, s); });
    out.sort(function (a, b) { return a.label.localeCompare(b.label); });
    return all ? out : out.filter(function (s) { return s.value > 0 || s.marked; });
  }
  function findSkill(state, id) { return skillList(state, { all: true }).filter(function (s) { return s.id === id; })[0] || null; }
  function skillValue(state, id) { var s = findSkill(state, id); return s ? s.value : 0; }
  function setSkillValue(state, id, v) {
    v = clamp(num(v, 0), 0, 99);
    var p = id.split(':'), t = p[0], k = p.slice(1).join(':');
    if (t === 'key') { state.skills = state.skills || {}; state.skills[k] = v; }
    else if (t === 'spec') (state.specialtyInstances || []).forEach(function (i) { if (i && String(i.id) === k) i.value = v; });
    else if (t === 'cust') { if (state.customSkills && state.customSkills[+k]) state.customSkills[+k].value = v; }
    else if (t === 'lpc') { if (state.lpCustomSkills && state.lpCustomSkills[+k]) state.lpCustomSkills[+k].val = String(v); }
  }
  function setSpecialty(state, id, name) {
    var k = id.split(':')[1];
    (state.specialtyInstances || []).forEach(function (i) { if (i && String(i.id) === k) i.specialty = String(name || '').trim() || null; });
  }
  function addSpecialty(state, key, specialty, value) {
    state.specialtyInstances = state.specialtyInstances || [];
    var inst = { id: uid(), key: key, specialty: String(specialty || '').trim() || null, value: clamp(num(value, 0), 0, 99), source: 'manual' };
    state.specialtyInstances.push(inst);
    return 'spec:' + inst.id;
  }
  function addOwnSkill(state, name, value) {
    state.customSkills = state.customSkills || [];
    state.customSkills.push({ fromProfession: false, name: String(name).trim(), value: clamp(num(value, 0), 0, 99) });
    return 'cust:' + (state.customSkills.length - 1);
  }
  function removeSkill(state, id) {
    var p = id.split(':'), t = p[0], k = p.slice(1).join(':');
    var s = findSkill(state, id);
    if (s && s.marked) toggleMark(state, s);
    if (t === 'spec') state.specialtyInstances = (state.specialtyInstances || []).filter(function (i) { return !i || String(i.id) !== k; });
    else if (t === 'cust') state.customSkills.splice(+k, 1);
    else if (t === 'lpc') state.lpCustomSkills.splice(+k, 1);
  }
  // Failed-roll marks, kept where the old sheet kept them (lpCheckedSkills).
  function markRef(s) { return s.kind === 'base' ? { type: 'key', key: s.key } : { type: 'name', name: s.label }; }
  function isMarked(state, s) {
    return (state.lpCheckedSkills || []).some(function (m) {
      return m && (m.type === 'key' ? s.kind === 'base' && m.key === s.key : m.name === s.label);
    });
  }
  function setMark(state, s, on) {
    var ref = markRef(s);
    state.lpCheckedSkills = (state.lpCheckedSkills || []).filter(function (m) {
      return !(m && (ref.type === 'key' ? m.type === 'key' && m.key === ref.key : m.type !== 'key' && m.name === ref.name));
    });
    if (on) state.lpCheckedSkills.push(ref);
  }
  function toggleMark(state, s) { setMark(state, s, !isMarked(state, s)); }
  // A failed roll marks a skill the Agent has at least 1% in -- never
  // Unnatural, which doesn't improve that way.
  function canMark(s) { return s && s.value >= 1 && s.key !== 'unnatural'; }
  function markFailed(state, id) { var s = findSkill(state, id); if (canMark(s) && !s.marked) { setMark(state, s, true); return true; } return false; }
  // End of session: +1D4 to each marked skill, then the marks are erased.
  function improve(state, roll) {
    roll = roll || localRoll;
    var marked = skillList(state, { all: true }).filter(function (s) { return s.marked; });
    var out = [];
    return marked.reduce(function (p, s) {
      return p.then(function () { return roll('1d4', s.label + ' improvement'); }).then(function (n) {
        var to = clamp(s.value + num(n, 1), 0, 99);
        setSkillValue(state, s.id, to);
        out.push({ label: s.label, from: s.value, to: to, gain: num(n, 1) });
      });
    }, Promise.resolve()).then(function () { state.lpCheckedSkills = []; return out; });
  }

  /* ── Sanity ── */
  function sanity(state) {
    state.sanity = state.sanity || {};
    ['violence', 'helplessness'].forEach(function (k) {
      var a = state.sanity[k] || [];
      state.sanity[k] = [!!a[0], !!a[1], !!a[2]];
    });
    state.adapted = state.adapted || {};
    return state.sanity;
  }
  function triggersOnLoss(name) {
    var D = window.dgDisorders, d = D && D.find(name);
    return !!(d && /losing 2\+ san/i.test(d.trigger));
  }
  // Apply a SAN loss the Handler announced. Returns what it set off, in
  // order, for the post-its:
  //   {type:'disorder', names:[…]}  loss ≥ 2 and a disorder that triggers on it
  //   {type:'insanity'}             loss ≥ 5 at once: temporary insanity
  //   {type:'breaking'}             SAN fell to the Breaking Point or below
  //   {type:'zero'}                 SAN 0: permanently insane
  //   {type:'incident', kind, count, adapted}  a Violence/Helplessness
  //                                 loss without insanity ticks a box
  function sanLoss(state, amount, kind) {
    amount = Math.max(0, num(amount));
    var d = derived(state), before = d.san, events = [];
    d.san = Math.max(0, d.san - amount);
    var dis = (state.bio && state.bio.disorders) || [];
    var triggered = amount >= 2 ? dis.filter(triggersOnLoss) : [];
    var insane = amount >= 5;
    var sa = sanity(state);
    state.sanLog = state.sanLog || [];
    state.sanLog.push({ at: new Date().toISOString(), loss: amount, kind: kind || '', san: d.san, triggered: triggered, insanity: insane });
    if (state.sanLog.length > 200) state.sanLog = state.sanLog.slice(-200);
    if (triggered.length) events.push({ type: 'disorder', names: triggered, loss: amount, kind: kind });
    if (insane) {
      events.push({ type: 'insanity', loss: amount, kind: kind });
      // Going insane from a kind of trauma undoes progress toward adapting to it.
      if (sa[kind] && !state.adapted[kind]) sa[kind] = [false, false, false];
    }
    if (before > d.bp && d.san <= d.bp && d.san > 0) events.push({ type: 'breaking', san: d.san, bp: d.bp });
    if (before > 0 && d.san === 0) events.push({ type: 'zero' });
    if (!insane && amount > 0 && sa[kind] && !state.adapted[kind]) {
      var inc = tickIncident(state, kind);
      events.push({ type: 'incident', kind: kind, count: inc.count, adapted: inc.adapted });
    }
    return { san: d.san, events: events };
  }
  // One more incident box ticked; the third makes the Agent adapted.
  function tickIncident(state, kind) {
    var sa = sanity(state), a = sa[kind];
    if (!a) return { count: 0, adapted: false };
    var i = a.indexOf(false);
    if (i !== -1) a[i] = true;
    var count = a.filter(Boolean).length;
    return { count: count, adapted: count === 3 && !state.adapted[kind] };
  }
  // The cost of adapting: Violence takes 1D6 from CHA and the same from
  // every Bond; Helplessness takes 1D6 from POW.
  function adapt(state, kind, roll) {
    roll = roll || localRoll;
    return roll('1d6', 'Adapted to ' + kind).then(function (n) {
      n = num(n, 1);
      var s = stats(state);
      if (kind === 'violence') {
        setStat(state, 'CHA', Math.max(0, s.CHA - n));
        (state.bonds || []).forEach(function (b) { if (b) b.score = Math.max(0, num(b.score) - n); });
      } else if (kind === 'helplessness') {
        setStat(state, 'POW', Math.max(0, s.POW - n));
      }
      state.adapted = state.adapted || {}; state.adapted[kind] = true;
      return n;
    });
  }
  // Projection: 1D4 off WP and a Bond, for a SAN test to resist.
  function project(state, bondIndex, roll) {
    roll = roll || localRoll;
    return roll('1d4', 'Projection').then(function (n) {
      n = num(n, 1);
      var d = derived(state);
      d.wp = Math.max(0, d.wp - n);
      var b = (state.bonds || [])[bondIndex];
      if (b) b.score = Math.max(0, num(b.score) - n);
      return n;
    });
  }

  /* ── Bonds, Motivations, Mental Disorders ── */
  function addBond(state, name, relationship) {
    state.bonds = state.bonds || [];
    var b = { id: uid(), name: String(name || '').trim(), relationship: String(relationship || '').trim(), description: '', score: stats(state).CHA || 10 };
    state.bonds.push(b);
    return b;
  }
  function motivations(state) {
    return String((state.bio && state.bio.motivations) || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
  }
  function setMotivations(state, list) {
    state.bio = state.bio || {};
    state.bio.motivations = list.map(function (s) { return String(s).trim(); }).filter(Boolean).join('\n');
  }
  function addMotivation(state, text) { var l = motivations(state); l.push(text); setMotivations(state, l); }
  // Each Breaking Point crosses off one Motivation (Agent's Handbook): it
  // stays on the sheet, struck through, in bio.motivationsCrossed.
  function crossedMotivations(state) { return ((state.bio && state.bio.motivationsCrossed) || []).slice(); }
  function crossOffMotivation(state, text) {
    state.bio = state.bio || {};
    var c = crossedMotivations(state);
    if (text && c.indexOf(text) === -1) c.push(text);
    state.bio.motivationsCrossed = c;
  }
  // A Motivation from the Briefing Documents' tables (stats/bio.js).
  function rollMotivation() {
    var M = window.motivationsData || (typeof motivationsData !== 'undefined' ? motivationsData : null); // eslint-disable-line no-undef
    if (!M) return '';
    var d = function (n) { return Math.floor(Math.random() * n) + 1; };
    var cat = M.categoryByD12[d(12) - 1], text = cat + ': ' + M.tables[cat][d(10) - 1];
    if (cat === 'Protection') text += ' — from: ' + M.protectionObjects[d(8) - 1];
    else if (cat === 'Opposition') text += ' — ' + M.oppositionObjects[d(8) - 1];
    return text;
  }
  function disorders(state) {
    var b = state.bio || {};
    if (Array.isArray(b.disorders)) return b.disorders.slice();
    // Older sheets kept them in the Motivations text.
    return window.dgDisorders ? window.dgDisorders.splitText(b.motivations || '').disorders : [];
  }
  // Older sheets: move disorder lines out of the Motivations text, once.
  function normalizeBio(state) {
    state.bio = state.bio || {};
    if (!Array.isArray(state.bio.disorders) && window.dgDisorders) {
      var sp = window.dgDisorders.splitText(state.bio.motivations || '');
      state.bio.motivations = sp.motivations; state.bio.disorders = sp.disorders;
    }
    return state;
  }
  function addDisorder(state, name) {
    normalizeBio(state);
    var D = window.dgDisorders, k = D && D.find(name);
    state.bio.disorders.push(k ? k.name : String(name).trim());
  }

  window.dgRules = {
    crossedMotivations: crossedMotivations, crossOffMotivation: crossOffMotivation,
    STATS: STATS, SKILLS: SKILLS, SPECIALTY_OPTIONS: SPECIALTY_OPTIONS, SPEC_LABEL: SPEC_LABEL, KINDS: KINDS,
    num: num, stats: stats, setStat: setStat, maxes: maxes, derived: derived, adjust: adjust, stepBp: stepBp, resetBp: resetBp,
    skillList: skillList, findSkill: findSkill, setSkillValue: setSkillValue, setSpecialty: setSpecialty, addSpecialty: addSpecialty,
    addOwnSkill: addOwnSkill, removeSkill: removeSkill, toggleMark: toggleMark, canMark: canMark, markFailed: markFailed, improve: improve,
    sanity: sanity, sanLoss: sanLoss, tickIncident: tickIncident, adapt: adapt, project: project,
    addBond: addBond, motivations: motivations, setMotivations: setMotivations, addMotivation: addMotivation, rollMotivation: rollMotivation,
    disorders: disorders, normalizeBio: normalizeBio, addDisorder: addDisorder, localRoll: localRoll
  };
})();
