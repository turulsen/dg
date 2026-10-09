/* Bringing an Agent in: one reader for every file the New Recruit
   wizard's drop zone takes (assets/recruit-wizard.js, step 0). Each
   format becomes the character sheet's own saved state (v1, the
   character_json shape), which the wizard then walks through from
   Personal data on.

     Foundry VTT actor (.json)        foundryToState()
     Kappa Black (.toml, or its .json, a Foundry actor)
     this site's own save (.json, v1 state)
     the printable sheet (.html, its embedded state)
     DD Form 315 (.pdf)               stats/pdf-export.js's reader
     the Google Sheets template (.xlsx) stats/sheets-import.js's reader

   The PDF and spreadsheet readers are the old sheet's own; they hand
   their result to window.dgSaveLoad.applyState(), so here that is
   briefly a catcher instead of the sheet's form.

   window.dgAgentImport = { read(file) -> Promise<{ state, from, label }>,
                            readText(text), foundryToState(data) } */
(function () {
  'use strict';
  if (window.dgAgentImport) return;

  var ROOT = (function () {
    var s = document.currentScript;
    return s && s.src ? s.src.replace(/assets\/agent-import\.js.*$/, '') : '';
  })();
  var STATS = ['STR', 'CON', 'DEX', 'INT', 'POW', 'CHA'];
  function R() { return window.dgRules; }
  function num(v, d) { v = parseInt(v, 10); return isNaN(v) ? (d == null ? 0 : d) : v; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function strip(html) { return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }
  function loadScript(path, test) {
    if (test()) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = ROOT + path;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('Could not load ' + path)); };
      document.head.appendChild(s);
    });
  }
  function PROF() { try { return typeof professions !== 'undefined' ? professions : null; } catch (e) { return null; } } // eslint-disable-line no-undef

  /* ── Names to keys ── */
  function skillKey(label) {
    var l = String(label || '').trim().toLowerCase();
    if (l === 'driving') return 'drive';
    var S = R().SKILLS;
    for (var i = 0; i < S.length; i++) if (S[i][1].toLowerCase() === l || S[i][0] === l) return S[i][0];
    return null;
  }
  function specKey(label) {
    var L = R().SPEC_LABEL, l = String(label || '').trim().toLowerCase();
    for (var k in L) if (L[k].toLowerCase() === l || k === l) return k;
    return null;
  }
  // A profession written out ("Pilot", "Federal Agent", "Marine
  // Interdiction Agent") -> its key; anything else is kept as written.
  function professionKey(text) {
    var t = String(text || '').trim().toLowerCase();
    if (!t) return '';
    var P = PROF() || {};
    if (P[t]) return t;
    var keys = Object.keys(P), k;
    for (var i = 0; i < keys.length; i++) {
      k = keys[i];
      var title = String(P[k].title || '').toLowerCase();
      if (title === t || title.split(/\s+or\s+/).some(function (x) { return x.trim() === t; })) return k;
    }
    var C = window.dgRecruitData ? window.dgRecruitData.COMPLEX : [];
    for (var j = 0; j < C.length; j++) if (C[j].title.toLowerCase() === t || C[j].key === t) return C[j].key;
    return String(text).trim();
  }
  function emptyState() {
    return {
      v: 1, stats: {}, csStats: {}, derived: {}, lpFeat: {}, skills: {}, skillSpecs: {}, customSkills: [], specialtyInstances: [],
      bonds: [], bio: {}, equipment: [], lpWeapons: [], lpNotes: { wounds: '', gear: '', remarks: '' },
      sanity: { violence: [false, false, false], helplessness: [false, false, false] }, adapted: {},
      lpCheckedSkills: [], lpCustomSkills: [], professionSkillsApplied: true, creationCommitted: false
    };
  }

  /* ── Foundry VTT actor (and Kappa Black, converted to one) ── */
  function foundryToState(data) {
    if (!data || typeof data !== 'object' || !(data.system || data.data)) throw new Error('Not a Foundry VTT Agent (no system data).');
    var sys = data.system || data.data, st = emptyState(), stat = sys.statistics || {};
    STATS.forEach(function (k) {
      var x = stat[k.toLowerCase()] || {};
      var v = clamp(num(x.value, 10), 3, 18);
      st.stats[k] = v; st.csStats[k] = v;
      if (x.distinguishing_feature) st.lpFeat[k] = String(x.distinguishing_feature);
    });
    var san = num(sys.sanity && sys.sanity.value, st.stats.POW * 5);
    var bp = num(sys.sanity && sys.sanity.currentBreakingPoint, 0);
    st.derived = {
      hp: num(sys.health && (sys.health.value != null ? sys.health.value : sys.health.max), Math.ceil((st.stats.STR + st.stats.CON) / 2)),
      wp: num(sys.wp && (sys.wp.value != null ? sys.wp.value : sys.wp.max), st.stats.POW),
      san: san, bp: bp > 0 ? bp : Math.max(0, san - st.stats.POW)
    };
    Object.keys(sys.skills || {}).forEach(function (k) {
      var x = sys.skills[k] || {}, key = skillKey(k) || (R().SKILLS.some(function (s) { return s[0] === k; }) ? k : null);
      if (key) st.skills[key] = num(x.proficiency != null ? x.proficiency : x.value, 0);
    });
    var n = 0;
    Object.keys(sys.typedSkills || {}).forEach(function (id) {
      var t = sys.typedSkills[id] || {}, val = num(t.proficiency != null ? t.proficiency : t.value, 0);
      var sk = specKey(t.group);
      if (sk) st.specialtyInstances.push({ id: 'im-' + sk + '-' + (n++), key: sk, specialty: String(t.label || ''), value: val, source: 'import' });
      else if (t.label) st.customSkills.push({ name: (t.group && t.group !== 'Other' ? t.group + ' (' + t.label + ')' : String(t.label)), value: val });
    });
    var bio = sys.biography || {};
    st.bio = {
      name: String(data.name || ''), profession: professionKey(bio.profession), employer: bio.employer || '', nationality: bio.nationality || '',
      sex: bio.sex || '', age: String(bio.age || ''), education: bio.education || '',
      physicalDesc: sys.physicalDescription || (sys.physical && sys.physical.description) || '',
      personalDetails: strip(bio.notes || ''), motivations: '', disorders: [], motivationsCrossed: []
    };
    if (sys.physical && sys.physical.wounds) st.lpNotes.wounds = strip(sys.physical.wounds);
    var items = data.items || [];
    var mots = items.filter(function (i) { return i.type === 'motivation'; });
    var ml = [], dl = [];
    mots.forEach(function (i) {
      var s = i.system || {};
      if (s.disorder) dl.push(String(s.disorder).trim());
      if (!(s.disorder && s.crossedOut) && i.name && i.name !== 'Mental disorder') ml.push(String(i.name));
    });
    var motText = ml.length ? ml.join('\n') : String(bio.motivations || '');
    if (window.dgDisorders) { var sp = window.dgDisorders.splitText(motText); motText = sp.motivations; dl = dl.concat(sp.disorders); }
    st.bio.motivations = motText; st.bio.disorders = dl.filter(Boolean);
    var ad = (sys.sanity && sys.sanity.adaptations) || {};
    ['violence', 'helplessness'].forEach(function (k) {
      var a = ad[k] || {};
      st.sanity[k] = [!!a.incident1, !!a.incident2, !!a.incident3];
    });
    items.filter(function (i) { return i.type === 'bond'; }).forEach(function (i, j) {
      var s = i.system || {};
      st.bonds.push({ id: 'bond-im-' + j, name: String(i.name || ''), relationship: s.relationship || '', description: strip(s.description), score: num(s.score, st.stats.CHA) });
    });
    items.filter(function (i) { return i.type === 'weapon'; }).forEach(function (i) {
      var s = i.system || {}, key = skillKey(s.skill) || s.skill;
      var pct = num(s.customSkillTarget, 0) || num(st.skills[key], 0) || num(String(s.skill || '').replace(/\D/g, ''), 0);
      st.lpWeapons.push({ name: String(i.name || 'Weapon'), skillPct: pct ? String(pct) : '', range: s.range || '', damage: s.isLethal ? '' : (s.damage || ''),
        lethality: s.lethality ? String(s.lethality) : '', ammo: s.ammo != null ? String(s.ammo) : '', fromEquip: false });
    });
    items.filter(function (i) { return i.type === 'armor' || i.type === 'gear' || i.type === 'item'; }).forEach(function (i) {
      if (i.name === "Agent's Gear") { st.lpNotes.gear = strip(i.system && i.system.description); return; }
      var cat = window.DG_EQUIPMENT_CATALOG || [];
      st.equipment.push(cat.some(function (c) { return c.name === i.name; }) ? i.name : { isCustom: true, name: String(i.name || '') });
    });
    return st;
  }

  /* ── Kappa Black (.toml) ── */
  function tomlValue(raw) {
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    if (raw.charAt(0) === '"' && raw.charAt(raw.length - 1) === '"' && raw.length >= 2) { try { return JSON.parse(raw); } catch (e) { return raw.slice(1, -1); } }
    if (raw !== '' && !isNaN(Number(raw))) return Number(raw);
    return raw;
  }
  function parseToml(text) {
    var root = {}, cur = root;
    String(text).split(/\r?\n/).forEach(function (raw) {
      var line = raw.trim(), m;
      if (!line || line.charAt(0) === '#') return;
      if ((m = /^\[\[([^\]]+)\]\]$/.exec(line))) { var n = m[1].trim(); if (!Array.isArray(root[n])) root[n] = []; cur = {}; root[n].push(cur); return; }
      if ((m = /^\[([^\]]+)\]$/.exec(line))) { var t = m[1].trim(); cur = root[t] && typeof root[t] === 'object' && !Array.isArray(root[t]) ? root[t] : {}; root[t] = cur; return; }
      var eq = line.indexOf('=');
      if (eq === -1) return;
      cur[line.slice(0, eq).trim()] = tomlValue(line.slice(eq + 1).trim());
    });
    return root;
  }
  var KB_STATS = { strength: 'str', constitution: 'con', dexterity: 'dex', intelligence: 'int', power: 'pow', charisma: 'cha' };
  function kbCount(c) { var n = clamp(num(c, 0), 0, 3); return { incident1: n >= 1, incident2: n >= 2, incident3: n >= 3 }; }
  function kappaToFoundry(t) {
    var statistics = {}, skills = {}, typed = {}, items = [];
    Object.keys(KB_STATS).forEach(function (s) { if (t[s] && t[s].score != null) statistics[KB_STATS[s]] = { value: t[s].score, distinguishing_feature: t[s].feature || '' }; });
    (t.skills || []).forEach(function (e, i) {
      if (!e.skill) return;
      if (e.type) { typed['kb-' + i] = { group: e.skill, label: e.type, proficiency: e.score || 0 }; return; }
      var k = skillKey(e.skill);
      if (k) skills[k] = { proficiency: e.score || 0 }; else typed['kb-' + i] = { group: 'Other', label: e.skill, proficiency: e.score || 0 };
    });
    (t.bonds || []).forEach(function (b, i) { items.push({ type: 'bond', name: b.bond || 'Bond ' + (i + 1), system: { relationship: '', description: '', score: b.score != null ? b.score : 10 } }); });
    (t.weapons || []).forEach(function (w) { items.push({ type: 'weapon', name: w.weapon || 'Weapon', system: { damage: w.damage || '', skill: w.skill || '' } }); });
    String(t.motivationsAndDisorders || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (l) { items.push({ type: 'motivation', name: l, system: {} }); });
    if (t.gear) items.push({ type: 'gear', name: "Agent's Gear", system: { description: String(t.gear) } });
    var training = (t.specialTraining || []).filter(function (s) { return s.training; }).map(function (s) { return 'Special training: ' + s.training + (s.skillOrStat ? ' (' + String(s.skillOrStat).trim() + ')' : ''); });
    return {
      name: t.name || '', items: items,
      system: {
        statistics: statistics, skills: skills, typedSkills: typed,
        biography: { profession: t.profession || '', employer: t.employer || '', nationality: t.nationality || '', age: t.age || '', education: t.education || '', sex: '', notes: training.join('\n') },
        physicalDescription: t.notes || '', health: { value: t.hp }, wp: { value: t.wp },
        sanity: { value: t.san, currentBreakingPoint: Math.max(0, num(t.san) - num(t.power && t.power.score)),
          adaptations: { violence: kbCount(t.violenceAdaptation), helplessness: kbCount(t.helplessnessAdaptation) } }
      }
    };
  }

  /* ── Text formats ── */
  function readText(text, hint) {
    var s = String(text || '').trim();
    if (!s) throw new Error('The file is empty.');
    if (hint === 'html' || s.charAt(0) === '<') {
      var m = /<script[^>]+id=["']dg-state-blob["'][^>]*>([\s\S]*?)<\/script>/i.exec(s);
      if (!m) throw new Error('No Agent inside this page: only the printable sheet this site exports carries one.');
      return { state: JSON.parse(m[1].replace(/<\\\/script>/gi, '</script>')), from: 'printable sheet' };
    }
    if (s.charAt(0) === '{') {
      var d = JSON.parse(s);
      if (d && d.v === 1 && d.bio) return { state: d, from: 'this site\'s save' };
      return { state: foundryToState(d), from: 'Foundry VTT' };
    }
    if (/^[A-Za-z_][\w]*\s*=/.test(s)) {
      var t = parseToml(s);
      if (!t.name) throw new Error('Not a Kappa Black export (no name).');
      return { state: foundryToState(kappaToFoundry(t)), from: 'Kappa Black' };
    }
    throw new Error('Unrecognized format.');
  }

  /* ── The old sheet's PDF and spreadsheet readers ── */
  var busy = Promise.resolve();
  function viaOld(path, fn, global, file) {
    var run = busy.then(function () {
      return loadScript(path, function () { return typeof window[fn] === 'function'; }).then(function () {
        var prevSL = window.dgSaveLoad, prevToast = window.showToast, got = null, last = '';
        window.dgSaveLoad = { applyState: function (s) { got = s; }, save: function () {} };
        window.showToast = function (m) { last = String(m || ''); };
        function restore() {
          // The readers save again 300 ms after applying; keep the catcher until then.
          setTimeout(function () { window.dgSaveLoad = prevSL; window.showToast = prevToast; }, 600);
        }
        return Promise.resolve(window[fn](file)).then(function () {
          restore();
          if (!got) throw new Error(last && !/^Reading/.test(last) ? last : 'Could not read the ' + global + '.');
          return got;
        }, function (err) { restore(); throw err; });
      });
    });
    busy = run.catch(function () {});
    return run;
  }

  function ext(file) { var n = String(file.name || '').toLowerCase(), i = n.lastIndexOf('.'); return i >= 0 ? n.slice(i + 1) : ''; }
  function head(file) {
    return file.slice(0, 4).arrayBuffer().then(function (b) { return String.fromCharCode.apply(null, new Uint8Array(b)); });
  }
  function read(file) {
    if (!file) return Promise.reject(new Error('No file.'));
    var e = ext(file);
    return head(file).then(function (h) {
      var work;
      if (e === 'pdf' || h.indexOf('%PDF') === 0) work = viaOld('stats/pdf-export.js', 'importPdfFile', 'PDF', file).then(function (s) { return { state: s, from: 'DD Form 315 PDF' }; });
      else if (e === 'xlsx' || h.indexOf('PK') === 0) work = viaOld('stats/sheets-import.js', 'importSheetsFile', 'spreadsheet', file).then(function (s) { return { state: s, from: 'Google Sheets' }; });
      else work = file.text().then(function (t) { return readText(t, e === 'html' || e === 'htm' ? 'html' : ''); });
      return work;
    }).then(function (res) {
      var st = res.state || {};
      st.v = 1;
      st.bio = st.bio || {};
      if (st.bio.profession) st.bio.profession = professionKey(st.bio.profession);
      if (!st.csStats && st.stats) st.csStats = st.stats;
      if (!st.stats && st.csStats) st.stats = st.csStats;
      if (!st.lpFeat) st.lpFeat = {};
      if (!Array.isArray(st.bonds)) st.bonds = [];
      R().derived(st);
      st.creationCommitted = false;
      var label = st.bio.profession ? (window.dgRecruitData && window.dgRecruitData.label(st.bio.profession)) || st.bio.profession : 'Imported';
      return { state: st, from: res.from + ' (' + (file.name || 'file') + ')', label: label };
    });
  }

  window.dgAgentImport = { read: read, readText: readText, foundryToState: foundryToState, parseToml: parseToml, kappaToFoundry: kappaToFoundry };
})();
