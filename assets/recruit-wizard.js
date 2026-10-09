/* The New Recruit wizard, on Agent Hub's + New Recruit tab
   (assets/recruit-wizard.css alongside). Twelve steps, from the dice to
   the Contract:

     0 Start              build one, or bring one in (imports, a Friendly,
                          an Agent Code), or resume the draft
     1 Statistics         point buy (72), 4D6 drop lowest, or random;
                          what each one means; a distinguishing feature each
     2 Profession         the Agent's Handbook's, The Complex's, agency
                          postings, or your own (400 points)
     3 Bonus skills       8 × +20%, 80% cap, packages
     4 Damaged Veteran    optional (Agent's Handbook p.39)
     5 Personal data      the Agent Code is made here
     6 Bonds              the generator, a description each (AI or by hand)
     7 Motivations & Mental Disorders
     8 Incursion          assets/incursion.js
     9 Equipment          the profession's kit, the catalog, your own
    10 Profiling          the play era, then the Agent File's own
                          Appearance brief and its Face / Outfit Plates
    11 Review & Contract  Y files the Agent and opens their Agent File

   The wizard keeps its choices (`W`) as a draft on this device
   (dg_recruit_draft); the saved character is always rebuilt from them
   (build(W)), in the character sheet's own v1 shape -- the Agent File,
   A-Cell and Friendly read it unchanged. Once there is an Agent Code
   (step 5) the draft is also saved to characters/{code} with
   creationCommitted:false, so the photos have an Agent to belong to;
   signing the Contract saves it with creationCommitted:true.

   Numbers follow the Agent's Handbook and The Complex; every word shown
   is our own (the site is public).

   window.dgRecruit = { show(), build(W), freshDraft(), _w() } */
