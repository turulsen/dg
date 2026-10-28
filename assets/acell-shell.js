/* A-Cell's shell (v3.12.0): the top bar's three modes and the Session
   prep tab.

   PREP is the folder: its index tabs down the left (Session prep ·
   Players · Evidence · Music · Notes · Sheet · Cells · ID Creator).
   PLAY is the desk (assets/acell-play.js), DEBRIEF the write-up after
   (assets/acell-debrief.js). All three work on the session chosen in the
   top bar's pill (assets/acell-sessions.js), remembered on this device.

   Session prep: the session's Cell (its Agents, who's away tonight), its
   notes (a vault note, or an uploaded HTML page), the evidence to hand
   out and the music and effect pads. The panels move by their grip (drop
   one on another to swap them) and ⤢ makes one full width; the order is
   kept on this device.

   window.dgAc: helpers the other A-Cell views share -- esc, ask, modal,
   agent(code), members(cellId), cell(id), session(), playerPath(name),
   evidenceState(h), loadSeen(), preview(url), setMode(mode). */
(function () {
  'use strict';
  if (window.dgAc) return;

  var MODE_KEY = 'dg_acell_mode';
  var PREP_KEY = 'dg_acell_prep_v1';
  var panel = document.getElementById('panel-session');
  var pill = document.getElementById('ac-session-pill');
  var modesEl = document.getElementById('ac-modes');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function store(k, d) { try { return JSON.parse(localStorage.getItem(k) || 'null') || d; } catch (e) { return d; } }
  function keep(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  function S() { return window.dgSessions; }
  function session() { return S() ? S().current() : null; }

  /* ── A modal and a yes/no (window.confirm is dead in an installed iOS app) ── */
  function modal(html, cls) {
    var wrap = document.createElement('div');
    wrap.className = 'vn-modal ' + (cls || '');
    wrap.innerHTML = '<div class="vn-sheet" role="dialog">' + html + '</div>';
    document.body.appendChild(wrap);
    wrap.addEventListener('click', function (e) { if (e.target === wrap || e.target.closest('[data-vclose]')) wrap.remove(); });
    return wrap;
  }
  function ask(text, ok, cancel) {
    return new Promise(function (res) {
      var w = modal('<p class="vn-lead">' + esc(text) + '</p><div class="vn-new" style="justify-content:flex-end">' +
        '<button type="button" class="vn-btn" data-no>' + esc(cancel || 'Cancel') + '</button>' +
        '<button type="button" class="vn-btn p" data-yes>' + esc(ok || 'OK') + '</button></div>', 'ac-ask');
      w.addEventListener('click', function (e) {
        if (e.target.closest('[data-yes]')) { w.remove(); res(true); }
        else if (e.target.closest('[data-no]') || e.target === w) { w.remove(); res(false); }
      });
    });
  }

  /* ── The roster, through the Players tab's own live copy ── */
  function R() { return window.dgAcellRoster; }
  function cells() { return R() ? R().cells() : []; }
  function cell(id) { return cells().filter(function (c) { return c.cell_id === id; })[0] || null; }
  function profLabel(p) {
    p = String(p || '');
    return /^[a-z0-9_]+$/.test(p) ? p.replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }) : p;
  }
  function agent(code) {
    var st = R() && R().state(code);
    if (!st) return null;
    var doc = R().doc(code) || {}, bio = st.bio || {}, d = st.derived || {}, stats = st.csStats || st.stats || {};
    var hpMax = stats.STR && stats.CON ? Math.ceil((stats.STR + stats.CON) / 2) : null, wpMax = stats.POW || null;
    if (window.dgRules && window.dgRules.maxes) { try { var m = window.dgRules.maxes(st); hpMax = m.hp; wpMax = m.wp; } catch (e) { /* the sums above */ } }
    var dis = Array.isArray(bio.disorders) ? bio.disorders : [];
    return {
      code: code, name: bio.name || code, profession: profLabel(bio.profession), player: doc.player_name || bio.player_name || '',
      hp: d.hp, wp: d.wp, san: d.san, bp: d.bp, hpMax: hpMax, wpMax: wpMax, dex: stats.DEX, disorders: dis, state: st
    };
  }
  function members(cellId) {
    var c = cell(cellId);
    return c ? c.member_codes.map(agent).filter(Boolean) : [];
  }
  function vitalsHtml(a, withMax) {
    function v(lbl, cur, max, bad) {
      var t = cur == null ? '—' : cur;
      return lbl + ' ' + (bad ? '<b>' + t + '</b>' : t) + (withMax && max ? '/' + max : '');
    }
    return v('HP', a.hp, a.hpMax, a.hpMax && a.hp <= a.hpMax / 2) + ' · ' + v('WP', a.wp, a.wpMax, a.wp != null && a.wp <= 2) +
      ' · ' + v('SAN', a.san, null, a.san != null && a.bp != null && a.san - a.bp <= 3);
  }
  // The Agent's file in the vault: Handler notes, sheet changes, quick notes.
  function playerPath(name) {
    return 'Players/' + String(name || 'Agent').replace(/[\\/:*?"<>|#^[\]]+/g, ' ').replace(/\s+/g, ' ').trim() + '.md';
  }

  /* ── Evidence: released, and who hasn't opened it yet ── */
  var seen = null, seenAt = 0, seenP = null;
  function loadSeen(force) {
    if (seenP && !force && Date.now() - seenAt < 60000) return seenP;
    seenP = window.dgAcellApi.handler().then(function (f) { return f.firestore().collection('evidence_seen').get(); }).then(function (snap) {
      var out = {};
      snap.forEach(function (d) { var x = d.data() || {}; if (x.evidence_id) (out[x.evidence_id] = out[x.evidence_id] || {})[x.agent_code] = true; });
      seen = out; seenAt = Date.now();
      document.dispatchEvent(new CustomEvent('dg-acell-seen'));
      return out;
    }).catch(function () { seen = seen || {}; return seen; });
    return seenP;
  }
  // { released, unseen: [names] } -- unseen only for released evidence.
  function evidenceState(h) {
    if (!h) return { released: false, unseen: [] };
    if (!h.released) return { released: false, unseen: [] };
    var who = (h.restricted_to && h.restricted_to.length) ? h.restricted_to : ((cell(h.cell_id) || {}).member_codes || []);
    var got = (seen || {})[h.evidence_id] || {};
    return { released: true, unseen: who.filter(function (c) { return !got[c]; }).map(function (c) { var a = agent(c); return a ? a.name.split(' ').pop() : c; }) };
  }

  /* ── Listening to a track or a sound here, not on the table ── */
  var previewEl = null, previewUrl = '';
  function preview(url) {
    if (!previewEl) { previewEl = new Audio(); previewEl.addEventListener('ended', function () { previewUrl = ''; document.dispatchEvent(new CustomEvent('dg-acell-preview')); }); }
    if (!url || previewUrl === url) { previewEl.pause(); previewUrl = ''; }
    else { previewUrl = url; previewEl.src = url; var p = previewEl.play(); if (p && p.catch) p.catch(function () { previewUrl = ''; }); }
    document.dispatchEvent(new CustomEvent('dg-acell-preview'));
    return previewUrl;
  }
  function previewing() { return previewUrl; }
  function soundUrl(kind, ref) {
    if (kind === 'ambient') return 'assets/ambient/' + ref + '.mp3';
    if (kind === 'stinger') return 'assets/stingers/' + ref + '.mp3';
    if (kind === 'track') { var t = trackById(ref); return t ? t.url : ''; }
    return /\.(mp3|m4a|ogg|wav)(\?|$)/i.test(ref) ? ref : '';
  }
  function trackById(id) {
    var M = window.dgAcellMusic;
    return M ? M.tracks().filter(function (t) { return t.track_id === id; })[0] || null : null;
  }

  /* ── The index on a phone: one button for the tab you're on, a grid of
     all of them under it (the screen's foot is the Dice Roller's and the
     radio's). ── */
  var strip = document.getElementById('acell-tab-strip');
  var ICONS = { session: '✎', play: '☺', evidence: '▤', music: '♪', notes: '✍', sheet: '▦', cells: '⚑', ids: '▭' };
  Array.prototype.forEach.call(strip.querySelectorAll('.tw'), function (t) {
    var i = document.createElement('i');
    i.className = 'tw-ic'; i.setAttribute('aria-hidden', 'true'); i.textContent = ICONS[t.dataset.tab] || '•';
    t.insertBefore(i, t.firstChild);
  });
  var idxBtn = document.createElement('button');
  idxBtn.type = 'button';
  idxBtn.id = 'ac-index-btn';
  idxBtn.className = 'ac-index-btn';
  idxBtn.setAttribute('aria-expanded', 'false');
  strip.parentNode.insertBefore(idxBtn, strip);
  function drawIndexBtn(tab) {
    var t = strip.querySelector('.tw[data-tab="' + tab + '"]');
    idxBtn.innerHTML = '<i>' + (ICONS[tab] || '▤') + '</i><span>' + esc(t ? t.textContent.replace(ICONS[tab] || '', '').trim() : 'Session prep') + '</span><b>▾ all tabs</b>';
  }
  function indexOpen(on) {
    document.body.classList.toggle('ac-index-open', on);
    idxBtn.setAttribute('aria-expanded', String(on));
  }
  idxBtn.addEventListener('click', function () { indexOpen(!document.body.classList.contains('ac-index-open')); });
  strip.addEventListener('click', function () { indexOpen(false); });
  document.addEventListener('dg-acell-tab', function (e) { drawIndexBtn(e.detail.tab); indexOpen(false); });
  drawIndexBtn('session');

  /* ── Modes ── */
  var lastPrep = 'session';
  function modeOf(tab) { return tab === 'desk' ? 'play' : tab === 'debrief' ? 'debrief' : 'prep'; }
  function setMode(m) { return window.dgAcellTab(m === 'play' ? 'desk' : m === 'debrief' ? 'debrief' : lastPrep); }
  document.addEventListener('dg-acell-tab', function (e) {
    var tab = e.detail && e.detail.tab, m = modeOf(tab);
    if (m === 'prep') lastPrep = tab;
    document.body.setAttribute('data-ac-mode', m);
    Array.prototype.forEach.call(modesEl.querySelectorAll('[data-mode]'), function (b) { b.classList.toggle('on', b.getAttribute('data-mode') === m); });
    keep(MODE_KEY, m);
    window.scrollTo(0, 0);
  });
  modesEl.addEventListener('click', function (e) {
    var b = e.target.closest('[data-mode]');
    if (b) setMode(b.getAttribute('data-mode'));
  });
  document.body.setAttribute('data-ac-mode', 'prep');

  /* ── The session: the top bar's pill, choosing, making, renaming ── */
  function drawPill() {
    var s = session();
    pill.hidden = !s;
    if (!s) return;
    var c = cell(s.cell_id);
    pill.innerHTML = '<b>' + esc(s.name) + '</b>' + (c ? ' · ' + esc(c.name || c.cell_id) : '') + '<i> ▾</i>';
  }
  pill.addEventListener('click', function () { chooser(); });
  function chooser() {
    var list = S().list(), cur = session();
    var w = modal('<div class="vn-mh"><b>Sessions</b><button type="button" data-vclose>✕</button></div>' +
      '<div class="vn-plist">' + (list.length ? list.map(function (s) {
        var c = cell(s.cell_id);
        return '<button type="button" class="vn-pi' + (cur && cur.id === s.id ? ' on' : '') + '" data-pick="' + esc(s.id) + '">' + esc(s.name) +
          '<small class="ac-pi-sub">' + esc([s.date, c && (c.name || c.cell_id), s.state === 'debriefed' ? 'debriefed' : s.state === 'played' ? 'played' : ''].filter(Boolean).join(' · ')) + '</small></button>';
      }).join('') : '<div class="vn-empty">No sessions yet.</div>') + '</div>' +
      '<div class="vn-new"><button type="button" class="vn-btn p" data-new>+ New session</button></div>');
    w.addEventListener('click', function (e) {
      var p = e.target.closest('[data-pick]');
      if (p) { w.remove(); S().setCurrent(p.getAttribute('data-pick')); return; }
      if (e.target.closest('[data-new]')) { w.remove(); editSession(null); }
    });
  }
  // A new session (s null) or this one's name, date and Cell.
  function editSession(s) {
    var cs = cells(), base = s || session();
    var cellId = s ? s.cell_id : (base ? base.cell_id : (cs[0] ? cs[0].cell_id : ''));
    var w = modal('<div class="vn-mh"><b>' + (s ? 'This session' : 'New session') + '</b><button type="button" data-vclose>✕</button></div>' +
      '<form class="ac-form">' +
      '<label>Name<input name="name" class="vn-search" required value="' + esc(s ? s.name : '') + '" placeholder="Session 5 — The lamp room"></label>' +
      '<label>Date<input name="date" type="date" class="vn-search" value="' + esc(s ? s.date : new Date().toISOString().slice(0, 10)) + '"></label>' +
      '<label>Cell<select name="cell" class="vn-search"><option value="">— none yet —</option>' + cs.map(function (c) {
        return '<option value="' + esc(c.cell_id) + '"' + (c.cell_id === cellId ? ' selected' : '') + '>' + esc(c.name || c.cell_id) + '</option>';
      }).join('') + '</select></label>' +
      '<div class="vn-new" style="justify-content:flex-end">' + (s ? '<button type="button" class="vn-btn ac-del" data-del>Delete session</button><span class="ac-sp"></span>' : '') +
      '<button type="button" class="vn-btn" data-vclose>Cancel</button><button type="submit" class="vn-btn p">' + (s ? 'Save' : 'Create') + '</button></div></form>');
    var f = w.querySelector('form');
    setTimeout(function () { f.name.focus(); }, 0);
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var fields = { name: f.name.value.trim() || 'Untitled session', date: f.date.value, cell_id: f.cell.value };
      w.remove();
      if (s) S().update(s.id, fields); else S().create(fields);
    });
    w.addEventListener('click', function (e) {
      if (!e.target.closest('[data-del]')) return;
      ask('Delete “' + s.name + '”? Its notes in the vault stay.', 'Delete', 'Keep it').then(function (yes) { if (yes) { w.remove(); S().remove(s.id); } });
    });
  }

  /* ── Session prep ── */
  var PANELS = {
    players: { title: 'Players' },
    notes: { title: 'Notes' },
    evidence: { title: 'Evidence for this session' },
    music: { title: 'Music & effects' }
  };
  var prefs = store(PREP_KEY, {});
  function order() {
    var o = (prefs.order || []).filter(function (k) { return PANELS[k]; });
    Object.keys(PANELS).forEach(function (k) { if (o.indexOf(k) < 0) o.push(k); });
    return o;
  }
  var built = '', notesEd = null, notesFor = '';

  function renderPrep() {
    if (!panel.classList.contains('active') && built) return;
    var s = session();
    var key = (s ? s.id : '') + '|' + order().join(',') + '|' + JSON.stringify(prefs.wide || {});
    drawHead(s);
    if (!s) {
      if (notesEd) { notesEd.destroy(); notesEd = null; notesFor = ''; }
      panel.querySelector('.ac-panels').innerHTML = '<div class="ac-empty">' + (S().list().length ? 'Choose a session above, or make a new one.' : 'No sessions yet. A session gathers what you need for one night\'s play: the Cell, your notes, the evidence to hand out, music and effects.') +
        '<div><button type="button" class="ac-btn p" data-ac="new">+ New session</button></div></div>';
      built = key;
      return;
    }
    if (built !== key) {
      if (notesEd) { notesEd.destroy(); notesEd = null; notesFor = ''; }
      panel.querySelector('.ac-panels').innerHTML = order().map(function (k) {
        return '<section class="ac-pn' + ((prefs.wide || {})[k] ? ' wide' : '') + '" data-pn="' + k + '">' +
          '<div class="ac-ph"><span class="ac-grip" title="Drag onto another panel to swap them" aria-hidden="true">⋮⋮</span><span class="ac-pt">' + esc(PANELS[k].title) + '</span>' +
          '<span class="ac-r" data-pr="' + k + '"></span><button type="button" class="ac-ic ac-wide" data-ac="wide" title="Full width" aria-label="Full width">⤢</button></div>' +
          '<div class="ac-pb" data-pb="' + k + '"></div></section>';
      }).join('');
      built = key;
    }
    drawPlayers(s); drawNotes(s); drawEvidence(s); drawMusic(s);
  }
  function drawHead(s) {
    var hd = panel.querySelector('.ac-hd');
    if (!hd) {
      panel.innerHTML = '<div class="ac-hd"></div><div class="ac-panels"></div>';
      hd = panel.querySelector('.ac-hd');
    }
    var list = S().list(), cs = cells();
    hd.innerHTML = '<h2 class="ac-h1">Session prep</h2><span class="ac-sp"></span>' +
      '<label class="ac-sel"><small>Session</small><select data-ac="pick-session">' +
      (s ? '' : '<option value="">— choose —</option>') +
      list.map(function (x) { return '<option value="' + esc(x.id) + '"' + (s && s.id === x.id ? ' selected' : '') + '>' + esc(x.name) + (x.date ? ' · ' + esc(x.date) : '') + '</option>'; }).join('') +
      '<option value="__new">+ New session…</option></select></label>' +
      (s ? '<label class="ac-sel"><small>Cell</small><select data-ac="pick-cell"><option value="">— choose —</option>' + cs.map(function (c) {
        return '<option value="' + esc(c.cell_id) + '"' + (c.cell_id === s.cell_id ? ' selected' : '') + '>' + esc(c.name || c.cell_id) + ' · ' + c.member_codes.length + ' Agent' + (c.member_codes.length === 1 ? '' : 's') + '</option>';
      }).join('') + '</select></label>' +
      '<button type="button" class="ac-btn" data-ac="edit-session" title="Rename, date, delete">✎</button>' +
      '<button type="button" class="ac-btn p" data-ac="play">Play this session ▸</button>' : '');
  }
  function pr(k, html) { var el = panel.querySelector('[data-pr="' + k + '"]'); if (el) el.innerHTML = html; }
  function pb(k) { return panel.querySelector('[data-pb="' + k + '"]'); }

  function drawPlayers(s) {
    var el = pb('players');
    if (!el) return;
    var c = cell(s.cell_id);
    if (!c) { pr('players', ''); el.innerHTML = '<div class="ac-none">Choose the Cell this session plays with (above).</div>'; return; }
    var ms = members(s.cell_id);
    pr('players', esc(c.name || c.cell_id));
    if (!ms.length) { el.innerHTML = '<div class="ac-none">No Agents in this Cell yet — add them on the Cells tab.</div>'; return; }
    var V = window.dgVault;
    el.innerHTML = ms.map(function (a) {
      var away = s.away.indexOf(a.code) >= 0;
      var file = V && V.get(playerPath(a.name));
      return '<div class="ac-row' + (away ? ' away' : '') + '" data-code="' + esc(a.code) + '">' +
        '<span class="ac-t">' + esc(a.name) + '<small>' + esc([a.profession, a.player].filter(Boolean).join(' · ')) + (away ? ' · away tonight' : '') + '</small></span>' +
        '<span class="ac-vit">' + vitalsHtml(a) + '</span>' +
        (a.disorders.length ? '<span class="ac-badge r" title="' + esc(a.disorders.join(', ')) + '">' + esc(a.disorders.length === 1 ? a.disorders[0] : a.disorders.length + ' disorders') + '</span>' : '') +
        (file ? '<span class="ac-badge" title="Has a player file in the vault">file</span>' : '') +
        '<button type="button" class="ac-ic ac-away' + (away ? ' on' : '') + '" data-ac="away" title="' + (away ? 'Here tonight after all' : 'Away tonight') + '" aria-label="Away tonight">' + (away ? '↩' : '☾') + '</button>' +
        '<button type="button" class="ac-ic" data-ac="open-agent" title="Open their sheet and file" aria-label="Open their sheet">✎</button></div>';
    }).join('');
  }

  function drawNotes(s) {
    var el = pb('notes');
    if (!el) return;
    var V = window.dgVault;
    if (s.note_path) {
      pr('notes', '<button type="button" class="ac-link" data-ac="pick-note">change</button>');
      if (notesFor !== s.note_path || !notesEd) {
        if (notesEd) notesEd.destroy();
        el.innerHTML = '<div class="ac-note"></div>';
        notesFor = s.note_path;
        notesEd = V.editor(el.querySelector('.ac-note'), s.note_path, { grow: true, onLink: function (p) { openNoteTab(p); } });
        V.load().catch(function () {});
      }
      return;
    }
    if (notesEd) { notesEd.destroy(); notesEd = null; notesFor = ''; }
    if (s.html_note) {
      var n = ((window.dgSessionNotes && window.dgSessionNotes.notes()) || []).filter(function (x) { return x.id === s.html_note.id; })[0];
      pr('notes', '<button type="button" class="ac-link" data-ac="pick-note">change</button>');
      el.innerHTML = '<div class="ac-row"><span class="ac-t">' + esc(n ? n.title : 'HTML page') + '<small>an uploaded HTML page · ' + esc((s.html_note.lang || 'en').toUpperCase()) + '</small></span>' +
        '<button type="button" class="ac-btn" data-ac="open-html">Open</button></div><div class="ac-none">It opens on the desk in Play.</div>';
      return;
    }
    pr('notes', '');
    el.innerHTML = '<div class="ac-none">No notes for this session yet.</div><div class="ac-acts">' +
      '<button type="button" class="ac-btn p" data-ac="new-note">+ New session note</button>' +
      '<button type="button" class="ac-btn" data-ac="pick-note">Pick from the vault…</button></div>';
  }
  function openNoteTab(path) {
    window.dgAcellTab('notes');
    document.dispatchEvent(new CustomEvent('dg-acell-open-note', { detail: { path: path } }));
  }
  function pickNote(s) {
    var SN = window.dgSessionNotes;
    var load = SN ? SN.load() : Promise.resolve([]);
    load.catch(function () { return []; }).then(function (html) {
      window.dgVault.picker({
        title: 'Notes for ' + s.name,
        newPath: 'Sessions/' + s.name.replace(/[\\/:*?"<>|]+/g, ' ').trim(),
        onPick: function (path) { S().update(s.id, { note_path: path, html_note: null }); },
        html: (html || []).map(function (n) { return { id: n.id, title: n.title || n.id }; }),
        onPickHtml: function (id) {
          var n = (html || []).filter(function (x) { return x.id === id; })[0] || {};
          var lang = n.file_en || n.url_en ? 'en' : ((SN.langs || []).map(function (l) { return l[0]; }).filter(function (l) { return n['file_' + l] || n['url_' + l]; })[0] || 'en');
          S().update(s.id, { html_note: { id: id, lang: lang }, note_path: '' });
        }
      });
    });
  }
  function newNote(s) {
    var V = window.dgVault, path = V.cleanPath('Sessions/' + s.name.replace(/[\\/:*?"<>|]+/g, ' ').trim());
    var tpl = '# ' + s.name + '\n\n## Scene 1\n\n- [ ] \n\n## Scene 2\n\n- [ ] \n\n## NPCs\n\n';
    V.load().catch(function () {}).then(function () {
      return V.get(path) ? path : V.save(path, tpl);
    }).then(function () { S().update(s.id, { note_path: path, html_note: null }); });
  }

  function drawEvidence(s) {
    var el = pb('evidence');
    if (!el) return;
    var E = window.dgAcellEvidence;
    if (!E) { el.innerHTML = '<div class="ac-none">Evidence isn\'t available.</div>'; return; }
    E.start();
    if (!seen) loadSeen();
    var none = !E.items().length;
    var mine = s.evidence.map(function (id) { return E.find(id) || { evidence_id: id, title: none ? 'Loading…' : '(deleted evidence)', missing: true }; });
    function row(h, inSession) {
      var st = evidenceState(h);
      var sub = h.missing ? (none ? '' : 'not found') :  !st.released ? 'not released yet' : st.unseen.length ? 'released · not seen by ' + st.unseen.join(', ') : 'released · everyone has seen it';
      var badge = h.missing ? '' : !st.released ? '<span class="ac-badge g">ready</span>' : st.unseen.length ? '<span class="ac-badge a">unseen</span>' : '';
      return '<div class="ac-row" data-ev="' + esc(h.evidence_id) + '"><button type="button" class="ac-ck' + (inSession ? ' on' : '') + '" data-ac="ev" aria-pressed="' + inSession + '" title="' + (inSession ? 'Take it off this session' : 'Add it to this session') + '"></button>' +
        '<span class="ac-t">' + esc(h.title || 'Untitled') + '<small>' + esc(sub) + '</small></span>' + (inSession ? badge : '') + '</div>';
    }
    var html = mine.map(function (h) { return row(h, true); }).join('');
    // To load in: not released, or released but not seen by everyone -- this session's Cell first.
    var have = {};
    s.evidence.forEach(function (id) { have[id] = true; });
    var more = E.items().filter(function (h) {
      if (have[h.evidence_id]) return false;
      if (s.cell_id && h.cell_id && h.cell_id !== s.cell_id) return false;
      var st = evidenceState(h);
      return !st.released || st.unseen.length;
    }).slice(0, 12);
    if (more.length) html += '<div class="ac-sub">Not released or not seen yet' + (s.cell_id ? ' · this Cell' : '') + '</div>' + more.map(function (h) { return row(h, false); }).join('');
    if (!html) html = '<div class="ac-none">' + (E.items().length ? 'Nothing waiting to hand out.' : 'Loading evidence…') + '</div>';
    el.innerHTML = html + '<div class="ac-acts"><button type="button" class="ac-link" data-ac="new-ev">+ New evidence</button><button type="button" class="ac-link" data-ac="tab" data-tab="evidence">All evidence ›</button></div>';
    pr('evidence', s.evidence.length ? s.evidence.length + ' for the session' : '');
  }

  function drawMusic(s) {
    var el = pb('music');
    if (!el) return;
    var M = window.dgAcellMusic;
    var playing = previewing();
    var html = s.tracks.length ? s.tracks.map(function (t, i) {
      var url = soundUrl(t.kind, t.ref);
      return '<div class="ac-row" data-i="' + i + '"><span class="ac-ic ac-glyph">' + (t.kind === 'ambient' ? '≈' : '♪') + '</span>' +
        '<span class="ac-t">' + esc(t.title || (M ? M.label('ambient', t.ref) : t.ref)) + '<small>' + (t.kind === 'ambient' ? 'ambient loop' : t.kind === 'link' ? 'linked track' : 'track') + '</small></span>' +
        (url ? '<button type="button" class="ac-ic" data-ac="hear" title="Listen here (not on the table)" aria-label="Listen here">' + (playing === url ? '❚❚' : '🎧') + '</button>' : '') +
        '<button type="button" class="ac-ic" data-ac="rm-track" title="Take it off" aria-label="Take it off">✕</button></div>';
    }).join('') : '<div class="ac-none">No tracks or loops yet.</div>';
    html += '<div class="ac-sub">Effect pads</div><div class="ac-pads">' + s.pads.map(function (id) {
      return '<span class="ac-padchip">' + esc(M ? M.label('stinger', id) : id) + '<button type="button" data-ac="rm-pad" data-id="' + esc(id) + '" aria-label="Take it off">✕</button></span>';
    }).join('') + '<button type="button" class="ac-padchip add" data-ac="tab" data-tab="music">+ add</button></div>';
    el.innerHTML = html;
    pr('music', '<button type="button" class="ac-link" data-ac="tab" data-tab="music">+ from the shelf</button>');
  }

  /* ── Clicks and changes ── */
  panel.addEventListener('change', function (e) {
    var t = e.target, s = session();
    if (t.getAttribute('data-ac') === 'pick-session') {
      if (t.value === '__new') { t.value = s ? s.id : ''; editSession(null); return; }
      S().setCurrent(t.value);
    } else if (t.getAttribute('data-ac') === 'pick-cell' && s) {
      S().update(s.id, { cell_id: t.value });
    }
  });
  panel.addEventListener('click', function (e) {
    var b = e.target.closest('[data-ac]');
    if (!b || b.tagName === 'SELECT') return;
    var a = b.getAttribute('data-ac'), s = session();
    var row = b.closest('[data-code],[data-ev],[data-i]');
    switch (a) {
      case 'new': editSession(null); return;
      case 'edit-session': if (s) editSession(s); return;
      case 'play': setMode('play'); return;
      case 'tab': window.dgAcellTab(b.getAttribute('data-tab')); return;
      case 'wide': {
        var k = b.closest('[data-pn]').getAttribute('data-pn');
        prefs.wide = prefs.wide || {};
        prefs.wide[k] = !prefs.wide[k];
        keep(PREP_KEY, prefs); renderPrep(); return;
      }
      case 'away': S().toggleIn(s.id, 'away', row.getAttribute('data-code')); return;
      case 'open-agent': {
        var code = row.getAttribute('data-code');
        window.dgAcellTab('play');
        if (R()) R().open(code);
        return;
      }
      case 'pick-note': pickNote(s); return;
      case 'new-note': newNote(s); return;
      case 'open-html': if (s.html_note && window.dgSessionNotes) window.dgSessionNotes.load().then(function () { window.dgSessionNotes.open(s.html_note.id, s.html_note.lang); }); return;
      case 'ev': S().toggleIn(s.id, 'evidence', row.getAttribute('data-ev')); return;
      case 'new-ev': window.dgAcellTab('evidence'); if (window.dgAcellEvidence) window.dgAcellEvidence.newItem(); return;
      case 'hear': { var t = s.tracks[+row.getAttribute('data-i')]; if (t) preview(soundUrl(t.kind, t.ref)); return; }
      case 'rm-track': S().update(s.id, { tracks: s.tracks.filter(function (x, i) { return i !== +row.getAttribute('data-i'); }) }); return;
      case 'rm-pad': S().toggleIn(s.id, 'pads', b.getAttribute('data-id')); return;
    }
  });

  /* Moving panels: drag one by its grip onto another and they swap. */
  var drag = null;
  panel.addEventListener('pointerdown', function (e) {
    // The panel's title bar is the handle (not its buttons).
    var g = e.target.closest('.ac-ph');
    if (!g || e.target.closest('button, a, select, input')) return;
    e.preventDefault();
    drag = { from: g.closest('[data-pn]'), over: null };
    drag.from.classList.add('ac-lift');
    try { g.setPointerCapture(e.pointerId); } catch (err) { /* old Safari */ }
  });
  function panelAt(x, y) {
    var hit = null;
    Array.prototype.forEach.call(panel.querySelectorAll('[data-pn]'), function (p) {
      var r = p.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) hit = p;
    });
    return hit;
  }
  panel.addEventListener('pointermove', function (e) {
    if (!drag) return;
    var over = panelAt(e.clientX, e.clientY);
    if (over === drag.from) over = null;
    if (drag.over && drag.over !== over) drag.over.classList.remove('ac-drop');
    if (over) over.classList.add('ac-drop');
    drag.over = over;
  });
  function endDrag() {
    if (!drag) return;
    var d = drag;
    drag = null;
    d.from.classList.remove('ac-lift');
    if (!d.over) return;
    d.over.classList.remove('ac-drop');
    var o = order(), a = o.indexOf(d.from.getAttribute('data-pn')), b = o.indexOf(d.over.getAttribute('data-pn'));
    o[a] = o.splice(b, 1, o[a])[0];
    prefs.order = o;
    keep(PREP_KEY, prefs);
    renderPrep();
  }
  panel.addEventListener('pointerup', endDrag);
  panel.addEventListener('pointercancel', function () { if (drag) { drag.from.classList.remove('ac-lift'); if (drag.over) drag.over.classList.remove('ac-drop'); drag = null; } });

  /* ── Keeping it current ── */
  var t0 = null;
  function soon() { clearTimeout(t0); t0 = setTimeout(function () { drawPill(); renderPrep(); }, 20); }
  ['dg-sessions', 'dg-acell-roster', 'dg-acell-evidence', 'dg-acell-music', 'dg-acell-seen', 'dg-acell-preview'].forEach(function (ev) { document.addEventListener(ev, soon); });
  document.addEventListener('dg-vault', function () { var s = session(); if (s && panel.classList.contains('active')) drawPlayers(s); });
  document.addEventListener('dg-acell-tab', function (e) { if (e.detail.tab === 'session') { built = built || ''; soon(); } });

  window.dgAc = {
    esc: esc, ask: ask, modal: modal, store: store, keep: keep,
    agent: agent, members: members, cell: cell, cells: cells, vitalsHtml: vitalsHtml, profLabel: profLabel,
    session: session, playerPath: playerPath, editSession: editSession, chooser: chooser,
    evidenceState: evidenceState, loadSeen: loadSeen, preview: preview, previewing: previewing, soundUrl: soundUrl, trackById: trackById,
    setMode: setMode, openNote: openNoteTab
  };

  // Starts once the Handler's signed in: the sessions and the vault.
  function start() {
    S().load().then(soon, function (err) {
      panel.innerHTML = '<div class="ac-empty">Could not load your sessions: ' + esc((err && err.message) || err) + '</div>';
    });
    if (window.dgVault) window.dgVault.load().catch(function () { /* the Notes tab says so */ });
    // Back where this device left off: mid-game, the desk.
    if (store(MODE_KEY, 'prep') === 'play') setTimeout(function () { setMode('play'); }, 0);
  }
  panel.innerHTML = '<div class="ac-hd"></div><div class="ac-panels"><div class="ac-empty">Loading sessions…</div></div>';
  // Before the gate's password there's no Handler yet: wait for it.
  var started = false;
  function startOnce() { if (!started) { started = true; start(); } }
  window.addEventListener('dg-acell-handler-ready', startOnce);
  if (sessionStorage.getItem('dg_acell_pw') && window.__dgHandlerAuth) window.__dgHandlerAuth().then(startOnce, function () { /* the gate asks */ });
})();
