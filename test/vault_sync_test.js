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
x = r([], [{ path: 'A/n.md', text: '1' }, { path: 'A/n.md', text: '2' }]);
check('the same path twice in one upload: kept once, counted as a duplicate', x.upserts.length === 1 && x.stats.duplicates === 1 && x.stats.duplicate_example === 'A/n.md', x);
check('an iOS File Path (colons, from iCloud Drive/Obsidian/<vault>) becomes the path in the vault',
  V.cleanPath('iCloudDrive:Obsidian:Delta Green:Delta Green:01_Session notes:Lover in the Ice - 27-01.txt') === 'Delta Green/01_Session notes/Lover in the Ice - 27-01.md' &&
  V.cleanPath('iCloudDrive:Obsidian:Delta Green:Delta Green:01_Session notes:Lover in the Ice - 27-01.txt.md') === 'Delta Green/01_Session notes/Lover in the Ice - 27-01.md' &&
  V.cleanPath('/private/var/mobile/Library/Mobile Documents/iCloud~md~obsidian/Documents/Delta Green/NPCs/Ruth.md') === 'NPCs/Ruth.md' &&
  V.cleanPath('Pale Lantern/Act II.md') === 'Pale Lantern/Act II.md',
  [V.cleanPath('iCloudDrive:Obsidian:Delta Green:Delta Green:01_Session notes:Lover in the Ice - 27-01.txt'), V.cleanPath('/private/var/mobile/Library/Mobile Documents/iCloud~md~obsidian/Documents/Delta Green/NPCs/Ruth.md')]);
x = r([{ path: 'A/a.md', content: 'a', synced: 'a' }, { path: 'A/b.md', content: 'b', synced: 'b' }], [{ path: 'A/a.md', text: 'a' }, { path: 'A/b.md', text: 'b' }]);
check('an ordinary sync counts no duplicates', x.stats.duplicates === 0 && x.stats.same === 2 && !x.stats.duplicate_example, x.stats);
x = r([{ path: 'a.md', content: 'Tur\u00e9 edit', synced: 'old', pending: 'Tur\u00e9 edit' }], [{ path: 'a.md', text: 'Ture\u0301 edit\r\n' }]);
check('the phone saved it with decomposed accents / CRLF / a trailing newline: still agreed, not sent again', !x.write.length && x.stats.same === 1, x);
x = r([{ path: 'S/Lover - 27-01.md', content: '# test\nx', synced: '# old', pending: '# test\nx' }, { path: 'S/Lover - 27-01-26.md', content: '# test\nx', synced: '# test\nx' }], [{ path: 'S/Lover - 27-01-26.md', text: '# test\nx' }]);
check('a leftover copy under an old path, with text the phone already has: removed, not sent again', !x.write.length && x.removes[0] === 'S/Lover - 27-01.md', x);
// 2026-11-05: the folder and file name apart, so the Shortcut saves .md (not .txt).
x = r([{ path: 'DG/Impossible/SN- Op - pt.2.md', content: 'new', synced: null }], []);
check('a note sent to the phone carries its folder and its .md file name apart',
  x.write[0].name === 'SN- Op - pt.2.md' && x.write[0].folder === 'DG/Impossible' && x.write[0].path === 'DG/Impossible/SN- Op - pt.2.md', x);
x = r([{ path: 'Top.md', content: 'new', synced: null }], []);
check('…a note at the top of the vault has no folder', x.write[0].name === 'Top.md' && x.write[0].folder === '', x);

// 2026-11-05: a reorganised vault -- the old paths' text arrives at new ones: moved, not missing.
x = r([{ path: 'Pale Lantern/A.md', content: 'a', synced: 'a' }, { path: 'Pale Lantern/B.md', content: 'b', synced: 'b' }, { path: 'Gone.md', content: 'g', synced: 'g' }],
  [{ path: 'Impossible/Pale Lantern/A.md', text: 'a' }, { path: 'Impossible/Pale Lantern/B.md', text: 'b' }]);
check('notes moved to another folder are removes the mass-delete guard can tell apart (movedAway)',
  x.removes.length === 3 && x.movedAway.length === 2 && x.movedAway.indexOf('Gone.md') < 0 && up(x, 'Impossible/Pale Lantern/A.md'), x);

// 2026-11-05: moved on the phone after A-Cell changed it (before the change reached the phone).
x = r([{ path: 'Players/Ilse.md', content: 'old\n- added in A-Cell', synced: 'old', pending: 'old\n- added in A-Cell' }],
  [{ path: 'Impossible/Agents/Ilse.md', text: 'old' }]);
check('moved on the phone, changed in A-Cell: A-Cell\'s version goes to the new path, the old path is dropped (not recreated)',
  x.write.length === 1 && x.write[0].path === 'Impossible/Agents/Ilse.md' && x.write[0].text === 'old\n- added in A-Cell' && x.write[0].folder === 'Impossible/Agents'
  && up(x, 'Impossible/Agents/Ilse.md').content === 'old\n- added in A-Cell' && up(x, 'Impossible/Agents/Ilse.md').synced === 'old'
  && x.removes.indexOf('Players/Ilse.md') >= 0 && x.movedAway.indexOf('Players/Ilse.md') >= 0 && !up(x, 'Players/Ilse.md'), x);
