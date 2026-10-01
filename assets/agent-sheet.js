/* ══════════════════════════════════════════════
   AGENT SHEET -- the one Agent File "paper" the app shows in two places:
   the Field Notes notebook's Agent File page (assets/field-notes.js) and
   each Agent's folder in the Agent Hub roster (agent-hub.html). Same
   markup, same styles (assets/agent-sheet.css), so the two never drift.

   Layout follows Friendly's one-player dossier (friendly.html): name and
   vitals up top, then Statistics (×5), Skills, Weapons, Bonds -- every
   number a button that rolls through the Dice Roller -- with the Agent's
   photo, a short physical description and the Cell (bold, members
   listed under it) above the sheet.

   Also: fromPregen()/pregenToState() turn a Friendly pregen
   (friendly/pregens.json) into a real character sheet, for Friendly's
   "Make this my Agent" (a stats/index.html native v1 state, the same
   shape dgSaveLoad.collectState() produces).
   ══════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.dgAgentSheet) return;

  var STATS = ['STR', 'CON', 'DEX', 'INT', 'POW', 'CHA'];
  // stats/scripts.js CONFIG.SKILLS -- key, label (kept in step by hand;
  // an unknown key still shows, title-cased).
  var SKILL_LABELS = {
    accounting: 'Accounting', alertness: 'Alertness', anthropology: 'Anthropology', archeology: 'Archeology',
    art: 'Art', artillery: 'Artillery', athletics: 'Athletics', bureaucracy: 'Bureaucracy',
    computer_science: 'Computer Science', craft: 'Craft', criminology: 'Criminology', demolitions: 'Demolitions',
    disguise: 'Disguise', dodge: 'Dodge', drive: 'Drive', firearms: 'Firearms', first_aid: 'First Aid',
    forensics: 'Forensics', heavy_machiner: 'Heavy Machinery', heavy_weapons: 'Heavy Weapons', history: 'History',
    humint: 'HUMINT', law: 'Law', medicine: 'Medicine', melee_weapons: 'Melee Weapons',
    military_science: 'Military Science', navigate: 'Navigate', occult: 'Occult', persuade: 'Persuade',
    pharmacy: 'Pharmacy', pilot: 'Pilot', psychotherapy: 'Psychotherapy', ride: 'Ride', science: 'Science',
    search: 'Search', sigint: 'SIGINT', stealth: 'Stealth', surgery: 'Surgery', survival: 'Survival',
    swim: 'Swim', unarmed_combat: 'Unarmed Combat', unnatural: 'Unnatural'
  };
  var SPECIALTY = { art: 1, craft: 1, military_science: 1, pilot: 1, science: 1 };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function labelFor(key) {
    return SKILL_LABELS[key] || String(key || '').replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }
  function keyForLabel(label) {
    var l = String(label || '').trim().toLowerCase();
    for (var k in SKILL_LABELS) if (SKILL_LABELS[k].toLowerCase() === l) return k;
    return null;
  }
  function num(v, d) { v = parseInt(v, 10); return isNaN(v) ? (d == null ? 0 : d) : v; }

  /* ── One normalized sheet shape, from either source ── */
  // { name, sub, stats:{STR:{value,x5}}, derived:{hp,wp,san,bp}, skills:[{name,value}],
  //   weapons:[{name,skill,damage}], bonds:[{name,relationship,score}], physical }
  function fromState(state) {
    state = state || {};
    var bio = state.bio || {};
    var src = state.csStats || state.stats || {};
    var stats = {};
    STATS.forEach(function (k) { var v = num(src[k], 0); stats[k] = { value: v, x5: v * 5 }; });
    var skills = [];
    var specs = state.skillSpecs || {};
    Object.keys(state.skills || {}).forEach(function (k) {
      if (SPECIALTY[k]) return; // listed via specialtyInstances below
      var v = num(state.skills[k]);
      if (v > 0) skills.push({ name: labelFor(k) + (specs[k] ? ' (' + specs[k] + ')' : ''), value: v });
    });
    (state.specialtyInstances || []).forEach(function (i) {
      if (num(i.value) > 0) skills.push({ name: labelFor(i.key) + (i.specialty ? ' (' + i.specialty + ')' : ''), value: num(i.value) });
    });
    (state.customSkills || []).forEach(function (c) {
      if (c && c.name && num(c.value) > 0) skills.push({ name: c.name, value: num(c.value) });
    });
    skills.sort(function (a, b) { return a.name.localeCompare(b.name); });
    var weapons = (state.lpWeapons || []).filter(function (w) { return w && w.name; }).map(function (w) {
      var leth = String(w.lethality || '').trim();
      return { name: w.name, skill: num(w.skillPct, 0), damage: w.damage || (leth ? (/%$/.test(leth) ? leth : leth + '%') : '') };
    });
    var bonds = (state.bonds || []).filter(function (b) { return b && b.name; })
      .map(function (b) { return { name: b.name, relationship: b.relationship || '', score: b.score }; });
    var d = state.derived || {};
    return {
      name: bio.name || '', profession: bio.profession || '', employer: bio.employer || '',
      stats: stats, derived: { hp: d.hp, wp: d.wp, san: d.san, bp: d.bp },
      skills: skills, weapons: weapons, bonds: bonds, physical: bio.physicalDesc || ''
    };
  }
  function fromPregen(p) {
    return {
      name: p.name, profession: p.profession, employer: p.employer,
      stats: p.stats, derived: p.derived,
      skills: p.skills.filter(function (s) { return s.value > 0; }),
      weapons: p.weapons.map(function (w) { return { name: w.name, skill: w.skill, damage: w.damage || w.kill_damage || '' }; }),
      bonds: p.bonds, physical: p.physical
    };
  }

  /* ── A Friendly pregen as a real character sheet (native v1 state) ── */
  function pregenToState(p, playerName) {
    var stats = {};
    STATS.forEach(function (k) { stats[k] = p.stats[k].value; });
    var skills = {}, specialtyInstances = [], customSkills = [];
    p.skills.forEach(function (s, i) {
      var m = /^(.+?)\s*\((.+)\)$/.exec(s.name);
      var base = m ? m[1] : s.name;
      var key = keyForLabel(base);
      if (m && key && SPECIALTY[key]) {
        specialtyInstances.push({ id: 'fr-' + key + '-' + i, key: key, specialty: m[2], value: s.value, source: 'profession' });
      } else if (!m && key) {
        skills[key] = s.value;
      } else {
        customSkills.push({ fromProfession: true, name: s.name, value: s.value });
      }
    });
    return {
      v: 1, stats: stats, csStats: stats,
      derived: { hp: p.derived.hp, wp: p.derived.wp, san: p.derived.san, bp: p.derived.bp },
      bio: {
        player_name: playerName || '', name: p.name, profession: p.profession, employer: p.employer || '',
        nationality: p.nationality || '', sex: p.sex || '', age: p.age ? String(p.age) + (p.dob ? ' (' + p.dob + ')' : '') : '',
        education: p.education || '', physicalDesc: p.physical || '',
        motivations: (p.motivations || []).join('\n'), personalDetails: ''
      },
      skills: skills, skillSpecs: {}, customSkills: customSkills, specialtyInstances: specialtyInstances,
      bonds: p.bonds.map(function (b, i) { return { id: 'bond-fr-' + i, name: b.name, relationship: b.relationship || '', description: '', score: b.score }; }),
      lpWeapons: p.weapons.map(function (w) {
        return { name: w.name, skillPct: w.skill != null ? String(w.skill) : '', range: w.range || '', damage: w.damage || '',
          lethality: w.kill_damage || '', ammo: w.ammo || '' };
      }),
      equipment: [], professionSkillsApplied: true, creationCommitted: true
    };
  }

  /* ── Short physical description from the Agent File (Profiling) ── */
  function lc(s) { return String(s || '').trim().toLowerCase(); }
  // A short description from the Agent File's profiling: who, build, hair
  // and eyes -- the glance a witness would give. (The full detail stays
  // on the Agent File itself.)
  function physical(brief, fallback) {
    var b = brief || {};
    var parts = [];
    // the first clause of a long profiling answer is the useful part
    // ...without its own full stop: "black." would read "black., eyes"
    var bare = function (t) { return String(t || '').trim().replace(/[\s.!?…:]+$/, ''); };
    var short = function (t) { return bare(lc(String(t || '').split(/[,;—–(]| - /)[0])); };
    var cap = function (t) { return t.charAt(0).toUpperCase() + t.slice(1); };
    var who = [bare(b.age_range), short(b.sex), bare(b.nationality)].filter(Boolean).join(' ');
    if (who) parts.push(cap(who) + '.');
    // "wiry build", but "build average in every dimension"
    var with_ = function (t, noun) { t = short(t); return t.split(/\s+/).length <= 2 ? t + ' ' + noun : noun + ' ' + t; };
    var look = [b.build ? with_(b.build, 'build') : '',
      (b.hair_color ? with_(b.hair_color, 'hair') : ''),
      (b.eye_color ? with_(b.eye_color, 'eyes') : '')].filter(Boolean).join(', ');
    if (look) parts.push(cap(look) + '.');
    var s = parts.join(' ');
    return s || String(fallback || '');
  }

  /* ── The paper ── */
  // opts: { photoHtml, subtitle, cellName, members:[{name,codename}], actionsHtml, noteHtml, emptySheetHtml }
  function render(sheet, opts) {
    opts = opts || {};
    var d = sheet.derived || {};
    function vital(l, v) { return '<div class="as-vital"><div class="as-lbl">' + l + '</div><div class="as-val">' + esc(v == null || v === '' ? '—' : v) + '</div></div>'; }
    var head =
      '<div class="as-head">' +
        (opts.photoHtml ? '<div class="as-photo">' + opts.photoHtml + '</div>' : '') +
        '<div class="as-id"><div class="as-name">' + esc(sheet.name || opts.fallbackName || 'Unnamed Agent') + '</div>' +
          '<div class="as-sub">' + esc(opts.subtitle || [sheet.profession, sheet.employer].filter(Boolean).join(' · ')) + '</div></div>' +
        (sheet.stats ? '<div class="as-vitals">' + vital('HP', d.hp) + vital('WP', d.wp) + vital('SAN', d.san) + vital('BP', d.bp) + '</div>' : '') +
      '</div>';
    var actions = opts.actionsHtml ? '<div class="as-actions">' + opts.actionsHtml + '</div>' : '';
    var phys = opts.physical || sheet.physical;
    var about =
      '<div class="as-about">' +
        (phys ? '<div class="as-sec"><div class="as-sec-hd">Physical description</div><p class="as-text">' + esc(phys) + '</p></div>' : '') +
        '<div class="as-sec"><div class="as-sec-hd">Cell</div>' +
          (opts.cellName
            ? '<div class="as-cell"><b>' + esc(opts.cellName) + '</b>' +
              '<ul class="as-members">' + ((opts.members || []).length ? opts.members.map(function (m) {
                return '<li>' + esc(m.name) + (m.codename ? ' <span class="as-k">“' + esc(m.codename) + '”</span>' : '') + '</li>';
              }).join('') : '<li class="as-k">Only you so far.</li>') + '</ul></div>'
            : '<p class="as-text as-k">Not assigned to a Cell yet — your Handler does that.</p>') +
          (opts.opsHtml || '') +
        '</div>' +
      '</div>' +
      // The Incursion: what brought the Agent to Delta Green.
      (opts.incursion ? '<div class="as-sec as-incursion"><div class="as-sec-hd">The Incursion</div><p class="as-text">' + esc(opts.incursion) + '</p></div>'
        : (opts.incursionEmptyHtml ? '<div class="as-sec as-incursion"><div class="as-sec-hd">The Incursion</div>' + opts.incursionEmptyHtml + '</div>' : ''));
    if (!sheet.stats) {
      return '<div class="as-paper">' + head + actions + about + (opts.emptySheetHtml || '') + (opts.noteHtml || '') + '</div>';
    }
    var stats = STATS.map(function (k) {
      var s = sheet.stats[k] || { value: 0, x5: 0 };
      return '<button type="button" class="as-stat" data-roll="' + s.x5 + '" data-label="' + k + ' ×5">' +
        '<div class="as-lbl">' + k + '</div><div class="as-val">' + s.value + '</div><div class="as-x5">' + s.x5 + '%</div></button>';
    }).join('');
    var skills = sheet.skills.map(function (s) {
      return '<button type="button" class="as-roll' + (s.value >= 50 ? ' as-strong' : '') + '" data-roll="' + s.value + '" data-label="' + esc(s.name) + '">' +
        '<span class="as-sn">' + esc(s.name) + '</span><span class="as-sv">' + s.value + '%</span></button>';
    }).join('') + '<button type="button" class="as-roll" data-roll="50" data-label="Luck"><span class="as-sn">Luck</span><span class="as-sv">50%</span></button>';
    var weapons = sheet.weapons.length ? '<table class="as-weapons"><tbody>' + sheet.weapons.map(function (w) {
      var dmg = w.damage || '';
      var rollable = /^\s*\d*d\d+\s*([+-]\s*\d+)?\s*$/i.test(dmg) || /\d+\s*%/.test(dmg);
      return '<tr><td class="as-wn">' + esc(w.name) + '</td>' +
        '<td>' + (w.skill ? '<button type="button" class="as-roll as-chip" data-roll="' + w.skill + '" data-label="' + esc(w.name) + '"><span class="as-sv">' + w.skill + '%</span></button>' : '') + '</td>' +
        '<td>' + (dmg && rollable ? '<button type="button" class="as-roll as-chip" data-damage="' + esc(dmg) + '" data-label="' + esc(w.name) + ' damage"><span class="as-sv">' + esc(dmg) + '</span></button>' : esc(dmg)) + '</td></tr>';
    }).join('') + '</tbody></table>' : '<p class="as-text as-k">None.</p>';
    var bonds = sheet.bonds.length ? sheet.bonds.map(function (b) {
      return '<div class="as-row"><span>' + esc(b.name) + (b.relationship ? ' <span class="as-k">· ' + esc(b.relationship) + '</span>' : '') + '</span><span class="as-score">' + esc(b.score == null ? '' : b.score) + '</span></div>';
    }).join('') : '<p class="as-text as-k">No bonds on the sheet yet.</p>';
    return '<div class="as-paper">' + head + actions + about +
      '<div class="as-sheet">' +
        // A sheet with no statistics rolled yet: no row of zeros.
        (STATS.some(function (k) { return sheet.stats[k] && sheet.stats[k].value > 0; })
          ? '<div class="as-sec-hd">Statistics <span>×5</span></div><div class="as-stats">' + stats + '</div>' : '') +
        '<div class="as-sec-hd">Skills</div><div class="as-skills">' + skills + '</div>' +
        '<div class="as-cols"><div><div class="as-sec-hd">Weapons</div>' + weapons + '</div>' +
        '<div><div class="as-sec-hd">Bonds</div>' + bonds + '</div></div>' +
      '</div>' + (opts.noteHtml || '') + '</div>';
  }

  // Rolls: every stat/skill/weapon number on the paper rolls through the
  // page's Dice Roller (or the Hub shell's, relayed -- see dice-roller.js).
  function wireRolls(el) {
    if (!el || el._asWired) return;
    el._asWired = true;
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-roll],[data-damage]');
      if (!b || !el.contains(b) || !window.dgDice) return;
      if (b.dataset.damage) {
        if (window.dgDice.rollExpr && window.dgDice.rollExpr(b.dataset.damage, b.dataset.label)) return;
        var pct = /(\d+)\s*%/.exec(b.dataset.damage);
        if (pct && window.dgDice.roll) window.dgDice.roll(parseInt(pct[1], 10), b.dataset.label.replace(/ damage$/, '') + ' lethality');
      } else if (window.dgDice.roll) {
        window.dgDice.roll(parseInt(b.dataset.roll, 10), b.dataset.label);
      }
    });
  }

  // The photo block: the Face Plate, or a yellow "Take Photo" post-it
  // covering the whole Polaroid when there isn't one yet.
  function photoHtml(takePhotoAttr) {
    return '<div class="as-polaroid"><div class="as-polaroid-img" data-as-photo>' +
      '<button type="button" class="as-take-photo" ' + (takePhotoAttr || '') + '>Take Photo</button></div></div>';
  }

  // What happened in the Agent's incursion: the copy on the Agent's own
  // record (characters/{code}.incursion -- the latest, possibly the
  // Handler's) over the one inside the sheet.
  function incursionText(charDoc, state) {
    var v = (charDoc && charDoc.incursion) || (state && state.bio && state.bio.incursion) || null;
    if (!v) return '';
    if (window.dgIncursion) return window.dgIncursion.textOf(v);
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch (e) { return v; } }
    return String((v && v.text) || '').trim();
  }

  window.dgAgentSheet = {
    fromState: fromState, fromPregen: fromPregen, pregenToState: pregenToState,
    physical: physical, render: render, wireRolls: wireRolls, photoHtml: photoHtml, esc: esc, incursionText: incursionText
  };
})();
