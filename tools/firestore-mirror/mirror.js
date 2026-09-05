#!/usr/bin/env node
'use strict';

// One-time + re-runnable mirror: Sheets -> Firestore.
//
// Reads every tab of the live "Delta Green Briefs" Google Sheet via the
// Sheets API and upserts an equivalent Firestore document per row, keyed
// by the SAME identifier the row already uses (Agent Code, Cell ID,
// etc.) -- never a newly invented ID. Safe to run over and over: it only
// ever upserts (never deletes) unless you pass --prune, which is opt-in
// and only prunes TOP-LEVEL collections (see README). Sheets/Apps Script
// stays the write path of record until each phase's cutover -- this
// script is purely additive infrastructure.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
//   SPREADSHEET_ID=1Xj386xUgKqFXQxHMKFwRENn11sJtcHHHA_lZPUE0AYo \
//   node mirror.js [--dry-run] [--prune] [--only=characters,briefs]

const { google } = require('googleapis');
const admin = require('firebase-admin');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '1Xj386xUgKqFXQxHMKFwRENn11sJtcHHHA_lZPUE0AYo';
const DRY_RUN = process.argv.includes('--dry-run');
const PRUNE = process.argv.includes('--prune');
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').replace('--only=', '');
const onlySet = ONLY ? new Set(ONLY.split(',').map(s => s.trim())) : null;

function normalizeHeader(h) {
  return String(h || '').trim().toLowerCase().replace(/\s+/g, '_');
}

function toBool(v) {
  return v === true || v === 'TRUE' || v === 'true' || v === 1;
}

function toArray(jsonStringOrArray, fallback) {
  if (Array.isArray(jsonStringOrArray)) return jsonStringOrArray;
  if (typeof jsonStringOrArray === 'string' && jsonStringOrArray.trim()) {
    try { return JSON.parse(jsonStringOrArray); } catch (e) { /* fall through */ }
  }
  return fallback || [];
}

async function readSheetRows(sheetsApi, tabName) {
  let res;
  try {
    res = await sheetsApi.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${tabName}'!A1:ZZ`,
      valueRenderOption: 'UNFORMATTED_VALUE',
    });
  } catch (err) {
    console.warn(`  ! skipping tab "${tabName}": ${err.message}`);
    return [];
  }
  const values = res.data.values || [];
  if (values.length < 2) return [];
  const headers = values[0].map(normalizeHeader);
  return values.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { if (h) obj[h] = row[i] !== undefined ? row[i] : ''; });
    return obj;
  });
}

