/* The Handler's notes vault: how an iCloud folder (read and written by an
   Apple Shortcut on the Handler's phone) and A-Cell's private copy
   (Firestore vault/) agree. Pure: no Firebase here, so it can be tested
   on its own (test/vault_sync_test.js).

   Each note A-Cell holds: { path, content, synced }. `synced` is the text
   both sides last agreed on (null: made in A-Cell, never synced yet).
   A sync sends every .md file in the folder: { path, text }.

   - Same text on both sides: nothing to do (synced catches up).
   - Only the phone changed it: A-Cell takes the phone's text.
   - Only A-Cell changed it: the phone gets A-Cell's text back.
   - Both changed it: A-Cell takes the phone's text, and A-Cell's version
     becomes a new note beside it, "Name (A-Cell).md", on both sides, so
     nothing is lost.
   - A note only A-Cell has, never synced: goes to the phone.
   - A note A-Cell has that the phone no longer sends: removed here only
     if A-Cell hadn't changed it since the last sync (the phone deleted
     or moved it); a changed one goes back to the phone instead.
   A file the phone sends with only a name (no folder) is matched to a
   note of that name anywhere in the vault.

   Text sent to the phone only counts as agreed once the phone sends it
   back (`pending` until then): a Shortcut that failed to save it would
   otherwise make A-Cell take the phone's older text as the newer one. */
'use strict';

// Same text as far as a person can tell: iOS may hand a note back with its
// accents decomposed (NFD), CRLF line ends, or a trailing newline added.
function norm(t) { return String(t == null ? '' : t).normalize('NFC').replace(/\r\n?/g, '\n').replace(/\s+$/, ''); }
function eq(a, b) { return a != null && b != null && norm(a) === norm(b); }
function cleanPath(p) {
  p = String(p || '').normalize('NFC').trim();
  // iOS Shortcuts' File Path: "iCloudDrive:Obsidian:Vault:Folder:Note.txt" --
  // colons for folders, and a text file's extension. Made relative to the
  // vault (iCloud Drive/Obsidian/<vault>/), with .md.
  if (p.indexOf(':') >= 0 && p.indexOf('/') < 0) {
    p = p.split(':').join('/').replace(/\.txt(\.md)?$/i, '.md');
  }
  p = p.replace(/^iCloud ?Drive\/Obsidian\/[^\/]+\//i, '').replace(/^.*\/iCloud~md~obsidian\/Documents\/[^\/]+\//, '');
  p = p.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/');
  if (!p || /(^|\/)\.\.?(\/|$)/.test(p)) return '';
  if (!/\.md$/i.test(p)) p += '.md';
  return p;
}
function baseName(p) { return p.split('/').pop(); }
function conflictPath(p, taken) {
  var stem = p.replace(/\.md$/i, ''), n = 1, out = stem + ' (A-Cell).md';
  while (taken[out]) { n += 1; out = stem + ' (A-Cell ' + n + ').md'; }
  return out;
}

// notes: [{ path, content, synced }]; files: [{ path, text }]
// Returns { upserts: [{ path, content, synced }], removes: [path], write: [{ path, text }], stats }
function reconcile(notes, files) {
  var byPath = {}, byName = {};
  (notes || []).forEach(function (n) {
    if (n.pending === undefined) n.pending = null;
    byPath[n.path] = n;
    var b = baseName(n.path).toLowerCase();
    (byName[b] = byName[b] || []).push(n);
  });
  var taken = {}; Object.keys(byPath).forEach(function (p) { taken[p] = true; });
  var seen = {}, upserts = [], write = [], removes = [];
  var stats = { created: 0, updated: 0, sent: 0, conflicts: 0, removed: 0, same: 0, duplicates: 0 };

  (files || []).forEach(function (f) {
    var text = String(f.text == null ? '' : f.text).replace(/\r\n/g, '\n');
    var path = cleanPath(f.path);
    if (!path) return;
    var note = byPath[path];
    if (!note && path.indexOf('/') < 0) {
      var same = byName[path.toLowerCase()] || [];
      if (same.length === 1) { note = same[0]; path = note.path; }
    }
    if (seen[path]) { stats.duplicates += 1; if (!stats.duplicate_example) stats.duplicate_example = path; return; }
    seen[path] = true;
    if (!note) {
      upserts.push({ path: path, content: text, synced: text, pending: null });
      taken[path] = true;
      stats.created += 1;
      return;
    }
    var content = note.content == null ? '' : note.content;
    // The phone saved what it was sent last time: that's agreed now.
    var synced = note.pending != null && eq(text, note.pending) ? text : note.synced;
    if (eq(content, text)) {
      if (!eq(note.synced, text) || note.pending != null) upserts.push({ path: path, content: content, synced: content, pending: null });
      stats.same += 1;
      return;
    }
    var mine = synced == null || !eq(content, synced);   // changed in A-Cell
    var theirs = synced == null || !eq(text, synced);    // changed on the phone
    if (theirs && !mine) {
      upserts.push({ path: path, content: text, synced: text, pending: null });
      stats.updated += 1;
    } else if (mine && !theirs) {
      upserts.push({ path: path, content: content, synced: synced, pending: content });
      write.push({ path: path, text: content });
      stats.sent += 1;
    } else {
      var cp = conflictPath(path, taken);
      taken[cp] = true;
      upserts.push({ path: path, content: text, synced: text, pending: null });
      upserts.push({ path: cp, content: content, synced: null, pending: content });
      write.push({ path: cp, text: content });
      stats.conflicts += 1;
    }
  });

  // Texts the phone has: a note missing from the phone whose text is one of
  // them is a leftover copy under an old path (a name iOS cut short), not
  // an A-Cell edit waiting to go out.
  var phoneHas = {};
  (files || []).forEach(function (f) { phoneHas[norm(f.text)] = true; });
  Object.keys(byPath).forEach(function (path) {
    if (seen[path]) return;
    var note = byPath[path], content = note.content == null ? '' : note.content;
    if (phoneHas[norm(content)]) { removes.push(path); stats.removed += 1; return; }
    if (note.synced == null || !eq(content, note.synced)) {
      upserts.push({ path: path, content: content, synced: note.synced == null ? null : note.synced, pending: content });
      write.push({ path: path, text: content });
      stats.sent += 1;
    } else {
      removes.push(path);
      stats.removed += 1;
    }
  });
  return { upserts: upserts, removes: removes, write: write, stats: stats };
}

// Firestore document id for a note path: no slashes allowed in an id.
function docId(path) {
  return Buffer.from(path, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

module.exports = { reconcile: reconcile, cleanPath: cleanPath, docId: docId };