x = r([{ path: 'Players/New.md', content: 'made in A-Cell', synced: null }], [{ path: 'Impossible/Other.md', text: 'x' }]);
check('…a note made in A-Cell and never synced still goes to the phone where it is', x.write.length === 1 && x.write[0].path === 'Players/New.md', x);

// 2026-11-05: a folder gone from the phone is never recreated.
x = r([{ path: 'Old Op/Ilse.md', content: 'old\n- A-Cell line', synced: 'old' }],
  [{ path: 'Impossible/Agents/Ilse.md', text: 'old, edited on the phone' }]);
check('changed in A-Cell, its folder gone from the phone, a note of that name elsewhere: A-Cell\'s version beside it as (A-Cell), the old folder not recreated',
  x.write.length === 1 && x.write[0].path === 'Impossible/Agents/Ilse (A-Cell).md' && x.write[0].text === 'old\n- A-Cell line' && x.removes.indexOf('Old Op/Ilse.md') >= 0
  && !x.write.some(function (w) { return w.path.indexOf('Old Op/') === 0; }), x);
x = r([{ path: 'Old Op/Lost.md', content: 'v2', synced: 'v1' }], [{ path: 'Impossible/Other.md', text: 'x' }]);
check('…no note of that name: held in A-Cell (kept, not sent, listed)',
  !x.write.length && x.removes.indexOf('Old Op/Lost.md') < 0 && x.stats.held_orphans === 1 && x.stats.held_paths[0] === 'Old Op/Lost.md', x);
x = r([{ path: 'New Op/SN- Op - pt.1.md', content: 'made in A-Cell', synced: null }], [{ path: 'Impossible/Other.md', text: 'x' }]);
check('…a note A-Cell made in a new folder still goes to the phone (the folder is made)', x.write.length === 1 && x.write[0].folder === 'New Op', x);

// 2026-11-07: a note A-Cell made, already sent, its folder still not on the phone: held, not sent again.
x = r([{ path: 'Old Op/NPCs/Ruth.md', content: 'made in A-Cell', synced: null, pending: 'made in A-Cell' }], [{ path: 'Impossible/Other.md', text: 'x' }]);
check('a note A-Cell already sent once whose folder never appeared on the phone: held, its folder not recreated',
  !x.write.length && x.stats.held_orphans === 1 && x.removes.indexOf('Old Op/NPCs/Ruth.md') < 0, x);
x = r([{ path: 'Old Op/NPCs/Ruth.md', content: 'made in A-Cell', synced: null, pending: null }], [{ path: 'Impossible/Other.md', text: 'x' }]);
check('…the first time (never sent yet) it still goes out', x.write.length === 1 && x.write[0].path === 'Old Op/NPCs/Ruth.md', x);

// 2026-11-08: an incremental sync -- every path, the text only of what changed.
let pr = V.resolvePartial([{ path: 'A.md', content: 'a', synced: 'a' }, { path: 'B.md', content: 'b2', synced: 'b', pending: 'b2' }],
  [{ path: 'A.md', hasText: false }, { path: 'B.md', hasText: false }, { path: 'C.md', text: 'new', hasText: true }]);
check('incremental: a path without text is the note as last agreed; a changed one comes with its text',
  !pr.needFull && pr.files.length === 3 && pr.files[0].text === 'a' && pr.files[1].text === 'b' && pr.files[2].text === 'new', pr);
x = r([{ path: 'B.md', content: 'b2', synced: 'b', pending: 'b2' }], pr.files.filter(function (f) { return f.path === 'B.md'; }));
check('…a note A-Cell sent that the phone hasn\'t saved (unchanged there) is sent again', x.write.length === 1 && x.write[0].text === 'b2', x);
pr = V.resolvePartial([{ path: 'A.md', content: 'a', synced: 'a' }], [{ path: 'A.md', hasText: false }, { path: 'Unknown.md', hasText: false }]);
check('…a path A-Cell can\'t read that way (a note it doesn\'t have): nothing this time, everything next time', pr.needFull && !pr.files.length, pr);
pr = V.resolvePartial([{ path: 'M.md', content: 'm', synced: null, pending: 'm' }], [{ path: 'M.md', hasText: false }]);
check('…nor one never agreed on', pr.needFull, pr);

// 2026-11-13: a readable report for the Shortcut to save (a notification shows two lines).
let rp = V.report({ partial: true, files: 412, created: 1, updated: 2, conflicts: 1, held_orphans: 1, held_paths: ['Old/NPCs/Marla.md'] },
  [{ path: 'Impossible/Players/Charles D.md' }], { changed: 3, when: new Date('2026-11-13T12:00:00Z') });
check('the report says what came in, what went out (by path) and what was held, with a one-line headline',
  rp.headline === 'DG sync: 3 in, 1 out, 1 kept twice' && /13 Nov 2026, 13:00/.test(rp.text) && /3 changed on the phone/.test(rp.text) &&
  /\n  Impossible\/Players\/Charles D\.md\n/.test(rp.text) && /Old\/NPCs\/Marla\.md/.test(rp.text), rp);
rp = V.report({ partial: true, need_full: true }, []);
check('…and when the next run must read everything, it says so', /every note/.test(rp.headline) && /Nothing was changed/.test(rp.text), rp);
rp = V.report({ files: 10, held_removals: 9 }, []);
check('…a warning flags the headline', /Check the report/.test(rp.headline) && /WARNING/.test(rp.text), rp);

console.log(JSON.stringify(out));

