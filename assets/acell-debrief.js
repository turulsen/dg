/* A-Cell's Debrief (v3.12.0): after the game, a new note in the vault
   named after the session -- "<session> · debrief.md", beside the
   session's notes (or in Sessions/) -- with To do, the quick notes from
   Play imported, and room for more. Done files what the night cost each
   Agent (their vitals now against when Play began) and their quick
   notes into their player files, and marks the session debriefed. */
(function () {
  'use strict';
  var A = window.dgAc;
  if (!A || window.dgAcDebrief) return;
  var esc = A.esc;
  var panel = document.getElementById('panel-debrief');
  function S() { return window.dgSessions; }
  function V() { return window.dgVault; }
  var st = { open: false, ed: null, edFor: '' };

  function debriefPath(s) {
    var dir = s.note_path && s.note_path.indexOf('/') > 0 ? s.note_path.slice(0, s.note_path.lastIndexOf('/')) : 'Sessions';
    return V().cleanPath(dir + '/' + s.name.replace(/[\\/:*?"<>|#^[\]]+/g, ' ').trim() + ' · debrief');
  }
  function hhmm(at) { return new Date(at).toTimeString().slice(0, 5); }
  // What changed since Play began: [{ a, text: 'SAN 25 → 22, WP 7 → 4' }]
  function costs(s) {
    if (!s.start) return [];
    return Object.keys(s.start).map(function (code) {
      var was = s.start[code] || {}, a = A.agent(code);
      if (!a) return null;
      var parts = ['hp', 'wp', 'san', 'bp'].filter(function (k) { return was[k] != null && a[k] != null && was[k] !== a[k]; })
        .map(function (k) { return k.toUpperCase() + ' ' + was[k] + ' → ' + a[k]; });
      return parts.length ? { a: a, text: parts.join(', ') } : null;
    }).filter(Boolean);
  }
  function quickLines(s, names) {
    return s.quick_notes.map(function (q) {
      return '- ' + (q.code && names[q.code] ? '[[' + names[q.code] + ']] ' : hhmm(q.at) + ' ') + q.text.replace(/\n+/g, ' ');
    });
  }
  function template(s) {
    var c = A.cell(s.cell_id), ms = A.members(s.cell_id), names = {};
    ms.forEach(function (a) { names[a.code] = a.name; });
    var here = ms.filter(function (a) { return s.away.indexOf(a.code) < 0; }), away = ms.filter(function (a) { return s.away.indexOf(a.code) >= 0; });
    var todo = away.map(function (a) { return '- [ ] Catch ' + a.name + ' up (away)'; });
    if (!todo.length) todo.push('- [ ] ');
    return '---\ndate: ' + (s.date || new Date().toISOString().slice(0, 10)) + '\ncell: ' + (c ? c.name || c.cell_id : '') +
      '\nagents: ' + here.map(function (a) { return a.name.split(' ').pop(); }).join(', ') + '\nsession: ' + s.name + '\n---\n' +
      '# ' + s.name + ' · debrief\n\n## To do\n\n' + todo.join('\n') + '\n\n## Quick notes\n\n' +
      (s.quick_notes.length ? quickLines(s, names).join('\n') : '- ') + '\n\n## Additional notes\n\n';
  }

  function draw() {
    var s = A.session();
    if (!s) {
      kill();
      panel.innerHTML = '<div class="db-page"><div class="ac-empty">Choose a session in the top bar to write its debrief.</div></div>';
      return;
    }
    var path = s.debrief_path, note = path && V().get(path);
    var cs = costs(s);
    if (!note) {
      kill();
      panel.innerHTML = '<div class="db-page"><h2 class="ac-h1">Debrief · ' + esc(s.name) + '</h2>' +
        '<p class="db-lead">A new note in your vault, <b>' + esc(debriefPath(s)) + '</b>, with a To do list, the ' + s.quick_notes.length + ' quick note' + (s.quick_notes.length === 1 ? '' : 's') + ' from Play, and room for the rest.</p>' +
        (cs.length ? '<div class="ac-sub">What it cost them (since Play began)</div>' + cs.map(function (x) { return '<div class="ac-row"><span class="ac-t">' + esc(x.a.name) + '</span><span class="ac-vit">' + esc(x.text) + '</span></div>'; }).join('') : '') +
        '<div class="ac-acts"><button type="button" class="ac-btn p" data-db="start">Write the debrief</button>' +
        (path ? '<span class="ac-none">(The debrief note was deleted — this makes a new one.)</span>' : '') + '</div></div>';
      return;
    }
    if (st.edFor !== path || !panel.querySelector('.db-ed')) {
      kill();
      var imported = s.debrief_imported || 0, fresh = s.quick_notes.length - imported;
      panel.innerHTML = '<div class="db-page"><div class="db-hd"><h2 class="ac-h1">Debrief</h2><span class="db-s">saved in A-Cell · the Shortcut writes it to iCloud</span></div>' +
        '<div class="db-new"></div><div class="db-ed"></div><div class="db-ft"><span class="db-done"></span><span class="ac-sp"></span><button type="button" class="ac-btn p" data-db="done"></button></div></div>';
      st.edFor = path;
      st.ed = V().editor(panel.querySelector('.db-ed'), path, { mode: 'edit', grow: true, onLink: function (p) { A.setMode('prep'); A.openNote(p); } });
    }
    var more = s.quick_notes.length - (s.debrief_imported || 0);
    panel.querySelector('.db-new').innerHTML = more > 0 ? '<button type="button" class="ac-link" data-db="import">＋ Import ' + more + ' newer quick note' + (more === 1 ? '' : 's') + '</button>' : '';
    var done = s.state === 'debriefed';
    panel.querySelector('.db-done').innerHTML = done ? '✓ Debriefed' + (s.debriefed_at ? ' ' + esc(new Date(s.debriefed_at).toLocaleString()) : '') + ' — the player files have it.' :
      (cs.length || s.quick_notes.some(function (q) { return q.code; }) ? 'Done files what the night cost each Agent, and their quick notes, in their player files.' : '');
    var btn = panel.querySelector('[data-db="done"]');
    btn.textContent = done ? 'Debriefed ✓' : 'Done';
    btn.disabled = done;
  }
  function kill() { if (st.ed) { st.ed.destroy(); st.ed = null; } st.edFor = ''; }

  function start() {
    var s = A.session(), path = debriefPath(s);
    var make = V().get(path) ? Promise.resolve(path) : V().save(path, template(s));
    return make.then(function () { return S().update(s.id, { debrief_path: path, debrief_imported: s.quick_notes.length }); });
  }
  function importNew() {
    var s = A.session(), names = {};
    A.members(s.cell_id).forEach(function (a) { names[a.code] = a.name; });
    var fresh = s.quick_notes.slice(s.debrief_imported || 0);
    var lines = quickLines({ quick_notes: fresh }, names);
    return window.dgAcPlayers.append(s.debrief_path, 'Quick notes', lines).then(function () { return S().update(s.id, { debrief_imported: s.quick_notes.length }); });
  }
  function done() {
    var s = A.session(), P = window.dgAcPlayers, title = V().title(s.debrief_path);
    var jobs = [];
    var byCode = {};
    costs(s).forEach(function (x) { (byCode[x.a.code] = byCode[x.a.code] || { a: x.a, cost: [], notes: [] }).cost.push('- ' + P.stamp(s) + ': ' + x.text); });
    s.quick_notes.forEach(function (q) {
      if (!q.code) return;
      var a = A.agent(q.code);
      if (!a) return;
      (byCode[q.code] = byCode[q.code] || { a: a, cost: [], notes: [] }).notes.push('- [[' + title + ']] ' + q.text.replace(/\n+/g, ' '));
    });
    Object.keys(byCode).forEach(function (code) {
      var x = byCode[code];
      jobs.push(P.ensureFile(code).then(function (path) {
        return P.append(path, 'Sheet changes', x.cost).then(function () { return P.append(path, 'Quick notes from play', x.notes); });
      }));
    });
    var btn = panel.querySelector('[data-db="done"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Filing…'; }
    return Promise.all(jobs).then(function () {
      return S().update(s.id, { state: 'debriefed', debriefed_at: Date.now() });
    }).catch(function (err) {
      if (btn) { btn.disabled = false; btn.textContent = 'Done'; }
      var d = panel.querySelector('.db-done');
      if (d) d.textContent = 'Could not file it all: ' + ((err && err.message) || err);
    });
  }
  panel.addEventListener('click', function (e) {
    var b = e.target.closest('[data-db]');
    if (!b) return;
    var a = b.getAttribute('data-db');
    if (a === 'start') { b.disabled = true; start().then(draw); }
    else if (a === 'import') importNew().then(draw);
    else if (a === 'done') done();
  });

  var t0 = null;
  function soon() { if (!st.open) return; clearTimeout(t0); t0 = setTimeout(draw, 25); }
  document.addEventListener('dg-acell-tab', function (e) {
    st.open = e.detail.tab === 'debrief';
    if (st.open) { panel.innerHTML = '<div class="db-page"><div class="ac-none">Loading…</div></div>'; V().load().then(draw, function (err) { panel.innerHTML = '<div class="db-page"><div class="ac-none">Could not load the vault: ' + esc((err && err.message) || err) + '</div></div>'; }); }
    else kill();
  });
  ['dg-sessions', 'dg-acell-roster'].forEach(function (ev) { document.addEventListener(ev, soon); });
  document.addEventListener('dg-vault', function () { if (st.open && !st.ed) soon(); });

  window.dgAcDebrief = { path: debriefPath, costs: costs, template: template, done: done };
})();