(function () {
  'use strict';
  if (window.dgRecruit) return;

  var DRAFT_KEY = 'dg_recruit_draft';
  var CI_KEY = 'dg_cover_identity';
  var ROSTER_KEY = 'dg_agent_roster';
  var CLOUD_CODE_KEY = 'dg_stats_cloud_code';
  var STATS = ['STR', 'CON', 'DEX', 'INT', 'POW', 'CHA'];
  var STEPS = ['Start', 'Statistics', 'Profession', 'Bonus skills', 'Damaged Veteran', 'Personal data', 'Bonds', 'Motivations', 'Incursion', 'Equipment', 'Profiling', 'Contract'];
  var ERAS = [['90s', '1990s'], ['00s', '2000s'], ['10s', '2010s'], ['20s', '2020s']];
  var ROOT = (function () {
    var s = document.currentScript;
    return s && s.src ? s.src.replace(/assets\/recruit-wizard\.js.*$/, '') : '';
  })();

  function R() { return window.dgRules; }
  function D() { return window.dgRecruitData; }
  function PROF() { try { return typeof professions !== 'undefined' ? professions : window.professions; } catch (e) { return null; } } // eslint-disable-line no-undef
  function BIO() { try { return typeof bioData !== 'undefined' ? bioData : null; } catch (e) { return null; } } // eslint-disable-line no-undef
  function CAT() { return window.DG_EQUIPMENT_CATALOG || []; }
  function num(v, d) { v = parseInt(v, 10); return isNaN(v) ? (d == null ? 0 : d) : v; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function d(n) { return Math.floor(Math.random() * n) + 1; }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private window */ } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* private window */ } }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* ── Loading the data tables (once, when the tab first opens) ── */
  var loaded = {};
  function loadScript(path, test) {
    if (test()) return Promise.resolve();
    if (loaded[path]) return loaded[path];
    loaded[path] = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = ROOT + path;
      s.onload = function () { resolve(); };
      s.onerror = function () { loaded[path] = null; reject(new Error('Could not load ' + path)); };
      document.head.appendChild(s);
    });
    return loaded[path];
  }
  function has(name) { return function () { try { return typeof window[name] !== 'undefined' || eval('typeof ' + name) !== 'undefined'; } catch (e) { return false; } }; } // eslint-disable-line no-eval
  function deps() {
    return Promise.all([
      loadScript('assets/agent-rules.js', has('dgRules')),
      loadScript('assets/disorders.js', has('dgDisorders')),
      loadScript('assets/incursion.js', has('dgIncursion')),
      loadScript('stats/professions.js', has('professions')),
      loadScript('stats/bonds.js', has('bonds')),
      loadScript('stats/bio.js', has('bioData')),
      loadScript('stats/equipment-data.js', has('DG_EQUIPMENT_CATALOG'))
    ]).then(function () { return loadScript('assets/recruit-data.js', has('dgRecruitData')); });
  }

  /* ── The draft ── */
  function freshDraft() {
    return {
      v: 1, step: 1, started: Date.now(), savedAt: Date.now(),
      mode: 'point', stats: { STR: 12, CON: 12, DEX: 12, INT: 12, POW: 12, CHA: 12 }, rolled: null, feat: {},
      prof: { src: '', key: '', posting: -1, opt: [], specs: {}, own: { title: '', skills: [], bonds: 3 } },
      filter: 'all', bonus: {}, bonusExtra: [], bonusFor: '', pkg: -1,
      vet: {}, vetHard: [], vetDisorder: '',
      bio: { name: '', codename: '', employer: '', pastEmployer: '', nationality: '', sex: '', age: '', education: '' },
      code: '', bonds: [], bondCats: ['family', 'friends'],
      motivations: ['', '', ''], disorders: [], incursion: null,
      kit: null, kitFor: '', extra: [], era: '', imported: null
    };
  }
  var W = null;
  function loadDraft() { try { var x = JSON.parse(lsGet(DRAFT_KEY) || 'null'); return x && x.v === 1 ? x : null; } catch (e) { return null; } }
  var draftTimer = null;
  function saveDraft(now) {
    if (!W) return;
    W.savedAt = Date.now();
    clearTimeout(draftTimer);
    var go = function () { lsSet(DRAFT_KEY, JSON.stringify(W)); };
    if (now) go(); else draftTimer = setTimeout(go, 300);
  }
  // With an Agent Code: the character so far, not yet committed.
  var cloudTimer = null;
  function saveCloud() {
    if (!W || !W.code || !window.dgStore) return Promise.resolve();
    clearTimeout(cloudTimer);
    var code = W.code, st = build(W);
    return window.dgStore.saveCharacter(code, st).catch(function (err) { console.warn('recruit: draft not saved to the cloud yet', err); });
  }
  function saveCloudSoon() { clearTimeout(cloudTimer); cloudTimer = setTimeout(saveCloud, 1500); }

  /* ── Skills: ids are 'key:<k>' or 'spec:<k>:<Specialty>' ── */
  function specKeyOf(label) {
    var L = R().SPEC_LABEL, l = String(label || '').trim().toLowerCase();
    for (var k in L) if (L[k].toLowerCase() === l) return k;
    return null;
  }
  function keyOf(label) {
    var l = String(label || '').trim().toLowerCase(), S = R().SKILLS;
    for (var i = 0; i < S.length; i++) if (S[i][1].toLowerCase() === l && !S[i][3]) return S[i][0];
    return null;
  }
  // A skill as written in the tables ('Pilot (Boat)', 'Foreign Language',
  // 'HUMINT') -> { id, key, spec, needsSpec, label }.
  function parseSkill(name) {
    name = String(name || '').trim();
    var m = /^(.+?)\s*\((.+)\)$/.exec(name);
    if (m) {
      var sk = specKeyOf(m[1]);
      if (sk) return { id: 'spec:' + sk + ':' + m[2], key: sk, spec: m[2], label: R().SPEC_LABEL[sk] + ' (' + m[2] + ')' };
    }
    var bare = specKeyOf(name);
    if (bare) return { id: '', key: bare, spec: '', needsSpec: true, label: R().SPEC_LABEL[bare] };
    var k = keyOf(name);
    if (k) return { id: 'key:' + k, key: k, label: name };
    return { id: '', key: '', label: name, unknown: true };
  }
  function labelOf(id) {
    var p = String(id).split(':');
    if (p[0] === 'key') { var s = R().SKILLS.filter(function (x) { return x[0] === p[1]; })[0]; return s ? s[1] : p[1]; }
    if (p[0] === 'spec') return (R().SPEC_LABEL[p[1]] || p[1]) + ' (' + p.slice(2).join(':') + ')';
    return id;
  }
  function baseOf(id) {
    var p = String(id).split(':');
    if (p[0] !== 'key') return 0;
    var s = R().SKILLS.filter(function (x) { return x[0] === p[1]; })[0];
    return s ? s[2] : 0;
  }
  function baseSkillIds() { return R().SKILLS.filter(function (s) { return !s[3]; }).map(function (s) { return 'key:' + s[0]; }); }

  /* ── Profession ── */
  function bondsOf(desc) { var m = /BONDS:\s*(\d+)/.exec(desc || ''); return m ? num(m[1]) : 3; }
  // What the chosen profession gives: { title, employer, bonds, skills
  // (set by the profession, chosen options included), options, limit,
  // bonus (suggested labels), kitKey, posting }.
  function profInfo(w) {
    var p = w.prof, P = PROF() || {};
    if (!p || !p.src) return null;
    var out = { title: '', employer: '', bonds: 3, skills: [], options: [], limit: 0, bonus: [], kitKey: '', posting: null, key: p.key, blurb: '' };
    function add(list, s, slot) {
      var ps = parseSkill(s.name);
      if (ps.needsSpec) {
        var nm = String((p.specs || {})[slot] || '').trim();
        ps.slot = slot;
        if (nm) { ps.id = 'spec:' + ps.key + ':' + nm; ps.spec = nm; ps.label = R().SPEC_LABEL[ps.key] + ' (' + nm + ')'; }
        else ps.label = R().SPEC_LABEL[ps.key] + ' (choose)';
      }
      ps.value = num(s.value);
      list.push(ps);
    }
    if (p.src === 'hb' || p.src === 'post') {
      var post = p.src === 'post' ? D().POSTINGS[p.posting] : null;
      var key = post ? post.profession : p.key, pr = P[key];
      if (!pr) return null;
      out.key = key;
      out.title = post ? post.title : pr.title;
      out.handbook = pr.title;
      out.employer = post ? post.employer : '';
      out.bonds = bondsOf(pr.description);
      out.posting = post;
      out.bonus = post ? post.bonus.slice() : [];
      out.kitKey = key;
      (pr.requiredSkills || []).forEach(function (s, i) { add(out.skills, s, 'r' + i); });
      (pr.optionalSkills || []).forEach(function (s, i) { add(out.options, s, 'o' + i); });
      out.limit = (pr.optionalSkills && pr.optionalSkills[0] && pr.optionalSkills[0].limit) || 0;
      (p.opt || []).forEach(function (i) { if (out.options[i]) out.skills.push(out.options[i]); });
      if (key === 'new_profession') out.own = true;
    } else if (p.src === 'cx') {
      var c = D().complexProfession(p.key);
      if (!c) return null;
      out.title = c.title; out.employer = c.employer; out.bonds = c.bonds; out.bonus = c.bonus.slice();
      out.kitKey = c.key; out.agency = c.agency; out.blurb = c.blurb;
      c.skills.forEach(function (s, i) { add(out.skills, s, 'c' + i); });
    }
    if (p.src === 'own' || out.own) {
      out.own = true;
      out.title = String(p.own.title || '').trim() || 'Own profession';
      out.handbook = 'Own profession';
      out.bonds = clamp(num(p.own.bonds, 3), 1, 4);
      out.kitKey = 'new_profession';
      out.skills = (p.own.skills || []).filter(function (s) { return s && s.id; }).map(function (s) {
        return { id: s.id, key: s.id.split(':')[1], label: labelOf(s.id), value: Math.min(60, baseOf(s.id) + num(s.points)) };
      });
    }
    return out;
  }
  function profId(w) { var p = w.prof; return p.src ? p.src + ':' + (p.src === 'post' ? p.posting : p.key) : ''; }
  function ownBudget(w) { return 400 + (3 - clamp(num(w.prof.own.bonds, 3), 1, 4)) * 50; }

  /* ── Values, step by step ── */
  function skillVals(w, upto) {
    var v = {};
    baseSkillIds().forEach(function (id) { v[id] = baseOf(id); });
    var src = {}, pi = profInfo(w);
    if (pi) pi.skills.forEach(function (s) { if (!s.id) return; v[s.id] = Math.max(v[s.id] == null ? 0 : v[s.id], s.value); src[s.id] = 'profession'; });
    if (upto === 'prof') return { v: v, src: src };
    Object.keys(w.bonus || {}).forEach(function (id) {
      var n = num(w.bonus[id]); if (!n) return;
      var cur = v[id] == null ? 0 : v[id];
      v[id] = Math.max(cur, Math.min(80, cur + 20 * n));
      if (!src[id]) src[id] = 'bonus';
    });
    if (upto === 'bonus') return { v: v, src: src };
    var vet = w.vet || {};
    ['violence', 'captivity', 'hard', 'unnatural'].forEach(function (k) {
      if (!vet[k]) return;
      var x = D().VETERAN.filter(function (o) { return o.key === k; })[0];
      if (x.occult) v['key:occult'] = (v['key:occult'] || 0) + x.occult;
      if (x.unnatural) v['key:unnatural'] = (v['key:unnatural'] || 0) + x.unnatural;
      if (x.fourSkills) (w.vetHard || []).slice(0, 4).forEach(function (id) { if (v[id] == null) v[id] = 0; v[id] += x.fourSkills; if (!src[id]) src[id] = 'bonus'; });
    });
    Object.keys(v).forEach(function (id) { v[id] = clamp(v[id], 0, 99); });
    return { v: v, src: src };
  }
  function finalStats(w) {
    var s = {}; STATS.forEach(function (k) { s[k] = num(w.stats[k], 10); });
    if (w.vet && w.vet.captivity) s.POW = Math.max(1, s.POW - 3);
    if (w.vet && w.vet.violence) s.CHA = Math.max(1, s.CHA - 3);
    return s;
  }
  function derivedOf(w) {
    var s = finalStats(w), pow0 = num(w.stats.POW, 10), vet = w.vet || {};
    var san = pow0 * 5;
    ['violence', 'captivity', 'hard'].forEach(function (k) { if (vet[k]) san -= 5; });
    if (vet.unnatural) san -= s.POW;
    var unn = skillVals(w).v['key:unnatural'] || 0;
    san = clamp(san, 0, 99 - unn);
    return { hp: Math.ceil((s.STR + s.CON) / 2), wp: s.POW, san: san, bp: Math.max(0, san - s.POW) };
  }
  function bondCount(w) { var pi = profInfo(w); return pi ? Math.max(0, pi.bonds - (w.vet && w.vet.hard ? 1 : 0)) : 0; }
  function ageRange(age) {
    age = num(age, 0);
    if (!age) return '';
    if (age >= 60) return '60s or older';
    if (age < 20) return 'Early 20s';
    var dec = Math.floor(age / 10) * 10, r = age % 10;
    return (r <= 3 ? 'Early ' : r <= 6 ? 'Mid ' : 'Late ') + dec + 's';
  }
  function coverIdentity() { return String(lsGet(CI_KEY) || '').trim(); }

  /* ── The saved character, rebuilt from the choices ── */
  function build(w) {
    if (w.imported) return buildImported(w);
    var s = finalStats(w), dv = derivedOf(w), sv = skillVals(w), pi = profInfo(w) || {};
    var st = {
      v: 1, stats: clone(s), csStats: clone(s), derived: dv, lpFeat: clone(w.feat || {}),
      skills: {}, skillSpecs: {}, customSkills: [], specialtyInstances: [],
      bonds: [], bio: {}, equipment: [], lpWeapons: [], lpNotes: { wounds: '', gear: '', remarks: '' },
      sanity: { violence: [false, false, false], helplessness: [false, false, false] }, adapted: {},
      lpCheckedSkills: [], lpCustomSkills: [], professionSkillsApplied: true, bonusApplied: true, creationCommitted: false,
      recruit: { by: 'wizard', profession: profId(w), posting: pi.posting ? pi.posting.title : '', vet: Object.keys(w.vet || {}).filter(function (k) { return w.vet[k]; }) }
    };
    var specN = 0;
    Object.keys(sv.v).forEach(function (id) {
      var p = id.split(':');
      if (p[0] === 'key') st.skills[p[1]] = sv.v[id];
      else if (p[0] === 'spec' && sv.v[id] > 0) {
        st.specialtyInstances.push({ id: 'nr-' + p[1] + '-' + (specN++), key: p[1], specialty: p.slice(2).join(':'), value: sv.v[id], source: sv.src[id] === 'profession' ? 'profession' : 'bonus' });
      }
    });
    var vet = w.vet || {};
    if (vet.violence) { st.sanity.violence = [true, true, true]; st.adapted.violence = true; }
    if (vet.captivity) { st.sanity.helplessness = [true, true, true]; st.adapted.helplessness = true; }
    var b = w.bio || {};
    st.bio = {
      player_name: coverIdentity(), name: String(b.name || '').trim(), codename: String(b.codename || '').trim(),
      profession: pi.key || '', employer: String(b.employer || '').trim(), pastEmployer: String(b.pastEmployer || '').trim(),
      nationality: String(b.nationality || '').trim(), sex: b.sex || '', age: String(b.age || '').trim(),
      education: String(b.education || '').trim(), physicalDesc: '', personalDetails: '',
      motivations: (w.motivations || []).map(function (m) { return String(m || '').trim(); }).filter(Boolean).join('\n'),
      disorders: (w.disorders || []).filter(Boolean).slice(), motivationsCrossed: []
    };
    if (pi.posting) st.bio.posting = pi.posting.title;
    if (pi.own) st.bio.professionTitle = pi.title;
    if (vet.unnatural && w.vetDisorder && st.bio.disorders.indexOf(w.vetDisorder) === -1) st.bio.disorders.push(w.vetDisorder);
    if (w.incursion && window.dgIncursion) st.bio.incursion = window.dgIncursion.normalize(w.incursion);
    var n = bondCount(w);
    st.bonds = (w.bonds || []).slice(0, n).map(function (x, i) {
      return { id: 'bond-nr-' + i, name: String(x.name || '').trim(), relationship: String(x.relationship || '').trim(), description: String(x.description || '').trim(), score: s.CHA };
    });
    // Kit: catalog weapons onto the weapons table (with the skill to use),
    // the rest as gear; anything not in the catalog as a written-in item.
    var cat = CAT();
    kitList(w).filter(function (k) { return k.on; }).concat((w.extra || []).map(function (x) { return { name: x, on: true }; })).forEach(function (k) {
      var item = cat.filter(function (c) { return c.name === k.name; })[0];
      if (item && item.type === 'weapon') {
        var sys = item.system || {}, pct = sv.v['key:' + sys.skill] || 0;
        st.lpWeapons.push({ name: item.name, skillPct: pct ? String(pct) : '', range: sys.range || '', damage: sys.damage || '', lethality: sys.lethality ? String(sys.lethality) : '', ammo: sys.ammo !== undefined ? String(sys.ammo) : '', fromEquip: true });
      } else if (item) st.equipment.push(item.name);
      else st.equipment.push({ isCustom: true, name: k.name });
    });
    return st;
  }
  // An import (or a Friendly): its own character, with the steps the
  // wizard still asks about (who they are, Bonds, Motivations, the
  // Incursion, equipment) written over it.
  function buildImported(w) {
    var st = clone(w.imported);
    st.v = 1; st.creationCommitted = false;
    st.bio = st.bio || {};
    var b = w.bio || {};
    ['name', 'codename', 'employer', 'pastEmployer', 'nationality', 'sex', 'age', 'education'].forEach(function (k) { if (b[k] != null) st.bio[k] = String(b[k]).trim(); });
    if (!st.bio.player_name) st.bio.player_name = coverIdentity();
    st.bio.motivations = (w.motivations || []).map(function (m) { return String(m || '').trim(); }).filter(Boolean).join('\n');
    st.bio.disorders = (w.disorders || []).filter(Boolean).slice();
    if (w.incursion && window.dgIncursion) st.bio.incursion = window.dgIncursion.normalize(w.incursion);
    var cha = R().stats(st).CHA || 10;
    st.bonds = (w.bonds || []).filter(function (x) { return x && String(x.name || '').trim(); }).map(function (x, i) {
      return { id: x.id || 'bond-nr-' + i, name: String(x.name).trim(), relationship: String(x.relationship || '').trim(), description: String(x.description || '').trim(), score: x.score != null ? num(x.score) : cha };
    });
    st.recruit = { by: 'import', from: w.importedFrom || '' };
    return st;
  }

  /* ── Equipment ── */
  function kitList(w) {
    var pi = profInfo(w);
    var id = profId(w);
    if (!w.kit || w.kitFor !== id) {
      w.kit = pi ? D().kitFor(pi.kitKey, pi.posting) : [];
      w.kitFor = id;
    }
    return w.kit;
  }

  /* ── Rendering ── */
  var root = null, ui = { err: '', busy: '', pickStat: '', bondBusy: {}, bonusSpec: 'foreign_language', gearCat: '' };
  function rail(cur) {
    return '<div class="nr-steps" role="list">' + STEPS.map(function (s, i) {
      var reach = W && i <= (W.reached || W.step);
      return '<span role="listitem" class="nr-step' + (i < cur ? ' done' : i === cur ? ' cur' : '') + '"' + (reach && i !== cur ? ' data-a="goto" data-s="' + i + '"' : '') + '><b>' + i + '</b><span class="nm">' + s + '</span></span>';
    }).join('') + '</div>';
  }
  function side() {
    var pi = profInfo(W), dv = W.imported ? R().derived(clone(W.imported)) : derivedOf(W), s = W.imported ? R().stats(W.imported) : finalStats(W);
    var name = String(W.bio.name || '').trim();
    var n = W.imported ? (W.bonds || []).length : bondCount(W);
    var filled = (W.bonds || []).slice(0, n).filter(function (b) { return b && String(b.name || '').trim(); }).length;
    return '<aside class="nr-side" data-side><div class="nr-lbl">The file so far</div>' +
      '<div class="nm">' + esc(name || 'Unnamed recruit') + (W.bio.codename ? ' <span class="nr-k">“' + esc(W.bio.codename) + '”</span>' : '') + '</div>' +
      '<dl><dt>Profession</dt><dd>' + esc(W.imported ? (W.importedLabel || 'Imported') : pi ? pi.title : '—') + '</dd>' +
      '<dt>Code</dt><dd>' + esc(W.code || 'made at step 5') + '</dd>' +
      '<dt>Bonds</dt><dd>' + (n ? filled + ' of ' + n : '—') + '</dd>' +
      '<dt>Draft</dt><dd>' + (W.code ? 'saved, not yet filed' : 'kept on this device') + '</dd></dl>' +
      '<div class="nr-mini-stats">' + STATS.map(function (k) { return '<div>' + k + '<b>' + s[k] + '</b></div>'; }).join('') + '</div>' +
      '<div class="nr-derived" style="margin-top:8px"><div>HP<b>' + dv.hp + '</b></div><div>WP<b>' + dv.wp + '</b></div><div>SAN<b>' + dv.san + '</b></div><div>BP<b>' + dv.bp + '</b></div></div></aside>';
  }
  function head(n, t, lead) { return '<div class="nr-h"><span class="n">' + n + '.</span><span class="t">' + esc(t) + '</span></div>' + (lead ? '<p class="nr-lead">' + lead + '</p>' : ''); }
  function foot(back, next, note) {
    return '<div class="nr-err" role="alert" data-err>' + esc(ui.err) + '</div><div class="nr-foot">' +
      (back != null ? '<button type="button" class="nr-btn ghost" data-a="back">◂ ' + esc(back) + '</button>' : '<span></span>') +
      '<span class="nr-k">' + (note || 'Your draft is kept on this device; close the tab and you come back here.') + '</span>' +
      (next ? '<button type="button" class="nr-btn ink" data-a="next"' + (ui.busy ? ' disabled' : '') + '>' + esc(ui.busy || next) + ' ▸</button>' : '<span></span>') + '</div>';
  }
  function wrap(body, noSide) {
    return rail(W.step) + (noSide ? body : '<div class="nr-grid"><div>' + body + '</div>' + side() + '</div>');
  }
  function chip(label, on, attrs) { return '<button type="button" class="nr-chip' + (on ? ' on' : '') + '" ' + attrs + '>' + label + '</button>'; }

  // Step 0: start, resume, or bring one in.
  function startHtml() {
    var dr = loadDraft();
    var resume = '';
    if (dr && (dr.step > 1 || (dr.bio && dr.bio.name))) {
      var when = new Date(dr.savedAt || dr.started || Date.now());
      resume = '<div class="nr-resume"><b style="color:var(--ink)">Draft found:</b> ' + (dr.bio && dr.bio.name ? '“' + esc(dr.bio.name) + '”, ' : '') +
        'stopped at step ' + dr.step + ' (' + esc(STEPS[dr.step] || '') + '), ' + esc(when.toLocaleDateString()) + '. ' +
        '<button type="button" class="nr-btn mini" data-a="resume">Resume</button> <button type="button" class="nr-btn mini" style="border-color:var(--rule);color:var(--ink3)" data-a="discard">Discard</button></div>';
    }
    return rail(0) +
      '<div class="nr-start"><div class="nr-big"><h3>Build a new Agent</h3><p class="nr-k">Eleven short steps, from the dice to the Contract. About 15 minutes.</p>' +
      '<ul style="margin:8px 0 12px;padding-left:16px;font-size:12px"><li>Statistics, profession and bonus skills</li><li>Who they are, who they love, what drives them</li><li>What brought them in, what they carry</li><li>How they look, and their Face Plate</li></ul>' +
      '<button type="button" class="nr-btn ink" data-a="begin">Begin ▸</button></div>' +
      '<div class="nr-big"><h3>Bring one in</h3><p class="nr-k">An Agent you already have elsewhere. What the file carries is filled in; you check each step and add what\'s missing.</p>' +
      '<div class="nr-drop" style="margin-top:10px" data-a="drop" data-drop tabindex="0" role="button" aria-label="Choose a file to import"><div class="big">Drop a file here, or tap to choose</div>' +
      '<div class="nr-fmt"><span>Foundry VTT (.json)</span><span>Kappa Black (.toml)</span><span>This site\'s save (.json)</span><span>DD Form 315 (.pdf)</span><span>Google Sheets (.xlsx)</span><span>Printable sheet (.html)</span></div>' +
      '<input type="file" data-file hidden accept=".json,.toml,.txt,.pdf,.xlsx,.html,.htm"></div>' +
      '<div class="nr-chips" style="margin-top:10px">' + chip('A Friendly pregen…', ui.start === 'friendly', 'data-a="start-friendly"') + chip('Load by Agent Code…', ui.start === 'code', 'data-a="start-code"') + '</div>' +
      (ui.start === 'code' ? '<div class="nr-ci"><input class="in" data-u="load-code" placeholder="e.g. MARA-V04S" autocapitalize="characters" aria-label="Agent Code"><button type="button" class="nr-btn red" data-a="load-code">Open</button></div>' : '') +
      (ui.start === 'friendly' ? friendlyPick() : '') +
      '<div class="nr-err" role="alert" data-err>' + esc(ui.err) + '</div></div></div>' + resume;
  }
  function friendlyPick() {
    var list = ui.pregens;
    if (!list) return '<p class="nr-busy">Loading the Friendlies…</p>';
    if (!list.length) return '<p class="nr-k">No Friendlies found.</p>';
    return '<div class="nr-ci"><select class="in" data-u="pregen" aria-label="Friendly">' + list.map(function (p, i) {
      return '<option value="' + i + '">' + esc(p.name + (p.profession ? ' — ' + p.profession : '')) + '</option>';
    }).join('') + '</select><button type="button" class="nr-btn red" data-a="use-pregen">Use</button></div>';
  }

  // Step 1: statistics.
  function statsHtml() {
    var I = D().STAT_INFO, used = STATS.reduce(function (t, k) { return t + num(W.stats[k]); }, 0);
    var dv = derivedOf(W);
    var modes = chip('Point buy (72)', W.mode === 'point', 'data-a="mode" data-m="point"') + chip('Roll 4D6, drop lowest', W.mode === 'roll', 'data-a="mode" data-m="roll"') + chip('Fully random', W.mode === 'random', 'data-a="mode" data-m="random"');
    var pool = W.mode === 'point'
      ? '<div class="nr-pool"><span>Points left</span><span class="big" data-left>' + (72 - used) + '</span><span class="nr-k">of 72 · every statistic 3–18</span></div>'
      : '<div class="nr-pool"><span class="nr-k">' + (W.mode === 'roll' ? 'Rolled. Tap one value, then another, to swap them.' : 'Spread at random across the six.') + '</span><button type="button" class="nr-btn mini" data-a="reroll">⚄ Roll again</button></div>';
    return wrap(head(1, 'Statistics', 'Spend 72 points across the six statistics (3 to 18 each), roll 4D6 and drop the lowest for each, or let the dice decide everything. Each one gets a distinguishing feature: one is suggested from the score; change it to anything.') +
      '<div class="nr-chips">' + modes + '</div>' + pool +
      '<div class="nr-stats">' + STATS.map(function (k) {
        var v = num(W.stats[k]), info = I[k];
        var ctl = W.mode === 'point'
          ? '<button type="button" class="nr-pm" data-a="st" data-k="' + k + '" data-d="-1" aria-label="Lower ' + k + '"' + (v <= 3 ? ' disabled' : '') + '>−</button><span class="v">' + v + '</span><button type="button" class="nr-pm" data-a="st" data-k="' + k + '" data-d="1" aria-label="Raise ' + k + '"' + (v >= 18 || used >= 72 ? ' disabled' : '') + '>+</button>'
          : '<span class="v swap' + (ui.pickStat === k ? ' pick' : '') + '" data-a="swap" data-k="' + k + '" role="button" tabindex="0" aria-label="Swap ' + k + '">' + v + '</span>';
        return '<div class="nr-stat"><div class="s" title="' + esc(info.name) + '">' + k + '</div><div class="row">' + ctl + '</div><div class="x5">×5 = ' + (v * 5) + '%</div>' +
          '<div class="ex"><b style="color:var(--ink)">' + esc(info.name) + '.</b> ' + esc(info.what) + '</div>' +
          '<div class="ft"><span>Distinguishing feature</span><button type="button" data-a="feat" data-k="' + k + '">⚄ suggest</button></div>' +
          '<input class="fvb" data-f="feat.' + k + '" value="' + esc(W.feat[k] || '') + '" placeholder="Optional" aria-label="' + k + ' distinguishing feature"></div>';
      }).join('') + '</div>' +
      '<div class="nr-lbl">Derived</div><div class="nr-derived"><div>HP<b>' + dv.hp + '</b></div><div>WP<b>' + dv.wp + '</b></div><div>SAN<b>' + dv.san + '</b></div><div>BP<b>' + dv.bp + '</b></div></div>' +
      foot(null, 'Profession'));
  }

  // Step 2: profession.
  function profHtml() {
    var P = PROF() || {}, f = W.filter || 'all', p = W.prof;
    function btn(src, key, title, sub, extra) {
      var on = p.src === src && String(src === 'post' ? p.posting : p.key) === String(key);
      return '<button type="button" class="nr-prof' + (on ? ' on' : '') + (extra || '') + '" data-a="prof" data-src="' + src + '" data-key="' + esc(key) + '" aria-pressed="' + on + '">' + esc(title) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</button>';
    }
    var hbKeys = Object.keys(P).filter(function (k) { return k !== 'new_profession'; });
    var groups = {}, order = [];
    D().COMPLEX.forEach(function (c) { if (!groups[c.agency]) { groups[c.agency] = []; order.push(c.agency); } groups[c.agency].push(c); });
    var posts = {}, porder = [];
    D().POSTINGS.forEach(function (x, i) { if (!posts[x.agency]) { posts[x.agency] = []; porder.push(x.agency); } posts[x.agency].push(i); });
    // The chosen profession's detail opens right under its own group.
    var detailDone = false;
    function grid(cards, holds) {
      var h = '<div class="nr-profs">' + cards + '</div>';
      if (holds && !detailDone) { detailDone = true; h += profDetail(); }
      return h;
    }
    var out = '<div class="nr-chips">' + chip('All', f === 'all', 'data-a="pfilter" data-f="all"') + chip('Agent\'s Handbook (' + hbKeys.length + ')', f === 'hb', 'data-a="pfilter" data-f="hb"') +
      chip('The Complex (' + D().COMPLEX.length + ')', f === 'cx', 'data-a="pfilter" data-f="cx"') + chip('Agency postings (' + D().POSTINGS.length + ')', f === 'post', 'data-a="pfilter" data-f="post"') + '</div>';
    if (f === 'all' || f === 'hb') {
      out += '<div class="nr-lbl" style="margin-top:4px">Agent\'s Handbook</div>' + grid(
        hbKeys.map(function (k) { return btn('hb', k, P[k].title, bondsOf(P[k].description) + ' Bonds'); }).join('') +
        btn('own', 'own', 'Build your own', '400 points, 60% cap', ' own'), p.src === 'hb' || p.src === 'own');
    }
    if (f === 'all' || f === 'cx') {
      out += '<div class="nr-lbl">The Complex</div>' + order.map(function (a) {
        return '<div class="nr-k" style="margin:6px 0 3px;letter-spacing:.08em;text-transform:uppercase">' + esc(a) + '</div>' + grid(
          groups[a].map(function (c) { return btn('cx', c.key, c.title, c.bonds + (c.bonds === 1 ? ' Bond' : ' Bonds')); }).join(''),
          p.src === 'cx' && groups[a].some(function (c) { return c.key === p.key; }));
      }).join('');
    }
    if (f === 'post') {
      out += '<div class="nr-lbl">Agency postings <span class="nr-k">a Handbook profession, with its agency, suggested bonus skills and kit</span></div>' + porder.map(function (a) {
        return '<div class="nr-k" style="margin:6px 0 3px;letter-spacing:.08em;text-transform:uppercase">' + esc(a) + '</div>' + grid(
          posts[a].map(function (i) { var x = D().POSTINGS[i]; return btn('post', i, x.title, (P[x.profession] || {}).title || ''); }).join(''),
          p.src === 'post' && posts[a].indexOf(p.posting) !== -1);
      }).join('');
    }
    if (!detailDone) out += profDetail();
    return wrap(head(2, 'Profession', 'What the Agent does when they aren\'t doing this. It sets the professional skills and how many Bonds they start with.') + out + foot('Statistics', 'Bonus skills'));
  }
  function profDetail() {
    var pi = profInfo(W);
    if (!pi) return '<p class="nr-k" style="margin-top:12px">Pick a profession to see its skills.</p>';
    var sv = skillVals(W, 'prof'), bonusIds = {};
    pi.bonus.forEach(function (b) { var x = parseSkill(b); if (x.id) bonusIds[x.id] = 1; else if (x.key) bonusIds['spec:' + x.key + ':'] = 1; });
    var ids = baseSkillIds().filter(function (id) { return id !== 'key:unnatural'; });
    pi.skills.forEach(function (s) { if (s.id && ids.indexOf(s.id) === -1) ids.push(s.id); });
    ids.sort(function (a, b) { return labelOf(a).localeCompare(labelOf(b)); });
    var html = '<div class="nr-panel" data-detail><div class="nr-lbl" style="margin-top:0">' + esc(pi.title) + (pi.employer ? ' (' + esc(pi.employer) + ')' : '') +
      ' <span class="nr-k">' + pi.bonds + (pi.bonds === 1 ? ' Bond' : ' Bonds') + (pi.handbook && pi.handbook !== pi.title ? ' · as ' + esc(pi.handbook) : '') + '</span></div>' +
      (pi.blurb ? '<p class="nr-k" style="margin:0 0 6px">' + esc(pi.blurb) + '</p>' : '');
    if (pi.own) html += ownHtml(pi);
    // Specialties the profession leaves to you.
    var seen = {}, needs = pi.skills.concat(pi.options).filter(function (s) { if (!s.needsSpec || seen[s.slot]) return false; seen[s.slot] = 1; return true; });
    if (needs.length) {
      html += needs.map(function (s) {
        var opts = (R().SPECIALTY_OPTIONS[s.key] || []).map(function (o) { return '<option>' + esc(o) + '</option>'; }).join('');
        return '<div class="nr-specin"><span>' + esc(R().SPEC_LABEL[s.key]) + ' ' + s.value + '%: which one?</span><input class="in" list="nr-spec-' + s.key + '" data-f="prof.specs.' + s.slot + '" value="' + esc((W.prof.specs || {})[s.slot] || '') + '" aria-label="' + esc(R().SPEC_LABEL[s.key]) + ' specialty"><datalist id="nr-spec-' + s.key + '">' + opts + '</datalist></div>';
      }).join('');
    }
    if (pi.options.length && pi.limit) {
      var chosen = W.prof.opt || [];
      html += '<div class="nr-lbl">Choose ' + pi.limit + ' <span class="nr-k">' + chosen.length + ' of ' + pi.limit + ' chosen</span></div><div class="nr-opt">' +
        pi.options.map(function (s, i) {
          var on = chosen.indexOf(i) !== -1;
          return '<label><input type="checkbox" data-a="opt" data-i="' + i + '"' + (on ? ' checked' : '') + (!on && chosen.length >= pi.limit ? ' disabled' : '') + '><span>' + esc(s.label) + '</span><span>' + s.value + '%</span></label>';
        }).join('') + '</div>';
    }
    html += '<div class="nr-lbl">Skills</div><div class="nr-legend"><span>plain: base value</span><span class="lp">red bold: set by the profession</span>' + (pi.bonus.length ? '<span class="lb">black bold: suggested bonus skill</span>' : '') + '</div>' +
      '<div class="nr-sk all">' + ids.map(function (id) {
        var pro = sv.src[id] === 'profession', bon = !pro && (bonusIds[id] || (id.indexOf('spec:') === 0 && bonusIds[id.replace(/:[^:]*$/, ':')]));
        return '<div class="' + (pro ? 'pro' : bon ? 'bon' : '') + '"><span>' + esc(labelOf(id)) + '</span><span>' + (sv.v[id] || 0) + '%</span></div>';
      }).join('') + '</div>';
    if (pi.bonus.length) html += '<div class="nr-lbl">Suggested bonus skills <span class="nr-k">pre-picked on the next step</span></div><div class="nr-chips">' + pi.bonus.map(function (b) { return '<span class="nr-chip" style="cursor:default;font-weight:700">' + esc(b) + '</span>'; }).join('') + '</div>';
    var kit = D().kitFor(pi.kitKey, pi.posting).map(function (k) { return k.name; });
    if (kit.length) html += '<div class="nr-lbl">Kit</div><p style="margin:0;color:var(--ink)">' + esc(kit.slice(0, 8).join(' · ')) + (kit.length > 8 ? ' · …' : '') + '</p>';
    return html + '</div>';
  }
  function ownHtml(pi) {
    var o = W.prof.own, used = (o.skills || []).reduce(function (t, s) { return t + num(s.points); }, 0), budget = ownBudget(W);
    var all = baseSkillIds().filter(function (id) { return id !== 'key:unnatural'; });
    var have = (o.skills || []).map(function (s) { return s.id; });
    var rows = (o.skills || []).map(function (s, i) {
      var v = baseOf(s.id) + num(s.points);
      return '<div class="nr-line"><span style="flex:1">' + esc(labelOf(s.id)) + ' <span class="nr-k">base ' + baseOf(s.id) + '%</span></span>' +
        '<span class="nr-k">+</span><input class="in" style="max-width:64px" inputmode="numeric" data-f="prof.own.skills.' + i + '.points" data-num="1" value="' + esc(s.points || '') + '" aria-label="Points on ' + esc(labelOf(s.id)) + '">' +
        '<span style="min-width:44px;text-align:right;font-family:\'Special Elite\',monospace;color:' + (v > 60 ? 'var(--red)' : 'var(--ink)') + '">= ' + v + '%</span>' +
        '<button type="button" class="x" data-a="own-rm" data-i="' + i + '" aria-label="Remove">×</button></div>';
    }).join('');
    var specs = Object.keys(R().SPEC_LABEL).map(function (k) { return '<option value="spec:' + k + ':">' + esc(R().SPEC_LABEL[k]) + ' (…)</option>'; }).join('');
    return '<div class="nr-form" style="margin-bottom:8px"><label>Profession title<input class="in" data-f="prof.own.title" value="' + esc(o.title || '') + '" placeholder="e.g. Forensic Accountant"></label>' +
      '<label>Bonds<select class="in" data-f="prof.own.bonds" data-num="1" data-rerender="1">' + [1, 2, 3, 4].map(function (n) { return '<option' + (num(o.bonds, 3) === n ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></label></div>' +
      '<p class="nr-k">Ten professional skills; ' + budget + ' points between them (more Bonds, fewer points: 50 each), none above 60%.</p>' +
      '<div class="nr-pool"><span>Points left</span><span class="big" data-own-left>' + (budget - used) + '</span><span class="nr-k">' + (o.skills || []).length + ' of 10 skills</span></div>' + rows +
      ((o.skills || []).length < 10 ? '<div class="nr-kitadd"><select class="in" data-u="own-add">' + all.filter(function (id) { return have.indexOf(id) === -1; }).map(function (id) { return '<option value="' + id + '">' + esc(labelOf(id)) + '</option>'; }).join('') + specs + '</select>' +
        '<input class="in" data-u="own-spec" placeholder="specialty, if any" style="max-width:160px"><button type="button" class="nr-btn mini" data-a="own-add">+ Add skill</button></div>' : '');
  }

  // Step 3: bonus skills.
  function bonusHtml() {
    var sv = skillVals(W, 'prof'), sb = skillVals(W, 'bonus'), left = 8 - boostsUsed();
    var pi = profInfo(W), sug = {};
    (pi ? pi.bonus : []).forEach(function (b) { var x = parseSkill(b); if (x.id) sug[x.id] = 1; });
    var ids = baseSkillIds().filter(function (id) { return id !== 'key:unnatural'; });
    Object.keys(sv.v).concat(W.bonusExtra || [], Object.keys(W.bonus || {})).forEach(function (id) { if (id && id !== 'key:unnatural' && ids.indexOf(id) === -1) ids.push(id); });
    ids.sort(function (a, b) { return labelOf(a).localeCompare(labelOf(b)); });
    var pk = D().BONUS_PACKAGES;
    var specOpts = Object.keys(R().SPEC_LABEL).map(function (k) { return '<option value="' + k + '"' + (ui.bonusSpec === k ? ' selected' : '') + '>' + esc(R().SPEC_LABEL[k]) + '</option>'; }).join('');
    return wrap(head(3, 'Bonus skills', 'Eight boosts of +20%, on any skill but Unnatural, none above 80%. Pick a package to fill them in one go, or place them yourself.' + (pi && pi.bonus.length ? ' The profession\'s suggestions (•) are placed for you; move them freely.' : '')) +
      '<div class="nr-pool"><span>Boosts left</span><span class="big">' + left + '</span><span class="nr-k">of 8 · +20% each · 80% cap</span></div>' +
      '<div class="nr-chips"><span class="nr-k" style="align-self:center">Package:</span><select class="in" style="max-width:320px" data-u="pkg" aria-label="Bonus skill package"><option value="-1">— none, or choose one —</option>' +
      pk.map(function (p, i) { return '<option value="' + i + '"' + (W.pkg === i ? ' selected' : '') + '>' + esc(p.label) + '</option>'; }).join('') + '</select>' +
      (W.pkg >= 0 && pk[W.pkg] ? '<span class="nr-k" style="flex-basis:100%">' + esc(pk[W.pkg].desc) + '</span>' : '') + '</div>' +
      '<div class="nr-bonus">' + ids.map(function (id) {
        var n = num(W.bonus[id]), cur = sv.v[id] == null ? 0 : sv.v[id], now = sb.v[id] == null ? cur : sb.v[id];
        var can = left > 0 && now < 80;
        return '<div class="' + (n ? 'on' : '') + (sug[id] ? ' sug' : '') + '"><span class="nm2">' + esc(labelOf(id)) + '</span><span class="pts">' + cur + '%</span>' +
          (n ? '<span class="up">→ ' + now + '%</span>' : '<span class="cap">&nbsp;</span>') +
          '<span class="pm"><button type="button" data-a="bonus" data-id="' + esc(id) + '" data-d="-1" aria-label="Remove a boost from ' + esc(labelOf(id)) + '"' + (n ? '' : ' disabled') + '>−</button><span class="n">' + (n ? '+' + (20 * n) : '') + '</span>' +
          '<button type="button" data-a="bonus" data-id="' + esc(id) + '" data-d="1" aria-label="Boost ' + esc(labelOf(id)) + '"' + (can ? '' : ' disabled') + '>+</button></span></div>';
      }).join('') + '</div>' +
      '<div class="nr-kitadd"><span class="nr-k">A specialty to boost:</span><select class="in" style="max-width:180px" data-u="bspec-kind">' + specOpts + '</select>' +
      '<input class="in" list="nr-bspec" data-u="bspec-name" placeholder="which one" style="max-width:180px"><datalist id="nr-bspec">' + (R().SPECIALTY_OPTIONS[ui.bonusSpec] || []).map(function (o) { return '<option>' + esc(o) + '</option>'; }).join('') + '</datalist>' +
      '<button type="button" class="nr-btn mini" data-a="bspec-add">+ Add</button></div>' +
      foot('Profession', 'Damaged Veteran'));
  }
  function boostsUsed() { return Object.keys(W.bonus || {}).reduce(function (t, k) { return t + num(W.bonus[k]); }, 0); }
  function applyPackage(i) {
    var p = D().BONUS_PACKAGES[i];
    W.pkg = i; W.bonus = {};
    if (!p) return;
    var usedSpec = {};
    p.skills.forEach(function (s) {
      var id = '';
      if (s.charAt(0) === '?') {
        var kind = s.slice(1);
        if (kind === 'anthro_arch') id = 'key:anthropology';
        else if (R().SPEC_LABEL[kind]) {
          var opts = R().SPECIALTY_OPTIONS[kind] || [], o = opts.filter(function (x) { return !usedSpec[kind + ':' + x]; })[0] || opts[0];
          usedSpec[kind + ':' + o] = 1; id = 'spec:' + kind + ':' + o;
        }
      } else if (/\(/.test(s)) id = parseSkill(s).id;
      else id = 'key:' + s;
      if (!id) return; // a free choice: left to place
      if (id.indexOf('spec:') === 0 && (W.bonusExtra || []).indexOf(id) === -1) W.bonusExtra.push(id);
      W.bonus[id] = num(W.bonus[id]) + 1;
    });
  }

  // Step 4: Damaged Veteran.
  function vetHtml() {
    var V = D().VETERAN, vet = W.vet || {};
    var any = V.some(function (x) { return vet[x.key]; });
    var cards = V.map(function (x) {
      var on = !!vet[x.key], sub = '';
      if (on && x.key === 'hard') {
        var ids = Object.keys(skillVals(W, 'bonus').v).filter(function (id) { return id !== 'key:unnatural'; }).sort(function (a, b) { return labelOf(a).localeCompare(labelOf(b)); });
        sub = '<div class="nr-sub"><div class="nr-k">Four skills, +10% each (' + (W.vetHard || []).length + ' of 4):</div>' + [0, 1, 2, 3].map(function (i) {
          return '<select class="in" data-u="vet-hard" data-i="' + i + '" style="margin-top:4px" aria-label="Hard Experience skill ' + (i + 1) + '"><option value="">—</option>' + ids.map(function (id) { return '<option value="' + esc(id) + '"' + ((W.vetHard || [])[i] === id ? ' selected' : '') + '>' + esc(labelOf(id)) + '</option>'; }).join('') + '</select>';
        }).join('') + '<div class="nr-k" style="margin-top:4px">One Bond fewer on the Bonds step.</div></div>';
      }
      if (on && x.key === 'unnatural') {
        var dis = (window.dgDisorders ? window.dgDisorders.list : []).filter(function (dd) { return (dd.kinds || []).indexOf('Unnatural') !== -1; });
        sub = '<div class="nr-sub"><div class="nr-k">The disorder it left:</div><select class="in" data-u="vet-dis" aria-label="Disorder"><option value="">— choose —</option>' +
          dis.map(function (dd) { return '<option' + (W.vetDisorder === dd.name ? ' selected' : '') + '>' + esc(dd.name) + '</option>'; }).join('') + '</select></div>';
      }
      return '<div class="nr-card' + (on ? ' on' : '') + '" data-a="vet" data-k="' + x.key + '" role="button" tabindex="0" aria-pressed="' + on + '"><h4>' + esc(x.title) + '</h4><div class="nr-k">' + esc(x.blurb) + '</div><ul>' +
        x.lines.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul>' + sub + '</div>';
    }).join('');
    return wrap(head(4, 'Damaged Veteran', 'Optional. Some past brush with horror brought the Agent to Delta Green\'s attention. Pick one (your Handler may allow more), or skip. The changes are applied for you and shown below.') +
      '<div class="nr-cards">' + cards + '</div>' + (any ? vetDiff() : '') +
      '<div class="nr-chips" style="margin-top:12px">' + chip('No — skip this', !any, 'data-a="vet-none"') + '</div>' +
      foot('Bonus skills', 'Personal data', 'Work out with your Handler what happened and how it brought the Agent in.'));
  }
  function vetDiff() {
    var before = clone(W); before.vet = {}; before.vetHard = [];
    var a = skillVals(before).v, b = skillVals(W).v, da = derivedOf(before), db = derivedOf(W), sa = finalStats(before), sb = finalStats(W);
    var out = [];
    Object.keys(b).forEach(function (id) { if ((a[id] || 0) !== b[id]) out.push(labelOf(id) + ' ' + (a[id] || 0) + '% → ' + b[id] + '%'); });
    STATS.forEach(function (k) { if (sa[k] !== sb[k]) out.push(k + ' ' + sa[k] + ' → ' + sb[k]); });
    if (da.san !== db.san) out.push('SAN ' + da.san + ' → ' + db.san + ' (BP ' + da.bp + ' → ' + db.bp + ')');
    if (da.wp !== db.wp) out.push('WP ' + da.wp + ' → ' + db.wp);
    if (W.vet.violence) out.push('each Bond starts at ' + sb.CHA + ' · Violence: adapted');
    if (W.vet.captivity) out.push('Helplessness: adapted');
    if (W.vet.hard) out.push('Bonds ' + (profInfo(W) || { bonds: 0 }).bonds + ' → ' + bondCount(W));
    if (W.vet.unnatural && W.vetDisorder) out.push('Disorder: ' + W.vetDisorder);
    return '<div class="nr-panel"><div class="nr-lbl" style="margin-top:0">Applied</div><div class="nr-diff">' + out.map(esc).join(' · ') + '</div></div>';
  }

  // Step 5: personal data.
  function personalHtml() {
    var b = W.bio, pi = profInfo(W) || {};
    function f(label, k, ph, extra) { return '<label>' + label + '<input class="in" data-f="bio.' + k + '" value="' + esc(b[k] || '') + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + (extra || '') + '></label>'; }
    var ci = coverIdentity();
    var codeBox = W.code
      ? '<div class="nr-code"><span class="nr-k">Agent Code:</span><span class="c">' + esc(W.code) + '</span><span class="nr-k">— filed under your Cover Identity' + (ci ? ' (' + esc(ci) + ')' : '') + '; it brings this Agent up on any device.</span></div>'
      : '<div class="nr-code"><span class="nr-k">The Agent Code is made when you go on, so the photos have somewhere to be saved. It\'s filed under your Cover Identity' + (ci ? ' (' + esc(ci) + ')' : '') + '.</span></div>';
    var ciBox = ci ? '' : '<div class="nr-ci"><span class="nr-k">No Cover Identity on this device yet (it\'s asked for at the top of Agent Hub):</span><input class="in" data-u="ci" placeholder="Your name, as your Handler knows you" aria-label="Cover Identity"></div>';
    return wrap(head(5, 'Personal data', 'Who the Agent is on paper. Random Bio fills everything you leave empty.') +
      '<div class="nr-chips"><button type="button" class="nr-btn red" data-a="randbio">⚄ Random Bio</button></div>' +
      '<div class="nr-form">' + f('Name', 'name', 'Full name', ' autocomplete="off"') + f('Cover name (codename)', 'codename', 'e.g. Sparrow') +
      '<label>Profession<input class="in" value="' + esc(pi.title || '') + '" disabled></label>' + f('Employer', 'employer', pi.employer || '') + f('Past employer (optional)', 'pastEmployer', 'e.g. Kansas City PD, 2009–2015') +
      f('Nationality', 'nationality', 'e.g. American') +
      '<label>Sex<select class="in" data-f="bio.sex"><option value=""></option>' + ['Female', 'Male', 'Non-binary'].map(function (s) { return '<option' + (b.sex === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select></label>' +
      f('Age', 'age', 'e.g. 38', ' inputmode="numeric"') + f('Education', 'education', 'e.g. MA, Criminology') + '</div>' + ciBox + codeBox +
      foot('Damaged Veteran', 'Bonds'));
  }
  function randomBio() {
    var B = BIO(), b = W.bio, s = finalStats(W);
    if (!B) return;
    var g = b.sex === 'Male' ? 'male' : b.sex === 'Female' ? 'female' : b.sex === 'Non-binary' ? 'non-binary' : pick(['male', 'female']);
    if (!b.sex) b.sex = { male: 'Male', female: 'Female', 'non-binary': 'Non-binary' }[g];
    if (!String(b.name || '').trim()) b.name = pick(B.firstNames[g] || B.firstNames.male) + ' ' + pick(B.lastNames);
    if (!String(b.age || '').trim()) b.age = String(25 + Math.floor(Math.random() * 41));
    if (!String(b.nationality || '').trim()) b.nationality = pick(B.nationalities);
    var pi = profInfo(W) || {};
    var map = { computer_scientist: 'engineer', soldier_marine: 'soldier', foreign_service: 'foreign_service_officer', lawyer_executive: 'lawyer', pilot_sailor: 'pilot' };
    var prof = B.professionProfiles[map[pi.key] || pi.key] || B.professionProfiles['default'] || { employers: [''], educations: [''] };
    if (!String(b.employer || '').trim()) b.employer = pi.employer || pick(prof.employers);
    if (!String(b.education || '').trim()) b.education = pick(prof.educations);
    if (!String(b.codename || '').trim()) {
      var words = ['Sparrow', 'Lantern', 'Harbor', 'Ledger', 'Cistern', 'Fathom', 'Meridian', 'Orchard', 'Kestrel', 'Tinder', 'Juniper', 'Basalt'];
      b.codename = pick(words);
    }
    void s;
  }

  // Step 6: Bonds.
  function bondsHtml() {
    var n = W.imported ? Math.max(1, (W.bonds || []).length) : bondCount(W), s = W.imported ? R().stats(W.imported) : finalStats(W), pi = profInfo(W) || {};
    while ((W.bonds || []).length < n) W.bonds.push({ name: '', relationship: '', description: '', gen: false });
    var cats = D().BOND_CATS.map(function (c) { return chip(esc(c[1]), W.bondCats.indexOf(c[0]) !== -1, 'data-a="bcat" data-c="' + c[0] + '"'); }).join('');
    var cards = W.bonds.slice(0, n).map(function (x, i) {
      var busy = ui.bondBusy[i];
      return '<div class="nr-bondc" data-bond="' + i + '"><div class="top"><input class="in" data-f="bonds.' + i + '.name" value="' + esc(x.name) + '" placeholder="Name" aria-label="Bond ' + (i + 1) + ' name">' +
        '<input class="in rel" data-f="bonds.' + i + '.relationship" value="' + esc(x.relationship) + '" placeholder="Relationship" aria-label="Bond ' + (i + 1) + ' relationship"><span class="sc" title="Score = CHA">' + s.CHA + '</span></div>' +
        '<textarea class="in ds" data-f="bonds.' + i + '.description" placeholder="Who they are to the Agent, in a line or two…" aria-label="Bond ' + (i + 1) + ' description">' + esc(x.description) + '</textarea>' +
        '<div class="acts"><span class="nr-k" data-bond-msg="' + i + '">' + esc(ui.bondMsg && ui.bondMsg[i] || '') + '</span>' +
        '<button type="button" class="nr-btn mini" data-a="bond-ai" data-i="' + i + '"' + (busy ? ' disabled' : '') + '>' + (busy ? 'Writing…' : 'Generate') + '</button>' +
        (x.gen ? '<button type="button" class="nr-btn mini" data-a="bond-another" data-i="' + i + '">⚄ Another</button>' : '') + '</div></div>';
    }).join('');
    return wrap(head(6, 'Bonds', 'The people who keep the Agent human. ' + (pi.title ? esc(pi.title) + ' starts with ' + n + (n === 1 ? ' Bond' : ' Bonds') : 'This Agent has ' + n + (n === 1 ? ' Bond' : ' Bonds')) +
      '; each begins at CHA (' + s.CHA + '). Write your own, or draw one from the generator and make it yours. Generate drafts a description from the name, relationship and the Agent so far; edit it freely.') +
      '<div class="nr-chips"><button type="button" class="nr-btn red" data-a="bond-gen">⚄ Generate a Bond</button><span class="nr-k" style="align-self:center">from:</span>' + cats + '</div>' +
      cards + (n ? '' : '<p class="nr-k">No Bonds: Hard Experience took this Agent\'s only one.</p>') + foot('Personal data', 'Motivations'));
  }
  function drawBond(i) {
    var avoid = (W.bonds || []).map(function (b) { return b.name; });
    var b = D().randomBond(W.bondCats, avoid);
    if (!b) { ui.err = 'Pick at least one category to draw from.'; return; }
    W.bonds[i] = { name: b.name, relationship: b.relationship || '', description: b.description || '', gen: true };
  }
  function bondAi(i) {
    var x = W.bonds[i];
    if (!x || !String(x.name || '').trim()) { setBondMsg(i, 'Give them a name first.'); return; }
    if (!W.code || !window.dgStore || !window.dgStore.generateBondDescription) { setBondMsg(i, 'Not available right now; write it yourself.'); return; }
    ui.bondBusy[i] = true; render();
    var pi = profInfo(W) || {};
    window.dgStore.generateBondDescription(W.code, {
      agent: { name: W.bio.name, profession: pi.title || '', employer: W.bio.employer, age: W.bio.age, sex: W.bio.sex, nationality: W.bio.nationality },
      bond: { name: x.name, relationship: x.relationship }, existing: x.description || ''
    }).then(function (res) {
      var text = String((res && (res.description || res.text)) || '').trim();
      if (!text) throw new Error('empty');
      W.bonds[i].description = text; saveDraft();
      setBondMsg(i, '');
    }).catch(function (err) {
      console.warn('recruit: bond description', err);
      setBondMsg(i, 'Could not write one just now; try again, or write it yourself.');
    }).then(function () { ui.bondBusy[i] = false; if (W.step === 6) render(); });
  }
  function setBondMsg(i, t) { ui.bondMsg = ui.bondMsg || {}; ui.bondMsg[i] = t; var el = root && root.querySelector('[data-bond-msg="' + i + '"]'); if (el) el.textContent = t; }

  // Step 7: Motivations & Mental Disorders.
  function motHtml() {
    var m = W.motivations || [];
    var dis = window.dgDisorders ? window.dgDisorders.list : [];
    var rows = m.map(function (t, i) {
      return '<div class="nr-line"><input class="in" data-f="motivations.' + i + '" value="' + esc(t) + '" placeholder="A motivation…" aria-label="Motivation ' + (i + 1) + '">' +
        '<button type="button" class="nr-btn mini" data-a="mot-roll" data-i="' + i + '">⚄ Roll</button><button type="button" class="x" data-a="mot-rm" data-i="' + i + '" aria-label="Remove">×</button></div>';
    }).join('');
    var dl = (W.disorders || []).map(function (t, i) {
      return '<div class="nr-line"><span style="flex:1">' + esc(t) + '</span><button type="button" class="x" data-a="dis-rm" data-i="' + i + '" aria-label="Remove">×</button></div>';
    }).join('');
    var vetDis = W.vet && W.vet.unnatural && W.vetDisorder ? '<div class="nr-line"><span style="flex:1">' + esc(W.vetDisorder) + ' <span class="nr-k">(Damaged Veteran)</span></span></div>' : '';
    return wrap(head(7, 'Motivations & Mental Disorders', 'Up to five things that keep the Agent going. A new Agent usually has no disorders; a Damaged Veteran may.') + rows +
      (m.length < 5 ? '<div class="nr-chips" style="margin-top:6px"><button type="button" class="nr-btn mini" data-a="mot-add">+ Another motivation</button></div>' : '') +
      '<div class="nr-lbl">Mental Disorders <span class="nr-k">from the Rules reference, or your own</span></div>' + vetDis + dl +
      '<div class="nr-line"><select class="in" data-u="dis-pick" aria-label="Add a disorder"><option value="">Add a disorder… (none)</option>' + dis.map(function (dd) { return '<option>' + esc(dd.name) + '</option>'; }).join('') + '</select>' +
      '<input class="in" data-u="dis-own" placeholder="…or in your own words" aria-label="Own disorder"><button type="button" class="nr-btn mini" data-a="dis-add">Add</button></div>' +
      foot('Bonds', 'Incursion'));
  }

  // Step 8: Incursion.
  function incHtml() {
    return wrap(head(8, 'The Incursion', 'What brought the Agent to Delta Green. Roll it, mix and match the parts, or write it yourself.') +
      '<div class="nr-panel" data-inc></div>' + foot('Motivations', 'Equipment'));
  }

  // Step 9: Equipment.
  function equipHtml() {
    var kit = kitList(W), cat = CAT(), sv = skillVals(W).v, pi = profInfo(W) || {};
    function note(name) {
      var it = cat.filter(function (c) { return c.name === name; })[0];
      if (!it) return 'own';
      var s = it.system || {};
      if (it.type === 'weapon') return 'weapon · ' + (s.isLethal ? s.lethality + '%' : s.damage || '') + (s.skill ? ' · ' + labelOf('key:' + s.skill) + ' ' + (sv['key:' + s.skill] || 0) + '%' : '');
      if (it.type === 'armor') return 'armor ' + s.protection;
      return it.category.toLowerCase();
    }
    var cats = []; cat.forEach(function (c) { if (cats.indexOf(c.category) === -1) cats.push(c.category); });
    var g = ui.gearCat || cats[0] || '';
    return wrap(head(9, 'Equipment', (pi.title ? 'A ' + esc(pi.title) + '\'s usual kit, ticked' : 'The usual kit, ticked') + '. Untick what they don\'t carry; add anything from the catalog or in your own words.') +
      '<div class="nr-kit">' + kit.map(function (k, i) {
        return '<label><input type="checkbox" data-a="kit" data-i="' + i + '"' + (k.on ? ' checked' : '') + '>' + esc(k.name) + '<span class="k">' + esc(note(k.name)) + '</span></label>';
      }).join('') + (W.extra || []).map(function (x, i) {
        return '<label><input type="checkbox" checked data-a="extra-rm" data-i="' + i + '">' + esc(x) + '<span class="k">' + esc(note(x)) + '</span></label>';
      }).join('') + '</div>' +
      '<div class="nr-kitadd"><select class="in" data-u="gear-cat" style="max-width:180px">' + cats.map(function (c) { return '<option' + (c === g ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>' +
      '<select class="in" data-u="gear-item">' + cat.filter(function (c) { return c.category === g; }).map(function (c) { return '<option>' + esc(c.name) + '</option>'; }).join('') + '</select>' +
      '<button type="button" class="nr-btn red" data-a="gear-add">+ From the catalog</button></div>' +
      '<div class="nr-kitadd"><input class="in" data-u="gear-own" placeholder="…or write one in"><button type="button" class="nr-btn ghost" data-a="gear-own">+ Write one in</button></div>' +
      '<p class="nr-k" style="margin-top:8px">The kit comes from the profession\'s Tools of the Trade (the rulebooks\' examples where they have them, real-world ones for the rest), matched to the equipment catalog so armor and weapons carry their numbers.</p>' +
      foot('Incursion', 'Profiling'));
  }

  // Step 10: Profiling -- the Agent File's own Appearance brief and plates.
  function profilingHtml() {
    var era = W.era || '20s';
    return wrap(head(10, 'Profiling', 'How the Agent looks: the whole Appearance brief, the same one as on Agent Hub. Every field goes into the Face Plate and Outfit Plate. Pick the play era first; clothing and hair follow it.') +
      '<div class="nr-lbl" style="margin-top:0">Play era <span class="nr-k">clothing and hair follow it</span></div>' +
      '<div class="nr-era">' + ERAS.map(function (e) { return chip(e[1], era === e[0], 'data-a="era" data-e="' + e[0] + '"'); }).join('') + '</div>' +
      '<p class="nr-k" style="margin-top:8px">Fill in the brief (Generate fills it for you) and save it with the button at its foot; then the era\'s page opens below it: the Face Plate first, then the Outfit Plate. Other eras can be added later on Agent Hub.</p>' +
      '<div class="nr-afslot" data-afslot>' + (W.code ? '' : '<p class="nr-k">Needs the Agent Code from step 5.</p>') + '</div>' +
      foot('Equipment', 'Review & Contract', 'You can go on before the photos are made; Agent Hub reminds you.'), true);
  }

  // Step 11: review, then the Contract.
  function reviewHtml() {
    var st = build(W), pi = profInfo(W) || {}, b = st.bio;
    function box(t, step, body) { return '<div class="nr-panel"><h5>' + esc(t) + '<button type="button" data-a="goto" data-s="' + step + '">edit</button></h5>' + body + '</div>'; }
    var s = R().stats(st), dv = R().derived(clone(st));
    var top = R().skillList(clone(st)).filter(function (x) { return x.value >= 40; }).sort(function (a, c) { return c.value - a.value; }).slice(0, 10);
    var gear = (st.lpWeapons || []).map(function (w) { return w.name; }).concat((st.equipment || []).map(function (e) { return typeof e === 'string' ? e : e.name; }));
    var inc = st.bio.incursion && window.dgIncursion ? window.dgIncursion.textOf(st.bio.incursion) : '';
    var html = '<div class="nr-review">' +
      box('Statistics', 1, '<div class="nr-mini-stats" style="margin:0">' + STATS.map(function (k) { return '<div>' + k + '<b>' + s[k] + '</b></div>'; }).join('') + '</div><div class="nr-k" style="margin-top:6px">HP ' + dv.hp + ' · WP ' + dv.wp + ' · SAN ' + dv.san + ' · BP ' + dv.bp + '</div>') +
      box('Profession', W.imported ? 0 : 2, esc(W.imported ? (W.importedLabel || 'Imported') : pi.title || '—') + (pi.employer ? ' <span class="nr-k">(' + esc(pi.employer) + ')</span>' : '') +
        '<div class="nr-k" style="margin-top:4px">' + top.map(function (x) { return esc(x.label) + ' ' + x.value + '%'; }).join(' · ') + '</div>') +
      box('Who they are', 5, esc(b.name || '—') + (b.codename ? ' “' + esc(b.codename) + '”' : '') + (b.age ? ', ' + esc(b.age) : '') + (b.nationality ? ', ' + esc(b.nationality) : '') +
        (b.employer ? '<br>' + esc(b.employer) : '') + (b.pastEmployer ? ' <span class="nr-k">(formerly ' + esc(b.pastEmployer) + ')</span>' : '') + '<br><span class="nr-k">Code ' + esc(W.code || '—') + '</span>') +
      box('Bonds', 6, (st.bonds || []).map(function (x) { return esc(x.name) + (x.relationship ? ' (' + esc(x.relationship) + ')' : '') + ' ' + x.score; }).join(' · ') || '<span class="nr-k">none</span>') +
      box('Motivations & disorders', 7, (R().motivations(st).map(esc).join(' · ') || '<span class="nr-k">no motivations yet</span>') + ((b.disorders || []).length ? '<br><span class="nr-k">Disorders: ' + b.disorders.map(esc).join(', ') + '</span>' : '')) +
      box('Incursion', 8, inc ? esc(inc) : '<span class="nr-k">not written yet</span>') +
      box('Equipment', 9, gear.length ? esc(gear.join(' · ')) : '<span class="nr-k">none</span>') +
      box('Appearance', 10, '<span data-review-brief class="nr-k">' + esc(ui.briefState || 'checking…') + '</span>') + '</div>';
    return wrap(head(11, 'Review & Contract', 'Everything in one place. Tap edit to go back to a step; nothing is lost.') + html +
      '<div class="nr-err" role="alert" data-err>' + esc(ui.err) + '</div>' +
      '<div class="nr-foot"><button type="button" class="nr-btn ghost" data-a="back">◂ Profiling</button><span class="nr-k">Signing opens the Contract. Y files the Agent and opens their Agent File; N brings you back here.</span>' +
      '<button type="button" class="nr-btn red" data-a="sign"' + (ui.busy ? ' disabled' : '') + '>' + esc(ui.busy || 'Sign the Contract') + ' ▸</button></div>', true);
  }

  var VIEWS = [startHtml, statsHtml, profHtml, bonusHtml, vetHtml, personalHtml, bondsHtml, motHtml, incHtml, equipHtml, profilingHtml, reviewHtml];
  var shownStep = -1;
  function render() {
    if (!root) return;
    var step = W ? W.step : 0;
    if (shownStep === 10 && window.dgAgentFile && window.dgAgentFile.park) window.dgAgentFile.park();
    var y = window.scrollY;
    root.innerHTML = (W && step ? VIEWS[step] : startHtml)();
    var changed = shownStep !== step;
    shownStep = W ? step : 0;
    if (W && step === 8) mountIncursion();
    if (W && step === 10) mountProfiling();
    if (W && step === 11) checkBrief();
    if (changed) {
      var top = root.getBoundingClientRect().top + window.scrollY - 70;
      if (window.scrollY > top) window.scrollTo(0, Math.max(0, top));
    } else window.scrollTo(0, y);
  }
  function refreshSide() {
    var el = root && root.querySelector('[data-side]');
    if (el) el.outerHTML = side();
  }
  function mountIncursion() {
    var el = root.querySelector('[data-inc]');
    if (!el || !window.dgIncursion) return;
    window.dgIncursion.mount(el, W.incursion || window.dgIncursion.empty(), { onChange: function (v) { W.incursion = v; saveDraft(); } });
  }
  var briefEraFor = '';
  function mountProfiling() {
    var slot = root.querySelector('[data-afslot]');
    if (!slot || !W.code || !window.dgAgentFile) return;
    if (window.dgHub && window.dgHub.homeAppearance) window.dgHub.homeAppearance();
    var era = W.era || '20s';
    var key = W.code + '|' + era;
    var ready = briefEraFor === key ? Promise.resolve() : window.dgStore.getBrief(W.code).then(function (b) {
      var eras = [];
      try { eras = JSON.parse((b && b.active_eras) || '[]'); } catch (e) { eras = []; }
      if (!Array.isArray(eras)) eras = [];
      if (eras[0] === era && (b && b.campaign_era) === era) return;
      eras = [era].concat(eras.filter(function (x) { return x !== era; }));
      return window.dgStore.updateBrief(W.code, { active_eras: JSON.stringify(eras), campaign_era: era });
    }).then(function () { briefEraFor = key; }, function (err) { console.warn('recruit: play era not saved', err); });
    ready.then(function () {
      if (W.step !== 10 || !root.contains(slot)) return;
      window.dgAgentFile.reload(slot, W.code);
      var ap = document.getElementById('af-appear');
      if (ap) ap.classList.add('af-open');
    });
  }
  function checkBrief() {
    if (!W.code || !window.dgStore) { ui.briefState = 'no Agent Code yet'; return; }
    window.dgStore.getBrief(W.code).then(function (b) {
      var face = b && window.dgStore.mainPhoto ? window.dgStore.mainPhoto(b) : '';
      var done = window.dgAgentFile && window.dgAgentFile.code() === W.code && window.dgAgentFile.complete();
      ui.briefState = (b && b.submitted_at && (done || b.build) ? 'Brief on file' : 'Brief not finished') + (face ? ' · Face Plate made' : ' · no Face Plate yet');
    }, function () { ui.briefState = 'could not check'; }).then(function () {
      var el = root && root.querySelector('[data-review-brief]');
      if (el) el.textContent = ui.briefState;
    });
  }

  /* ── Moving between steps ── */
  function problem(step) {
    var pi = profInfo(W);
    if (step === 1) {
      var used = STATS.reduce(function (t, k) { return t + num(W.stats[k]); }, 0);
      if (STATS.some(function (k) { var v = num(W.stats[k]); return v < 3 || v > 18; })) return 'Every statistic must be between 3 and 18.';
      if (W.mode === 'point' && used !== 72) return used < 72 ? 'Spend all 72 points (' + (72 - used) + ' left).' : 'That\'s ' + (used - 72) + ' points over 72.';
    }
    if (step === 2) {
      if (!pi) return 'Pick a profession.';
      if (pi.own) {
        var o = W.prof.own, used2 = (o.skills || []).reduce(function (t, s) { return t + num(s.points); }, 0);
        if ((o.skills || []).length !== 10) return 'Pick ten professional skills (' + (o.skills || []).length + ' so far).';
        if (used2 !== ownBudget(W)) return 'Spend exactly ' + ownBudget(W) + ' points (' + (ownBudget(W) - used2) + ' left).';
        if ((o.skills || []).some(function (s) { return baseOf(s.id) + num(s.points) > 60; })) return 'No professional skill may go above 60%.';
      }
      if (pi.limit && (W.prof.opt || []).length !== pi.limit) return 'Choose ' + pi.limit + ' of the optional skills (' + (W.prof.opt || []).length + ' so far).';
      var unnamed = pi.skills.filter(function (s) { return s.needsSpec && !s.spec; });
      if (unnamed.length) return 'Name the ' + R().SPEC_LABEL[unnamed[0].key] + ' specialty.';
    }
    if (step === 3) { var left = 8 - boostsUsed(); if (left > 0) return 'Place all eight boosts (' + left + ' left).'; }
    if (step === 4) {
      if (W.vet.hard && (W.vetHard || []).filter(Boolean).length < 4) return 'Hard Experience: pick four skills.';
      if (W.vet.hard && new Set((W.vetHard || []).filter(Boolean)).size < 4) return 'Hard Experience: four different skills.';
      if (W.vet.unnatural && !W.vetDisorder) return 'Things Man Was Not Meant to Know: choose the disorder it left.';
    }
    if (step === 5 && !String(W.bio.name || '').trim()) return 'The Agent needs a name.';
    if (step === 6) {
      var n = W.imported ? W.bonds.length : bondCount(W);
      var empty = (W.bonds || []).slice(0, n).filter(function (b) { return !String(b.name || '').trim(); }).length;
      if (!W.imported && empty) return empty === 1 ? 'One Bond still needs a name.' : empty + ' Bonds still need a name.';
    }
    return '';
  }
  function go(step) {
    ui.err = ''; ui.pickStat = '';
    W.step = step; W.reached = Math.max(W.reached || 0, step);
    saveDraft(true);
    if (W.code) saveCloud();
    render();
  }
  function next() {
    var p = problem(W.step);
    if (p) { ui.err = p; var e = root.querySelector('[data-err]'); if (e) e.textContent = p; return; }
    if (W.step === 2) onProfessionSet();
    if (W.step === 5) { ensureCode().then(function (ok) { if (ok) go(6); }); return; }
    go(W.imported ? nextImported(W.step) : W.step + 1);
  }
  function back() { go(W.imported ? prevImported(W.step) : Math.max(1, W.step - 1)); }
  // An import skips what it already carries: statistics, profession,
  // bonus skills and Damaged Veteran.
  function nextImported(s) { return s < 5 ? 5 : s + 1; }
  function prevImported(s) { return s <= 5 ? 0 : s - 1; }
  function onProfessionSet() {
    var id = profId(W);
    if (W.bonusFor === id) return;
    W.bonusFor = id; W.bonus = {}; W.pkg = -1; W.bonusExtra = [];
    var pi = profInfo(W);
    (pi ? pi.bonus : []).forEach(function (b) {
      var x = parseSkill(b);
      var bid = x.id || (x.key && (R().SPECIALTY_OPTIONS[x.key] || [])[0] ? 'spec:' + x.key + ':' + R().SPECIALTY_OPTIONS[x.key][0] : '');
      if (!bid || bid === 'key:unnatural' || boostsUsed() >= 8) return;
      if (bid.indexOf('spec:') === 0 && W.bonusExtra.indexOf(bid) === -1) W.bonusExtra.push(bid);
      W.bonus[bid] = num(W.bonus[bid]) + 1;
    });
    if (!W.bio.employer && pi && pi.employer) W.bio.employer = pi.employer;
  }
  // Step 5 -> 6: the Agent Code (and their brief) is made, or updated.
  function briefFields() {
    var pi = profInfo(W) || {};
    var f = { char_name: String(W.bio.name || '').trim(), codename: String(W.bio.codename || '').trim(), nationality: String(W.bio.nationality || '').trim(), profession: W.imported ? (W.importedLabel || '') : pi.title || '' };
    if (W.bio.sex) f.sex = W.bio.sex === 'Non-binary' ? 'Other' : W.bio.sex;
    var ar = ageRange(W.bio.age); if (ar) f.age_range = ar;
    var ci = coverIdentity(); if (ci) f.player_name = ci;
    return f;
  }
  function ensureCode() {
    if (!window.dgStore) { ui.err = 'Not connected; try again in a moment.'; render(); return Promise.resolve(false); }
    ui.busy = W.code ? 'Saving…' : 'Making the Agent Code…'; render();
    var f = briefFields();
    var work = W.code ? window.dgStore.updateBrief(W.code, f).then(function () { return W.code; })
      : window.dgStore.submitBrief(f);
    return work.then(function (code) {
      W.code = code;
      ui.busy = '';
      saveDraft(true);
      return saveCloud().then(function () { return true; });
    }, function (err) {
      console.warn('recruit: Agent Code', err);
      ui.busy = ''; ui.err = 'Could not save the Agent Code (' + String((err && err.message) || err).slice(0, 100) + '). Check your connection and try again.';
      render();
      return false;
    });
  }

  /* ── Signing ── */
  function sign() {
    if (!W.code) { ui.err = 'The Agent needs their Agent Code first (step 5).'; render(); return; }
    var st = build(W);
    var inc = st.bio.incursion && window.dgIncursion ? window.dgIncursion.textOf(st.bio.incursion) : '';
    var pi = profInfo(W) || {};
    var FN = window.dgFieldNotes;
    var ask = FN && FN.contract ? FN.contract({ code: W.code, name: st.bio.name, profession: W.imported ? W.importedLabel : pi.title, incursion: inc })
      : Promise.resolve(window.confirm('Sign the Contract and file ' + (st.bio.name || 'this Agent') + '?'));
    ask.then(function (yes) {
      if (!yes) { render(); return; }
      fileAgent(st);
    });
  }
  function fileAgent(st) {
    var code = W.code, S = window.dgStore;
    st.creationCommitted = true;
    ui.busy = 'Filing…'; ui.err = ''; render();
    var now = new Date().toISOString();
    var writes = [S.saveCharacter(code, st), S.updateBrief(code, Object.assign(briefFields(), { standing_orders_ack_at: now }))];
    if (st.bio.incursion && S.saveIncursion) writes.push(S.saveIncursion(code, st.bio.incursion, 'player'));
    Promise.all(writes).then(function () {
      // On this device: the roster, and the Agent the Dice Roller rolls for.
      try {
        var roster = JSON.parse(lsGet(ROSTER_KEY) || '{}'), ex = roster[code] || {};
        var f = briefFields();
        roster[code] = Object.assign({}, ex, { code: code, char_name: f.char_name, codename: f.codename, sex: f.sex || ex.sex || '', age_range: f.age_range || ex.age_range || '',
          nationality: f.nationality, player_name: f.player_name || ex.player_name || '', active_eras: ex.active_eras || JSON.stringify([W.era || '20s']), campaign_era: ex.campaign_era || W.era || '20s', saved_at: Date.now() });
        lsSet(ROSTER_KEY, JSON.stringify(roster));
      } catch (e) { /* best effort */ }
      lsSet(CLOUD_CODE_KEY, code);
      try { window.dispatchEvent(new CustomEvent('dg-cloud-code-set', { detail: { code: code } })); } catch (e) { /* old engine */ }
      lsDel(DRAFT_KEY);
      var filed = code;
      W = null; ui = { err: '', busy: '', pickStat: '', bondBusy: {}, bonusSpec: 'foreign_language', gearCat: '' }; shownStep = -1;
      render();
      try { window.dispatchEvent(new CustomEvent('dg-recruit-filed', { detail: { code: filed } })); } catch (e) { /* old engine */ }
    }, function (err) {
      console.warn('recruit: filing', err);
      ui.busy = ''; ui.err = 'Could not file the Agent (' + String((err && err.message) || err).slice(0, 100) + '). Nothing is lost; try again.';
      render();
    });
  }

  /* ── Events ── */
  function setPath(path, val) {
    var p = path.split('.'), o = W;
    for (var i = 0; i < p.length - 1; i++) { if (o[p[i]] == null) o[p[i]] = /^\d+$/.test(p[i + 1]) ? [] : {}; o = o[p[i]]; }
    o[p[p.length - 1]] = val;
  }
  function onInput(e) {
    var t = e.target, f = t.getAttribute && t.getAttribute('data-f');
    if (!f || !W) return;
    var v = t.value;
    if (t.hasAttribute('data-num')) v = num(v, 0);
    setPath(f, v);
    saveDraft();
    if (f.indexOf('bio.') === 0 || f.indexOf('bonds.') === 0) refreshSide();
    if (f.indexOf('prof.own.skills.') === 0) {
      var o = W.prof.own, used = o.skills.reduce(function (s, x) { return s + num(x.points); }, 0), el = root.querySelector('[data-own-left]');
      if (el) el.textContent = ownBudget(W) - used;
    }
    if (f.indexOf('prof.specs.') === 0 && e.type === 'change') render();
    if (t.hasAttribute('data-rerender') && e.type === 'change') render();
  }
  function onChange(e) {
    var t = e.target, u = t.getAttribute && t.getAttribute('data-u');
    if (t.getAttribute && t.getAttribute('data-f')) { onInput(e); return; }
    if (t.matches && t.matches('[data-file]')) { if (t.files && t.files[0]) importFile(t.files[0]); t.value = ''; return; }
    if (!u || !W && u !== 'load-code' && u !== 'pregen') return;
    if (u === 'pkg') { var i = num(t.value, -1); if (i >= 0) applyPackage(i); else { W.pkg = -1; } saveDraft(); render(); }
    else if (u === 'bspec-kind') { ui.bonusSpec = t.value; render(); }
    else if (u === 'vet-hard') { W.vetHard = W.vetHard || []; W.vetHard[num(t.getAttribute('data-i'))] = t.value; saveDraft(); render(); }
    else if (u === 'vet-dis') { W.vetDisorder = t.value; saveDraft(); render(); }
    else if (u === 'gear-cat') { ui.gearCat = t.value; render(); }
    else if (u === 'ci') { lsSet(CI_KEY, String(t.value || '').trim()); }
  }
  function val(sel) { var el = root.querySelector(sel); return el ? String(el.value || '').trim() : ''; }
  function onClick(e) {
    var b = e.target.closest('[data-a]');
    if (!b || !root.contains(b)) return;
    var a = b.getAttribute('data-a'), i = num(b.getAttribute('data-i'), -1);
    if (b.tagName === 'INPUT' && b.type === 'checkbox') { /* handled below, keep default toggle */ } else if (a !== 'drop') e.preventDefault();
    ui.err = '';
    switch (a) {
      case 'begin': W = freshDraft(); go(1); return;
      case 'resume': W = loadDraft() || freshDraft(); go(W.step || 1); return;
      case 'discard': discardDraft(); return;
      case 'drop': { var fi = root.querySelector('[data-file]'); if (fi && e.target === b || fi && !e.target.closest('input')) fi.click(); return; }
      case 'start-code': ui.start = ui.start === 'code' ? '' : 'code'; render(); return;
      case 'start-friendly': ui.start = ui.start === 'friendly' ? '' : 'friendly'; render(); if (ui.start === 'friendly' && !ui.pregens) loadPregens(); return;
      case 'load-code': { var c = val('[data-u="load-code"]').toUpperCase(); if (c) location.href = ROOT + 'agent-hub.html?code=' + encodeURIComponent(c); return; }
      case 'use-pregen': usePregen(num(val('[data-u="pregen"]'), 0)); return;
      case 'goto': go(num(b.getAttribute('data-s'), W.step)); return;
      case 'next': next(); return;
      case 'back': back(); return;
      case 'sign': sign(); return;
    }
    if (!W) return;
    switch (a) {
      case 'mode':
        W.mode = b.getAttribute('data-m');
        if (W.mode === 'point') W.stats = { STR: 12, CON: 12, DEX: 12, INT: 12, POW: 12, CHA: 12 };
        else rollStats();
        break;
      case 'reroll': rollStats(); break;
      case 'st': { var k = b.getAttribute('data-k'), dd = num(b.getAttribute('data-d')); W.stats[k] = clamp(num(W.stats[k]) + dd, 3, 18); break; }
      case 'swap': {
        var k2 = b.getAttribute('data-k');
        if (!ui.pickStat) ui.pickStat = k2;
        else { var t = W.stats[ui.pickStat]; W.stats[ui.pickStat] = W.stats[k2]; W.stats[k2] = t; ui.pickStat = ''; }
        break;
      }
      case 'feat': { var k3 = b.getAttribute('data-k'); W.feat[k3] = D().suggestFeature(k3, num(W.stats[k3]), W.feat[k3]); break; }
      case 'pfilter': W.filter = b.getAttribute('data-f'); break;
      case 'prof': {
        var src = b.getAttribute('data-src'), key = b.getAttribute('data-key');
        W.prof.src = src; W.prof.key = src === 'post' ? '' : key; W.prof.posting = src === 'post' ? num(key) : -1;
        W.prof.opt = []; W.prof.specs = {};
        saveDraft(); render();
        var det = root.querySelector('[data-detail]');
        if (det && det.scrollIntoView) det.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        return;
      }
      case 'opt': {
        var o = W.prof.opt = W.prof.opt || [], at = o.indexOf(i);
        if (at === -1) o.push(i); else o.splice(at, 1);
        break;
      }
      case 'own-add': {
        var id = val('[data-u="own-add"]'), sp = val('[data-u="own-spec"]');
        if (/^spec:[^:]+:$/.test(id)) { if (!sp) { ui.err = 'Name the specialty first.'; break; } id += sp; }
        if (!id || W.prof.own.skills.some(function (x) { return x.id === id; })) break;
        W.prof.own.skills.push({ id: id, points: 0 });
        break;
      }
      case 'own-rm': W.prof.own.skills.splice(i, 1); break;
      case 'bonus': {
        var bid = b.getAttribute('data-id'), d2 = num(b.getAttribute('data-d'));
        W.bonus[bid] = Math.max(0, num(W.bonus[bid]) + d2);
        if (!W.bonus[bid]) delete W.bonus[bid];
        W.pkg = -1;
        break;
      }
      case 'bspec-add': {
        var nm = val('[data-u="bspec-name"]');
        if (!nm) { ui.err = 'Name the specialty.'; break; }
        var sid = 'spec:' + ui.bonusSpec + ':' + nm;
        if (W.bonusExtra.indexOf(sid) === -1) W.bonusExtra.push(sid);
        break;
      }
      case 'vet': {
        if (e.target.closest('select, .nr-sub')) return;
        var vk = b.getAttribute('data-k');
        W.vet[vk] = !W.vet[vk];
        break;
      }
      case 'vet-none': W.vet = {}; W.vetHard = []; W.vetDisorder = ''; break;
      case 'randbio': randomBio(); break;
      case 'bcat': { var cc = b.getAttribute('data-c'), ci2 = W.bondCats.indexOf(cc); if (ci2 === -1) W.bondCats.push(cc); else W.bondCats.splice(ci2, 1); break; }
      case 'bond-gen': {
        var n = W.imported ? W.bonds.length : bondCount(W);
        var slot = W.bonds.slice(0, n).findIndex(function (x) { return !String(x.name || '').trim(); });
        if (slot === -1) { ui.err = 'Every Bond is filled in; use ⚄ Another on a generated one, or clear a name.'; break; }
        drawBond(slot);
        break;
      }
      case 'bond-another': drawBond(i); break;
      case 'bond-ai': bondAi(i); return;
      case 'mot-roll': W.motivations[i] = R().rollMotivation() || W.motivations[i]; break;
      case 'mot-add': if (W.motivations.length < 5) W.motivations.push(''); break;
      case 'mot-rm': W.motivations.splice(i, 1); break;
      case 'dis-add': { var dn = val('[data-u="dis-own"]') || val('[data-u="dis-pick"]'); if (dn && W.disorders.indexOf(dn) === -1) W.disorders.push(dn); break; }
      case 'dis-rm': W.disorders.splice(i, 1); break;
      case 'kit': { var kl = kitList(W); if (kl[i]) kl[i].on = !kl[i].on; break; }
      case 'extra-rm': W.extra.splice(i, 1); break;
      case 'gear-add': { var gi = val('[data-u="gear-item"]'); if (gi) W.extra.push(gi); break; }
      case 'gear-own': { var go2 = val('[data-u="gear-own"]'); if (go2) W.extra.push(go2); break; }
      case 'era': W.era = b.getAttribute('data-e'); break;
      default: return;
    }
    saveDraft();
    render();
  }
  function onKey(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var b = e.target.closest && e.target.closest('[role="button"][data-a]');
    if (b && root.contains(b)) { e.preventDefault(); b.click(); }
  }
  function rollStats() {
    if (W.mode === 'roll') {
      STATS.forEach(function (k) { var r = [d(6), d(6), d(6), d(6)].sort(function (a, b) { return a - b; }); W.stats[k] = r[1] + r[2] + r[3]; });
    } else {
      // 72 points spread at random, each 3-18.
      var s = { STR: 3, CON: 3, DEX: 3, INT: 3, POW: 3, CHA: 3 }, left = 72 - 18;
      while (left > 0) { var k = pick(STATS); if (s[k] < 18) { s[k]++; left--; } }
      W.stats = s;
    }
    STATS.forEach(function (k) { if (!W.feat[k]) W.feat[k] = D().suggestFeature(k, W.stats[k]); });
  }
  function discardDraft() {
    var dr = loadDraft();
    var ask = window.dgConfirm ? window.dgConfirm('Discard this draft' + (dr && dr.bio && dr.bio.name ? ' (' + dr.bio.name + ')' : '') + '?' + (dr && dr.code ? ' Its Agent Code ' + dr.code + ' goes to Recently Deleted (a Handler can bring it back for 24 hours).' : ''), { ok: 'Discard', cancel: 'Keep it' })
      : Promise.resolve(window.confirm('Discard this draft?'));
    ask.then(function (yes) {
      if (!yes) return;
      lsDel(DRAFT_KEY);
      if (dr && dr.code && window.dgStore && window.dgStore.deleteOwnAgent) {
        window.dgStore.deleteOwnAgent(dr.code).catch(function (err) { console.warn('recruit: draft Agent not removed', err); });
        try { var r = JSON.parse(lsGet(ROSTER_KEY) || '{}'); if (r[dr.code]) { delete r[dr.code]; lsSet(ROSTER_KEY, JSON.stringify(r)); } } catch (e) { /* best effort */ }
      }
      W = null; render();
    });
  }

  /* ── Friendlies and imports ── */
  function loadPregens() {
    fetch(ROOT + 'friendly/pregens.json').then(function (r) { return r.json(); }).then(function (j) {
      ui.pregens = (Array.isArray(j) ? j : j.pregens || j.agents || []).filter(function (p) { return p && p.name && p.stats; });
    }, function () { ui.pregens = []; }).then(function () { if (!W) render(); });
  }
  function usePregen(i) {
    var p = (ui.pregens || [])[i];
    if (!p) return;
    loadSheetLib().then(function (AS) {
      var st = AS.pregenToState(p, coverIdentity());
      startImported(st, 'Friendly: ' + p.name, p.profession || '');
    }, function () { ui.err = 'Could not load the Friendly.'; render(); });
  }
  function loadSheetLib() { return loadScript('assets/agent-sheet.js', has('dgAgentSheet')).then(function () { return window.dgAgentSheet; }); }
  // An imported character becomes the draft; the wizard asks about what
  // it may not carry, from Personal data on.
  function startImported(st, from, label) {
    W = freshDraft();
    W.imported = st; W.importedFrom = from; W.importedLabel = label || (st.bio && st.bio.profession) || 'Imported';
    var b = st.bio || {};
    ['name', 'codename', 'employer', 'pastEmployer', 'nationality', 'sex', 'age', 'education'].forEach(function (k) { if (b[k] != null) W.bio[k] = String(b[k]); });
    W.bonds = (st.bonds || []).map(function (x) { return { id: x.id, name: x.name || '', relationship: x.relationship || '', description: x.description || '', score: x.score, gen: false }; });
    W.motivations = R().motivations(st);
    if (!W.motivations.length) W.motivations = [''];
    W.disorders = R().disorders(st);
    W.incursion = b.incursion || null;
    W.reached = 11;
    go(5);
  }
  function importFile(file) {
    var I = window.dgAgentImport;
    var load = I ? Promise.resolve(I) : loadScript('assets/agent-import.js', has('dgAgentImport')).then(function () { return window.dgAgentImport; });
    ui.err = ''; ui.busy = 'Reading ' + file.name + '…';
    load.then(function (imp) {
      if (!imp) throw new Error('The importer is not available yet.');
      return imp.read(file);
    }).then(function (res) {
      ui.busy = '';
      startImported(res.state, res.from || file.name, res.label);
    }, function (err) {
      ui.busy = ''; ui.err = 'Could not read ' + file.name + ': ' + String((err && err.message) || err).slice(0, 160);
      render();
    });
  }
  function wireDrop() {
    root.addEventListener('dragover', function (e) { var z = e.target.closest && e.target.closest('[data-drop]'); if (!z) return; e.preventDefault(); z.classList.add('over'); });
    root.addEventListener('dragleave', function (e) { var z = e.target.closest && e.target.closest('[data-drop]'); if (z) z.classList.remove('over'); });
    root.addEventListener('drop', function (e) {
      var z = e.target.closest && e.target.closest('[data-drop]');
      if (!z) return;
      e.preventDefault(); z.classList.remove('over');
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) importFile(f);
    });
  }

  /* ── Showing the wizard ── */
  var readyP = null;
  function show() {
    root = root || document.getElementById('nr-root');
    if (!root) return Promise.resolve();
    if (!root._wired) {
      root._wired = true;
      root.addEventListener('click', onClick);
      root.addEventListener('input', onInput);
      root.addEventListener('change', onChange);
      root.addEventListener('keydown', onKey);
      wireDrop();
    }
    if (!readyP) {
      root.innerHTML = '<p class="nr-busy">Opening a new case file…</p>';
      readyP = deps().then(function () {
        var params = new URLSearchParams(location.search);
        var dr = loadDraft();
        if (params.get('recruit') === 'resume' && dr) { W = dr; }
        render();
      }, function (err) {
        readyP = null;
        root.innerHTML = '<p class="nr-err">Could not open the wizard (' + esc(err && err.message || err) + '). <button type="button" class="nr-btn mini" data-retry>Try again</button></p>';
        var r = root.querySelector('[data-retry]'); if (r) r.onclick = show;
      });
      return readyP;
    }
    return readyP.then(function () { if (shownStep === 10 || (W && W.step === 10)) render(); });
  }

  window.dgRecruit = {
    show: show, build: build, freshDraft: freshDraft,
    startImported: function (st, from, label) { return show().then(function () { startImported(st, from, label); }); },
    _w: function () { return W; }, _set: function (w) { W = w; render(); }
  };
  // Agent Hub may have opened + New Recruit before this script loaded.
  var pn = document.getElementById('panel-new');
  if (pn && pn.classList.contains('active')) show();
})();
