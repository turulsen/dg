// One-time repair (2026-11-13): vault notes whose text in A-Cell became the
// word "Text" (the phone read back notes the Shortcut had saved as "Text",
// and a sync rule took that over A-Cell's text) get their text back from a
// nightly backup (backups/YYYY-MM-DD.json in Storage).
//
// A note "X (A-Cell) (A-Cell).md" takes the backup's text of the same path
// if it was real there, else of "X.md" (A-Cell's own version, which the
// copies were made from). Nothing else is touched.
//
// Cloud Shell, from the repo's functions/ folder:
//   node scripts/restore-text-notes.js 2026-11-13          (shows what it would do)
//   node scripts/restore-text-notes.js 2026-11-13 --apply  (does it)
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');

const day = process.argv[2];
const apply = process.argv.includes('--apply');
if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) { console.error('Give the backup date: node scripts/restore-text-notes.js 2026-11-13'); process.exit(1); }

initializeApp({ projectId: 'dg-app-b3447', storageBucket: 'dg-app-b3447.firebasestorage.app' });
const isText = (t) => String(t == null ? '' : t).trim() === 'Text';

(async () => {
  const [buf] = await getStorage().bucket().file('backups/' + day + '.json').download();
  const backup = JSON.parse(buf.toString('utf8'));
  const old = {};
  Object.values(backup.vault || {}).forEach((d) => { if (d && d.path && !isText(d.content)) old[d.path] = d.content; });
  console.log('Backup ' + day + ' (taken ' + backup.taken_at + '): ' + Object.keys(old).length + ' notes.');

  const db = getFirestore();
  const snap = await db.collection('vault').get();
  const todo = [];
  snap.forEach((d) => {
    const x = d.data();
    if (!isText(x.content)) return;
    const base = String(x.path).replace(/( \(A-Cell( \d+)?\))+\.md$/i, '.md');
    const text = old[x.path] != null ? old[x.path] : old[base];
    todo.push({ ref: d.ref, path: x.path, from: old[x.path] != null ? x.path : base, text });
  });
  if (!todo.length) { console.log('No note reads "Text". Nothing to do.'); return; }
  todo.forEach((t) => console.log((t.text == null ? 'NOT IN BACKUP  ' : 'restore (' + t.text.length + ' chars)  ') + t.path + (t.text != null && t.from !== t.path ? '   <- from ' + t.from : '')));
  if (!apply) { console.log('\nNothing changed yet. Run again with --apply to restore these.'); return; }
  const now = Date.now();
  let n = 0;
  for (const t of todo) {
    if (t.text == null) continue;
    await t.ref.set({ content: t.text, synced: t.text, pending: null, updated_at: now, updated_by: 'restore' }, { merge: true });
    n += 1;
  }
  console.log('\nRestored ' + n + ' note(s).');
})().catch((e) => { console.error('Restore failed:', e.message || e); process.exit(1); });
