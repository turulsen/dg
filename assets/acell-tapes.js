/* A-Cell's tapes (v3.12.0): everything one channel plays -- its tracks in
   order, the loops under them and the effect pads -- made once in Prep and
   played across an operation's sessions (or kept for a Cell). Players
   hear nothing new: a tape put into a channel just plays there through
   the same broadcast (window.dgAcellMusic).

   Firestore tapes/{id}, Handler-only:
     { name, color, scope: 'operation'|'cell', operation_id, cell_id,
       tracks: [{ kind: 'track'|'link', ref, title, dur }],   dur in seconds
       loops: [ambient id], pads: [stinger id], created_at, updated_at }
   radio/{ch}.tape = { id, name } says which tape is in that channel's deck.

     window.dgTapes = { load(), list(), get(id), create(fields), update(id,
     patch), remove(id), forOperation(opId), forCell(cellId), operations(),
     operation(id), inDeck(), insert(id), eject(), runtime(tape), fmt(sec) }
   Fires 'dg-tapes' on document when anything changes. */
(function () {
  'use strict';
  if (window.dgTapes) return;
  var byId = {}, ops = [], loading = null;
  var COLORS = ['#2a2a2a', '#5b2a24', '#2d3d4a', '#e5e0d0', '#2c3a22', '#4a3a6a', '#6a5a2a'];

  function fb() { return window.dgAcellApi.handler(); }
  function col(f) { return f.firestore().collection('tapes'); }
  function emit() { document.dispatchEvent(new CustomEvent('dg-tapes')); }
  function norm(id, d) {
    d = d || {};
    return {
      id: id, name: d.name || 'Untitled tape', color: d.color || COLORS[0], scope: d.scope === 'cell' ? 'cell' : 'operation',
      operation_id: d.operation_id || '', cell_id: d.cell_id || '',
      tracks: Array.isArray(d.tracks) ? d.tracks : [], loops: Array.isArray(d.loops) ? d.loops : [], pads: Array.isArray(d.pads) ? d.pads : [],
      created_at: d.created_at || 0, updated_at: d.updated_at || 0
    };
  }
  function load() {
    if (loading) return loading;
    loading = fb().then(function (f) {
      var db = f.firestore();
      return Promise.all([col(f).get(), db.collection('operations').get()]).then(function (r) {
        r[0].forEach(function (doc) { byId[doc.id] = norm(doc.id, doc.data()); });
        ops = [];
        r[1].forEach(function (doc) { var o = doc.data() || {}; ops.push({ operation_id: o.operation_id || doc.id, name: o.name || doc.id, cell_id: o.cell_id || '', created_at: o.created_at || 0 }); });
        ops.sort(function (a, b) { return (b.created_at || 0) - (a.created_at || 0); });
        emit();
        try {
          col(f).onSnapshot(function (s) {
            var fresh = {};
            s.forEach(function (doc) { fresh[doc.id] = true; var mine = byId[doc.id], d = norm(doc.id, doc.data()); if (!mine || !mine._pending || d.updated_at >= mine.updated_at) byId[doc.id] = d; });
            Object.keys(byId).forEach(function (k) { if (!fresh[k] && !byId[k]._pending) delete byId[k]; });
            emit();
          }, function () { /* keep what was read */ });
        } catch (e) { /* the read stands */ }
        return list();
      });
    }).catch(function (err) { loading = null; throw err; });
    return loading;
  }
  function list() { return Object.keys(byId).map(function (k) { return byId[k]; }).sort(function (a, b) { return a.created_at - b.created_at; }); }
  function get(id) { return byId[id] || null; }
  function write(id, patch) {
    patch.updated_at = Date.now();
    byId[id] = norm(id, Object.assign({}, byId[id] || {}, patch));
    byId[id]._pending = true;
    emit();
    return fb().then(function (f) { return col(f).doc(id).set(patch, { merge: true }); })
      .then(function () { if (byId[id]) delete byId[id]._pending; return byId[id]; });
  }
  function create(fields) {
    var id = 'tape_' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    var n = list().length;
    return write(id, Object.assign({ name: 'New tape', color: COLORS[n % COLORS.length], tracks: [], loops: [], pads: [], created_at: Date.now() }, fields || {}));
  }
  function update(id, patch) { return write(id, Object.assign({}, patch)); }
  function remove(id) {
    delete byId[id];
    emit();
    return fb().then(function (f) { return col(f).doc(id).delete(); });
  }
  function forOperation(opId) { return opId ? list().filter(function (t) { return t.scope === 'operation' && t.operation_id === opId; }) : []; }
  function forCell(cellId) { return cellId ? list().filter(function (t) { return t.scope === 'cell' && t.cell_id === cellId; }) : []; }
  function operation(id) { return ops.filter(function (o) { return o.operation_id === id; })[0] || null; }
  function runtime(t) { return (t.tracks || []).reduce(function (s, x) { return s + (+x.dur || 0); }, 0); }
  function fmt(sec) { sec = Math.round(+sec || 0); if (!sec) return ''; var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return (h ? h + ':' + ('0' + m).slice(-2) : m) + ':' + ('0' + s).slice(-2); }

  /* ── In the deck ── */
  function M() { return window.dgAcellMusic; }
  function inDeck() { var m = M(); var t = m && m.state().tape; return t && t.id ? (get(t.id) || t) : null; }
  function urlOf(x) { if (x.kind === 'track') { var t = (M().tracks() || []).filter(function (y) { return y.track_id === x.ref; })[0]; return t ? t.url : ''; } return x.ref; }
  // Puts the tape into the dialed channel: its tracks become the cue list
  // (auto-advance on, round to the first), track 1 plays, its loops come
  // in under it (others out), and the deck says which tape it is.
  function insert(id) {
    var t = get(id), m = M();
    if (!t || !m) return Promise.reject(new Error('No such tape.'));
    var cues = t.tracks.map(function (x) { return { url: urlOf(x), title: x.title, kind: x.kind === 'track' ? 'audio' : '' }; }).filter(function (c) { return c.url; });
    m.setTape({ id: t.id, name: t.name, color: t.color }, cues);
    m.autoAdvance(true);
    var want = {}; t.loops.forEach(function (l) { want[l] = true; });
    var jobs = [];
    (m.state().ambient || []).forEach(function (a) { if (!want[a.id]) jobs.push(m.setAmbient(a.id, false)); });
    var on = {}; (m.state().ambient || []).forEach(function (a) { on[a.id] = true; });
    t.loops.forEach(function (l) { if (!on[l]) jobs.push(m.setAmbient(l, true)); });
    if (cues.length) m.playCue(0);
    return Promise.all(jobs);
  }
  function eject() { var m = M(); if (m) m.setTape(null, null); }

  /* ── A cassette, drawn (the Music tab, the control center, the desk) ── */
  function esc(x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var STRIPES = ['#a3221c', '#2448a0', '#2c3a22', '#6a3aa0', '#c48a1a'];
  function light(c) { return /^#(e|f|d)/i.test(c || ''); }
  // opts: { chip: 'IN DECK · CH 3', meta: '…' (default: tracks · runtime · loops · pads), spin: true, size: 'sm' }
  function cassette(t, opts) {
    opts = opts || {};
    var n = (t.tracks || []).length, rt = runtime(t);
    var meta = opts.meta != null ? opts.meta : [n + ' track' + (n === 1 ? '' : 's'), fmt(rt), (t.loops || []).length ? (t.loops.length + ' loop' + (t.loops.length === 1 ? '' : 's')) : '', (t.pads || []).length ? t.pads.length + ' pads' : ''].filter(Boolean).join(' · ');
    var stripe = STRIPES[Math.abs(String(t.id || t.name).split('').reduce(function (h, c) { return (h * 31 + c.charCodeAt(0)) | 0; }, 0)) % STRIPES.length];
    return '<div class="cas' + (opts.size ? ' cas-' + opts.size : '') + (light(t.color) ? ' cas-light' : '') + (opts.spin ? ' spin' : '') + '" style="--shell:' + esc(t.color || COLORS[0]) + ';--stripe:' + stripe + '">' +
      '<div class="cas-lab"><small>A</small><b>' + esc(t.name) + '</b><span class="cas-meta">' + esc(meta) + '</span></div>' +
      '<div class="cas-win"><i></i><i></i></div><div class="cas-foot"><u></u><u></u></div><div class="cas-side">A</div>' +
      (opts.chip ? '<div class="cas-chip">' + esc(opts.chip) + '</div>' : '') + '</div>';
  }

  window.dgTapes = {
    cassette: cassette,
    load: load, list: list, get: get, create: create, update: update, remove: remove,
    forOperation: forOperation, forCell: forCell, operations: function () { return ops.slice(); }, operation: operation,
    inDeck: inDeck, insert: insert, eject: eject, runtime: runtime, fmt: fmt, COLORS: COLORS
  };
})();
