/* A-Cell's sessions (v3.12.0): what Prep lays out for a game and Play and
   Debrief read and add to. Firestore sessions/{id}, Handler-only:
     { name, cell_id, operation_id, date,
       note_path              the session's notes (a vault note), or
       html_note {id, lang}   an uploaded HTML page (Session Notes),
       evidence: [evidence_id], tracks: [{ kind:'track'|'loop', ref, title }],
       pads: [stinger id], npcs: [{ name, dex, hp, note }], away: [agent code],
       quick_notes: [{ at, text, code }]   code: an Agent's, or '' for the session,
       start: { code: { hp, wp, san, bp } } vitals when Play began, started_at,
       debrief_path, state: 'prep'|'played'|'debriefed',
       created_at, updated_at }
   The session being prepped/played is remembered per device.

   window.dgSessions = { load(), list(), get(id), current(), setCurrent(id),
     create(fields), update(id, patch), remove(id), toggleIn(id, field, value),
     addQuickNote(id, text, code), removeQuickNote(id, at) }
   Fires 'dg-sessions' on document when anything changes. */
(function () {
  'use strict';
  if (window.dgSessions) return;
  var KEY = 'dg_acell_session';
  var byId = {}, loading = null;

  function fb() { return window.dgAcellApi.handler(); }
  function col(f) { return f.firestore().collection('sessions'); }
  function emit() { document.dispatchEvent(new CustomEvent('dg-sessions')); }
  function norm(id, d) {
    d = d || {};
    return {
      id: id, name: d.name || 'Untitled session', cell_id: d.cell_id || '', operation_id: d.operation_id || '', date: d.date || '',
      note_path: d.note_path || '', html_note: d.html_note || null,
      evidence: Array.isArray(d.evidence) ? d.evidence : [], tracks: Array.isArray(d.tracks) ? d.tracks : [],
      pads: Array.isArray(d.pads) ? d.pads : [], npcs: Array.isArray(d.npcs) ? d.npcs : [], away: Array.isArray(d.away) ? d.away : [],
      quick_notes: Array.isArray(d.quick_notes) ? d.quick_notes : [], start: d.start || null, started_at: d.started_at || 0,
      debrief_path: d.debrief_path || '', state: d.state || 'prep',
      created_at: d.created_at || 0, updated_at: d.updated_at || 0
    };
  }
  function load() {
    if (loading) return loading;
    loading = fb().then(function (f) {
      return col(f).get().then(function (snap) {
        snap.forEach(function (doc) { byId[doc.id] = norm(doc.id, doc.data()); });
        emit();
        try {
          col(f).onSnapshot(function (s) {
            s.forEach(function (doc) {
              var mine = byId[doc.id];
              var d = norm(doc.id, doc.data());
              // A write of ours still on its way wins over an older copy.
              if (!mine || !mine._pending || d.updated_at >= mine.updated_at) byId[doc.id] = d;
            });
            emit();
          }, function () { /* keep what was read */ });
        } catch (e) { /* the read above stands */ }
        return list();
      });
    }).catch(function (err) { loading = null; throw err; });
    return loading;
  }
  function list() {
    return Object.keys(byId).map(function (k) { return byId[k]; }).sort(function (a, b) {
      return (b.date || '').localeCompare(a.date || '') || b.created_at - a.created_at;
    });
  }
  function get(id) { return byId[id] || null; }
  function current() {
    var id = '';
    try { id = localStorage.getItem(KEY) || ''; } catch (e) { /* private mode */ }
    return get(id) || null;
  }
  function setCurrent(id) {
    try { localStorage.setItem(KEY, id || ''); } catch (e) { /* private mode */ }
    emit();
  }
  function write(id, patch) {
    var now = Date.now();
    patch.updated_at = now;
    byId[id] = norm(id, Object.assign({}, byId[id] || {}, patch));
    byId[id]._pending = true;
    emit();
    return fb().then(function (f) { return col(f).doc(id).set(patch, { merge: true }); })
      .then(function () { if (byId[id]) delete byId[id]._pending; return byId[id]; });
  }
  function create(fields) {
    var id = 'sess_' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    var d = Object.assign({ name: 'New session', state: 'prep', created_at: Date.now(), date: new Date().toISOString().slice(0, 10),
      evidence: [], tracks: [], pads: [], npcs: [], quick_notes: [] }, fields || {});
    return write(id, d).then(function () { setCurrent(id); return byId[id]; });
  }
  function update(id, patch) { return write(id, Object.assign({}, patch)); }
  // Adds value to the list field if it's not there, else takes it out.
  // value may be an object; same() says which entry is "the same".
  function toggleIn(id, field, value, same) {
    var s = get(id);
    if (!s) return Promise.reject(new Error('No such session.'));
    same = same || function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };
    var arr = (s[field] || []).slice(), at = -1;
    arr.forEach(function (v, i) { if (same(v, value)) at = i; });
    if (at >= 0) arr.splice(at, 1); else arr.push(value);
    var p = {}; p[field] = arr;
    return write(id, p);
  }
  function has(id, field, value, same) {
    var s = get(id);
    if (!s) return false;
    same = same || function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };
    return (s[field] || []).some(function (v) { return same(v, value); });
  }
  function remove(id) {
    delete byId[id];
    var cur = current();
    if (!cur) setCurrent(''); else emit();
    return fb().then(function (f) { return col(f).doc(id).delete(); });
  }
  function addQuickNote(id, text, code) {
    var s = get(id);
    text = String(text || '').trim();
    if (!s || !text) return Promise.resolve(null);
    var notes = s.quick_notes.concat([{ at: Date.now(), text: text, code: code || '' }]);
    return write(id, { quick_notes: notes });
  }
  function removeQuickNote(id, at) {
    var s = get(id);
    if (!s) return Promise.resolve(null);
    return write(id, { quick_notes: s.quick_notes.filter(function (q) { return q.at !== at; }) });
  }

  window.dgSessions = {
    load: load, list: list, get: get, current: current, setCurrent: setCurrent,
    create: create, update: update, remove: remove, toggleIn: toggleIn, has: has,
    addQuickNote: addQuickNote, removeQuickNote: removeQuickNote
  };
})();
