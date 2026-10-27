// Unit checks for functions/vault-sync.js (the iCloud ⇄ A-Cell notes
// rules). Run: node test/vault_sync_test.js — prints JSON results.
'use strict';
const V = require('../functions/vault-sync.js');
const out = [];
function check(name, ok, detail) { out.push({ name, ok: !!ok, detail: ok ? '' : JSON.stringify(detail) }); }
const r = (notes, files) => V.reconcile(JSON.parse(JSON.stringify(notes)), files);
const up = (res, p) => res.upserts.filter((u) => u.path === p)[0];

let x = r([], [{ path: 'Pale Lantern/Act II.md', text: 'hi' }]);
check('a new file on the phone becomes a note, agreed', up(x, 'Pale Lantern/Act II.md') && up(x, 'Pale Lantern/Act II.md').synced === 'hi' && !x.write.length, x);

x = r([{ path: 'a.md', content: 'v1', synced: 'v1' }], [{ path: 'a.md', text: 'v2' }]);
check('changed only on the phone: A-Cell takes it', up(x, 'a.md').content === 'v2' && up(x, 'a.md').synced === 'v2' && !x.write.length, x);

x = r([{ path: 'a.md', content: 'v2', synced: 'v1' }], [{ path: 'a.md', text: 'v1' }]);
check('changed only in A-Cell: sent to the phone, pending until it comes back', x.write[0].text === 'v2' && up(x, 'a.md').pending === 'v2' && up(x, 'a.md').synced === 'v1', x);

x = r([{ path: 'a.md', content: 'v2', synced: 'v1', pending: 'v2' }], [{ path: 'a.md', text: 'v2' }]);
check('the phone saved it: agreed, nothing sent', up(x, 'a.md').synced === 'v2' && up(x, 'a.md').pending === null && !x.write.length, x);

x = r([{ path: 'a.md', content: 'v2', synced: 'v1', pending: 'v2' }], [{ path: 'a.md', text: 'v1' }]);
check('the phone failed to save it: sent again, the A-Cell edit is kept', x.write.length === 1 && x.write[0].text === 'v2' && up(x, 'a.md').content === 'v2', x);

x = r([{ path: 'a.md', content: 'mine', synced: 'v1' }], [{ path: 'a.md', text: 'theirs' }]);
check('changed on both: the phone keeps its note, A-Cell\'s becomes "a (A-Cell).md"', up(x, 'a.md').content === 'theirs' && up(x, 'a (A-Cell).md').content === 'mine' && x.write[0].path === 'a (A-Cell).md', x);

x = r([{ path: 'new.md', content: 'made in A-Cell', synced: null }], []);
check('a note made in A-Cell goes to the phone', x.write[0].path === 'new.md' && !x.removes.length, x);

x = r([{ path: 'gone.md', content: 'v1', synced: 'v1' }], [{ path: 'other.md', text: 'o' }]);
check('deleted on the phone, untouched in A-Cell: removed', x.removes[0] === 'gone.md', x);

x = r([{ path: 'gone.md', content: 'v2', synced: 'v1' }], [{ path: 'other.md', text: 'o' }]);
check('deleted on the phone but edited in A-Cell: sent back, not removed', !x.removes.length && x.write[0].path === 'gone.md', x);

x = r([{ path: 'NPCs/Ruth.md', content: 'r', synced: 'r' }], [{ path: 'Ruth.md', text: 'r2' }]);
check('a file sent with only its name matches the note of that name', up(x, 'NPCs/Ruth.md') && up(x, 'NPCs/Ruth.md').content === 'r2' && !up(x, 'Ruth.md'), x);

check('paths are cleaned: no "..", .md added', V.cleanPath('../x') === '' && V.cleanPath('/A/b') === 'A/b.md', [V.cleanPath('../x'), V.cleanPath('/A/b')]);
check('doc ids have no slashes', V.docId('Pale Lantern/Act II.md').indexOf('/') < 0, V.docId('Pale Lantern/Act II.md'));
x = r([{ path: 'a.md', content: 'a\nb', synced: 'a\nb' }], [{ path: 'a.md', text: 'a\r\nb' }]);
check('Windows line endings count as the same text', !x.write.length && x.stats.same === 1, x);
console.log(JSON.stringify(out));