// One descriptor per Sheet tab -> Firestore collection. `docId(row)`
// returns the doc's Firestore path (relative to the DB root); `data(row)`
// returns the Firestore document body. Rows failing `skip(row)` are
// silently dropped (e.g. a blank trailing row, or a note with no
// cell_id to nest under).
const RESOURCES = [
  {
    key: 'characters',
    tab: 'Characters',
    collection: 'characters',
    skip: row => !row.agent_code,
    docPath: row => `characters/${String(row.agent_code).trim()}`,
    data: row => ({
      agent_code: String(row.agent_code).trim(),
      updated_at: row.updated_at || '',
      character_json: typeof row.character_json === 'string' ? row.character_json : JSON.stringify(row.character_json || {}),
      player_name: row.player_name || '',
    }),
  },
  {
    key: 'briefs',
    tab: 'Delta Green Briefs',
    collection: 'briefs',
    skip: row => !row.agent_code,
    docPath: row => `briefs/${String(row.agent_code).trim()}`,
    // Every column on this sheet, verbatim, keyed by its already-
    // normalized (snake_case) header -- this sheet's real column set
    // has grown over the campaign's life and shouldn't be hardcoded
    // here a second time.
    data: row => row,
  },
  {
    key: 'cells',
    tab: 'Cells',
    collection: 'cells',
    skip: row => !row.cell_id,
    docPath: row => `cells/${row.cell_id}`,
    data: row => ({
      cell_id: row.cell_id,
      name: row.name || '',
      handler: row.handler || '',
      member_codes: toArray(row.member_codes, []),
      created_at: row.created_at || '',
      channel: row.channel || '',
    }),
  },
  {
    key: 'cell_notes',
    tab: 'CellNotes',
    nested: true, // pruning is skipped for this one -- see main()
    skip: row => !row.block_id || !row.cell_id,
    docPath: row => `cells/${row.cell_id}/notes/${row.block_id}`,
    data: row => ({
      block_id: row.block_id,
      cell_id: row.cell_id,
      agent_code: row.agent_code || '',
      block_type: row.block_type || '',
      text: row.text || '',
      shared: toBool(row.shared),
      sort_order: Number(row.sort_order) || 0,
      created_at: row.created_at || '',
      updated_at: row.updated_at || '',
      pinned: toBool(row.pinned),
      tags: toArray(row.tags, []),
    }),
  },
  {
    key: 'radio',
    tab: 'RadioChannels',
    collection: 'radio',
    skip: row => !row.channel,
    docPath: row => `radio/${row.channel}`,
    data: row => ({
      channel: row.channel,
      track_url: row.track_url || '',
      track_title: row.track_title || '',
      started_at: row.started_at || '',
      updated_at: row.updated_at || '',
      track_kind: row.track_kind || '',
      paused: toBool(row.paused),
      paused_at: row.paused_at || '',
      loop: toBool(row.loop),
    }),
  },
  {
    key: 'evidence',
    tab: 'Evidence',
    collection: 'evidence',
    skip: row => !row.evidence_id,
    docPath: row => `evidence/${row.evidence_id}`,
    data: row => ({
      evidence_id: row.evidence_id,
      title: row.title || '',
      body: row.body || '',
      photo: row.photo || '',
      cell_id: row.cell_id || '',
      created_at: row.created_at || '',
      operation_id: row.operation_id || '',
      released: toBool(row.released),
      restricted_to: row.restricted_to || '',
    }),
  },
  {
    key: 'operations',
    tab: 'Operations',
    collection: 'operations',
    skip: row => !row.operation_id,
    docPath: row => `operations/${row.operation_id}`,
    data: row => ({
      operation_id: row.operation_id,
      cell_id: row.cell_id || '',
      name: row.name || '',
      created_at: row.created_at || '',
    }),
  },
  {
    key: 'evidence_seen',
    tab: 'EvidenceSeen',
    collection: 'evidence_seen',
    skip: row => !row.agent_code || !row.evidence_id,
    docPath: row => `evidence_seen/${row.agent_code}_${row.evidence_id}`,
    data: row => ({
      agent_code: row.agent_code,
      evidence_id: row.evidence_id,
      seen_at: row.seen_at || '',
    }),
  },
  {
    key: 'tracks',
    tab: 'Tracks',
    collection: 'tracks',
    skip: row => !row.track_id,
    docPath: row => `tracks/${row.track_id}`,
    data: row => ({
      track_id: row.track_id,
      title: row.title || '',
      drive_file_id: row.drive_file_id || '',
      url: row.url || '',
      uploaded_at: row.uploaded_at || '',
    }),
  },
  {
    key: 'handout_notes',
    tab: 'HandoutNotes',
    collection: 'handout_notes',
    skip: row => !row.agent_code || !row.handout_id,
    docPath: row => `handout_notes/${row.agent_code}_${row.handout_id}`,
    data: row => ({
      handout_id: row.handout_id,
      agent_code: row.agent_code,
      note: row.note || '',
      updated_at: row.updated_at || '',
    }),
  },
  {
    key: 'agent_identity',
    tab: 'AgentIdentity',
    collection: 'agent_identity',
    skip: row => !row.agent_code,
    docPath: row => `agent_identity/${row.agent_code}`,
    data: row => ({
      agent_code: row.agent_code,
      color: row.color || '',
      font: row.font || '',
      updated_at: row.updated_at || '',
    }),
  },
];

async function commitInBatches(db, writes) {
  // Firestore batch cap is 500 ops.
  for (let i = 0; i < writes.length; i += 450) {
    const chunk = writes.slice(i, i + 450);
    if (DRY_RUN) continue;
    const batch = db.batch();
    chunk.forEach(({ ref, data }) => batch.set(ref, data, { merge: false }));
    await batch.commit();
  }
}

async function pruneCollection(db, collectionPath, keepIds) {
  const snap = await db.collection(collectionPath).get();
  const stale = snap.docs.filter(d => !keepIds.has(d.id));
  if (!stale.length) return 0;
  for (let i = 0; i < stale.length; i += 450) {
    const chunk = stale.slice(i, i + 450);
    if (DRY_RUN) continue;
    const batch = db.batch();
    chunk.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
  return stale.length;
}

async function main() {
  admin.initializeApp();
  const db = admin.firestore();

  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheetsApi = google.sheets({ version: 'v4', auth });

  console.log(`Mirroring spreadsheet ${SPREADSHEET_ID} -> Firestore${DRY_RUN ? ' (dry run)' : ''}...`);

  for (const resource of RESOURCES) {
    if (onlySet && !onlySet.has(resource.key)) continue;
    const rows = await readSheetRows(sheetsApi, resource.tab);
    const valid = rows.filter(r => !resource.skip(r));
    const writes = valid.map(row => ({
      ref: db.doc(resource.docPath(row)),
      data: resource.data(row),
    }));
    await commitInBatches(db, writes);
    console.log(`  ${resource.key}: ${writes.length} doc(s) upserted from "${resource.tab}" (${rows.length - valid.length} row(s) skipped)`);

    // Prune is only safe for TOP-LEVEL collections here -- cell_notes is
    // nested per-Cell (cells/{cellId}/notes), and pruning that correctly
    // means diffing per parent Cell, which this script doesn't attempt
    // yet (left as a follow-up if Notes' live data volume ever needs it).
    if (PRUNE && !resource.nested) {
      const keepIds = new Set(valid.map(row => resource.docPath(row).split('/').pop()));
      const removed = await pruneCollection(db, resource.collection, keepIds);
      if (removed) console.log(`    pruned ${removed} stale doc(s) from ${resource.collection}`);
    }
  }

  console.log('Done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
