/* The Agent File as the character sheet: the paper shown in the Field
   Notes notebook and on Agent Hub, played at the table and edited in
   place. Rules: assets/agent-rules.js (dgRules). Saving and the live
   document: assets/agent-live.js (dgAgentLive). Looks:
   assets/agent-sheet.css + assets/agent-paper.css.

   Play mode (always on): HP/WP/SAN − / +, Roll SAN, SAN loss (with the
   post-its it sets off), skills that mark themselves on a failed roll and
   improve at the end of the session, Bond scores, new Bonds, Motivations,
   Mental Disorders, incidents, weapons, gear, wounds. Every change saves
   by itself.

   Edit mode (✎ Edit): statistics, every skill, BP, personal data, the
   existing Bonds/Motivations/Disorders/weapons, description and
   distinguishing features, on a copy; Save asks for the Oath, Y files it.

   window.dgAgentPaper = { mount(el, ctx) } */
(function () {
  'use strict';
  if (window.dgAgentPaper) return;

  var ROOT = (function () {
    var s = document.currentScript && document.currentScript.src;
    return s ? s.replace(/assets\/agent-paper\.js.*$/, '') : '';
  })();
  function R() { return window.dgRules; }
  function D() { return window.dgDisorders; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(v, d) { v = parseInt(v, 10); return isNaN(v) ? (d == null ? 0 : d) : v; }
  function cap(s) { return String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1); }

  /* ── Data the paper loads on demand (pure data files) ── */
  var loaded = {};
  function loadScript(path, test) {
    if (test()) return Promise.resolve();
    if (loaded[path]) return loaded[path];
    loaded[path] = new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = ROOT + path;
      s.onload = function () { resolve(); };
      s.onerror = function () { loaded[path] = null; resolve(); };
      document.head.appendChild(s);
    });
    return loaded[path];
  }
  function motivationData() { return loadScript('stats/bio.js', function () { return typeof window.motivationsData !== 'undefined' || typeof motivationsData !== 'undefined'; }); } // eslint-disable-line no-undef
  function catalog() { return loadScript('stats/equipment-data.js', function () { return !!window.DG_EQUIPMENT_CATALOG; }); }

  /* ── Dice: through the Dice Roller, so every roll is in the history ── */
  // rollExpr('1d6', label) -> Promise of the total. The Dice Roller
  // announces each finished roll ('dg-dice-result'); if it's busy or
  // absent, the roll is made here and logged.
  function rollExpr(expr, label) {
    expr = String(expr).toLowerCase();
    var dd = window.dgDice;
    if (!/^\d*d\d+$/.test(expr)) return Promise.resolve(num(expr));
    return new Promise(function (resolve) {
      var done = false;
      function finish(v, logged) {
        if (done) return;
        done = true;
        window.removeEventListener('dg-dice-result', onRes);
        clearTimeout(t);
        if (!logged && dd && dd.recordRoll) {
          try { dd.recordRoll({ roll_type: 'expr', label: label, value: v, target: null, tier: null, sides: null, expr: expr, breakdown: null }); } catch (e) { /* history only */ }
        }
        resolve(v);
      }
      function onRes(e) {
        var r = e.detail || {};
        if (r.roll_type === 'expr' && r.label === label) finish(num(r.value), true);
      }
      window.addEventListener('dg-dice-result', onRes);
      var t = setTimeout(function () { R().localRoll(expr).then(function (v) { finish(v, false); }); }, 6000);
      var ok = dd && dd.rollExpr ? dd.rollExpr(expr, label) : false;
      if (ok === false) { clearTimeout(t); R().localRoll(expr).then(function (v) { finish(v, false); }); }
    });
  }
  // A percentile roll; onFail runs if the Dice Roller calls it a failure.
  var pendingPct = [];
  window.addEventListener('dg-dice-result', function (e) {
    var r = e.detail || {};
    if (r.roll_type !== 'percent') return;
    var now = Date.now();
    pendingPct = pendingPct.filter(function (p) { return now - p.at < 15000; });
    for (var i = 0; i < pendingPct.length; i++) {
      if (pendingPct[i].label === r.label) {
        var p = pendingPct.splice(i, 1)[0];
        if ((r.tier === 'failure' || r.tier === 'fumble') && p.onFail) p.onFail();
        return;
      }
    }
  });
  function rollPct(target, label, onFail) {
    if (onFail) pendingPct.push({ label: label, at: Date.now(), onFail: onFail });
    if (window.dgDice && window.dgDice.roll) window.dgDice.roll(target, label);
  }

  /* ── Post-its: over the whole page, one tap to dismiss ── */
  function postits(list) {
    if (!list.length) return;
    var ov = document.getElementById('ap-posts');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'ap-posts';
      ov.setAttribute('role', 'dialog');
      ov.setAttribute('aria-label', 'Sanity');
      ov.innerHTML = '<div class="ap-posts-stack"></div>';
      ov.addEventListener('click', function (e) { if (e.target === ov) closeAll(); });
      document.body.appendChild(ov);
    }
    var stack = ov.querySelector('.ap-posts-stack');
    list.forEach(function (p) {
      var n = document.createElement('div');
      n.className = 'ap-postit' + (p.tone ? ' ap-' + p.tone : '');
      n.innerHTML = '<button type="button" class="ap-x" aria-label="Dismiss">×</button><b class="ap-pt">' + esc(p.title) + '</b><div class="ap-pb">' + p.html + '</div>' +
        (p.actions && p.actions.length ? '<div class="ap-pa">' + p.actions.map(function (a, i) { return '<button type="button" data-pa="' + i + '">' + esc(a.label) + '</button>'; }).join('') + '</div>' : '');
      n.querySelector('.ap-x').addEventListener('click', function () { dismiss(n); });
      Array.prototype.forEach.call(n.querySelectorAll('[data-pa]'), function (b) {
        b.addEventListener('click', function () {
          var a = p.actions[+b.getAttribute('data-pa')];
          var keep = a.fn && a.fn(n);
          if (!keep) dismiss(n);
        });
      });
      stack.appendChild(n);
    });
    function dismiss(n) { n.remove(); if (!stack.children.length) ov.remove(); }
    function closeAll() { ov.remove(); }
  }

  /* ── The look of the parts' headings: a per-device choice ── */
  var LOOK_KEY = 'dg_paper_look';
  var LOOKS = [['form', 'Typed form'], ['folder', 'Folder tabs'], ['stamp', 'Rubber stamps']];
  function look() {
    var v = '';
    try { v = localStorage.getItem(LOOK_KEY) || ''; } catch (e) { /* private mode */ }
    return LOOKS.some(function (l) { return l[0] === v; }) ? v : 'form';
  }
  function applyLook() {
    var v = look();
    Array.prototype.forEach.call(document.querySelectorAll('.as-paper.ap'), function (p) {
      LOOKS.forEach(function (l) { p.classList.toggle('ap-look-' + l[0], l[0] === v); });
    });
  }
  function setLook(v) {
    try { localStorage.setItem(LOOK_KEY, v); } catch (e) { /* private mode */ }
    applyLook();
  }
  // Other pages and frames of this site pick the change up as it happens.
  window.addEventListener('storage', function (e) { if (e.key === LOOK_KEY) applyLook(); });

  /* ── The paper ── */
  function mount(el, ctx) {
    var s = window.dgAgentLive.session(ctx.code, ctx.char);
    // The drop-downs stay as they were when the host draws the paper again.
    var ui = { pop: '', san: { amount: '1d6', kind: 'violence', other: '' }, card: -1, gearCat: '', appear: !!el._apAppear, cellOpen: !!el._apCell, eraOpen: !!el._apEra };
    var members = (ctx.members || []).slice();
    var unwatch = [];

    function st() { return s.edit || s.state; }
    function scroller() {
      var n = el;
      while (n && n !== document.body) { if (n.scrollHeight > n.clientHeight + 2 && /(auto|scroll)/.test(getComputedStyle(n).overflowY)) return n; n = n.parentElement; }
      return document.scrollingElement;
    }
    function render() {
      var sc = scroller(), top = sc ? sc.scrollTop : 0;
      el.innerHTML = s.state ? paperHtml() : emptyHtml();
      // Only when the redraw moved it: setting it anyway would stop a
      // smooth scroll already on its way (a #photos link on Agent Hub).
      if (sc && sc.scrollTop !== top) sc.scrollTop = top;
      if (ctx.onPhoto) ctx.onPhoto(el);
      fillThumbs();
      filterSkills();
    }
    function emptyHtml() {
      return '<div class="as-paper ap"><div class="as-head">' + (ctx.photoHtml ? '<div class="as-photo">' + ctx.photoHtml + '</div>' : '') +
        '<div class="as-id"><div class="as-name">' + esc(ctx.name || ctx.code) + '</div></div></div>' + (ctx.emptySheetHtml || '') + '</div>';
    }

    /* Head: name, vitals, buttons */
    function headHtml(x, edit) {
      var bio = x.bio || {}, d = R().derived(x), m = R().maxes(x);
      function box(k, label, max) {
        return '<div class="ap-v" data-v="' + k + '"><div class="as-lbl">' + label + '</div><div class="ap-cur">' + d[k] + '</div>' +
          '<div class="ap-max">' + (max != null ? 'of ' + max : (k === 'bp' ? (edit ? '± POW (' + R().stats(x).POW + ')' : 'breaking pt') : '&nbsp;')) + '</div>' +
          ((!edit && k !== 'bp') || (edit && k === 'bp') ? '<div class="ap-pmrow"><button type="button" class="ap-pm" data-a="' + k + '-" aria-label="' + label + ' down">−</button><button type="button" class="ap-pm" data-a="' + k + '+" aria-label="' + label + ' up">+</button></div>' : '') +
          '</div>';
      }
      var sub = [ctx.professionLabel ? ctx.professionLabel(bio.profession) : bio.profession, ctx.codename ? 'Cover “' + ctx.codename + '”' : ''].filter(Boolean).join(' · ');
      return '<div class="as-head ap-head">' +
        (ctx.photoHtml ? '<div class="as-photo">' + ctx.photoHtml + dropBtns() + '</div>' : '') +
        '<div class="as-id">' +
          (edit ? '<input class="ap-in ap-name-in" data-e="bio.name" value="' + esc(bio.name) + '" aria-label="Name">' : '<div class="as-name">' + esc(bio.name || ctx.name || 'Unnamed Agent') + '</div>') +
          '<div class="as-sub">' + esc(sub) + '</div>' +
          '<div class="ap-vitals">' + box('hp', 'HP', m.hp) + box('wp', 'WP', m.wp) + box('san', 'SAN', m.san) + box('bp', 'BP', null) + '</div>' +
          (edit ? '' : '<div class="ap-btns"><button type="button" class="ap-btn ap-red" data-a="rollsan"' + (d.san > 0 ? '' : ' disabled') + '>Roll SAN</button>' +
            '<button type="button" class="ap-btn ap-red" data-a="pop" data-pop="san" aria-expanded="' + (ui.pop === 'san') + '">SAN loss ' + (ui.pop === 'san' ? '▴' : '▾') + '</button>' +
            '<button type="button" class="ap-btn ap-ink" data-a="edit">✎ Edit</button>' + (ctx.actionsHtml || '') + '</div>') +
          (!edit && ui.pop === 'san' ? sanPopHtml() : '') +
          '<div class="ap-status" data-ap-status="' + esc(s.code) + '">' + esc(s.status || '') + '</div>' +
        '</div></div>';
    }
    function sanPopHtml() {
      var amounts = ['1', '2', '3', '1d4', '1d6', '1d8', '1d10', '1d20', '1d100'];
      var a = ui.san.amount;
      return '<div class="ap-pop" data-popbox="san"><div class="ap-pop-h">SAN loss — as the Handler announced</div>' +
        '<div class="ap-k">Amount</div><div class="ap-chips">' + amounts.map(function (v) {
          return '<button type="button" class="ap-chip' + (a === v ? ' on' : '') + '" data-a="san-amt" data-v="' + v + '">' + v.toUpperCase() + '</button>';
        }).join('') + '<button type="button" class="ap-chip' + (a === 'other' ? ' on' : '') + '" data-a="san-amt" data-v="other">Other…</button></div>' +
        (a === 'other' ? '<input class="ap-in" data-u="san-other" placeholder="A number, or dice like 2D6" value="' + esc(ui.san.other) + '" style="margin-bottom:8px">' : '') +
        '<div class="ap-k">Kind</div><div class="ap-chips">' + R().KINDS.map(function (k) {
          return '<button type="button" class="ap-chip' + (ui.san.kind === k ? ' on' : '') + '" data-a="san-kind" data-v="' + k + '">' + cap(k) + '</button>';
        }).join('') + '</div>' +
        '<div class="ap-btns"><button type="button" class="ap-btn ap-red" data-a="san-go">' + (/^\d+$/.test(a) ? 'Lose ' + a + ' SAN' : 'Roll ' + (a === 'other' ? 'it' : a.toUpperCase()) + ' and lose it') + '</button>' +
        '<button type="button" class="ap-btn ap-ghost" data-a="pop" data-pop="">Cancel</button></div>' +
        '<div class="ap-k ap-note">The loss is rolled in the Dice Roller and taken off SAN. Fix it with − / + if needed.</div></div>';
    }

    /* Cell: initiative by DEX */
    function selfMember(x) {
      var d = R().derived(x);
      return { code: s.code, name: (x.bio && x.bio.name) || ctx.name || s.code, codename: ctx.codename || '', dex: R().stats(x).DEX || null, kia: d.hp <= 0 && R().maxes(x).hp > 0, me: true,
        profession: x.bio && x.bio.profession, derived: d, photo: ctx.photo || '' };
    }
    function cellHtml(x) {
      if (!ctx.cellName) return '<div data-p="cell"><p class="as-text as-k">Not assigned to a Cell yet — your Handler does that.</p></div>';
      var list = members.concat([selfMember(x)]).sort(function (a, b) {
        if (!!a.kia !== !!b.kia) return a.kia ? 1 : -1;
        var da = a.dex == null ? -1 : a.dex, db = b.dex == null ? -1 : b.dex;
        return (db - da) || String(a.name).localeCompare(String(b.name));
      });
      var card = '';
      var rows = list.map(function (m, i) {
        var open = !m.me && ui.card === i;
        if (open) card = memberCard(m, i);
        return '<li class="' + (m.kia ? 'as-kia' : '') + (m.me ? ' ap-me' : '') + '"><span class="ap-dex">' + (m.dex == null ? '—' : m.dex) + '</span>' +
          '<button type="button" class="as-mbtn" data-a="' + (m.me ? '' : 'card') + '" data-i="' + i + '" aria-expanded="' + open + '"' + (m.me ? ' tabindex="-1"' : '') + '>' +
          '<span class="as-mthumb" data-ap-mphoto="' + esc(m.photo || '') + '"></span>' +
          '<span class="as-mname">' + esc(m.name) + '</span>' + (m.me ? ' <span class="as-k">(you)</span>' : '') +
          (m.codename ? ' <span class="as-k">“' + esc(m.codename) + '”</span>' : '') + (m.kia ? ' <span class="as-stamp">KIA</span>' : '') + '</button></li>';
      }).join('');
      return '<div data-p="cell"><div class="as-sec-hd">' + esc(ctx.cellName) + ' <span>initiative · highest DEX first</span></div><ol class="ap-init">' + rows + '</ol>' + card + '</div>';
    }
    function memberCard(m) {
      var d = m.derived || {};
      function v(l, x) { return '<div class="as-vital"><div class="as-lbl">' + l + '</div><div class="as-val">' + esc(x == null || x === '' ? '—' : x) + '</div></div>'; }
      var prof = ctx.professionLabel ? ctx.professionLabel(m.profession) : m.profession;
      return '<div class="as-mcard"><div class="as-mcard-photo" data-ap-cardphoto="' + esc(m.photo || '') + '">' + (m.photo ? '' : '<span class="as-k">No photo yet</span>') + '</div>' +
        '<div class="as-mcard-id"><div class="as-mcard-name">' + esc(m.name) + (m.kia ? ' <span class="as-stamp">KIA</span>' : '') + '</div>' +
        (prof ? '<div class="ap-mmeta">' + esc(prof) + '</div>' : '') +
        '<div class="ap-mmeta">' + (m.codename ? 'Cover “' + esc(m.codename) + '”' : 'No cover name') + (m.dex != null ? ' · DEX ' + m.dex : '') + '</div>' +
        '<div class="as-vitals">' + v('HP', d.hp) + v('WP', d.wp) + v('SAN', d.san) + v('BP', d.bp) + '</div></div></div>';
    }
    function fillThumbs() {
      if (!ctx.loadPhoto) return;
      Array.prototype.forEach.call(el.querySelectorAll('[data-ap-mphoto],[data-ap-cardphoto],[data-ap-era]'), function (b) {
        var src = b.getAttribute('data-ap-mphoto') || b.getAttribute('data-ap-cardphoto') || b.getAttribute('data-ap-era');
        if (src) ctx.loadPhoto(b, src);
      });
    }

    function statsHtml(x, edit) {
      var sv = R().stats(x), feat = x.lpFeat || {};
      return '<div class="as-stats">' + R().STATS.map(function (k) {
        if (edit) return '<div class="ap-stat-e"><div class="as-lbl">' + k + '</div><input class="ap-in ap-num" inputmode="numeric" data-e="stat:' + k + '" value="' + sv[k] + '" aria-label="' + k + '"><div class="as-x5">' + sv[k] * 5 + '%</div>' +
          '<input class="ap-in ap-feat" data-e="feat:' + k + '" placeholder="feature" value="' + esc(feat[k] || '') + '" aria-label="' + k + ' distinguishing feature"></div>';
        return '<button type="button" class="as-stat" data-a="pct" data-t="' + sv[k] * 5 + '" data-l="' + k + ' ×5"><div class="as-lbl">' + k + '</div><div class="as-val">' + sv[k] + '</div><div class="as-x5">×5 = ' + sv[k] * 5 + '%</div>' +
          (feat[k] ? '<div class="ap-feat-t">' + esc(feat[k]) + '</div>' : '') + '</button>';
      }).join('') + '</div>';
    }
    function skillsHtml(x, edit) {
      if (edit) {
        var all = R().skillList(x, { all: true });
        return (ui.pop === 'spec' ? specPopHtml() : '') + (ui.pop === 'own' ? ownPopHtml() : '') +
          '<div class="ap-k ap-note">Every skill, 0% too. Tap a name to set or clear its failed-roll mark.</div><div class="as-skills ap-skills-e">' +
          all.map(function (sk) {
            var spec = sk.kind === 'spec';
            var opts = spec ? (R().SPECIALTY_OPTIONS[sk.key] || []) : [];
            if (spec && sk.specialty && opts.indexOf(sk.specialty) === -1) opts = [sk.specialty].concat(opts);
            return '<div class="ap-sk' + (sk.marked ? ' ap-marked' : '') + (spec ? ' ap-spec' : '') + '">' +
              '<button type="button" class="ap-skn" data-a="mark" data-id="' + esc(sk.id) + '">' + esc(spec ? (R().SPEC_LABEL[sk.key] || sk.key) : sk.label) + '</button>' +
              (spec ? '<select class="ap-in ap-specsel" data-e="spec:' + esc(sk.id) + '" aria-label="Specialty">' + opts.map(function (o) { return '<option' + (o === sk.specialty ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>' : '') +
              '<input class="ap-in ap-num" inputmode="numeric" data-e="skill:' + esc(sk.id) + '" value="' + sk.value + '" aria-label="' + esc(sk.label) + '">%' +
              (sk.kind !== 'base' ? '<button type="button" class="ap-del" data-a="rm" data-what="skill" data-id="' + esc(sk.id) + '" aria-label="Remove ' + esc(sk.label) + '">×</button>' : '') +
              '</div>';
          }).join('') + '</div>';
      }
      var list = R().skillList(x);
      var n = list.filter(function (sk) { return sk.marked; }).length;
      return '<div class="ap-skillbar"><input class="ap-in ap-find" type="search" data-u="skill-find" placeholder="Find a skill…" value="' + esc(ui.find || '') + '" aria-label="Find a skill">' +
        '<button type="button" class="ap-mini" data-a="improve"' + (n ? '' : ' disabled') + '>Roll improvements' + (n ? ' (' + n + ' failed)' : '') + '</button></div>' +
        '<div class="as-skills">' +
        list.map(function (sk) {
          return '<button type="button" class="as-roll ap-skill' + (sk.marked ? ' ap-marked' : '') + (sk.value >= 50 ? ' as-strong' : '') + '" data-a="skill" data-id="' + esc(sk.id) + '" data-t="' + sk.value + '" data-l="' + esc(sk.label) + '">' +
            '<span class="as-sn">' + esc(sk.label) + '</span><span class="as-sv">' + sk.value + '%</span></button>';
        }).join('') + '<button type="button" class="as-roll" data-a="pct" data-t="50" data-l="Luck"><span class="as-sn">Luck</span><span class="as-sv">50%</span></button></div>';
    }
    function skillsTools(x, edit) {
      if (edit) return '<button type="button" class="ap-mini" data-a="pop" data-pop="spec">+ Specialty</button><button type="button" class="ap-mini" data-a="pop" data-pop="own">+ Own skill</button>';
      return '<span class="ap-part-note">tap to roll · a failed roll turns red</span>';
    }
    // "Find a skill": hides the rest, kept across redraws.
    function filterSkills() {
      var q = String(ui.find || '').trim().toLowerCase();
      Array.prototype.forEach.call(el.querySelectorAll('.ap-part[data-part="skills"] .as-skills > *'), function (n) {
        n.hidden = !!q && n.textContent.toLowerCase().indexOf(q) === -1;
      });
    }
    function specPopHtml() {
      var keys = Object.keys(R().SPECIALTY_OPTIONS);
      var g = ui.specKey || keys[0];
      return '<div class="ap-pop"><div class="ap-pop-h">Add a specialty</div><div class="ap-row">' +
        '<select class="ap-in" data-u="spec-key">' + keys.map(function (k) { return '<option value="' + k + '"' + (k === g ? ' selected' : '') + '>' + esc(R().SPEC_LABEL[k]) + '</option>'; }).join('') + '</select>' +
        '<input class="ap-in" data-u="spec-name" list="ap-spec-list" placeholder="Specialty"><datalist id="ap-spec-list">' + (R().SPECIALTY_OPTIONS[g] || []).map(function (o) { return '<option value="' + esc(o) + '">'; }).join('') + '</datalist>' +
        '<input class="ap-in ap-num" data-u="spec-val" inputmode="numeric" placeholder="%" value="0"></div>' +
        '<div class="ap-btns"><button type="button" class="ap-btn ap-ink" data-a="spec-add">Add</button><button type="button" class="ap-btn ap-ghost" data-a="pop" data-pop="">Cancel</button></div></div>';
    }
    function ownPopHtml() {
      return '<div class="ap-pop"><div class="ap-pop-h">Add a skill of your own</div><div class="ap-row">' +
        '<input class="ap-in" data-u="own-name" placeholder="Skill name"><input class="ap-in ap-num" data-u="own-val" inputmode="numeric" placeholder="%" value="0"></div>' +
        '<div class="ap-btns"><button type="button" class="ap-btn ap-ink" data-a="own-add">Add</button><button type="button" class="ap-btn ap-ghost" data-a="pop" data-pop="">Cancel</button></div></div>';
    }

    function bondsHtml(x, edit) {
      var bonds = (x.bonds || []).filter(Boolean);
      return '<div class="as-sec-hd ap-hd">Bonds ' + (edit ? '' : '<button type="button" class="ap-mini" data-a="pop" data-pop="bond">+ Bond</button>') + '</div>' +
        (ui.pop === 'bond' && !edit ? '<div class="ap-pop"><div class="ap-pop-h">New Bond (score = CHA ' + R().stats(x).CHA + ')</div><div class="ap-row">' +
          '<input class="ap-in" data-u="bond-name" placeholder="Name"><input class="ap-in" data-u="bond-rel" placeholder="Relationship"></div>' +
          '<div class="ap-btns"><button type="button" class="ap-btn ap-ink" data-a="bond-add">Add Bond</button><button type="button" class="ap-btn ap-ghost" data-a="pop" data-pop="">Cancel</button></div></div>' : '') +
        (bonds.length ? bonds.map(function (b, i) {
          if (edit) return '<div class="ap-bond"><input class="ap-in" data-e="bond:' + i + ':name" value="' + esc(b.name) + '" aria-label="Bond name"><input class="ap-in" data-e="bond:' + i + ':relationship" value="' + esc(b.relationship || '') + '" placeholder="Relationship" aria-label="Relationship">' +
            '<input class="ap-in ap-num" inputmode="numeric" data-e="bond:' + i + ':score" value="' + num(b.score) + '" aria-label="Score"><button type="button" class="ap-del" data-a="rm" data-what="bond" data-i="' + i + '" aria-label="Remove ' + esc(b.name) + '">×</button></div>';
          return '<div class="ap-bond"><span class="ap-bn">' + esc(b.name) + (b.relationship ? ' <span class="as-k">· ' + esc(b.relationship) + '</span>' : '') + '</span>' +
            '<button type="button" class="ap-pm" data-a="bond-" data-i="' + i + '" aria-label="' + esc(b.name) + ' down">−</button><span class="ap-bscore">' + num(b.score) + '</span>' +
            '<button type="button" class="ap-pm" data-a="bond+" data-i="' + i + '" aria-label="' + esc(b.name) + ' up">+</button></div>';
        }).join('') : '<p class="as-text as-k">No Bonds yet.</p>');
    }
    function motHtml(x, edit) {
      var list = R().motivations(x);
      return '<div class="as-sec-hd ap-hd">Motivations ' + (edit ? '' : '<span class="ap-hbtns"><button type="button" class="ap-mini" data-a="mot-roll">+ Roll</button><button type="button" class="ap-mini" data-a="pop" data-pop="mot">+ Write</button></span>') + '</div>' +
        (ui.pop === 'mot' && !edit ? '<div class="ap-pop"><div class="ap-row"><input class="ap-in" data-u="mot" placeholder="What keeps this Agent going?"></div>' +
          '<div class="ap-btns"><button type="button" class="ap-btn ap-ink" data-a="mot-add">Add</button><button type="button" class="ap-btn ap-ghost" data-a="pop" data-pop="">Cancel</button></div></div>' : '') +
        (list.length ? '<ul class="ap-list">' + list.map(function (m, i) {
          return '<li>' + (edit ? '<div class="ap-row"><input class="ap-in" data-e="mot:' + i + '" value="' + esc(m) + '" aria-label="Motivation"><button type="button" class="ap-del" data-a="rm" data-what="mot" data-i="' + i + '" aria-label="Remove">×</button></div>' : esc(m)) + '</li>';
        }).join('') + '</ul>' : '<p class="as-text as-k">None yet.</p>');
    }
    function disHtml(x, edit) {
      var list = R().disorders(x), Dd = D();
      function picker(sel, attr) {
        return '<select class="ap-in" ' + attr + '>' + (sel ? '' : '<option value="">Choose a disorder…</option>') +
          (Dd ? Dd.list : []).map(function (d) { return '<option' + (d.name === sel ? ' selected' : '') + '>' + esc(d.name) + '</option>'; }).join('') +
          (sel && !(Dd && Dd.find(sel)) ? '<option selected>' + esc(sel) + '</option>' : '') + '<option value="__other">Other…</option></select>';
      }
      return '<div class="as-sec-hd ap-hd">Mental Disorders ' + (edit ? '' : '<button type="button" class="ap-mini" data-a="pop" data-pop="dis">+ Disorder</button>') + '</div>' +
        (ui.pop === 'dis' && !edit ? '<div class="ap-pop"><div class="ap-row">' + picker('', 'data-u="dis"') + '</div>' +
          (ui.disOther ? '<div class="ap-row"><input class="ap-in" data-u="dis-other" placeholder="Name the disorder"></div>' : '') +
          '<div class="ap-btns"><button type="button" class="ap-btn ap-ink" data-a="dis-add">Add</button><button type="button" class="ap-btn ap-ghost" data-a="pop" data-pop="">Cancel</button></div></div>' : '') +
        (list.length ? '<ul class="ap-list">' + list.map(function (n, i) {
          var info = Dd ? Dd.describe(n) : '';
          return '<li>' + (edit ? '<div class="ap-row">' + picker(n, 'data-e="dis:' + i + '"') + '<button type="button" class="ap-del" data-a="rm" data-what="dis" data-i="' + i + '" aria-label="Remove">×</button></div>' : esc(n)) +
            (info ? '<span class="as-k ap-info">' + esc(info) + '</span>' : '') + '</li>';
        }).join('') + '</ul>' : '<p class="as-text as-k">None.</p>');
    }
    function adaptHtml(x, edit) {
      var sa = R().sanity(x), ad = x.adapted || {};
      function row(k, label, cost) {
        return '<div class="ap-adapt"><span class="ap-al">' + label + '</span>' + [0, 1, 2].map(function (i) {
          return '<input type="checkbox" data-a="adapt" data-k="' + k + '" data-i="' + i + '"' + (sa[k][i] ? ' checked' : '') + ' aria-label="' + label + ' incident ' + (i + 1) + '">';
        }).join('') + '<span class="as-k">' + (ad[k] ? '<b class="ap-adapted">Adapted</b>' : 'adapted at 3 · ' + cost) + '</span></div>';
      }
      return '<div class="as-sec-hd ap-hd">Sanity adaptation ' + (edit ? '' : '<button type="button" class="ap-mini" data-a="pop" data-pop="inc">+ Incident</button>') + '</div>' +
        (ui.pop === 'inc' && !edit ? '<div class="ap-pop"><div class="ap-pop-h">An incident of…</div><div class="ap-btns"><button type="button" class="ap-btn ap-ink" data-a="inc" data-k="violence">Violence</button>' +
          '<button type="button" class="ap-btn ap-ink" data-a="inc" data-k="helplessness">Helplessness</button><button type="button" class="ap-btn ap-ghost" data-a="pop" data-pop="">Cancel</button></div></div>' : '') +
        row('violence', 'Violence', '−1D6 CHA and each Bond') + row('helplessness', 'Helplessness', '−1D6 POW');
    }
    function weaponsHtml(x, edit) {
      var ws = (x.lpWeapons || []);
      var rows = ws.map(function (w, i) {
        if (!w) return '';
        if (edit) return '<tr><td><input class="ap-in" data-e="wep:' + i + ':name" value="' + esc(w.name) + '" aria-label="Weapon"></td><td><input class="ap-in ap-num" data-e="wep:' + i + ':skillPct" value="' + esc(w.skillPct) + '" aria-label="Skill %"></td>' +
          '<td><input class="ap-in ap-dmg" data-e="wep:' + i + ':damage" value="' + esc(w.damage || w.lethality || '') + '" aria-label="Damage"></td><td><button type="button" class="ap-del" data-a="rm" data-what="wep" data-i="' + i + '" aria-label="Remove">×</button></td></tr>';
        if (!w.name) return '';
        var dmg = w.damage || (w.lethality ? (/%$/.test(String(w.lethality)) ? w.lethality : w.lethality + '%') : '');
        var rollable = /^\s*\d*d\d+\s*([+-]\s*\d+)?\s*$/i.test(dmg);
        return '<tr><td class="as-wn">' + esc(w.name) + (w.range ? ' <span class="as-k">' + esc(w.range) + '</span>' : '') + '</td>' +
          '<td>' + (num(w.skillPct) ? '<button type="button" class="as-roll as-chip" data-a="pct" data-t="' + num(w.skillPct) + '" data-l="' + esc(w.name) + '"><span class="as-sv">' + num(w.skillPct) + '%</span></button>' : '') + '</td>' +
          '<td>' + (dmg ? (rollable ? '<button type="button" class="as-roll as-chip" data-a="dmg" data-x="' + esc(dmg) + '" data-l="' + esc(w.name) + ' damage"><span class="as-sv">' + esc(dmg) + '</span></button>'
            : (/%$/.test(dmg) ? '<button type="button" class="as-roll as-chip" data-a="pct" data-t="' + num(dmg) + '" data-l="' + esc(w.name) + ' lethality"><span class="as-sv">' + esc(dmg) + '</span></button>' : esc(dmg))) : '') + '</td></tr>';
      }).join('');
      return '<div class="as-sec-hd ap-hd">Weapons ' + (edit ? '<button type="button" class="ap-mini" data-a="wep-add">+ Weapon</button>' : '') + '</div>' +
        (rows ? '<table class="as-weapons"><tbody>' + rows + '</tbody></table>' : '<p class="as-text as-k">None.</p>');
    }
    function gearItems(x) {
      var cat = window.DG_EQUIPMENT_CATALOG || [];
      return (x.equipment || []).map(function (g, i) {
        var name = typeof g === 'string' ? g : (g && g.name) || '';
        var item = cat.filter(function (c) { return c.name === name; })[0];
        var note = item && item.type === 'armor' && item.system ? 'Armor ' + item.system.protection : '';
        return { i: i, name: name, note: note };
      }).filter(function (g) { return g.name; });
    }
    function gearHtml(x, edit) {
      var items = gearItems(x), notes = (x.lpNotes && x.lpNotes.gear) || '';
      var cat = window.DG_EQUIPMENT_CATALOG || [];
      var cats = []; cat.forEach(function (c) { if (cats.indexOf(c.category) === -1) cats.push(c.category); });
      var pop = '';
      if (ui.pop === 'gear' && !edit) {
        var g = ui.gearCat || cats[0] || '';
        pop = '<div class="ap-pop"><div class="ap-pop-h">From the catalog</div>' + (cat.length ? '<div class="ap-row"><select class="ap-in" data-u="gear-cat">' +
          cats.map(function (c) { return '<option' + (c === g ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>' +
          '<select class="ap-in" data-u="gear-item">' + cat.filter(function (c) { return c.category === g; }).map(function (c) { return '<option>' + esc(c.name) + '</option>'; }).join('') + '</select></div>' : '<p class="as-k">Loading the catalog…</p>') +
          '<div class="ap-row"><input class="ap-in" data-u="gear-own" placeholder="…or write in your own item"></div>' +
          '<div class="ap-btns"><button type="button" class="ap-btn ap-ink" data-a="gear-add">Add</button><button type="button" class="ap-btn ap-ghost" data-a="pop" data-pop="">Cancel</button></div></div>';
      }
      return '<div class="as-sec-hd ap-hd">Gear &amp; Armor ' + (edit ? '' : '<button type="button" class="ap-mini" data-a="pop" data-pop="gear">+ From catalog</button>') + '</div>' + pop +
        (items.length ? '<ul class="ap-list">' + items.map(function (g) {
          return '<li class="ap-gear">' + esc(g.name) + (g.note ? ' <span class="as-k ap-inl">· ' + esc(g.note) + '</span>' : '') +
            (edit ? '<button type="button" class="ap-del" data-a="rm" data-what="gear" data-i="' + g.i + '" aria-label="Remove ' + esc(g.name) + '">×</button>' : '') + '</li>';
        }).join('') + '</ul>' : '') +
        (edit ? '<textarea class="ap-ta" data-e="gearnotes" placeholder="Other gear, in your own words">' + esc(notes) + '</textarea>'
          : (notes ? '<p class="as-text ap-pre">' + esc(notes) + '</p>' : (items.length ? '' : '<p class="as-text as-k">None.</p>')));
    }
    function woundsHtml(x) {
      return '<div class="as-sec-hd">Wounds &amp; ailments</div><textarea class="ap-ta" data-q="wounds" placeholder="Injuries, illness, anything slowing the Agent down">' + esc((x.lpNotes && x.lpNotes.wounds) || '') + '</textarea>';
    }
    function personalHtml(x) {
      var b = x.bio || {};
      var f = [['profession', 'Profession', ctx.professionLabel ? ctx.professionLabel(b.profession) : b.profession], ['employer', 'Employer', b.employer], ['nationality', 'Nationality', b.nationality],
        ['sex', 'Sex', b.sex], ['age', 'Age', b.age], ['education', 'Education', b.education]];
      return '<div class="ap-pdata">' + f.map(function (r) {
        return '<label>' + r[1] + '<input class="ap-in" data-e="bio.' + r[0] + '" value="' + esc(r[2] == null ? '' : r[2]) + '"></label>';
      }).join('') + '</div>' +
        '<div class="as-sec-hd">Physical description <span>part of Appearance</span></div><textarea class="ap-ta" data-e="bio.physicalDesc">' + esc((x.bio && x.bio.physicalDesc) || '') + '</textarea>';
    }
    // The physical description belongs with Appearance: on Agent Hub it
    // sits in the Appearance drop-down under the photo (the hub fills it,
    // ctx.appearanceOutside); here, a fold under the photo.
    function physText(x) { return (x.bio && x.bio.physicalDesc) || ctx.physical || ''; }
    function appearHtml(x) {
      if (ctx.appearanceOutside || !ui.appear) return '';
      var p = physText(x);
      return '<div class="ap-appear"><div class="as-sec-hd">Appearance <span>physical description</span></div>' +
        (p ? '<p class="as-text">' + esc(p) + '</p>' : '<p class="as-text as-k">Not described yet.</p>') + '</div>';
    }
    // The Cell (initiative by DEX, member cards) drops down from beside
    // Appearance; on Agent Hub from the hub's own button (api.toggleCell).
    function cellDropHtml(x) {
      return ui.cellOpen ? '<div class="ap-appear ap-celldrop">' + cellHtml(x) + '</div>' : '';
    }
    // Era photos (the notebook; Agent Hub has the full Era photos form):
    // each era's Face and Outfit Plates from the brief (ctx.brief), and a
    // way to make them on Agent Hub.
    var ERA_NAME = { '90s': '1990s', '00s': '2000s', '10s': '2010s', '20s': '2020s' };
    function eraList() {
      var b = ctx.brief || {}, order = [];
      try { order = Array.isArray(b.active_eras) ? b.active_eras : JSON.parse(b.active_eras || '[]'); } catch (e) { order = [b.active_eras]; }
      order = (Array.isArray(order) ? order : []).filter(function (e) { return ERA_NAME[e]; });
      if (!order.length) return b.face_plate_url ? [{ era: '', face: b.face_plate_url, outfit: b.outfit_plate_url || '' }] : [];
      return order.map(function (e, i) {
        return { era: e, face: b['era_' + e + '_face_url'] || (i === 0 ? b.face_plate_url || '' : ''), outfit: b['era_' + e + '_outfit_url'] || (i === 0 ? b.outfit_plate_url || '' : '') };
      });
    }
    function eraDropHtml() {
      if (ctx.appearanceOutside || !ui.eraOpen) return '';
      var list = eraList();
      function plate(src, label) {
        return '<div class="ap-plate"><div class="ap-plate-img" data-ap-era="' + esc(src || '') + '">' + (src ? '' : '<span class="as-k">' + label + ' — not made yet</span>') + '</div><div class="ap-k">' + label + '</div></div>';
      }
      return '<div class="ap-appear ap-eradrop"><div class="as-sec-hd">Era photos <span>Face and Outfit Plates</span></div>' +
        (list.length ? list.map(function (x) {
          return '<div class="ap-era"><div class="ap-era-t">' + esc(ERA_NAME[x.era] || 'Photos') + '</div><div class="ap-plates">' + plate(x.face, 'Face Plate') + plate(x.outfit, 'Outfit Plate') + '</div></div>';
        }).join('') : '<p class="as-text as-k">No era photos yet — they are made from the Appearance brief.</p>') +
        '<div class="ap-btns"><button type="button" class="ap-btn ap-ghost" data-go="photo">Make or change photos on Agent Hub ↗</button></div></div>';
    }
    function dropBtns() {
      if (ctx.appearanceOutside) return '';
      function btn(a, label, on) { return '<button type="button" class="ap-mini ap-appear-btn" data-a="' + a + '" aria-expanded="' + !!on + '">' + label + ' ' + (on ? '▴' : '▾') + '</button>'; }
      return '<div class="ap-dropbtns">' + btn('appear', 'Appearance', ui.appear) + btn('era', 'Era photos', ui.eraOpen) + btn('cell', 'Cell', ui.cellOpen) + '</div>';
    }
    // One numbered part of the file, like the sections of a DD 315.
    var PARTS = [['stats', 'Statistics'], ['skills', 'Skills'], ['psyche', 'Psyche'], ['kit', 'Combat & gear'], ['record', 'Record']];
    function part(id, n, title, tools, body) {
      return '<section class="ap-part" data-part="' + id + '"><header class="ap-part-hd"><span class="ap-part-n">' + n + '</span><span class="ap-part-t">' + title + '</span>' +
        (tools ? '<span class="ap-part-tools">' + tools + '</span>' : '') + '</header><div class="ap-part-b">' + body + '</div></section>';
    }
    function indexHtml(edit) {
      return '<nav class="ap-index" aria-label="Parts of the file">' + PARTS.filter(function (p) { return !edit || p[0] !== 'record'; }).map(function (p, i) {
        return '<button type="button" data-a="jump" data-part="' + p[0] + '"><b>' + (i + 1) + '</b> ' + esc(p[1]) + '</button>';
      }).join('') + '</nav>';
    }
    function paperHtml() {
      var x = st(), edit = !!s.edit;
      var bar = edit ? '<div class="ap-editbar"><span>✎ Editing — not saved yet</span><span><button type="button" class="ap-btn ap-ghost" data-a="cancel">Cancel</button>' +
        '<button type="button" class="ap-btn ap-save" data-a="save">Save</button></span></div>' : '';
      var inc = ctx.incursion ? '<div class="as-sec as-incursion"><div class="as-sec-hd">The Incursion</div><p class="as-text">' + esc(ctx.incursion) + '</p></div>'
        : (ctx.incursionEmptyHtml ? '<div class="as-sec as-incursion"><div class="as-sec-hd">The Incursion</div>' + ctx.incursionEmptyHtml + '</div>' : '');
      var n = 0;
      return '<div class="as-paper ap ap-look-' + look() + (edit ? ' ap-editing' : '') + '">' + bar + (ctx.appearanceOutside ? cellDropHtml(x) : '') + headHtml(x, edit) + appearHtml(x) + eraDropHtml() + (ctx.appearanceOutside ? '' : cellDropHtml(x)) + indexHtml(edit) +
        (edit ? part('personal', '0', 'Personal data & appearance', '', personalHtml(x)) : '') +
        '<div class="as-sheet">' +
          part('stats', ++n, 'Statistics', '<span class="ap-part-note">' + (edit ? 'value · distinguishing feature' : 'tap to roll ×5 · distinguishing features') + '</span>', statsHtml(x, edit)) +
          part('skills', ++n, 'Skills', skillsTools(x, edit), skillsHtml(x, edit)) +
          part('psyche', ++n, 'Psyche — Bonds, Motivations, Sanity', '',
            '<div class="as-cols"><div>' + bondsHtml(x, edit) + motHtml(x, edit) + '</div><div>' + disHtml(x, edit) + adaptHtml(x, edit) + '</div></div>') +
          part('kit', ++n, 'Combat & gear', '',
            '<div class="as-cols"><div>' + weaponsHtml(x, edit) + (edit ? '' : woundsHtml(x)) + '</div><div>' + gearHtml(x, edit) + '</div></div>') +
        '</div>' +
        (edit ? '' : part('record', ++n, 'Record — Incursion & Operations', '', inc + (ctx.opsHtml || ''))) + (ctx.noteHtml || '') + '</div>';
    }

    /* ── Sanity: what a loss sets off ── */
    function afterSanLoss(res, amount, kind) {
      var list = [];
      res.events.forEach(function (ev) {
        if (ev.type === 'disorder') {
          list.push({ title: 'Disorder triggered — ' + ev.names.join(', '), html: 'Lost ' + amount + ' SAN (' + esc(cap(kind)) + '). ' +
            ev.names.map(function (n) { var dd = D() && D().find(n); return '<b>' + esc(n) + ':</b> ' + esc(dd ? dd.effect : ''); }).join(' ') + ' Roll SAN, or the disorder takes over.',
            actions: [{ label: 'Roll SAN (' + R().derived(s.state).san + '%)', fn: function () { rollPct(R().derived(s.state).san, 'SAN'); } }, { label: 'Noted' }] });
        } else if (ev.type === 'insanity') {
          list.push({ tone: 'pink', title: 'Temporary insanity', html: 'Lost ' + amount + ' SAN at once. The Handler picks: <b>Flee</b>, <b>Fight</b> or <b>Submit</b>.' +
            (kind !== 'unnatural' ? ' ' + esc(cap(kind)) + ' adaptation marks are cleared.' : ''),
            actions: ((s.state.bonds || []).length ? [{ label: 'Project onto a Bond…', fn: function (n) { projectForm(n); return true; } }] : []).concat([{ label: 'Noted' }]) });
        } else if (ev.type === 'breaking') {
          list.push({ title: 'Breaking Point', html: 'SAN ' + ev.san + ' is at or below BP ' + ev.bp + '. Pick the new disorder; BP resets to SAN − POW.' + disorderPicker(),
            actions: [{ label: 'Confirm', fn: function (n) { return !pickDisorder(n); } }] });
        } else if (ev.type === 'zero') {
          list.push({ tone: 'pink', title: 'SAN 0', html: 'The Agent is permanently insane. Talk to your Handler.', actions: [{ label: 'Noted' }] });
        } else if (ev.type === 'incident' && ev.adapted) {
          s.update(function (x) { return R().adapt(x, ev.kind, rollExpr); }).then(function (lost) {
            postits([{ title: 'Adapted to ' + cap(ev.kind), html: ev.kind === 'violence' ? 'Lost ' + lost + ' CHA, and ' + lost + ' from every Bond.' : 'Lost ' + lost + ' POW.', actions: [{ label: 'Noted' }] }]);
          });
        }
      });
      postits(list);
    }
    function disorderPicker() {
      var Dd = D();
      return '<select class="ap-psel" data-pp="dis"><option value="">Choose a disorder…</option>' + (Dd ? Dd.list : []).map(function (d) { return '<option>' + esc(d.name) + '</option>'; }).join('') +
        '<option value="__other">Other…</option></select><input class="ap-psel" data-pp="dis-other" placeholder="…or name it" hidden>';
    }
    function pickDisorder(n) {
      var sel = n.querySelector('[data-pp="dis"]'), other = n.querySelector('[data-pp="dis-other"]');
      if (sel.value === '__other' && other.hidden) { other.hidden = false; other.focus(); return false; }
      var name = sel.value === '__other' ? other.value.trim() : sel.value;
      if (!name) { sel.focus(); return false; }
      s.update(function (x) { R().addDisorder(x, name); R().resetBp(x); });
      return true;
    }
    function projectForm(n) {
      var bonds = (s.state.bonds || []);
      var pa = n.querySelector('.ap-pa');
      pa.innerHTML = '<select class="ap-psel" data-pp="bond">' + bonds.map(function (b, i) { return '<option value="' + i + '">' + esc(b.name) + ' (' + num(b.score) + ')</option>'; }).join('') + '</select>' +
        '<button type="button" data-pp="go">Project: −1D4 WP and Bond</button>';
      pa.querySelector('[data-pp="go"]').addEventListener('click', function () {
        var i = +pa.querySelector('[data-pp="bond"]').value;
        s.update(function (x) { return R().project(x, i, rollExpr); }).then(function (lost) {
          pa.innerHTML = '<span>Lost ' + lost + ' WP and ' + lost + ' from the Bond. Now the SAN test:</span> <button type="button" data-pp="san">Roll SAN</button>';
          pa.querySelector('[data-pp="san"]').addEventListener('click', function () { rollPct(R().derived(s.state).san, 'SAN (projection)'); n.remove(); });
        });
      });
    }

    /* ── Wiring (once per element) ── */
    function onClick(e) {
      var b = e.target.closest('[data-a]');
      if (!b || !el.contains(b)) return;
      var a = b.getAttribute('data-a');
      if (!a) return;
      var x = st(), edit = !!s.edit;
      var i = +b.getAttribute('data-i');
      if (/^(hp|wp|san)[+-]$/.test(a) && !edit) { s.update(function (y) { R().adjust(y, a.slice(0, -1), a.slice(-1) === '+' ? 1 : -1); }); return; }
      if ((a === 'bp+' || a === 'bp-') && edit) { R().stepBp(s.edit, a === 'bp+' ? 1 : -1); render(); return; }
      switch (a) {
        case 'pop':
          ui.pop = ui.pop === b.getAttribute('data-pop') ? '' : b.getAttribute('data-pop'); ui.disOther = false;
          if (ui.pop === 'gear') catalog().then(render);
          if (ui.pop === 'mot') motivationData();
          render();
          var f = el.querySelector('.ap-pop input, .ap-pop select');
          if (f && ui.pop) f.focus();
          return;
        case 'rollsan': rollPct(R().derived(s.state).san, 'SAN'); return;
        case 'appear': ui.appear = el._apAppear = !ui.appear; render(); return;
        case 'cell': ui.cellOpen = el._apCell = !ui.cellOpen; render(); return;
        case 'era': ui.eraOpen = el._apEra = !ui.eraOpen; render(); return;
        case 'jump': {
          var tg = el.querySelector('.ap-part[data-part="' + b.getAttribute('data-part') + '"]');
          if (tg) tg.scrollIntoView({ block: 'start', behavior: 'smooth' });
          return;
        }
        case 'san-amt': ui.san.amount = b.getAttribute('data-v'); render(); return;
        case 'san-kind': ui.san.kind = b.getAttribute('data-v'); render(); return;
        case 'san-go': {
          var amt = ui.san.amount === 'other' ? String(ui.san.other || '').trim().toLowerCase() : ui.san.amount;
          if (!/^\d+$/.test(amt) && !/^\d*d\d+$/.test(amt)) { var o = el.querySelector('[data-u="san-other"]'); if (o) o.focus(); return; }
          var kind = ui.san.kind;
          ui.pop = ''; render();
          rollExpr(amt, 'SAN loss').then(function (n) {
            var res;
            return s.update(function (y) { res = R().sanLoss(y, n, kind); }).then(function () { afterSanLoss(res, n, kind); });
          });
          return;
        }
        case 'pct': rollPct(+b.getAttribute('data-t'), b.getAttribute('data-l')); return;
        case 'dmg': rollExpr(b.getAttribute('data-x'), b.getAttribute('data-l')); return;
        case 'skill': {
          var id = b.getAttribute('data-id');
          rollPct(+b.getAttribute('data-t'), b.getAttribute('data-l'), function () { s.update(function (y) { R().markFailed(y, id); }); });
          return;
        }
        case 'improve':
          b.disabled = true;
          s.update(function (y) { return R().improve(y, rollExpr); }).then(function (out) {
            postits([{ title: 'Skills improved', html: out.length ? out.map(function (r) { return esc(r.label) + ': ' + r.from + '% → <b>' + r.to + '%</b> (+' + r.gain + ')'; }).join('<br>') : 'No marked skills.', actions: [{ label: 'Noted' }] }]);
          });
          return;
        case 'bond-': case 'bond+':
          s.update(function (y) { var bd = y.bonds[i]; if (bd) bd.score = Math.max(0, num(bd.score) + (a === 'bond+' ? 1 : -1)); }); return;
        case 'bond-add': {
          var nm = el.querySelector('[data-u="bond-name"]').value.trim(), rel = el.querySelector('[data-u="bond-rel"]').value.trim();
          if (!nm) { el.querySelector('[data-u="bond-name"]').focus(); return; }
          ui.pop = ''; s.update(function (y) { R().addBond(y, nm, rel); }); return;
        }
        case 'mot-roll':
          motivationData().then(function () { var t = R().rollMotivation(); if (t) s.update(function (y) { R().addMotivation(y, t); }); }); return;
        case 'mot-add': {
          var mv = el.querySelector('[data-u="mot"]').value.trim();
          if (!mv) return;
          ui.pop = ''; s.update(function (y) { R().addMotivation(y, mv); }); return;
        }
        case 'dis-add': {
          var sel = el.querySelector('[data-u="dis"]'), oth = el.querySelector('[data-u="dis-other"]');
          var dn = sel.value === '__other' ? (oth ? oth.value.trim() : '') : sel.value;
          if (!dn) { (oth || sel).focus(); return; }
          ui.pop = ''; ui.disOther = false; s.update(function (y) { R().addDisorder(y, dn); }); return;
        }
        case 'inc': {
          var k = b.getAttribute('data-k'), res;
          ui.pop = '';
          s.update(function (y) { res = R().tickIncident(y, k); }).then(function () {
            if (res.adapted) afterSanLoss({ events: [{ type: 'incident', kind: k, adapted: true }] }, 0, k);
          });
          return;
        }
        case 'gear-add': {
          var own = el.querySelector('[data-u="gear-own"]').value.trim(), it = el.querySelector('[data-u="gear-item"]');
          var add = own ? { isCustom: true, name: own } : (it ? it.value : '');
          if (!add) return;
          ui.pop = ''; s.update(function (y) { y.equipment = y.equipment || []; y.equipment.push(add); }); return;
        }
        case 'card': ui.card = ui.card === i ? -1 : i; render(); return;
        case 'edit': ui.pop = ''; s.beginEdit(); return;
        case 'cancel':
          if (s.editDirty() && !window.confirm('Throw away these edits?')) return;
          ui.pop = ''; s.cancelEdit(); return;
        case 'save': {
          var changes = diff(s.state, s.edit);
          var oath = window.dgFieldNotes && window.dgFieldNotes.oath ? window.dgFieldNotes.oath({ code: s.code, name: (s.edit.bio && s.edit.bio.name) || s.code, changes: changes })
            : Promise.resolve(window.confirm('Save these edits?'));
          oath.then(function (yes) { if (yes) { ui.pop = ''; s.commitEdit(); } });
          return;
        }
        case 'mark': { var sk = R().findSkill(s.edit, b.getAttribute('data-id')); if (sk) { R().toggleMark(s.edit, sk); render(); } return; }
        case 'spec-add': {
          var key = el.querySelector('[data-u="spec-key"]').value, sn = el.querySelector('[data-u="spec-name"]').value.trim(), svv = el.querySelector('[data-u="spec-val"]').value;
          if (!sn) { el.querySelector('[data-u="spec-name"]').focus(); return; }
          ui.pop = ''; R().addSpecialty(s.edit, key, sn, svv); render(); return;
        }
        case 'own-add': {
          var on = el.querySelector('[data-u="own-name"]').value.trim(), ov = el.querySelector('[data-u="own-val"]').value;
          if (!on) { el.querySelector('[data-u="own-name"]').focus(); return; }
          ui.pop = ''; R().addOwnSkill(s.edit, on, ov); render(); return;
        }
        case 'wep-add': s.edit.lpWeapons = (s.edit.lpWeapons || []).concat([{ name: '', skillPct: '', range: '', damage: '', lethality: '', ammo: '', fromEquip: false }]); render(); return;
        case 'rm': {
          var what = b.getAttribute('data-what'), E = s.edit;
          if (what === 'skill') R().removeSkill(E, b.getAttribute('data-id'));
          else if (what === 'bond') E.bonds.splice(i, 1);
          else if (what === 'mot') { var ml = R().motivations(E); ml.splice(i, 1); R().setMotivations(E, ml); }
          else if (what === 'dis') { R().normalizeBio(E); E.bio.disorders.splice(i, 1); }
          else if (what === 'wep') E.lpWeapons.splice(i, 1);
          else if (what === 'gear') E.equipment.splice(i, 1);
          render(); return;
        }
      }
    }
    function onChange(e) {
      var t = e.target;
      if (t.getAttribute('data-a') === 'adapt') {
        var k = t.getAttribute('data-k'), idx = +t.getAttribute('data-i'), on = t.checked;
        if (s.edit) { R().sanity(s.edit)[k][idx] = on; render(); return; }
        var res;
        s.update(function (y) {
          var a = R().sanity(y)[k];
          a[idx] = on;
          var count = a.filter(Boolean).length;
          res = { adapted: on && count === 3 && !(y.adapted || {})[k] };
        }).then(function () { if (res.adapted) afterSanLoss({ events: [{ type: 'incident', kind: k, adapted: true }] }, 0, k); });
        return;
      }
      var u = t.getAttribute('data-u');
      if (u === 'gear-cat') { ui.gearCat = t.value; render(); return; }
      if (u === 'spec-key') { ui.specKey = t.value; render(); return; }
      if (u === 'dis') { ui.disOther = t.value === '__other'; if (ui.disOther) { render(); var f = el.querySelector('[data-u="dis-other"]'); if (f) f.focus(); } return; }
      var ed = t.getAttribute('data-e');
      if (ed && s.edit) { applyEdit(ed, t.value); if (/^(stat:|spec:|dis:)/.test(ed)) render(); }
    }
    function onInput(e) {
      var t = e.target;
      if (t.getAttribute('data-q') === 'wounds') {
        var v = t.value;
        s.update(function (y) { y.lpNotes = y.lpNotes || {}; y.lpNotes.wounds = v; }, 'quiet');
        return;
      }
      if (t.getAttribute('data-u') === 'san-other') { ui.san.other = t.value; return; }
      if (t.getAttribute('data-u') === 'skill-find') { ui.find = t.value; filterSkills(); return; }
      var ed = t.getAttribute('data-e');
      if (ed && s.edit) applyEdit(ed, t.value);
    }
    function onKey(e) {
      if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
      var pop = e.target.closest('.ap-pop');
      if (pop) { var go = pop.querySelector('.ap-btn.ap-ink, .ap-btn.ap-red'); if (go) { e.preventDefault(); go.click(); } }
    }
    function applyEdit(path, v) {
      var E = s.edit, p = path.split(':');
      if (path.indexOf('bio.') === 0) {
        E.bio = E.bio || {};
        var f = path.slice(4);
        if (f === 'profession') {
          // Keep the sheet's profession key while the title is unchanged.
          var cur = ctx.professionLabel ? ctx.professionLabel(E.bio.profession) : E.bio.profession;
          if (v !== cur) E.bio.profession = v;
        } else E.bio[f] = v;
      } else if (p[0] === 'stat') R().setStat(E, p[1], v);
      else if (p[0] === 'feat') { E.lpFeat = E.lpFeat || {}; E.lpFeat[p[1]] = v; }
      else if (p[0] === 'skill') R().setSkillValue(E, p.slice(1).join(':'), v);
      else if (p[0] === 'spec') R().setSpecialty(E, p.slice(1).join(':'), v);
      else if (p[0] === 'bond') { var bd = E.bonds[+p[1]]; if (bd) bd[p[2]] = p[2] === 'score' ? num(v) : v; }
      else if (p[0] === 'mot') { var ml = R().motivations(E); ml[+p[1]] = v; R().setMotivations(E, ml); }
      else if (p[0] === 'dis') { R().normalizeBio(E); if (v === '__other') { var nv = window.prompt('Name the disorder'); if (nv) E.bio.disorders[+p[1]] = nv.trim(); } else E.bio.disorders[+p[1]] = v; }
      else if (p[0] === 'wep') { var w = E.lpWeapons[+p[1]]; if (w) { if (p[2] === 'damage') { w.damage = v; w.lethality = ''; } else w[p[2]] = v; } }
      else if (path === 'gearnotes') { E.lpNotes = E.lpNotes || {}; E.lpNotes.gear = v; }
    }

    if (!el._apWired) {
      el._apWired = true;
      // The host may reuse this element for other pages (the notebook
      // does): only events from the paper itself are ours.
      var mine = function (e) { return el._ap && e.target.closest && e.target.closest('.as-paper.ap'); };
      el.addEventListener('click', function (e) { if (mine(e)) el._ap.click(e); });
      el.addEventListener('change', function (e) { if (mine(e)) el._ap.change(e); });
      el.addEventListener('input', function (e) { if (mine(e)) el._ap.input(e); });
      el.addEventListener('keydown', function (e) { if (mine(e)) el._ap.key(e); });
    }
    if (el._ap) el._ap.destroy();
    var off = s.on(function (sess, why) {
      // Gone, or the host has put another page in this element.
      if (!el.isConnected || el._ap !== api || !el.querySelector('.as-paper.ap')) { off(); return; }
      if (why === 'quiet') return;
      render();
    });

    // Cell members, live: DEX, KIA and vitals as they change.
    function watchMembers() {
      if (!window.dgStore || !window.dgStore.ready) return;
      window.dgStore.ready().then(function () {
        if (!window.firebase || !window.firebase.firestore) return;
        members.forEach(function (m) {
          if (!m.code || /^FR-/i.test(m.code)) return;
          var u = window.firebase.firestore().collection('characters').doc(m.code).onSnapshot(function (snap) {
            var d = snap && snap.data ? snap.data() : null, x;
            try { x = d && d.character_json ? JSON.parse(d.character_json) : null; } catch (e) { x = null; }
            if (!x || !el.isConnected) return;
            var dd = x.derived || {};
            m.dex = R().stats(x).DEX || m.dex; m.derived = { hp: dd.hp, wp: dd.wp, san: dd.san, bp: dd.bp };
            m.kia = typeof dd.hp === 'number' && dd.hp <= 0; m.profession = (x.bio && x.bio.profession) || m.profession;
            if (el._ap !== api) return;
            var sec = el.querySelector('[data-p="cell"]');
            if (sec && s.state) { var tmp = document.createElement('div'); tmp.innerHTML = cellHtml(st()); sec.replaceWith(tmp.firstChild); fillThumbs(); }
          }, function () { /* offline */ });
          unwatch.push(u);
        });
      }).catch(function () { /* no Firebase */ });
    }
    watchMembers();
    catalog().then(function () { if (el.isConnected && gearItems(st() || {}).some(function (g) { return !g.note; })) render(); });

    var api = {
      click: onClick, change: onChange, input: onInput, key: onKey,
      destroy: function () { off(); unwatch.forEach(function (u) { try { u(); } catch (e) { /* gone */ } }); unwatch = []; },
      session: s, render: render,
      toggleCell: function (open) { ui.cellOpen = el._apCell = open == null ? !ui.cellOpen : !!open; render(); return ui.cellOpen; }
    };
    el._ap = api;
    render();
    return api;
  }

  // What an edit changed, in a line for the Oath terminal.
  function diff(a, b) {
    var out = [], Rr = R();
    var sa = Rr.stats(a), sb = Rr.stats(b);
    Rr.STATS.forEach(function (k) { if (sa[k] !== sb[k]) out.push(k + ' ' + sa[k] + '→' + sb[k]); });
    var da = Rr.derived(a), db = Rr.derived(b);
    if (da.bp !== db.bp) out.push('BP ' + da.bp + '→' + db.bp);
    var ka = {}; Rr.skillList(a, { all: true }).forEach(function (s) { ka[s.id] = s; });
    Rr.skillList(b, { all: true }).forEach(function (s) {
      var o = ka[s.id];
      if (!o) out.push('+' + s.label + ' ' + s.value + '%');
      else if (o.value !== s.value) out.push(s.label + ' ' + o.value + '→' + s.value);
    });
    ['name', 'profession', 'employer', 'nationality', 'sex', 'age', 'education', 'physicalDesc'].forEach(function (f) {
      if (String((a.bio || {})[f] || '') !== String((b.bio || {})[f] || '')) out.push(f === 'physicalDesc' ? 'description' : f);
    });
    if (JSON.stringify(a.bonds || []) !== JSON.stringify(b.bonds || [])) out.push('Bonds');
    if (String((a.bio || {}).motivations || '') !== String((b.bio || {}).motivations || '')) out.push('Motivations');
    if (JSON.stringify(Rr.disorders(a)) !== JSON.stringify(Rr.disorders(b))) out.push('Mental Disorders');
    if (JSON.stringify(a.lpWeapons || []) !== JSON.stringify(b.lpWeapons || [])) out.push('weapons');
    if (JSON.stringify(a.equipment || []) !== JSON.stringify(b.equipment || []) || ((a.lpNotes || {}).gear || '') !== ((b.lpNotes || {}).gear || '')) out.push('gear');
    if (JSON.stringify(a.lpFeat || {}) !== JSON.stringify(b.lpFeat || {})) out.push('features');
    if (JSON.stringify(a.lpCheckedSkills || []) !== JSON.stringify(b.lpCheckedSkills || [])) out.push('skill marks');
    if (JSON.stringify(Rr.sanity(a)) !== JSON.stringify(Rr.sanity(b))) out.push('adaptation');
    return out;
  }

  window.dgAgentPaper = { mount: mount, rollExpr: rollExpr, postits: postits, diff: diff, LOOKS: LOOKS, look: look, setLook: setLook };
})();
