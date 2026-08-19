// ════════════════════════════════════════════════════════════════
// DELTA GREEN — Character Brief Collector + Agent File
// Google Apps Script backend v23 — Phase 2 + image proxy + Cloud Save
// + A-Cell (Play/Cells/Sheet/Admin) + Cell groups + Table Radio
// + Cover Identity (find a player's Agents by real name)
// + 24h auto-purge for Recently Deleted
// + AI appearance prompt generation (Face/Outfit Plate, via Claude)
// + AI appearance IMAGE generation (Face/Outfit Plate, via Gemini)
// + Agent File Only listing (A-Cell Admin, for briefs with no sheet)
// + Concurrency hardening: cached spreadsheet lookup + migration checks,
//   short-lived get_now_playing cache, LockService on hot write paths
//   (fixes A-Cell going unresponsive under several simultaneous players)
// + Fixed 24h purge silently never running on a DeletedCharacters/
//   DeletedBriefs sheet that predates that feature (missing header)
// + doLookupCharacter() (Play button / ?load=) now reads a targeted
//   single row instead of every Agent's full Character JSON blob
//   (fixes a reported ~8-10s wait before a character sheet appeared)
// + Player Notes v1 (list_cell_notes/save_note_block/delete_note_block):
//   shared/private note blocks scoped to a Cell, server-side privacy
//   filtering, short-lived per-Cell read cache + write lock -- new
//   notes/ frontend, unlinked from nav until tested
// + Player Notes: per-Agent color/handwriting-font identity
//   (save_agent_identity, bundled into list_cell_notes as
//   `identities`) for attributing contributions in the combined
//   Shared tab; created_at now also returned per block
// + Player Notes editing engine swapped to Editor.js client-side --
//   block_type/text vocabulary changed (Editor.js tool names, text is
//   now a JSON-stringified block data object) but saveNoteBlock()/
//   deleteNoteBlock()/listCellNotes() already treated both columns as
//   opaque strings, so NO backend logic changed for this migration --
//   only this header comment. `shared` deliberately stays a plain
//   top-level column, outside the JSON blob, so the server-side
//   privacy filter below is completely unaffected either.
// + Fixed listCellNotes() never actually returning agent_code on each
//   note object (only as the notes{} dict key) -- broke ink
//   color/font attribution entirely (identityFor(b.agent_code) was
//   always identityFor(undefined)) and made every block in the
//   combined Shared tab uneditable by its own author
// + Backend hardening, stage 1 (standalone fixes ahead of an
//   authentication pass -- see stage 2/3 for that): deleted the dead
//   action=img branch; added respond_()/safeCallback_() as the one
//   place every JSONP/JSON response gets built, replacing ~17 manual
//   `callback + '(' + json + ')'` sites (fixed the unvalidated-callback
//   injection risk and the missing-callback `undefined(...)` bug in the
//   same pass); added asBoolean_() and applied it to shared/paused/loop
//   instead of the old `=== 1` checks; fixed createCell() writing 5
//   values into its 6-column schema (channel was always silently
//   blank); added a duplicate-guard to restoreCharacter() so restoring
//   an already-live Agent can no longer create a second row; moved
//   generateAgentCode() for a brand-new Agent inside the existing
//   withScriptLock() callback in the Brief-submission handler, with a
//   collision retry against the already-scanned rows instead of
//   trusting Math.random() alone
// + Backend hardening, stage 2 (auth infrastructure -- not wired to
//   any existing action yet, that's stage 3): new AgentAuth sheet
//   (agent_code/token/created_at/claimed_at); requireAgentToken_()
//   validates a per-Agent secret token; requireHandlerAuth_() checks a
//   handler_password against a new HANDLER_PASSWORD Script Property
//   (fails closed if unset); new reset_agent_token action +
//   resetAgentToken_(), gated by requireHandlerAuth_() from the moment
//   it exists, for Handler-mediated recovery on a new device/cleared
//   storage (after locating the Agent Code via the existing
//   find_by_player_name search)
// + Backend hardening, stage 3 (the guard rollout + client plumbing):
//   requireAgentToken_()'s lazy-claim revised from stage 2's own
//   description -- it now accepts whatever token the CLIENT already
//   generated and sent, rather than minting one server-side and
//   handing it back, since most writes in this app are fire-and-forget
//   `fetch(...,{mode:'no-cors'})` POSTs whose response can never be
//   read to learn a server-issued token at all. Every client file
//   mints and persists its own per-Agent token locally on first use
//   instead (see agentToken() in dg-agent-portal.html,
//   stats/cloud-sync.js, agent-hub.html, notes/index.html). Every
//   player-owned write (update_medical/update_aar/update_field,
//   save_plate, generate_prompt, generate_plate_image, save_note_block,
//   delete_note_block, save_agent_identity, save_handout_note) and the
//   two requester-spoofable reads (list_cell_notes, list_handout_notes)
//   now call requireAgentToken_(); save_character accepts EITHER the
//   Agent's own token or the Handler password (requireAgentOrHandlerAuth_)
//   since A-Cell's Sheet tab also edits it directly; every Handler/admin
//   write (create/update/delete_cell, update_cell_members,
//   create/update/delete_handout, delete_character, restore_character,
//   set/pause/resume_now_playing, save_playlist, upload_track,
//   delete_track, set_cell_channel, update_character_field) now calls
//   requireHandlerAuth_(). deleteNoteBlock()/saveNoteBlock() also gained
//   a real ownership check against the block's own agent_code -- a
//   valid token only proves who's asking, not that the named block_id
//   is theirs, which mattered once Circulate made every shared block_id
//   visible to the whole Cell. list_handouts/load_character/list_cells/
//   get_now_playing/get_playlist/list_tracks/imgdata/find_by_player_name
//   deliberately stay open, since players legitimately need them
//   unauthenticated (find_by_player_name IS the recovery mechanism).
// + Backend hardening, stage 4 (Handler sessions): list_characters/
//   list_agent_file_only/list_deleted_characters were the one gap left
//   after stage 3 -- full Admin-only data, still readable with no auth
//   at all, but GET/JSONP requests, where the only fix stage 3's
//   requireHandlerAuth_() offered would mean putting the real Handler
//   password in a URL query string (browser history, server logs) --
//   worse than the problem. New handler_login action (POST-only, the
//   one place the real password is still ever sent) exchanges it for
//   an opaque session token cached server-side for up to 6h
//   (CacheService -- self-expiring, no sheet to maintain);
//   requireHandlerSession_() gates the three listing reads on that
//   token instead. a-cell.html logs in once right after its own
//   password gate passes and sends the session on every listing GET
//   from then on.
// + Performance + remaining review items: new headerMap_()/
//   requireColumns_() helpers, replacing repeated headers.indexOf('X')
//   boilerplate and closing several unguarded-missing-column write
//   gaps (saveNoteBlock, saveAgentIdentity, updateHandout,
//   setCellChannel, deleteTrack, listHandoutNotes, saveHandoutNote);
//   appendRow([...]) sites switched to header-length-safe row builds
//   (requireAgentToken_, resetAgentToken_, saveNoteBlock,
//   saveAgentIdentity, createHandout, uploadTrack, saveHandoutNote);
//   multi-cell single-row writes (saveCharacter, setNowPlaying,
//   pauseNowPlaying, resumeNowPlaying, saveNoteBlock, saveAgentIdentity,
//   updateHandout, resetAgentToken_) now mutate the row already in hand
//   from the scan and write it back with one setValues() instead of
//   several setValue() calls; getOrCreateCharactersSheet()/
//   getOrCreateCellsSheet() gained the same migration-check cache-skip
//   guard getOrCreateRadioSheet()/ensureBriefsColumns() already had;
//   getAgentIdentitiesMap() and getPlaylist() gained the short-TTL
//   cache-then-invalidate-on-write pattern their siblings
//   (listCellNotes/getNowPlaying) already used; deleteCharacter()/
//   restoreCharacter() now run their Characters+Briefs pair of
//   operations inside withScriptLock() for atomicity; Handouts.photo
//   now uploads to Drive via a new resolveHandoutPhoto_() instead of
//   storing a raw data URI in the cell, matching every other image
//   path in this file (client-side resolution added to
//   agent-hub.html/a-cell.html, mirroring the existing Face Plate
//   gdrive: pattern). Re-verified two items the original review flagged
//   and found already resolved: findByPlayerName()'s merge logic is
//   deterministic, not ambiguous (one clarifying comment added, no
//   behavior change); DRIVE_API_KEY being hardcoded is safe by design
//   (Drive-API-restricted, see its own comment below) and needed no
//   change. Deliberately not done: a secondary AgentIndex sheet (real
//   full-sheet-scan cost is negligible at this campaign's scale; the
//   actual concurrent-write problem already hit was a locking issue,
//   already fixed) and a full input-sanitization/XSS audit (deserves
//   its own focused pass, not a bolt-on here).
// + Hotfix: requireAgentToken_()/requireHandlerSession_() now route
//   their error responses through respond_() with the request's own
//   callback instead of always returning bare JSON. Both are called
//   from GET/JSONP actions (list_cell_notes/list_handout_notes, and
//   the three Admin listing reads) as well as POST ones -- bare JSON
//   handed to a `<script src=...>` tag is invalid as a JS statement,
//   so on a GET the tag failed to execute, the JSONP callback never
//   fired, and the caller just saw its own generic connection-timeout
//   message after ~7s ("could not load the Agent list... may not be
//   deployed yet") instead of the real reason (most likely: no
//   Handler session yet, e.g. HANDLER_PASSWORD not set in Script
//   Properties). Confirmed live: A-Cell's Play/Admin tabs now surface
//   the actual res.message instead of a generic string.
//
// This file is NOT deployed from here -- this repo is a static
// GitHub Pages site with no server-side execution. It's kept here as
// the canonical, always-current mirror of the real Google Apps
// Script project (a separate, non-versioned target reachable only
// through the Apps Script web editor), so future backend changes can
// be written and reviewed as a diff against known-good production
// code instead of guessed blind. When this file changes, copy its
// full contents over the live project's Code.gs and redeploy.
// ════════════════════════════════════════════════════════════════

const SHEET_NAME = 'Delta Green Briefs';
const CHARACTERS_SHEET_NAME = 'Characters';

// Optional but recommended: paste your spreadsheet's ID here (from its
// URL, the part between /d/ and /edit) to look it up directly instead
// of by searching Drive for a file named "Delta Green Briefs" --
// removes any chance of that search ever resolving to the wrong file.
// Leave blank to keep the current Drive-search behavior.
const SPREADSHEET_ID = '1Xj386xUgKqFXQxHMKFwRENn11sJtcHHHA_lZPUE0AYo';

const COLUMNS = [
  'agent_code',
  'submitted_at',
  'char_name',
  'codename',
  'age_range',
  'sex',
  'nationality',
  'face_shape',
  'eye_color',
  'eye_shape',
  'nose',
  'lips',
  'skin',
  'facial_hair',
  'face_scars',
  'hair_color',
  'hair_style',
  'hair_texture',
  'build',
  'posture',
  'body_markers',
  'jacket',
  'shirt',
  'trousers',
  'footwear',
  'accessories',
  'jewelry',
  'expression',
  'vibe',
  'reference_person',
  'notes',
  'ref_image_name',
  'ref_image_link',
  'medical_log',
  'aar_log',
  'active_eras',
  'banana_prompt',
  'face_plate_url',
  'outfit_plate_url',
  'mode0_prompt',
  'mode1_prompt',
  // Cover Identity: the player's real name, doubling the existing
  // Biography field on the character sheet as a lookup key. Appended
  // at the END, not inserted among the existing columns -- the "new
  // agent submission" path below (COLUMNS.map(...) -> sheet.appendRow())
  // writes positionally, so this position must match wherever
  // ensureBriefsColumns() puts the actual header on the live sheet
  // (also always the end).
  'player_name',
  // The agent's profession -- typed directly on the Profiling form, or
  // auto-filled by stats/agent-portal-export.js from the character
  // sheet's own profession dropdown. Was collected and sent by both of
  // those clients already but silently dropped here (missing from
  // COLUMNS means COLUMNS.map() below never wrote it to any column), so
  // it never actually reached the Sheet -- same append-at-the-end
  // discipline as player_name above.
  'profession'
];

// Serializes a read-modify-write against a Sheet (scan for an existing
// row, then write) so concurrent requests -- e.g. several players
// importing/saving characters within the same few seconds during a live
// session -- can't race each other's scans and clobber or duplicate a
// row. Falls back to running unlocked rather than failing the request if
// the lock can't be acquired in time (a rare miss under contention is
// far better than turning a working save into a hard error).
function withScriptLock(fn) {
  const lock = LockService.getScriptLock();
  let locked = false;
  try { locked = lock.tryLock(5000); } catch (e) { /* proceed unlocked */ }
  try {
    return fn();
  } finally {
    if (locked) { try { lock.releaseLock(); } catch (e) { /* already released/expired */ } }
  }
}

function generateAgentCode(name) {
  const prefix = (name || 'AGNT').replace(/[^A-Za-z]/g, '').substring(0, 4).toUpperCase();
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 4; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
  return prefix + '-' + suffix;
}

// Only a bare identifier (what every real caller -- our own JSONP
// helpers -- ever sends) is echoed back as a callback wrapper. Anything
// else (missing, or containing characters that could break out of a
// <script> response) falls back to plain JSON instead of being
// concatenated into the response unescaped.
function safeCallback_(callback) {
  const cb = String(callback || '');
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(cb) ? cb : null;
}

// Single place building every JSONP/JSON response. Replaces the old
// per-call-site `callback + '(' + json + ')'` concatenation, which had
// no callback validation (injection risk) and, at most call sites, no
// missing-callback guard either (silently returned invalid `undefined(...)`
// JavaScript when a caller forgot ?callback=).
function respond_(payload, callback) {
  const json = JSON.stringify(payload);
  const cb = safeCallback_(callback);
  if (cb) {
    return ContentService.createTextOutput(cb + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

// Normalizes a Sheets cell into a real boolean regardless of whether it
// was ever written as 1, '1', true, or (an untouched/legacy cell) '' --
// the old `=== 1` checks scattered across shared/paused/loop only ever
// matched the exact numeric case.
function asBoolean_(value) {
  return value === 1 || value === '1' || value === true || value === 'true';
}

// ════════════════════════════════════════════════════════════════
// Auth infrastructure (stage 2 of the backend hardening pass). These
// helpers exist and are self-contained, but nothing calls
// requireAgentToken_()/requireHandlerAuth_() from an existing action
// yet -- that guard rollout, plus the client-side plumbing to actually
// send a token/password, is stage 3, done deliberately separately so
// each stage stays small enough to review and redeploy on its own.
// reset_agent_token is the one exception: it's a brand-new action, so
// it ships gated from the moment it exists rather than sitting open
// until stage 3 gets to it.
// ════════════════════════════════════════════════════════════════

// Self-provisions a sheet holding one secret token per Agent Code --
// deliberately separate from the Agent Code itself (which stays the
// public identifier used in URLs/lookups everywhere else). claimed_at
// is set the moment a token is minted (lazy-claim and Handler-reset
// both mint+claim in the same step), so it's currently redundant with
// created_at, but kept as its own column for a future where a token
// could be pre-provisioned without being claimed yet.
function getOrCreateAgentAuthSheet() {
  const ss = getOrCreateSheet();
  let sheet = ss.getSheetByName('AgentAuth');
  if (!sheet) {
    sheet = ss.insertSheet('AgentAuth');
    sheet.getRange(1, 1, 1, 4).setValues([['agent_code', 'token', 'created_at', 'claimed_at']]);
  }
  return sheet;
}

// Validates data.agent_code + data.token against AgentAuth. An Agent
// Code with no AgentAuth row yet is lazily claimed using whatever token
// the CLIENT already generated and sent -- not a server-minted one
// handed back in the response. That's a deliberate change from how
// stage 2 first described this: most writes in this app are
// fire-and-forget `fetch(..., {mode:'no-cors'})` POSTs (keepalive,
// used precisely so a page navigation doesn't cancel an in-flight
// save) whose response body can never be read at all, so a
// server-issued token would have no reliable way back to the client
// that needs to store it. A client-generated token sidesteps that
// entirely: every frontend mints and persists one locally the first
// time it needs one for a given Agent Code (see agentToken() in each
// client file) and simply starts sending it, no round trip required.
// This is what lets an existing player's saved data keep working on
// their own device with zero action from them, even long after this
// rollout ships -- their browser already holds the same token it's
// been quietly sending all along.
//
// Returns null on success (a fresh claim counts as success), or a
// ContentService error response the caller should return immediately.
//
// data.callback (present when this runs from a GET/JSONP action --
// e.parameter always carries it as a real request param; a POST body
// never has one) routes the error through respond_() so it's still a
// valid JSONP response. Without this, a rejected GET (list_cell_notes,
// list_handout_notes) returned bare JSON to a <script src=...> tag,
// which is invalid as a JS statement -- the tag fails to execute, the
// JSONP callback never fires, and the caller just sees its own
// generic "connection timed out" after ~7s instead of the real reason.
function requireAgentToken_(data) {
  const agentCode = String((data && data.agent_code) || '').trim().toUpperCase();
  if (!agentCode) {
    return respond_({ status: 'ERROR', message: 'agent_code is required' }, data && data.callback);
  }
  const providedToken = String((data && data.token) || '').trim();
  return withScriptLock(function () {
    const sheet = getOrCreateAgentAuthSheet();
    const rows = sheet.getDataRange().getValues();
    const headers = rows[0];
    const cols = headerMap_(headers);
    const missing = requireColumns_(cols, ['agent_code', 'token', 'created_at', 'claimed_at']);
    if (missing) return respond_(JSON.parse(missing.getContent()), data && data.callback);
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][cols.agent_code] === agentCode) {
        if (rows[i][cols.token] && rows[i][cols.token] === providedToken) return null;
        return respond_({ status: 'ERROR', message: 'invalid or missing Agent token' }, data && data.callback);
      }
    }
    if (!providedToken) {
      return respond_({ status: 'ERROR', message: 'token is required' }, data && data.callback);
    }
    const now = new Date().getTime();
    const row = new Array(headers.length).fill('');
    row[cols.agent_code] = agentCode;
    row[cols.token] = providedToken;
    row[cols.created_at] = now;
    row[cols.claimed_at] = now;
    sheet.appendRow(row);
    return null;
  });
}

// Validates data.handler_password against the HANDLER_PASSWORD Script
// Property. Fails closed (rejects) if the property was never set,
// rather than leaving every Handler/admin action open by accident from
// a forgotten setup step.
function requireHandlerAuth_(data) {
  const expected = PropertiesService.getScriptProperties().getProperty('HANDLER_PASSWORD');
  if (!expected) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'ERROR', message: 'Handler auth is not configured on the server' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (String((data && data.handler_password) || '') !== expected) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'ERROR', message: 'invalid Handler password' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  return null;
}

// A handful of player-owned writes (e.g. save_character) are ALSO
// legitimately editable directly by the Handler -- A-Cell's Sheet tab
// lets the Handler correct any Agent's Player Name inline, which has
// no way to carry that Agent's own token since the Handler isn't that
// player. Either credential is accepted: the Handler password (checked
// first, but only when the caller actually sent one, so a normal
// player request with no handler_password field at all goes straight
// to the token check instead of failing on a "wrong Handler password"
// it never claimed to have) or the Agent's own token.
function requireAgentOrHandlerAuth_(data) {
  if (data && data.handler_password) {
    const handlerErr = requireHandlerAuth_(data);
    if (!handlerErr) return null;
    return handlerErr;
  }
  return requireAgentToken_(data);
}

// ── Handler sessions (stage 4): a handful of A-Cell Admin reads --
// list_characters, list_agent_file_only, list_deleted_characters --
// return every Agent's full data with no auth at all, but they're
// GET/JSONP (a <script src=...> tag), and the only credential this app
// has is the Handler password. Putting that raw password in a URL
// query string would land it in browser history and any server access
// log -- worse than the problem it's fixing. A short-lived, revocable
// session token sidesteps that: the password is only ever POSTed once
// (handler_login below), and everything after that trades in an opaque
// token that's useless once it expires. CacheService is a natural fit
// -- it already expires entries on its own, so there's no separate
// sheet or cleanup job to maintain. ──

const HANDLER_SESSION_TTL_SECONDS = 21600; // 6h -- CacheService's own max

// POST-only: the one place the real Handler password is ever sent.
// Mints an opaque session token good for HANDLER_SESSION_TTL_SECONDS
// and returns it; the client stores it for the rest of the tab's
// session and sends it on every subsequent Admin listing GET instead
// of the password itself.
function handlerLogin_(data) {
  const authErr = requireHandlerAuth_(data);
  if (authErr) return authErr;
  const session = Utilities.getUuid();
  CacheService.getScriptCache().put('handler_session_' + session, '1', HANDLER_SESSION_TTL_SECONDS);
  return ContentService.createTextOutput(JSON.stringify({ status: 'OK', session: session, expires_in: HANDLER_SESSION_TTL_SECONDS }))
    .setMimeType(ContentService.MimeType.JSON);
}

// Validates params.handler_session against the cache. Works for both a
// POST body (data) and GET query params (e.parameter) -- same shape
// either way, just a field to read. All three current callers are
// GET/JSONP, so an error routes through respond_() with params.callback
// (e.parameter always carries the real one) -- bare JSON handed to a
// <script src=...> tag is invalid as a JS statement, so the tag fails
// silently and the caller just sees its own generic connection-timeout
// message after ~7s instead of the real "session expired" reason.
function requireHandlerSession_(params) {
  const session = String((params && params.handler_session) || '').trim();
  if (!session || !CacheService.getScriptCache().get('handler_session_' + session)) {
    return respond_({ status: 'ERROR', message: 'invalid or expired Handler session -- reload A-Cell' }, params && params.callback);
  }
  return null;
}

// Handler-only: mints a fresh token for an Agent Code, overwriting
// whatever token (if any) it had before. This is the recovery path for
// a player on a new device or with cleared storage -- they find their
// Agent Code via Cover Identity search (find_by_player_name, which
// stays deliberately open since it's the actual discovery mechanism
// this depends on), then ask their Handler, who runs this and relays
// the token back. Same social "ask your Handler" flow the app already
// assumes everywhere else -- no separate account system.
function resetAgentToken_(agentCode) {
  agentCode = String(agentCode || '').trim().toUpperCase();
  if (!agentCode) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'ERROR', message: 'agent_code is required' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  return withScriptLock(function () {
    const sheet = getOrCreateAgentAuthSheet();
    const rows = sheet.getDataRange().getValues();
    const headers = rows[0];
    const cols = headerMap_(headers);
    const missing = requireColumns_(cols, ['agent_code', 'token', 'created_at', 'claimed_at']);
    if (missing) return missing;
    const token = Utilities.getUuid();
    const now = new Date().getTime();
    let rowIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][cols.agent_code] === agentCode) { rowIndex = i; break; }
    }
    if (rowIndex !== -1) {
      // Mutate the row already in hand from the scan above and write it
      // back in one call instead of one setValue() per changed cell --
      // same row-batching pattern used throughout this round.
      const row = rows[rowIndex];
      row[cols.token] = token;
      row[cols.claimed_at] = now;
      sheet.getRange(rowIndex + 1, 1, 1, headers.length).setValues([row]);
    } else {
      const row = new Array(headers.length).fill('');
      row[cols.agent_code] = agentCode;
      row[cols.token] = token;
      row[cols.created_at] = now;
      row[cols.claimed_at] = now;
      sheet.appendRow(row);
    }
    return ContentService.createTextOutput(JSON.stringify({ status: 'OK', agent_code: agentCode, token: token }))
      .setMimeType(ContentService.MimeType.JSON);
  });
}

// ── Shared header-lookup helpers (this round's hygiene pass). Most
// functions below used to repeat `headers.indexOf('X')` per column
// with no consistent guard for a missing one -- headerMap_() builds
// {columnName: index} once, requireColumns_() checks a required set
// against it up front and fails with a clear message instead of a
// write silently targeting column -1 (or, in most cases, getRange()
// just throwing partway through a multi-cell write). Not retrofitted
// onto every function in the file -- only ones touched in this round,
// or that had a real unguarded gap; already-correct read-only listing
// functions are left as they were to avoid churn for no behavior
// change. ──
function headerMap_(headers) {
  const map = {};
  (headers || []).forEach(function (h, i) { if (h) map[h] = i; });
  return map;
}

function requireColumns_(map, names) {
  const missing = names.filter(function (n) { return !(n in map); });
  if (missing.length) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'ERROR', message: 'sheet missing column(s): ' + missing.join(', ') }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  return null;
}

function doGet(e) {
  // e is undefined if this is run manually from the Apps Script editor
  // (the "Run" button) instead of a real web request -- guard so that
  // doesn't show up as a false "Failed" execution.
  e = e || {};
  e.parameter = e.parameter || {};
  const callback = e.parameter && e.parameter.callback;

  // ── Image proxy (data URI approach) ─────────────────────────
  // ?action=imgdata&id=FILE_ID&callback=CALLBACK
  // Returns JSONP with base64 data URI so portal can set img.src
  if (e.parameter && e.parameter.action === 'imgdata' && e.parameter.id) {
    try {
      const file = DriveApp.getFileById(e.parameter.id);
      const blob = file.getBlob();
      const mimeType = blob.getContentType();
      const base64 = Utilities.base64Encode(blob.getBytes());
      const dataUri = 'data:' + mimeType + ';base64,' + base64;
      return respond_({ status: 'OK', dataUri: dataUri }, e.parameter.callback);
    } catch(err) {
      return respond_({ status: 'ERROR', message: err.message }, e.parameter.callback);
    }
  }

  // ── Character cloud load ─────────────────────────────────────
  // ?action=load_character&code=AGENT-CODE&callback=CALLBACK
  if (e.parameter && e.parameter.action === 'load_character' && e.parameter.code) {
    const result = doLookupCharacter(e.parameter.code);
    return respond_(JSON.parse(result.getContent()), e.parameter.callback);
  }

  // ── A-Cell: every saved character, for Play/Cells/Sheet/Admin ──
  // ?action=list_characters&callback=CALLBACK
  if (e.parameter && e.parameter.action === 'list_characters') {
    const authErr = requireHandlerSession_(e.parameter);
    if (authErr) return authErr;
    return listCharacters(callback);
  }

  // ── A-Cell: every Cell group, for the Cells tab ───────────────
  // ?action=list_cells&callback=CALLBACK
  if (e.parameter && e.parameter.action === 'list_cells') {
    return listCells(callback);
  }

  // ── Player Notes: a Cell's shared/private note blocks, filtered for
  // the requesting Agent. agent_code here is the requester (used only
  // to decide what's visible), not a filter on which cell's data is
  // read. Gated by the Agent's own token -- agent_code was otherwise a
  // spoofable requester parameter: sending someone else's code would
  // have returned THEIR private blocks, not just shared ones. ──
  // ?action=list_cell_notes&cell_id=ID&agent_code=CODE&token=TOKEN&callback=CALLBACK
  if (e.parameter && e.parameter.action === 'list_cell_notes') {
    const authErr = requireAgentToken_(e.parameter);
    if (authErr) return authErr;
    return listCellNotes(e.parameter.cell_id, e.parameter.agent_code, callback);
  }

  // ── A-Cell Admin: every soft-deleted Agent, for Recently Deleted ──
  // ?action=list_deleted_characters&callback=CALLBACK
  if (e.parameter && e.parameter.action === 'list_deleted_characters') {
    const authErr = requireHandlerSession_(e.parameter);
    if (authErr) return authErr;
    return listDeletedCharacters(callback);
  }

  // ── A-Cell Admin: every Agent that has an Agent File / Profiling
  // brief but no character sheet yet -- list_characters above only ever
  // sees the Characters sheet, so these were invisible to Admin's
  // delete list (and to Recently Deleted -- see listDeletedCharacters())
  // with no way to clean up a duplicate/test entry short of editing the
  // Delta Green Briefs sheet by hand. ──
  // ?action=list_agent_file_only&callback=CALLBACK
  if (e.parameter && e.parameter.action === 'list_agent_file_only') {
    const authErr = requireHandlerSession_(e.parameter);
    if (authErr) return authErr;
    return listAgentFileOnly(callback);
  }

  // ── A-Cell Handouts + the player-facing Agent Hub: every filed
  // handout/clue. ──
  // ?action=list_handouts&callback=CALLBACK
  if (e.parameter && e.parameter.action === 'list_handouts') {
    return listHandouts(callback);
  }

  // ── Table Radio: current track for a channel ─────────────────
  // ?action=get_now_playing&channel=CH&callback=CALLBACK
  if (e.parameter && e.parameter.action === 'get_now_playing') {
    return getNowPlaying(e.parameter.channel, callback);
  }

  // ── Table Radio: saved playlist for a channel ─────────────────
  // ?action=get_playlist&channel=CH&callback=CALLBACK
  if (e.parameter && e.parameter.action === 'get_playlist') {
    return getPlaylist(e.parameter.channel, callback);
  }

  // ── A-Cell Music: every uploaded Track Library mp3 ─────────────
  // ?action=list_tracks&callback=CALLBACK
  if (e.parameter && e.parameter.action === 'list_tracks') {
    return listTracks(callback);
  }

  // ── Agent Hub: a player's private notes on Handouts. Gated by the
  // Agent's own token -- agent_code was otherwise a spoofable requester
  // parameter, same issue as list_cell_notes above. ──
  // ?action=list_handout_notes&agent_code=CODE&token=TOKEN&callback=CALLBACK
  if (e.parameter && e.parameter.action === 'list_handout_notes') {
    const authErr = requireAgentToken_(e.parameter);
    if (authErr) return authErr;
    return listHandoutNotes(e.parameter.agent_code, callback);
  }

  // ── Cover Identity: find every Agent (character sheet and/or Agent
  // File) belonging to a real-world player by name. Case-insensitive,
  // trimmed exact match -- no auth/PIN, deliberately: a bare name
  // lookup for now, with real access control tracked as its own
  // separate, later piece of work rather than bundled into this. ──
  // ?action=find_by_player_name&name=NAME&callback=CALLBACK
  if (e.parameter && e.parameter.action === 'find_by_player_name') {
    return findByPlayerName(e.parameter.name, callback);
  }

  // ── Agent lookup ─────────────────────────────────────────────
  if (e.parameter && e.parameter.code) {
    const result = doLookup(e.parameter.code);
    return respond_(JSON.parse(result.getContent()), e.parameter.callback);
  }

  return ContentService
    .createTextOutput('Delta Green Brief Collector is running.')
    .setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  try {
    let rawData = '';
    if (e.postData && e.postData.contents) rawData = e.postData.contents;
    else if (e.parameter) rawData = JSON.stringify(e.parameter);

    const data = JSON.parse(rawData);

    // A-Cell: exchange the Handler password for a short-lived session
    // token (see the "Handler sessions" block above) -- the one action
    // that ever sees the real password, so every Admin listing read can
    // trade in the opaque token instead.
    if (data.action === 'handler_login') {
      return handlerLogin_(data);
    }

    if (data.action === 'update_medical' || data.action === 'update_aar' || data.action === 'update_field') {
      const authErr = requireAgentToken_(data);
      if (authErr) return authErr;
      return updateAgentField(data);
    }

    if (data.action === 'save_plate') {
      const authErr = requireAgentToken_(data);
      if (authErr) return authErr;
      return savePlateImage(data);
    }

    // Agent File: AI-drafted appearance prompt (Face Plate / Outfit Plate /
    // surveillance / post-injury), via Claude on the server so the API key
    // never touches the browser. See generateAppearancePrompt() below.
    if (data.action === 'generate_prompt') {
      const authErr = requireAgentToken_(data);
      if (authErr) return authErr;
      return generateAppearancePrompt(data);
    }

    // Agent File: actually render a Face/Outfit Plate image from a
    // (previously drafted) prompt, via Gemini on the server. Returns the
    // image back to the client rather than saving it directly, so the
    // client can reuse the existing save_plate action unchanged -- one
    // Drive-upload/Sheet-write code path for both a manual upload and a
    // generated image. See generatePlateImage() below.
    if (data.action === 'generate_plate_image') {
      const authErr = requireAgentToken_(data);
      if (authErr) return authErr;
      return generatePlateImage(data);
    }

    // Either credential works here -- the Agent's own token (the normal
    // case, stats/cloud-sync.js saving the player's own sheet) or the
    // Handler password (A-Cell's Sheet tab editing any Agent's Player
    // Name field directly). See requireAgentOrHandlerAuth_().
    if (data.action === 'save_character') {
      const authErr = requireAgentOrHandlerAuth_(data);
      if (authErr) return authErr;
      return saveCharacter(data);
    }

    // A-Cell (legacy): Handler edits a Cell's handler/operation tag.
    // Superseded by real Cell groups (create_cell/update_cell_members
    // below) -- kept for backward compatibility, unused by the current
    // frontend.
    if (data.action === 'update_character_field') {
      const authErr = requireHandlerAuth_(data);
      if (authErr) return authErr;
      return updateCharacterField(data.agent_code, data.field, data.value);
    }

    // A-Cell: create a new Cell group.
    if (data.action === 'create_cell') {
      const authErr = requireHandlerAuth_(data);
      if (authErr) return authErr;
      return createCell(data.name, data.handler);
    }

    // A-Cell: overwrite a Cell's full member list (add/remove).
    if (data.action === 'update_cell_members') {
      const authErr = requireHandlerAuth_(data);
      if (authErr) return authErr;
      return updateCellMembers(data.cell_id, data.member_codes);
    }

    // A-Cell: delete a Cell grouping (its Agents stay on file).
    if (data.action === 'delete_cell') {
      const authErr = requireHandlerAuth_(data);
      if (authErr) return authErr;
      return deleteCell(data.cell_id);
    }

    // Player Notes: save (create or update) one note block.
    if (data.action === 'save_note_block') {
      const authErr = requireAgentToken_(data);
      if (authErr) return authErr;
      return saveNoteBlock(data);
    }

    if (data.action === 'delete_note_block') {
      const authErr = requireAgentToken_(data);
      if (authErr) return authErr;
      return deleteNoteBlock(data);
    }

    // Player Notes: save an Agent's chosen color/handwriting font.
    if (data.action === 'save_agent_identity') {
      const authErr = requireAgentToken_(data);
      if (authErr) return authErr;
      return saveAgentIdentity(data);
    }

    // A-Cell Music: set a Cell's usual Table Radio channel ("Cue For Cell").
    if (data.action === 'set_cell_channel') {
      const authErr = requireHandlerAuth_(data);
      if (authErr) return authErr;
      return setCellChannel(data.cell_id, data.channel);
    }

    // A-Cell Handouts: create/edit/delete a filed handout.
    if (data.action === 'create_handout') {
      const authErr = requireHandlerAuth_(data);
      if (authErr) return authErr;
      return createHandout(data);
    }
    if (data.action === 'update_handout') {
      const authErr = requireHandlerAuth_(data);
      if (authErr) return authErr;
      return updateHandout(data);
    }
    if (data.action === 'delete_handout') {
      const authErr = requireHandlerAuth_(data);
      if (authErr) return authErr;
      return deleteHandout(data.handout_id);
    }

    // A-Cell Admin: soft-delete an Agent (archives Characters + Briefs
    // rows so they can be restored, rather than removing them).
    if (data.action === 'delete_character') {
      const authErr = requireHandlerAuth_(data);
      if (authErr) return authErr;
      return deleteCharacter(data.agent_code);
    }

    // A-Cell Admin: undo a soft-delete.
    if (data.action === 'restore_character') {
      const authErr = requireHandlerAuth_(data);
      if (authErr) return authErr;
      return restoreCharacter(data.agent_code);
    }

    // A-Cell Admin: Handler-mediated recovery -- mint a fresh Agent
    // token for a player on a new device / cleared storage, after the
    // Handler has located their Agent Code via Cover Identity search.
    // Gated from the moment it exists (unlike the pre-existing actions
    // above, which don't get their requireAgentToken_()/
    // requireHandlerAuth_() guards until a later, separate stage) --
    // an ungated token-reset would be a standing account-takeover hole.
    if (data.action === 'reset_agent_token') {
      const authErr = requireHandlerAuth_(data);
      if (authErr) return authErr;
      return resetAgentToken_(data.agent_code);
    }

    // Table Radio: Handler sets (or clears) the current track for a channel.
    if (data.action === 'set_now_playing') {
      const authErr = requireHandlerAuth_(data);
      if (authErr) return authErr;
      return setNowPlaying(data.channel, data.track_url, data.track_title, data.track_kind, data.loop);
    }

    // Table Radio: Handler pauses/resumes the current track for a channel
    // without restarting it (set_now_playing always restarts from 0:00).
    if (data.action === 'pause_now_playing') {
      const authErr = requireHandlerAuth_(data);
      if (authErr) return authErr;
      return pauseNowPlaying(data.channel);
    }
    if (data.action === 'resume_now_playing') {
      const authErr = requireHandlerAuth_(data);
      if (authErr) return authErr;
      return resumeNowPlaying(data.channel);
    }

    // Table Radio: Handler saves the playlist for a channel.
    if (data.action === 'save_playlist') {
      const authErr = requireHandlerAuth_(data);
      if (authErr) return authErr;
      return savePlaylist(data.channel, data.playlist_json);
    }

    // A-Cell Music: upload/delete a Track Library mp3.
    if (data.action === 'upload_track') {
      const authErr = requireHandlerAuth_(data);
      if (authErr) return authErr;
      return uploadTrack(data);
    }
    if (data.action === 'delete_track') {
      const authErr = requireHandlerAuth_(data);
      if (authErr) return authErr;
      return deleteTrack(data.track_id);
    }

    // Agent Hub: save a player's private note on a Handout.
    if (data.action === 'save_handout_note') {
      const authErr = requireAgentToken_(data);
      if (authErr) return authErr;
      return saveHandoutNote(data);
    }

    // New agent submission -- also handles a returning Agent's "Update
    // Brief" resubmission. Upsert by agent_code: an existing row is
    // overwritten in place rather than appended alongside a duplicate.
    // Before this, EVERY resubmission appended a fresh row, and
    // doLookup()/doGet() both return the FIRST row matching a code --
    // so a corrected/completed resubmission was silently invisible,
    // permanently shadowed by whatever row for that code existed first.
    // (This is very likely why "the Agent File still won't open even
    // though Profiling was resubmitted" reports happen: the fix landed
    // in a row nobody ever reads back.)
    const ss = getOrCreateSheet();
    const sheet = ss.getSheetByName(SHEET_NAME);

    // Locked: several players submitting/resubmitting Profiling briefs
    // within the same couple of seconds during a live session is exactly
    // when an unlocked scan-then-write can race.
    return withScriptLock(function () {
      const existingValues = sheet.getDataRange().getValues();
      const existingHeaders = existingValues[0];
      const codeCol = existingHeaders.indexOf('Agent Code');
      const refImageLinkCol = existingHeaders.indexOf('Ref Image Link');

      // Brand-new Agent: generate the code inside the lock, against the
      // same row scan used for the upsert check below, and retry on a
      // collision rather than trusting Math.random() alone -- previously
      // generated entirely outside the lock, so a colliding fresh code
      // would have silently upserted into a stranger's existing row.
      let agentCode = data.agent_code;
      if (!agentCode && codeCol !== -1) {
        const existingCodes = {};
        for (let i = 1; i < existingValues.length; i++) {
          if (existingValues[i][codeCol]) existingCodes[existingValues[i][codeCol]] = true;
        }
        do {
          agentCode = generateAgentCode(data.char_name);
        } while (existingCodes[agentCode]);
      } else if (!agentCode) {
        agentCode = generateAgentCode(data.char_name);
      }

      let existingRowIndex = -1;
      if (codeCol !== -1) {
        for (let i = 1; i < existingValues.length; i++) {
          if (existingValues[i][codeCol] === agentCode) { existingRowIndex = i; break; }
        }
      }

      let imageLink = '';
      if (data.ref_image_base64 && data.ref_image_name) {
        imageLink = saveImageToDrive(data.ref_image_base64, data.ref_image_name, data.char_name);
      } else if (existingRowIndex !== -1 && refImageLinkCol !== -1) {
        // Resubmitting without picking a new file (the normal case --
        // <input type=file> can't be pre-filled from a previous session,
        // so it's empty on every resubmit unless the player deliberately
        // re-attaches) keeps whatever reference image was already on file
        // instead of wiping it out.
        imageLink = existingValues[existingRowIndex][refImageLinkCol] || '';
      }

      const row = COLUMNS.map(col => {
        if (col === 'agent_code') return agentCode;
        if (col === 'ref_image_link') return imageLink;
        if (col === 'ref_image_base64') return '';
        return data[col] || '';
      });

      if (existingRowIndex !== -1) {
        sheet.getRange(existingRowIndex + 1, 1, 1, row.length).setValues([row]);
      } else {
        sheet.appendRow(row);
      }

      return ContentService
        .createTextOutput(JSON.stringify({ status: 'OK', agent_code: agentCode }))
        .setMimeType(ContentService.MimeType.JSON);
    });

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ERROR', message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function updateAgentField(data) {
  try {
    const ss = getOrCreateSheet();
    const sheet = ss.getSheetByName(SHEET_NAME);
    const rows = sheet.getDataRange().getValues();
    const headers = rows[0];
    const codeCol = headers.indexOf('Agent Code');

    const FIELD_MAP = {
      'medical_log':    'Medical Log',
      'aar_log':        'Aar Log',
      'active_eras':    'Active Eras',
      'banana_prompt':  'Banana Prompt',
      'face_plate_url': 'face_plate_url',
      'outfit_plate_url': 'outfit_plate_url',
      'mode0_prompt':   'mode0_prompt',
      'mode1_prompt':   'mode1_prompt',
      'ref_image_link': 'Ref Image Link',
      // Cover Identity: explicit, even though the generic fallback below
      // (field.split('_').map(capitalize).join(' ')) already produces
      // the same 'Player Name' -- spelled out so it's not relying on
      // that fallback matching by coincidence if this map is ever
      // consulted elsewhere.
      'player_name':    'Player Name'
    };

    let fieldName;
    if (data.action === 'update_medical') fieldName = 'Medical Log';
    else if (data.action === 'update_aar') fieldName = 'Aar Log';
    else if (data.action === 'update_field') {
      fieldName = FIELD_MAP[data.field] || data.field
        .split('_')
        .map(function(w){ return w.charAt(0).toUpperCase() + w.slice(1); })
        .join(' ');
    }

    const fieldCol = headers.indexOf(fieldName);

    if (fieldCol === -1) {
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'ERROR', message: fieldName + ' column not found. Add it to the Sheet.' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    for (let i = 1; i < rows.length; i++) {
      if (rows[i][codeCol] === data.agent_code) {
        const value = data.action === 'update_medical' ? data.medical_log
          : data.action === 'update_aar' ? data.aar_log
          : data.value;
        sheet.getRange(i + 1, fieldCol + 1).setValue(value);
        return ContentService
          .createTextOutput(JSON.stringify({ status: 'OK' }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'NOT_FOUND' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ERROR', message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doLookup(code) {
  try {
    const ss = getOrCreateSheet();
    const sheet = ss.getSheetByName(SHEET_NAME);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const codeCol = headers.indexOf('Agent Code');

    for (let i = 1; i < data.length; i++) {
      if (data[i][codeCol] === code) {
        const row = {};
        headers.forEach((h, idx) => {
          const key = h.toLowerCase().replace(/\s+/g, '_');
          row[key] = data[i][idx];
        });
        return ContentService
          .createTextOutput(JSON.stringify({ status: 'OK', data: row }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'NOT_FOUND' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ERROR', message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ── Character cloud save (Characters tab, upserted by agent_code) ──
// NOTE: this sheet's headers are Title Case ('Agent Code', 'Updated
// At', 'Character JSON', 'Player Name') -- the A-Cell functions below
// (listCharacters etc.) look up columns by these exact header strings,
// not by the snake_case keys used elsewhere in this file, so they stay
// in sync with what this function actually writes.

function getOrCreateCharactersSheet() {
  const ss = getOrCreateSheet(); // same spreadsheet file as the Briefs tab
  let sheet = ss.getSheetByName(CHARACTERS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CHARACTERS_SHEET_NAME);
    const headers = ['Agent Code', 'Updated At', 'Character JSON', 'Player Name'];
    sheet.appendRow(headers);
    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setBackground('#1a1a18');
    headerRange.setFontColor('#e8e2d4');
    headerRange.setFontWeight('bold');
    headerRange.setFontSize(10);
    sheet.setFrozenRows(1);
  } else {
    // Migration-safe: adds Player Name to a Characters sheet that
    // predates Cover Identity, so an existing deployment self-heals
    // instead of needing a manual one-time migration run -- same
    // pattern as getOrCreateCellsSheet()'s 'channel' column and
    // getOrCreateRadioSheet()'s track_kind/paused/paused_at/loop
    // columns further down this file. Gated behind a cache flag, also
    // matching getOrCreateRadioSheet()/ensureBriefsColumns() -- this
    // runs on nearly every request that touches character data, so
    // re-reading the header row and re-running indexOf on every single
    // call (rather than once per however long the cache lives) was an
    // avoidable chunk of load on a live session.
    const cache = CacheService.getScriptCache();
    if (cache.get('characters_columns_ensured') !== '1') {
      const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      if (headers.indexOf('Player Name') === -1) {
        sheet.getRange(1, sheet.getLastColumn() + 1).setValue('Player Name');
      }
      cache.put('characters_columns_ensured', '1', 21600);
    }
  }
  return sheet;
}

function saveCharacter(data) {
  try {
    if (!data.agent_code) {
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'ERROR', message: 'agent_code is required.' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // Locked: several players can save/import within the same couple of
    // seconds during a live session, and this is a scan-for-existing-row
    // then write -- without a lock, two concurrent saves for two
    // different (or, worse, the same) codes can interleave their scans
    // against a mid-write sheet.
    return withScriptLock(function () {
      const sheet = getOrCreateCharactersSheet();
      const values = sheet.getDataRange().getValues();
      const headers = values[0];
      // Header-based lookups, not hardcoded column positions -- Player
      // Name was added after this sheet already had rows in production,
      // so writes here can't assume a fixed 3-column layout any more.
      const cols = headerMap_(headers);
      const codeCol = cols['Agent Code'];
      const updatedCol = cols['Updated At'];
      const jsonCol = cols['Character JSON'];
      const playerNameCol = cols['Player Name'];
      const now = new Date().toISOString();
      const characterJson = typeof data.character_json === 'string'
        ? data.character_json
        : JSON.stringify(data.character_json || {});
      const playerName = data.player_name || '';

      for (let i = 1; i < values.length; i++) {
        if (values[i][codeCol] === data.agent_code) {
          // Existing row for this code -- overwrite in place (the
          // upsert). Mutate the row already fetched above and write it
          // back in one call instead of one setValue() per column.
          const row = values[i];
          row[updatedCol] = now;
          row[jsonCol] = characterJson;
          if (playerNameCol !== undefined) row[playerNameCol] = playerName;
          sheet.getRange(i + 1, 1, 1, headers.length).setValues([row]);
          return ContentService
            .createTextOutput(JSON.stringify({ status: 'OK', agent_code: data.agent_code, updated_at: now }))
            .setMimeType(ContentService.MimeType.JSON);
        }
      }

      // No existing row -- first save for this code. Built by header
      // position (like setNowPlaying() further down), not array-literal
      // order, so this stays correct regardless of where Player Name
      // ended up relative to any other future column.
      const newRow = new Array(headers.length).fill('');
      newRow[codeCol] = data.agent_code;
      newRow[updatedCol] = now;
      newRow[jsonCol] = characterJson;
      if (playerNameCol !== undefined) newRow[playerNameCol] = playerName;
      sheet.appendRow(newRow);
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'OK', agent_code: data.agent_code, updated_at: now }))
        .setMimeType(ContentService.MimeType.JSON);
    });
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ERROR', message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doLookupCharacter(code) {
  try {
    const ss = getOrCreateSheet();
    const sheet = ss.getSheetByName(CHARACTERS_SHEET_NAME);
    if (!sheet) {
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'NOT_FOUND' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'NOT_FOUND' }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    // Read only the Agent Code column first to find the row -- every
    // single "Play" click (agent-hub.html's ?load= flow) used to pull
    // this whole sheet across the wire, including every OTHER agent's
    // full Character JSON blob (usually the single largest thing on
    // this sheet), just to find one row by code. That scales worse the
    // more Agents the campaign accumulates, and was very likely the
    // real cause of a reported ~8-10s wait on the loading screen before
    // a character actually appeared. A targeted single-row read after
    // this only ever transfers the one JSON blob that's actually needed.
    const codes = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < codes.length; i++) {
      if (codes[i][0] === code) {
        const row = i + 2; // header is row 1; codes[0] is sheet row 2
        const rowValues = sheet.getRange(row, 1, 1, 3).getValues()[0]; // Agent Code, Updated At, Character JSON
        return ContentService
          .createTextOutput(JSON.stringify({
            status: 'OK',
            agent_code: code,
            updated_at: rowValues[1],
            character_json: rowValues[2]
          }))
          .setMimeType(ContentService.MimeType.JSON);
      }
    }
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'NOT_FOUND' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ERROR', message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ── Cover Identity: find every Agent belonging to a real-world player
// by name, across BOTH sheets -- a Delta Green Briefs row (Agent File
// only, no character sheet yet) and a Characters row (has a character
// sheet) are merged by agent_code, with the Characters row's fields
// winning where both exist (it's the fuller, more current record).
// Case-insensitive, trimmed exact match; no fuzzy matching, no auth --
// deliberately a bare name lookup for now (see the doGet comment above
// this action). ──
function findByPlayerName(name, callback) {
  const needle = String(name || '').trim().toLowerCase();
  if (!needle) {
    return respond_({ status: 'OK', agents: [] }, callback);
  }

  const byCode = {};

  // Pass 1: Delta Green Briefs (Agent File fields) -- used as a base so
  // an Agent-File-only player (no character sheet yet) is still found.
  const briefsSheet = getOrCreateSheet().getSheetByName(SHEET_NAME);
  if (briefsSheet) {
    const briefRows = briefsSheet.getDataRange().getValues();
    const briefHeaders = briefRows[0];
    const pnCol = briefHeaders.indexOf('Player Name');
    const codeCol = briefHeaders.indexOf('Agent Code');
    const nameCol = briefHeaders.indexOf('Char Name');
    const codenameCol = briefHeaders.indexOf('Codename');
    const sexCol = briefHeaders.indexOf('Sex');
    const ageCol = briefHeaders.indexOf('Age Range');
    const natCol = briefHeaders.indexOf('Nationality');
    // Face Plate (and the eras it was generated for) only ever lives on
    // this sheet -- Characters has no such column -- so this is the only
    // pass that can populate it. Read by header name, not COLUMNS
    // position, same as every other column above.
    const faceCol = briefHeaders.indexOf('face_plate_url');
    const erasCol = briefHeaders.indexOf('Active Eras');
    if (pnCol !== -1 && codeCol !== -1) {
      for (let i = 1; i < briefRows.length; i++) {
        const row = briefRows[i];
        if (String(row[pnCol] || '').trim().toLowerCase() !== needle) continue;
        const code = row[codeCol];
        if (!code) continue;
        byCode[code] = {
          code: code,
          char_name: nameCol !== -1 ? (row[nameCol] || '') : '',
          codename: codenameCol !== -1 ? (row[codenameCol] || '') : '',
          sex: sexCol !== -1 ? (row[sexCol] || '') : '',
          age_range: ageCol !== -1 ? (row[ageCol] || '') : '',
          nationality: natCol !== -1 ? (row[natCol] || '') : '',
          face_plate_url: faceCol !== -1 ? (row[faceCol] || '') : '',
          active_eras: erasCol !== -1 ? (row[erasCol] || '') : '',
          saved_at: Date.now(),
        };
      }
    }
  }

  // Pass 2: Characters -- overrides/adds on top of the Briefs pass,
  // since this is the fuller record once a character sheet exists.
  // character_json is parsed only for the handful of display fields
  // agent-hub.html's roster needs, not re-sent whole.
  const charSheet = getOrCreateCharactersSheet();
  const charRows = charSheet.getDataRange().getValues();
  const charHeaders = charRows[0];
  const cPnCol = charHeaders.indexOf('Player Name');
  const cCodeCol = charHeaders.indexOf('Agent Code');
  const cJsonCol = charHeaders.indexOf('Character JSON');
  const cUpdatedCol = charHeaders.indexOf('Updated At');
  if (cPnCol !== -1 && cCodeCol !== -1) {
    for (let j = 1; j < charRows.length; j++) {
      const row = charRows[j];
      if (String(row[cPnCol] || '').trim().toLowerCase() !== needle) continue;
      const code = row[cCodeCol];
      if (!code) continue;
      let bio = {};
      try { bio = JSON.parse(row[cJsonCol] || '{}').bio || {}; } catch (e) { /* skip unparsable */ }
      const existing = byCode[code] || {};
      // Updated At is stored as an ISO string (see saveCharacter()
      // above, new Date().toISOString()), not epoch millis -- parse it
      // properly rather than Number(...), which would just silently
      // produce NaN on a string like that.
      const updatedRaw = cUpdatedCol !== -1 ? row[cUpdatedCol] : null;
      const parsedUpdated = updatedRaw ? new Date(updatedRaw).getTime() : NaN;
      byCode[code] = {
        code: code,
        char_name: bio.name || existing.char_name || '',
        codename: existing.codename || '',
        sex: bio.sex || existing.sex || '',
        age_range: bio.age || existing.age_range || '',
        nationality: bio.nationality || existing.nationality || '',
        // Neither lives on the Characters sheet -- carry forward whatever
        // Pass 1 found on Briefs instead of dropping it here.
        face_plate_url: existing.face_plate_url || '',
        active_eras: existing.active_eras || '',
        // Real Characters "Updated At" when there's a character sheet to
        // read it from; otherwise (a Briefs-only match, Pass 1's own
        // Date.now() above) this is "found via name lookup just now",
        // NOT that row's actual Submitted At -- a real, if surprising,
        // difference in what saved_at means depending on which sheet
        // matched, not a bug: there's simply no better timestamp
        // available for a Briefs-only Agent that hasn't been re-touched.
        saved_at: isNaN(parsedUpdated) ? Date.now() : parsedUpdated,
      };
    }
  }

  const result = { status: 'OK', agents: Object.keys(byCode).map(function (k) { return byCode[k]; }) };
  return respond_(result, callback);
}

// ── A-Cell: Play/Cells/Sheet/Admin read every saved character. Column
// lookups use the SAME Title Case headers getOrCreateCharactersSheet()
// creates above ('Agent Code', 'Updated At', 'Character JSON', 'Player
// Name'). ──

function listCharacters(callback) {
  const sheet = getOrCreateCharactersSheet();
  const result = { status: 'OK', characters: [] };

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const codeCol = headers.indexOf('Agent Code');
  const jsonCol = headers.indexOf('Character JSON');
  const updatedCol = headers.indexOf('Updated At');
  const handlerCol = headers.indexOf('Handler');
  const operationCol = headers.indexOf('Operation');

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const code = codeCol >= 0 ? row[codeCol] : '';
    if (!code) continue;
    result.characters.push({
      agent_code: code,
      character_json: jsonCol >= 0 ? row[jsonCol] : '',
      updated_at: updatedCol >= 0 ? row[updatedCol] : '',
      // legacy fields -- empty unless addCellsTagColumns() was run in
      // the past; the current frontend no longer reads these, real
      // groups live in the Cells sheet below instead.
      handler: handlerCol >= 0 ? row[handlerCol] : '',
      operation: operationCol >= 0 ? row[operationCol] : ''
    });
  }

  return respond_(result, callback);
}

// ── A-Cell Admin: every Agent File / Profiling brief with no matching
// Characters-sheet row -- listCharacters() above can't see these at
// all, which made them undeletable through Admin (delete_character
// itself already handles a code with no Characters row fine, it just
// had no list to surface one from). ──
function listAgentFileOnly(callback) {
  const result = { status: 'OK', agents: [] };

  const charSheet = getOrCreateCharactersSheet();
  const charValues = charSheet.getDataRange().getValues();
  const charHeaders = charValues[0];
  const charCodeCol = charHeaders.indexOf('Agent Code');
  const charCodes = {};
  if (charCodeCol !== -1) {
    for (let i = 1; i < charValues.length; i++) {
      const code = charValues[i][charCodeCol];
      if (code) charCodes[code] = true;
    }
  }

  const briefsSheet = getOrCreateSheet().getSheetByName(SHEET_NAME);
  const briefsValues = briefsSheet.getDataRange().getValues();
  const briefsHeaders = briefsValues[0];
  const codeCol = briefsHeaders.indexOf('Agent Code');
  const nameCol = briefsHeaders.indexOf('Char Name');
  const codenameCol = briefsHeaders.indexOf('Codename');
  const submittedCol = briefsHeaders.indexOf('Submitted At');

  for (let i = 1; i < briefsValues.length; i++) {
    const row = briefsValues[i];
    const code = codeCol !== -1 ? row[codeCol] : '';
    if (!code || charCodes[code]) continue; // has a character sheet -- listCharacters() already covers it
    result.agents.push({
      agent_code: code,
      char_name: nameCol !== -1 ? (row[nameCol] || '') : '',
      codename: codenameCol !== -1 ? (row[codenameCol] || '') : '',
      submitted_at: submittedCol !== -1 ? (row[submittedCol] || '') : ''
    });
  }

  return respond_(result, callback);
}

// Legacy: writes a single handler/operation tag for one Agent's row.
// Superseded by Cell groups below -- kept only so an old deployment
// that still calls update_character_field doesn't hard-error.
function updateCharacterField(agentCode, field, value) {
  const allowed = { handler: 'Handler', operation: 'Operation' };
  const headerName = allowed[field];
  if (!headerName) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'ERROR', message: 'Field not allowed: ' + field }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  const sheet = getOrCreateCharactersSheet();
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const codeCol = headers.indexOf('Agent Code');
  const fieldCol = headers.indexOf(headerName);
  if (fieldCol === -1) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'ERROR', message: headerName + ' column missing' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  for (let i = 1; i < data.length; i++) {
    if (data[i][codeCol] === agentCode) {
      sheet.getRange(i + 1, fieldCol + 1).setValue(value);
      return ContentService.createTextOutput(JSON.stringify({ status: 'OK' })).setMimeType(ContentService.MimeType.JSON);
    }
  }
  return ContentService.createTextOutput(JSON.stringify({ status: 'NOT_FOUND' })).setMimeType(ContentService.MimeType.JSON);
}

// ── A-Cell Admin: soft-delete an Agent -- moves their Characters row
// (character sheet) AND their Delta Green Briefs row (Agent File /
// Field ID submission) to matching "Deleted" archive sheets, instead
// of removing them outright, so a delete is still recoverable via
// Restore in the Admin tab's Recently Deleted list. Gated client-side
// behind the A-Cell password (the page already sits behind that same
// password, so this is one confirmation, not a second one on top)
// before this ever gets called. Recovery isn't indefinite, though --
// see purgeOldDeleted() below. ──
// Migration-safe: a DeletedCharacters/DeletedBriefs sheet that already
// existed before the 24h purge feature was added has no "Deleted At"
// header at all -- deleteCharacter() below still appends the timestamp
// as an extra value past the end of every row regardless of whether a
// header names that column, so the data has been sitting there
// correctly all along. Without the header, though, purgeOldDeleted()'s
// data[0].indexOf('Deleted At') always returns -1 and it silently
// no-ops for that sheet, forever -- this is very likely why "Recently
// Deleted" reportedly never purges even on an up-to-date deploy.
// Labeling the column now (getLastColumn() already reflects where that
// data actually lives, since appendRow extended the sheet out to it)
// unblocks purging immediately, including the already-overdue backlog.
// Called from both getOrCreateDeletedSheet() (a fresh delete) and
// purgeOldDeleted() (viewing Admin's Recently Deleted, or restoring)
// so either path self-heals it, not just whichever happens first.
function ensureDeletedAtColumn(sheet) {
  const lastCol = sheet.getLastColumn();
  if (lastCol === 0) return;
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  if (headers.indexOf('Deleted At') === -1) {
    sheet.getRange(1, lastCol + 1).setValue('Deleted At');
  }
}

function getOrCreateDeletedSheet(name, liveHeaders) {
  const ss = getOrCreateSheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(liveHeaders.concat(['Deleted At']));
    return sheet;
  }
  ensureDeletedAtColumn(sheet);
  return sheet;
}

// A soft-deleted Agent older than this is gone for good -- "Recently
// Deleted" is meant as an undo window for an accidental delete, not a
// second permanent archive alongside the live sheets. Purged
// opportunistically (called from listDeletedCharacters() and
// deleteCharacter() below) rather than off a separate time-driven
// Apps Script trigger, which would need a one-time manual setup step
// in the Apps Script UI on top of just pasting this file in -- this
// way the retention policy is self-contained in the code, and
// "Recently Deleted" prunes itself the next time anyone actually
// looks at or touches the Admin tab.
const DELETED_RETENTION_MS = 24 * 60 * 60 * 1000;

function purgeOldDeleted() {
  const ss = getOrCreateSheet();
  const cutoff = new Date().getTime() - DELETED_RETENTION_MS;
  ['DeletedCharacters', 'DeletedBriefs'].forEach(function (name) {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return;
    ensureDeletedAtColumn(sheet);
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return;
    const deletedAtCol = data[0].indexOf('Deleted At');
    if (deletedAtCol === -1) return;
    // Bottom-up, same as every other in-place row delete in this file --
    // deleting row i shifts every row below it up, so walking forward
    // would skip a row right after deleting its predecessor.
    for (let i = data.length - 1; i >= 1; i--) {
      const deletedAt = Number(data[i][deletedAtCol]);
      if (deletedAt && deletedAt < cutoff) sheet.deleteRow(i + 1);
    }
  });
}

function deleteCharacter(agentCode) {
  if (!agentCode) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'ERROR', message: 'agent_code is required' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  purgeOldDeleted();
  // Locked: this moves a row in Characters AND a row in Briefs as two
  // separate operations -- without a lock around both, a concurrent
  // request touching either sheet mid-move could interleave with it.
  return withScriptLock(function () {
    const deletedAt = new Date().getTime();

    const charSheet = getOrCreateCharactersSheet();
    const charData = charSheet.getDataRange().getValues();
    const charHeaders = charData[0];
    const charCodeCol = charHeaders.indexOf('Agent Code');
    const deletedChars = getOrCreateDeletedSheet('DeletedCharacters', charHeaders);
    for (let i = charData.length - 1; i >= 1; i--) {
      if (charData[i][charCodeCol] === agentCode) {
        deletedChars.appendRow(charData[i].concat([deletedAt]));
        charSheet.deleteRow(i + 1);
        break;
      }
    }

    const briefsSs = getOrCreateSheet();
    const briefsSheet = briefsSs.getSheetByName(SHEET_NAME);
    const briefsData = briefsSheet.getDataRange().getValues();
    const briefsHeaders = briefsData[0];
    const briefsCodeCol = briefsHeaders.indexOf('Agent Code');
    const deletedBriefs = getOrCreateDeletedSheet('DeletedBriefs', briefsHeaders);
    for (let j = briefsData.length - 1; j >= 1; j--) {
      if (briefsData[j][briefsCodeCol] === agentCode) {
        deletedBriefs.appendRow(briefsData[j].concat([deletedAt]));
        briefsSheet.deleteRow(j + 1);
        break;
      }
    }

    return ContentService.createTextOutput(JSON.stringify({ status: 'OK', agent_code: agentCode }))
      .setMimeType(ContentService.MimeType.JSON);
  });
}

// ── A-Cell Admin: list every soft-deleted Agent, for the Admin tab's
// Recently Deleted section. Reads DeletedCharacters (the character-
// sheet half) same as always, PLUS DeletedBriefs entries that have no
// matching DeletedCharacters row -- an Agent-File-only delete (no
// character sheet, see deleteCharacter()/listAgentFileOnly() above)
// only ever wrote to DeletedBriefs, so it used to be invisible here too
// and the 24h undo window didn't actually cover it. Those entries carry
// char_name directly (there's no character_json to read a name out of).
// Purges anything past retention first, so a stale entry never briefly
// flashes in the list only to fail Restore a moment later. ──
function listDeletedCharacters(callback) {
  purgeOldDeleted();
  const ss = getOrCreateSheet();
  const result = { status: 'OK', characters: [] };
  const seenCodes = {};

  const charSheet = ss.getSheetByName('DeletedCharacters');
  if (charSheet) {
    const data = charSheet.getDataRange().getValues();
    const headers = data[0];
    const codeCol = headers.indexOf('Agent Code');
    const jsonCol = headers.indexOf('Character JSON');
    const deletedAtCol = headers.indexOf('Deleted At');
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const code = codeCol >= 0 ? row[codeCol] : '';
      if (!code) continue;
      seenCodes[code] = true;
      result.characters.push({
        agent_code: code,
        character_json: jsonCol >= 0 ? row[jsonCol] : '',
        deleted_at: deletedAtCol >= 0 ? row[deletedAtCol] : ''
      });
    }
  }

  const briefsSheet = ss.getSheetByName('DeletedBriefs');
  if (briefsSheet) {
    const data = briefsSheet.getDataRange().getValues();
    const headers = data[0];
    const codeCol = headers.indexOf('Agent Code');
    const nameCol = headers.indexOf('Char Name');
    const deletedAtCol = headers.indexOf('Deleted At');
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const code = codeCol >= 0 ? row[codeCol] : '';
      if (!code || seenCodes[code]) continue; // already listed via its character sheet half above
      result.characters.push({
        agent_code: code,
        char_name: nameCol >= 0 ? (row[nameCol] || '') : '',
        character_json: '',
        deleted_at: deletedAtCol >= 0 ? row[deletedAtCol] : ''
      });
    }
  }

  return respond_(result, callback);
}

// ── A-Cell Admin: undo a soft-delete -- moves the row back from
// DeletedCharacters/DeletedBriefs to the live Characters/Briefs
// sheets. Mirror image of deleteCharacter() above. ──
function restoreCharacter(agentCode) {
  if (!agentCode) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'ERROR', message: 'agent_code is required' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  // Locked, same reasoning as deleteCharacter() above -- this moves a
  // row in Characters AND a row in Briefs as two separate operations.
  return withScriptLock(function () {
    const ss = getOrCreateSheet();

    const deletedChars = ss.getSheetByName('DeletedCharacters');
    if (deletedChars) {
      const charSheet = getOrCreateCharactersSheet();
      const charValues = charSheet.getDataRange().getValues();
      const charCodeCol = charValues[0].indexOf('Agent Code');
      const alreadyLive = charCodeCol !== -1 && charValues.some(function (row, i) {
        return i > 0 && row[charCodeCol] === agentCode;
      });
      // A live row already exists for this code (e.g. the Agent resubmitted
      // a fresh Brief after being deleted, or Restore was clicked twice) --
      // skip appending a duplicate. The archived row stays put rather than
      // being silently discarded.
      if (!alreadyLive) {
        const data = deletedChars.getDataRange().getValues();
        const codeCol = data[0].indexOf('Agent Code');
        for (let i = data.length - 1; i >= 1; i--) {
          if (data[i][codeCol] === agentCode) {
            // Drop the trailing "Deleted At" column when moving back.
            charSheet.appendRow(data[i].slice(0, data[0].length - 1));
            deletedChars.deleteRow(i + 1);
            break;
          }
        }
      }
    }

    const deletedBriefs = ss.getSheetByName('DeletedBriefs');
    if (deletedBriefs) {
      const briefsSheet = ss.getSheetByName(SHEET_NAME);
      const briefsValues = briefsSheet.getDataRange().getValues();
      const briefsCodeCol = briefsValues[0].indexOf('Agent Code');
      const alreadyLive = briefsCodeCol !== -1 && briefsValues.some(function (row, i) {
        return i > 0 && row[briefsCodeCol] === agentCode;
      });
      if (!alreadyLive) {
        const data = deletedBriefs.getDataRange().getValues();
        const codeCol = data[0].indexOf('Agent Code');
        for (let j = data.length - 1; j >= 1; j--) {
          if (data[j][codeCol] === agentCode) {
            briefsSheet.appendRow(data[j].slice(0, data[0].length - 1));
            deletedBriefs.deleteRow(j + 1);
            break;
          }
        }
      }
    }

    return ContentService.createTextOutput(JSON.stringify({ status: 'OK', agent_code: agentCode }))
      .setMimeType(ContentService.MimeType.JSON);
  });
}

// ── A-Cell Cells: real named groups -- a Cell has its own name and
// Handler, and a list of member Agents picked from the full roster.
// One Agent can belong to several Cells at once, or none yet.
// Self-provisions its own "Cells" sheet. ──

function getOrCreateCellsSheet() {
  const ss = getOrCreateSheet(); // same spreadsheet file as the Briefs tab
  let sheet = ss.getSheetByName('Cells');
  if (!sheet) {
    sheet = ss.insertSheet('Cells');
    sheet.getRange(1, 1, 1, 6).setValues([['cell_id', 'name', 'handler', 'member_codes', 'created_at', 'channel']]);
  } else {
    // Migration: a Cells sheet created before "Cue For Cell" (Music tab)
    // won't have this column yet -- add it rather than requiring the
    // sheet be recreated. Gated behind a cache flag (same reasoning as
    // getOrCreateCharactersSheet()'s Player Name check just above) --
    // this runs on nearly every A-Cell request.
    const cache = CacheService.getScriptCache();
    if (cache.get('cells_columns_ensured') !== '1') {
      const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      if (headers.indexOf('channel') === -1) {
        sheet.getRange(1, headers.length + 1).setValue('channel');
      }
      cache.put('cells_columns_ensured', '1', 21600);
    }
  }
  return sheet;
}

function listCells(callback) {
  const sheet = getOrCreateCellsSheet();
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('cell_id');
  const nameCol = headers.indexOf('name');
  const handlerCol = headers.indexOf('handler');
  const membersCol = headers.indexOf('member_codes');
  const channelCol = headers.indexOf('channel');

  const cells = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[idCol]) continue;
    let members = [];
    try { members = JSON.parse(row[membersCol] || '[]'); } catch (e) { members = []; }
    cells.push({
      cell_id: row[idCol],
      name: row[nameCol] || '',
      handler: row[handlerCol] || '',
      member_codes: members,
      channel: channelCol >= 0 ? String(row[channelCol] || '') : ''
    });
  }

  return respond_({ status: 'OK', cells: cells }, callback);
}

function createCell(name, handler) {
  name = (name || '').trim();
  if (!name) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'ERROR', message: 'name is required' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  const sheet = getOrCreateCellsSheet();
  const cellId = 'cell_' + new Date().getTime() + '_' + Math.floor(Math.random() * 100000).toString(36);
  // Explicit 6th value for 'channel' -- appendRow() with fewer values
  // than columns silently leaves the trailing cell blank rather than
  // erroring, so a short array here was an easy, invisible mismatch.
  sheet.appendRow([cellId, name, (handler || '').trim(), '[]', new Date().getTime(), '']);
  return ContentService.createTextOutput(JSON.stringify({ status: 'OK', cell_id: cellId })).setMimeType(ContentService.MimeType.JSON);
}

// Overwrites the full member list for a Cell -- the client sends the
// complete new list (after an add or a remove), rather than this
// function doing incremental add/remove itself.
function updateCellMembers(cellId, memberCodes) {
  if (!cellId) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'ERROR', message: 'cell_id is required' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  const sheet = getOrCreateCellsSheet();
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('cell_id');
  const membersCol = headers.indexOf('member_codes');
  for (let i = 1; i < data.length; i++) {
    if (data[i][idCol] === cellId) {
      sheet.getRange(i + 1, membersCol + 1).setValue(JSON.stringify(memberCodes || []));
      return ContentService.createTextOutput(JSON.stringify({ status: 'OK' })).setMimeType(ContentService.MimeType.JSON);
    }
  }
  return ContentService.createTextOutput(JSON.stringify({ status: 'NOT_FOUND' })).setMimeType(ContentService.MimeType.JSON);
}

// Deletes only the Cell grouping -- the member Agents' own rows in the
// Characters/Briefs sheets are untouched, they just fall back to
// Unassigned (or whatever other Cells they're also in).
function deleteCell(cellId) {
  if (!cellId) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'ERROR', message: 'cell_id is required' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  const sheet = getOrCreateCellsSheet();
  const data = sheet.getDataRange().getValues();
  const idCol = data[0].indexOf('cell_id');
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][idCol] === cellId) {
      sheet.deleteRow(i + 1);
      return ContentService.createTextOutput(JSON.stringify({ status: 'OK' })).setMimeType(ContentService.MimeType.JSON);
    }
  }
  return ContentService.createTextOutput(JSON.stringify({ status: 'NOT_FOUND' })).setMimeType(ContentService.MimeType.JSON);
}

// ── Player Notes: shared/private block notes scoped to a Cell. Each
// block (heading/paragraph/bullet) belongs to one Agent and is either
// private (only that Agent sees it) or shared (every member of the
// Cell sees it). Privacy is enforced HERE, server-side, in the object
// literal that gets serialized in listCellNotes() below -- never by
// omitting fields client-side, since that would mean a private
// block's text already left the server. Self-provisions its own
// "CellNotes" sheet. ──
function getOrCreateCellNotesSheet() {
  const ss = getOrCreateSheet();
  let sheet = ss.getSheetByName('CellNotes');
  if (!sheet) {
    sheet = ss.insertSheet('CellNotes');
    sheet.getRange(1, 1, 1, 9).setValues([[
      'block_id', 'cell_id', 'agent_code', 'block_type', 'text',
      'shared', 'sort_order', 'created_at', 'updated_at'
    ]]);
  }
  return sheet;
}

// Every open notes panel polls this every ~5s. Caches the RAW
// (unfiltered) row set per Cell for a few seconds so a burst of
// simultaneous polls from several players' browsers shares one Sheets
// read -- same reasoning as getNowPlaying()'s cache -- then filters on
// every single call, cached or not: the requester's own blocks come
// back in full, every other Agent's blocks are filtered to shared
// blocks only. The raw cache is never itself sent to a browser, so
// caching can never leak a stale filtered view to the wrong requester.
function listCellNotes(cellId, agentCode, callback) {
  cellId = (cellId || '').trim();
  const requester = (agentCode || '').trim().toUpperCase();
  const result = { status: 'OK', notes: {} };
  if (!cellId) {
    return respond_(result, callback);
  }

  const cache = CacheService.getScriptCache();
  const cacheKey = 'cell_notes_raw_' + cellId;
  let rows;
  const cached = cache.get(cacheKey);
  if (cached) {
    rows = JSON.parse(cached);
  } else {
    const sheet = getOrCreateCellNotesSheet();
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const cellCol = headers.indexOf('cell_id');
    const idCol = headers.indexOf('block_id');
    const codeCol = headers.indexOf('agent_code');
    const typeCol = headers.indexOf('block_type');
    const textCol = headers.indexOf('text');
    const sharedCol = headers.indexOf('shared');
    const sortCol = headers.indexOf('sort_order');
    const createdCol = headers.indexOf('created_at');
    const updatedCol = headers.indexOf('updated_at');
    rows = [];
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][cellCol]).trim() !== cellId) continue;
      rows.push({
        block_id: data[i][idCol],
        agent_code: String(data[i][codeCol] || '').trim().toUpperCase(),
        block_type: data[i][typeCol] || 'paragraph',
        text: data[i][textCol] || '',
        shared: asBoolean_(data[i][sharedCol]),
        sort_order: Number(data[i][sortCol]) || 0,
        created_at: (createdCol !== -1 && data[i][createdCol]) || 0,
        updated_at: data[i][updatedCol] || 0
      });
    }
    cache.put(cacheKey, JSON.stringify(rows), 3);
  }

  rows.forEach(function (row) {
    if (row.agent_code !== requester && !row.shared) return; // private, not yours -- never included
    const list = result.notes[row.agent_code] || (result.notes[row.agent_code] = []);
    list.push({
      block_id: row.block_id, agent_code: row.agent_code, block_type: row.block_type, text: row.text,
      shared: row.shared, sort_order: row.sort_order, created_at: row.created_at, updated_at: row.updated_at
    });
  });

  // Bundled into the same response rather than a separate round trip --
  // the panel needs both together to render the combined Shared tab
  // (every visible block, attributed to its author's chosen color/font).
  result.identities = getAgentIdentitiesMap();

  return respond_(result, callback);
}

// Upserts by block_id (blank/unknown -> mints a new one). Wrapped in
// withScriptLock() since several players can be editing different
// blocks in the same Cell within the same few seconds during a live
// session -- the same class of concurrent-write race saveCharacter()
// already guards against.
function saveNoteBlock(data) {
  const cellId = (data.cell_id || '').trim();
  const agentCode = (data.agent_code || '').trim().toUpperCase();
  if (!cellId || !agentCode) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'ERROR', message: 'cell_id and agent_code are required' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  return withScriptLock(function () {
    const sheet = getOrCreateCellNotesSheet();
    const values = sheet.getDataRange().getValues();
    const headers = values[0];
    const cols = headerMap_(headers);
    const missing = requireColumns_(cols, ['block_id', 'cell_id', 'agent_code', 'block_type', 'text', 'shared', 'sort_order', 'created_at', 'updated_at']);
    if (missing) return missing;
    const now = new Date().getTime();
    const blockType = data.block_type || 'paragraph';
    const shared = data.shared ? 1 : 0;
    const sortOrder = Number(data.sort_order) || 0;

    let blockId = (data.block_id || '').trim();
    if (blockId) {
      for (let i = 1; i < values.length; i++) {
        if (values[i][cols.block_id] === blockId) {
          // A valid token only proves who the requester is, not that
          // this block is theirs -- without this check, any Cell member
          // could overwrite anyone else's SHARED block by reusing its
          // block_id (visible to the whole Cell in the combined Shared
          // feed). See the matching check in deleteNoteBlock().
          if (String(values[i][cols.agent_code] || '').trim().toUpperCase() !== agentCode) {
            return ContentService.createTextOutput(JSON.stringify({ status: 'ERROR', message: 'not your block' }))
              .setMimeType(ContentService.MimeType.JSON);
          }
          const row = values[i];
          row[cols.block_type] = blockType;
          row[cols.text] = data.text || '';
          row[cols.shared] = shared;
          row[cols.sort_order] = sortOrder;
          row[cols.updated_at] = now;
          sheet.getRange(i + 1, 1, 1, headers.length).setValues([row]);
          CacheService.getScriptCache().remove('cell_notes_raw_' + cellId);
          return ContentService.createTextOutput(JSON.stringify({ status: 'OK', block_id: blockId })).setMimeType(ContentService.MimeType.JSON);
        }
      }
    }
    // No existing row matched -- this is a brand-new block. If the
    // client already minted an id (notes.js always does, so a poll
    // landing before this write is confirmed echoes back the exact
    // same id the client is already showing, instead of a second,
    // server-minted one the client would never learn about under
    // no-cors), keep it; only mint a fresh one if none was sent.
    if (!blockId) blockId = 'block_' + now + '_' + Math.floor(Math.random() * 100000).toString(36);
    const newRow = new Array(headers.length).fill('');
    newRow[cols.block_id] = blockId;
    newRow[cols.cell_id] = cellId;
    newRow[cols.agent_code] = agentCode;
    newRow[cols.block_type] = blockType;
    newRow[cols.text] = data.text || '';
    newRow[cols.shared] = shared;
    newRow[cols.sort_order] = sortOrder;
    newRow[cols.created_at] = now;
    newRow[cols.updated_at] = now;
    sheet.appendRow(newRow);
    CacheService.getScriptCache().remove('cell_notes_raw_' + cellId);
    return ContentService.createTextOutput(JSON.stringify({ status: 'OK', block_id: blockId })).setMimeType(ContentService.MimeType.JSON);
  });
}

// Now that requireAgentToken_() gates this action, deletion is also
// checked against the block's own agent_code -- a valid token only
// proves who the requester IS, not that the block they named is
// theirs. Without this, any Cell member could delete anyone else's
// SHARED block just by reusing its block_id (visible to the whole Cell
// in the combined Shared feed).
function deleteNoteBlock(data) {
  const blockId = (data.block_id || '').trim();
  const cellId = (data.cell_id || '').trim();
  const agentCode = (data.agent_code || '').trim().toUpperCase();
  if (!blockId || !agentCode) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'ERROR', message: 'block_id and agent_code are required' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  const sheet = getOrCreateCellNotesSheet();
  const values = sheet.getDataRange().getValues();
  const idCol = values[0].indexOf('block_id');
  const codeCol = values[0].indexOf('agent_code');
  for (let i = values.length - 1; i >= 1; i--) {
    if (values[i][idCol] === blockId) {
      if (codeCol !== -1 && String(values[i][codeCol] || '').trim().toUpperCase() !== agentCode) {
        return ContentService.createTextOutput(JSON.stringify({ status: 'ERROR', message: 'not your block' }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      sheet.deleteRow(i + 1);
      if (cellId) CacheService.getScriptCache().remove('cell_notes_raw_' + cellId);
      return ContentService.createTextOutput(JSON.stringify({ status: 'OK' })).setMimeType(ContentService.MimeType.JSON);
    }
  }
  return ContentService.createTextOutput(JSON.stringify({ status: 'NOT_FOUND' })).setMimeType(ContentService.MimeType.JSON);
}

// ── Player Notes identity: each Agent picks a color (and a handwriting
// font) once, the first time they open Notes -- used to attribute their
// contributions in the combined Shared tab, and stored server-side
// (not just localStorage) so it's remembered across devices for that
// Agent Code. Self-provisions its own "AgentIdentity" sheet, upserted
// by agent_code. ──
function getOrCreateAgentIdentitySheet() {
  const ss = getOrCreateSheet();
  let sheet = ss.getSheetByName('AgentIdentity');
  if (!sheet) {
    sheet = ss.insertSheet('AgentIdentity');
    sheet.getRange(1, 1, 1, 4).setValues([['agent_code', 'color', 'font', 'updated_at']]);
  }
  return sheet;
}

function saveAgentIdentity(data) {
  const agentCode = (data.agent_code || '').trim().toUpperCase();
  if (!agentCode) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'ERROR', message: 'agent_code is required' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  const sheet = getOrCreateAgentIdentitySheet();
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const cols = headerMap_(headers);
  const missing = requireColumns_(cols, ['agent_code', 'color', 'font', 'updated_at']);
  if (missing) return missing;
  const now = new Date().getTime();
  // Every list_cell_notes bundles this map in -- keep it in step with
  // any identity change instead of serving a stale color/font for up
  // to the cache's own TTL.
  CacheService.getScriptCache().remove('agent_identities_map');
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][cols.agent_code]).trim().toUpperCase() === agentCode) {
      const row = values[i];
      row[cols.color] = data.color || '';
      row[cols.font] = data.font || '';
      row[cols.updated_at] = now;
      sheet.getRange(i + 1, 1, 1, headers.length).setValues([row]);
      return ContentService.createTextOutput(JSON.stringify({ status: 'OK' })).setMimeType(ContentService.MimeType.JSON);
    }
  }
  const newRow = new Array(headers.length).fill('');
  newRow[cols.agent_code] = agentCode;
  newRow[cols.color] = data.color || '';
  newRow[cols.font] = data.font || '';
  newRow[cols.updated_at] = now;
  sheet.appendRow(newRow);
  return ContentService.createTextOutput(JSON.stringify({ status: 'OK' })).setMimeType(ContentService.MimeType.JSON);
}

// Bundled into every list_cell_notes response (every open Notes panel
// polls ~5s), so despite being small (one row per Agent who's ever
// opened Notes), a full scan on every single poll adds up -- same
// short-TTL cache-then-invalidate-on-write pattern listCellNotes()
// itself already uses for the raw block rows, invalidated in
// saveAgentIdentity() above.
function getAgentIdentitiesMap() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('agent_identities_map');
  if (cached) return JSON.parse(cached);
  const sheet = getOrCreateAgentIdentitySheet();
  const values = sheet.getDataRange().getValues();
  const cols = headerMap_(values[0]);
  const map = {};
  for (let i = 1; i < values.length; i++) {
    const code = String(values[i][cols.agent_code] || '').trim().toUpperCase();
    if (!code) continue;
    map[code] = { color: values[i][cols.color] || '', font: values[i][cols.font] || '' };
  }
  cache.put('agent_identities_map', JSON.stringify(map), 3);
  return map;
}

// ── A-Cell Handouts: a shared clue/document log the Handler files from
// the Handouts tab. Each entry is scoped to one Cell (cell_id set) or
// every Cell (cell_id blank) -- the player-facing Agent Hub reads the
// same list_handouts action and shows each Agent only the ones scoped
// to a Cell they're actually in, plus the campaign-wide ones. A photo
// sent as a raw data URI gets uploaded to Drive and only the gdrive:
// link is stored (see resolveHandoutPhoto_() below) -- same pattern
// already used for Face/Outfit Plates and Track Library uploads, to
// stay well clear of Sheets' ~50,000-char cell limit. Self-provisions
// its own "Handouts" sheet. ──
function getOrCreateHandoutsSheet() {
  const ss = getOrCreateSheet();
  let sheet = ss.getSheetByName('Handouts');
  if (!sheet) {
    sheet = ss.insertSheet('Handouts');
    sheet.getRange(1, 1, 1, 6).setValues([['handout_id', 'title', 'body', 'photo', 'cell_id', 'created_at']]);
  }
  return sheet;
}

// A photo sent as a raw data URI gets uploaded to Drive (via the same
// saveImageToDrive() every other image path in this file already
// uses) and only the gdrive: link is persisted. An already-resolved
// gdrive: link, a pre-migration legacy data URI already on file that
// wasn't touched this save, or an empty string all pass through
// unchanged -- so re-saving a handout without picking a new photo
// doesn't re-upload it.
function resolveHandoutPhoto_(photo, title) {
  photo = photo || '';
  if (!photo || photo.indexOf('data:') !== 0) return photo;
  return saveImageToDrive(photo, (title || 'handout') + '.png', 'Handout');
}

function listHandouts(callback) {
  const sheet = getOrCreateHandoutsSheet();
  const data = sheet.getDataRange().getValues();
  const cols = headerMap_(data[0]);

  const handouts = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[cols.handout_id]) continue;
    handouts.push({
      handout_id: row[cols.handout_id],
      title: (cols.title !== undefined && row[cols.title]) || '',
      body: (cols.body !== undefined && row[cols.body]) || '',
      photo: (cols.photo !== undefined && row[cols.photo]) || '',
      cell_id: (cols.cell_id !== undefined && row[cols.cell_id]) || '',
      created_at: (cols.created_at !== undefined && row[cols.created_at]) || ''
    });
  }
  return respond_({ status: 'OK', handouts: handouts }, callback);
}

function createHandout(data) {
  const title = (data.title || '').trim();
  if (!title) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'ERROR', message: 'title is required' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  const sheet = getOrCreateHandoutsSheet();
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const cols = headerMap_(headers);
  const missing = requireColumns_(cols, ['handout_id', 'title', 'body', 'photo', 'cell_id', 'created_at']);
  if (missing) return missing;
  const handoutId = 'handout_' + new Date().getTime() + '_' + Math.floor(Math.random() * 100000).toString(36);
  const row = new Array(headers.length).fill('');
  row[cols.handout_id] = handoutId;
  row[cols.title] = title;
  row[cols.body] = data.body || '';
  row[cols.photo] = resolveHandoutPhoto_(data.photo, title);
  row[cols.cell_id] = data.cell_id || '';
  row[cols.created_at] = new Date().getTime();
  sheet.appendRow(row);
  return ContentService.createTextOutput(JSON.stringify({ status: 'OK', handout_id: handoutId })).setMimeType(ContentService.MimeType.JSON);
}

function updateHandout(data) {
  if (!data.handout_id) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'ERROR', message: 'handout_id is required' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  const sheet = getOrCreateHandoutsSheet();
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const cols = headerMap_(headers);
  const missing = requireColumns_(cols, ['handout_id', 'title', 'body', 'photo', 'cell_id']);
  if (missing) return missing;
  for (let i = 1; i < values.length; i++) {
    if (values[i][cols.handout_id] === data.handout_id) {
      const row = values[i];
      row[cols.title] = data.title || '';
      row[cols.body] = data.body || '';
      // Only re-resolves through Drive if the client actually sent a
      // fresh raw data URI (a new photo picked this edit) -- an
      // unchanged gdrive: link or empty string passes straight through,
      // see resolveHandoutPhoto_().
      row[cols.photo] = resolveHandoutPhoto_(data.photo, data.title);
      row[cols.cell_id] = data.cell_id || '';
      sheet.getRange(i + 1, 1, 1, headers.length).setValues([row]);
      return ContentService.createTextOutput(JSON.stringify({ status: 'OK' })).setMimeType(ContentService.MimeType.JSON);
    }
  }
  return ContentService.createTextOutput(JSON.stringify({ status: 'NOT_FOUND' })).setMimeType(ContentService.MimeType.JSON);
}

function deleteHandout(handoutId) {
  if (!handoutId) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'ERROR', message: 'handout_id is required' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  const sheet = getOrCreateHandoutsSheet();
  const data = sheet.getDataRange().getValues();
  const idCol = data[0].indexOf('handout_id');
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][idCol] === handoutId) {
      sheet.deleteRow(i + 1);
      return ContentService.createTextOutput(JSON.stringify({ status: 'OK' })).setMimeType(ContentService.MimeType.JSON);
    }
  }
  return ContentService.createTextOutput(JSON.stringify({ status: 'NOT_FOUND' })).setMimeType(ContentService.MimeType.JSON);
}

// ── A-Cell Music: a persistent Track Library of mp3s the Handler
// uploads once and can then cue on any channel with one click, instead
// of pasting a link every time. A raw mp3's base64 easily blows past a
// Sheets cell's ~50,000-character limit (fine for the small reference-
// image data URIs elsewhere in this app, not for audio), so tracks are
// stored in Drive instead and served back as a direct download link --
// the browser streams straight from Drive, rather than being fully
// buffered through one Apps Script response first the way the
// gdrive:-prefixed reference images are (saveImageToDrive() below),
// which would mean no playback could start until the whole file had
// round-tripped through a single JSONP call. Self-provisions its own
// "Tracks" sheet. ──
function getOrCreateTracksSheet() {
  const ss = getOrCreateSheet();
  let sheet = ss.getSheetByName('Tracks');
  if (!sheet) {
    sheet = ss.insertSheet('Tracks');
    sheet.getRange(1, 1, 1, 5).setValues([['track_id', 'title', 'drive_file_id', 'url', 'uploaded_at']]);
  }
  return sheet;
}

// The stable, reliable direct-media link for a public Drive file. Both
// drive.google.com/uc?export=download AND drive.usercontent.google.com/
// download were tried first and both failed in practice (Google serving
// something other than raw bytes for cross-origin hotlinking regardless
// of which legacy URL trick is used -- same class of breakage that
// already forced the imgdata proxy for reference images, just not
// fixable this time by another URL variant). The Drive API v3 media
// endpoint is the actual documented, supported way to serve a public
// file's raw bytes with correct headers and Range support -- it just
// needs an API key. This key is restricted (API restrictions: Google
// Drive API only) in Google Cloud Console, so it's safe to ship in a
// public static site -- it can't be used for anything but reading files
// this app already made public via ANYONE_WITH_LINK sharing.
var DRIVE_API_KEY = 'AIzaSyC36Z6iunko5YB-MPBBMpIOvDr7nUOYKAE';
function driveDirectAudioUrl(fileId) {
  return 'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media&key=' + DRIVE_API_KEY;
}

function listTracks(callback) {
  const sheet = getOrCreateTracksSheet();
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('track_id');
  const titleCol = headers.indexOf('title');
  const fileIdCol = headers.indexOf('drive_file_id');
  const urlCol = headers.indexOf('url');
  const uploadedCol = headers.indexOf('uploaded_at');

  const tracks = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[idCol]) continue;
    // Rebuilt from drive_file_id on every read, not read from the stored
    // url column -- so a track uploaded before driveDirectAudioUrl()'s
    // URL format changed self-heals the next time the library loads,
    // with no separate migration step needed.
    const fileId = fileIdCol !== -1 ? row[fileIdCol] : '';
    tracks.push({
      track_id: row[idCol],
      title: row[titleCol] || '',
      url: fileId ? driveDirectAudioUrl(fileId) : (row[urlCol] || ''),
      uploaded_at: row[uploadedCol] || ''
    });
  }
  return respond_({ status: 'OK', tracks: tracks }, callback);
}

// data.mp3_base64 may be a bare base64 string or a full data: URL --
// accepts either so the frontend doesn't need to strip the prefix
// itself.
function uploadTrack(data) {
  const title = (data.title || '').trim();
  if (!title) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'ERROR', message: 'title is required' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  if (!data.mp3_base64) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'ERROR', message: 'mp3_base64 is required' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  try {
    const base64 = data.mp3_base64.indexOf(',') !== -1 ? data.mp3_base64.split(',')[1] : data.mp3_base64;
    const blob = Utilities.newBlob(Utilities.base64Decode(base64), 'audio/mpeg', title + '.mp3');

    let folder;
    const folders = DriveApp.getFoldersByName('Delta Green — Table Radio Tracks');
    folder = folders.hasNext() ? folders.next() : DriveApp.createFolder('Delta Green — Table Radio Tracks');

    const file = folder.createFile(blob);
    file.setName(title);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    const url = driveDirectAudioUrl(file.getId());
    const trackId = 'track_' + new Date().getTime() + '_' + Math.floor(Math.random() * 100000).toString(36);
    const sheet = getOrCreateTracksSheet();
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const cols = headerMap_(headers);
    const missing = requireColumns_(cols, ['track_id', 'title', 'drive_file_id', 'url', 'uploaded_at']);
    if (missing) return missing;
    const row = new Array(headers.length).fill('');
    row[cols.track_id] = trackId;
    row[cols.title] = title;
    row[cols.drive_file_id] = file.getId();
    row[cols.url] = url;
    row[cols.uploaded_at] = new Date().getTime();
    sheet.appendRow(row);

    return ContentService.createTextOutput(JSON.stringify({ status: 'OK', track_id: trackId, url: url }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'ERROR', message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function deleteTrack(trackId) {
  if (!trackId) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'ERROR', message: 'track_id is required' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  const sheet = getOrCreateTracksSheet();
  const data = sheet.getDataRange().getValues();
  const cols = headerMap_(data[0]);
  const missing = requireColumns_(cols, ['track_id', 'drive_file_id']);
  if (missing) return missing;
  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][cols.track_id] === trackId) {
      const fileId = data[i][cols.drive_file_id];
      if (fileId) {
        try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) { /* already gone */ }
      }
      sheet.deleteRow(i + 1);
      return ContentService.createTextOutput(JSON.stringify({ status: 'OK' })).setMimeType(ContentService.MimeType.JSON);
    }
  }
  return ContentService.createTextOutput(JSON.stringify({ status: 'NOT_FOUND' })).setMimeType(ContentService.MimeType.JSON);
}

// ── Agent Hub: a player's private notes on a Handout, synced so they
// survive clearing browser data and follow the Agent across devices --
// scoped to (handout_id, agent_code), so two Agents each see only their
// own annotations on the same shared Handout, and the Handler never
// sees them at all (nothing in A-Cell reads this sheet). Self-
// provisions its own "HandoutNotes" sheet. ──
function getOrCreateHandoutNotesSheet() {
  const ss = getOrCreateSheet();
  let sheet = ss.getSheetByName('HandoutNotes');
  if (!sheet) {
    sheet = ss.insertSheet('HandoutNotes');
    sheet.getRange(1, 1, 1, 4).setValues([['handout_id', 'agent_code', 'note', 'updated_at']]);
  }
  return sheet;
}

// Returns every note a given Agent has written, across all Handouts, in
// one call -- the Agent Hub renders one Handouts section per Agent tab,
// so this is fetched once per Agent rather than once per Handout shown.
function listHandoutNotes(agentCode, callback) {
  const sheet = getOrCreateHandoutNotesSheet();
  const data = sheet.getDataRange().getValues();
  const cols = headerMap_(data[0]);

  const notes = [];
  const code = (agentCode || '').trim().toUpperCase();
  if (code && cols.agent_code !== undefined) {
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][cols.agent_code]).trim().toUpperCase() === code && data[i][cols.note]) {
        notes.push({ handout_id: data[i][cols.handout_id], note: data[i][cols.note] });
      }
    }
  }
  return respond_({ status: 'OK', notes: notes }, callback);
}

// Upserts by (handout_id, agent_code). An empty note is a valid save
// (clearing a note the Agent had written before), not an error.
function saveHandoutNote(data) {
  const handoutId = data.handout_id;
  const agentCode = (data.agent_code || '').trim().toUpperCase();
  if (!handoutId || !agentCode) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'ERROR', message: 'handout_id and agent_code are required' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  const sheet = getOrCreateHandoutNotesSheet();
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const cols = headerMap_(headers);
  const missing = requireColumns_(cols, ['handout_id', 'agent_code', 'note', 'updated_at']);
  if (missing) return missing;
  const now = new Date().getTime();

  for (let i = 1; i < values.length; i++) {
    if (values[i][cols.handout_id] === handoutId && String(values[i][cols.agent_code]).trim().toUpperCase() === agentCode) {
      const row = values[i];
      row[cols.note] = data.note || '';
      row[cols.updated_at] = now;
      sheet.getRange(i + 1, 1, 1, headers.length).setValues([row]);
      return ContentService.createTextOutput(JSON.stringify({ status: 'OK' })).setMimeType(ContentService.MimeType.JSON);
    }
  }
  const newRow = new Array(headers.length).fill('');
  newRow[cols.handout_id] = handoutId;
  newRow[cols.agent_code] = agentCode;
  newRow[cols.note] = data.note || '';
  newRow[cols.updated_at] = now;
  sheet.appendRow(newRow);
  return ContentService.createTextOutput(JSON.stringify({ status: 'OK' })).setMimeType(ContentService.MimeType.JSON);
}

// A Cell's usual Table Radio channel -- lets the Music tab's "Cue For
// Cell" tune straight to a Cell's number instead of the Handler
// remembering it. Independent of member_codes; set separately.
function setCellChannel(cellId, channel) {
  if (!cellId) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'ERROR', message: 'cell_id is required' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  const sheet = getOrCreateCellsSheet();
  const data = sheet.getDataRange().getValues();
  const cols = headerMap_(data[0]);
  const missing = requireColumns_(cols, ['cell_id', 'channel']);
  if (missing) return missing;
  for (let i = 1; i < data.length; i++) {
    if (data[i][cols.cell_id] === cellId) {
      sheet.getRange(i + 1, cols.channel + 1).setValue(channel || '');
      return ContentService.createTextOutput(JSON.stringify({ status: 'OK' })).setMimeType(ContentService.MimeType.JSON);
    }
  }
  return ContentService.createTextOutput(JSON.stringify({ status: 'NOT_FOUND' })).setMimeType(ContentService.MimeType.JSON);
}

// ── Table Radio: A-Cell's Music tab broadcasts a "now playing" track
// (and a saved playlist) per channel; any player tuned to that channel
// (assets/table-radio.js on every Hub page) polls and roughly syncs to
// it. A "channel" is one of five fixed numbers (1-5), picked from a
// dial on both sides rather than typed -- no login system, so whoever
// dials in a channel can read or set it, same trust model as an
// Agent Code. Self-provisions its own "RadioChannels" sheet. ──

function getOrCreateRadioSheet() {
  const ss = getOrCreateSheet(); // same spreadsheet file as the Briefs tab
  let sheet = ss.getSheetByName('RadioChannels');
  if (!sheet) {
    sheet = ss.insertSheet('RadioChannels');
    sheet.getRange(1, 1, 1, 5).setValues([['channel', 'track_url', 'track_title', 'started_at', 'updated_at']]);
  }
  // This function is called by getNowPlaying(), which every open tab on
  // every page polls every 2 seconds -- re-verifying 4 migration columns
  // with a fresh read each (5 reads total per poll, before this fix) on
  // every single one of those ticks was a large, entirely avoidable chunk
  // of the load a live session with several players puts on this
  // backend. A cache flag skips the checks entirely once confirmed
  // clean, same reasoning as the SPREADSHEET_ID/Briefs-columns caches
  // above.
  const cache = CacheService.getScriptCache();
  if (cache.get('radio_columns_ensured') !== '1') {
    let lastCol = sheet.getLastColumn();
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    // track_kind: added for the Track Library (uploaded mp3s) -- Drive
    // download links don't end in .mp3 like a pasted URL would, so the
    // player needs an explicit "this is direct audio" flag instead of
    // sniffing the URL's file extension.
    // paused/paused_at/loop: let the Handler pause, resume, and loop a
    // broadcast in place -- set_now_playing always restarts a track from
    // 0:00, which isn't the right tool for either of those.
    ['track_kind', 'paused', 'paused_at', 'loop'].forEach(function (col) {
      if (headers.indexOf(col) === -1) {
        lastCol++;
        sheet.getRange(1, lastCol).setValue(col);
        headers.push(col);
      }
    });
    cache.put('radio_columns_ensured', '1', 21600);
  }
  return sheet;
}

// Reads the current track for a channel. Server-stamped started_at
// means every player computes elapsed time against the same clock,
// regardless of the Handler's or their own device's clock skew.
function getNowPlaying(channel, callback) {
  let result = { status: 'NOT_FOUND' };
  channel = (channel || '').trim();
  if (channel) {
    // Every open tab on every page polls this every 2 seconds -- caching
    // the response per channel for a couple of seconds means a burst of
    // simultaneous polls from several players' browsers (the exact
    // situation during a live session) shares one Sheets read instead of
    // each triggering its own, without ever serving anything staler than
    // the poll interval itself already tolerates.
    const cache = CacheService.getScriptCache();
    const cacheKey = 'now_playing_' + channel.toLowerCase();
    const cached = cache.get(cacheKey);
    if (cached) {
      return respond_(JSON.parse(cached), callback);
    }

    const sheet = getOrCreateRadioSheet();
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const chCol = headers.indexOf('channel');
    const urlCol = headers.indexOf('track_url');
    const titleCol = headers.indexOf('track_title');
    const startedCol = headers.indexOf('started_at');
    const kindCol = headers.indexOf('track_kind');
    const pausedCol = headers.indexOf('paused');
    const pausedAtCol = headers.indexOf('paused_at');
    const loopCol = headers.indexOf('loop');
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][chCol]).trim().toLowerCase() === channel.toLowerCase()) {
        const trackUrl = data[i][urlCol] || '';
        if (trackUrl) {
          result = {
            status: 'OK',
            channel: data[i][chCol],
            track_url: trackUrl,
            track_title: data[i][titleCol] || '',
            started_at: data[i][startedCol] || 0,
            track_kind: (kindCol !== -1 && data[i][kindCol]) || '',
            paused: pausedCol !== -1 && asBoolean_(data[i][pausedCol]),
            paused_at: (pausedAtCol !== -1 && data[i][pausedAtCol]) || 0,
            loop: loopCol !== -1 && asBoolean_(data[i][loopCol])
          };
        }
        break;
      }
    }
    cache.put(cacheKey, JSON.stringify(result), 2);
  }
  return respond_(result, callback);
}

// Sets (or clears, if track_url is empty) the current track for a
// channel. Upserts by channel, case-insensitive (the dial only ever
// sends "1".."5", but this doesn't hardcode that). trackKind is '' for
// a pasted URL (the player sniffs YouTube/SoundCloud/direct-audio from
// the URL itself, same as always) or 'audio' for a Track Library pick,
// whose Drive download link has no .mp3 extension for that sniffing to
// catch.
function setNowPlaying(channel, trackUrl, trackTitle, trackKind, loop) {
  channel = (channel || '').trim();
  if (!channel) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'ERROR', message: 'channel is required' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  // Invalidate getNowPlaying()'s short-lived read cache for this channel
  // so listeners get the new track on their very next poll instead of
  // possibly waiting out the rest of that cache window.
  CacheService.getScriptCache().remove('now_playing_' + channel.toLowerCase());

  const sheet = getOrCreateRadioSheet();
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const cols = headerMap_(headers);
  const chCol = cols.channel;
  const urlCol = cols.track_url;
  const titleCol = cols.track_title;
  const startedCol = cols.started_at;
  const updatedCol = cols.updated_at;
  const kindCol = cols.track_kind;
  const pausedCol = cols.paused;
  const pausedAtCol = cols.paused_at;
  const loopCol = cols.loop;
  const now = new Date().getTime();
  const loopVal = loop === '1' || loop === true ? 1 : 0;

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][chCol]).trim().toLowerCase() === channel.toLowerCase()) {
      // Mutate the row already fetched above and write it back in one
      // call instead of up to 8 separate setValue() calls.
      const row = data[i];
      row[urlCol] = trackUrl || '';
      row[titleCol] = trackTitle || '';
      row[startedCol] = now;
      row[updatedCol] = now;
      if (kindCol !== undefined) row[kindCol] = trackKind || '';
      // A fresh set_now_playing always restarts the track for everyone --
      // any Pause left over from the previous track shouldn't carry
      // forward onto this new one.
      if (pausedCol !== undefined) row[pausedCol] = 0;
      if (pausedAtCol !== undefined) row[pausedAtCol] = '';
      if (loopCol !== undefined) row[loopCol] = loopVal;
      sheet.getRange(i + 1, 1, 1, headers.length).setValues([row]);
      return ContentService.createTextOutput(JSON.stringify({ status: 'OK' })).setMimeType(ContentService.MimeType.JSON);
    }
  }
  // Built by header position, not array-literal order -- a sheet that
  // already picked up the playlist_json migration column before this
  // track_kind one would otherwise leave a gap between them.
  const newRow = new Array(headers.length).fill('');
  newRow[chCol] = channel;
  newRow[urlCol] = trackUrl || '';
  newRow[titleCol] = trackTitle || '';
  newRow[startedCol] = now;
  newRow[updatedCol] = now;
  if (kindCol !== undefined) newRow[kindCol] = trackKind || '';
  if (pausedCol !== undefined) newRow[pausedCol] = 0;
  if (loopCol !== undefined) newRow[loopCol] = loopVal;
  sheet.appendRow(newRow);
  return ContentService.createTextOutput(JSON.stringify({ status: 'OK' })).setMimeType(ContentService.MimeType.JSON);
}

// Pause/resume the CURRENT track in place for a channel, without
// restarting it (set_now_playing always resets started_at to now, which
// would jump the track back to 0:00). Resuming shifts started_at forward
// by however long the pause lasted, so every listener's elapsed-time
// calculation (now - started_at) keeps landing on the same spot the track
// was paused at, rather than skipping ahead by the pause duration.
function pauseNowPlaying(channel) {
  channel = (channel || '').trim();
  if (!channel) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'ERROR', message: 'channel is required' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  CacheService.getScriptCache().remove('now_playing_' + channel.toLowerCase());

  const sheet = getOrCreateRadioSheet();
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const cols = headerMap_(headers);
  const chCol = cols.channel;
  const pausedCol = cols.paused;
  const pausedAtCol = cols.paused_at;
  const updatedCol = cols.updated_at;
  const now = new Date().getTime();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][chCol]).trim().toLowerCase() === channel.toLowerCase()) {
      const row = data[i];
      if (pausedCol !== undefined) row[pausedCol] = 1;
      if (pausedAtCol !== undefined) row[pausedAtCol] = now;
      if (updatedCol !== undefined) row[updatedCol] = now;
      sheet.getRange(i + 1, 1, 1, headers.length).setValues([row]);
      return ContentService.createTextOutput(JSON.stringify({ status: 'OK' })).setMimeType(ContentService.MimeType.JSON);
    }
  }
  return ContentService.createTextOutput(JSON.stringify({ status: 'ERROR', message: 'no track for that channel' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function resumeNowPlaying(channel) {
  channel = (channel || '').trim();
  if (!channel) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'ERROR', message: 'channel is required' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  CacheService.getScriptCache().remove('now_playing_' + channel.toLowerCase());

  const sheet = getOrCreateRadioSheet();
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const cols = headerMap_(headers);
  const chCol = cols.channel;
  const startedCol = cols.started_at;
  const pausedCol = cols.paused;
  const pausedAtCol = cols.paused_at;
  const updatedCol = cols.updated_at;
  const now = new Date().getTime();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][chCol]).trim().toLowerCase() === channel.toLowerCase()) {
      const pausedAt = (pausedAtCol !== undefined && data[i][pausedAtCol]) || now;
      const startedAt = (startedCol !== undefined && data[i][startedCol]) || now;
      const shiftedStart = startedAt + (now - pausedAt);
      const row = data[i];
      if (startedCol !== undefined) row[startedCol] = shiftedStart;
      if (pausedCol !== undefined) row[pausedCol] = 0;
      if (pausedAtCol !== undefined) row[pausedAtCol] = '';
      if (updatedCol !== undefined) row[updatedCol] = now;
      sheet.getRange(i + 1, 1, 1, headers.length).setValues([row]);
      return ContentService.createTextOutput(JSON.stringify({ status: 'OK' })).setMimeType(ContentService.MimeType.JSON);
    }
  }
  return ContentService.createTextOutput(JSON.stringify({ status: 'ERROR', message: 'no track for that channel' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// One-time migration -- run this once by hand from the Apps Script
// editor (pick "addPlaylistColumn" from the function dropdown at the
// top, click Run). Adds a playlist_json column to the RadioChannels
// sheet if it's not already there.
function addPlaylistColumn() {
  const sheet = getOrCreateRadioSheet();
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (headers.indexOf('playlist_json') === -1) {
    sheet.getRange(1, sheet.getLastColumn() + 1).setValue('playlist_json');
  }
}

// Reads the saved playlist (an array of {url, title}) for a channel.
// Empty array if the channel has no saved tracks yet.
function getPlaylist(channel, callback) {
  const result = { status: 'OK', playlist: [] };
  channel = (channel || '').trim();
  if (channel) {
    // Same short-TTL cache pattern as getNowPlaying()'s own -- every
    // Music tab/channel load hit a full RadioChannels scan with no
    // caching at all before this, unlike its sibling.
    const cache = CacheService.getScriptCache();
    const cacheKey = 'playlist_' + channel.toLowerCase();
    const cached = cache.get(cacheKey);
    if (cached) {
      result.playlist = JSON.parse(cached);
      return respond_(result, callback);
    }
    const sheet = getOrCreateRadioSheet();
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const chCol = headers.indexOf('channel');
    const plCol = headers.indexOf('playlist_json');
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][chCol]).trim().toLowerCase() === channel.toLowerCase()) {
        if (plCol >= 0 && data[i][plCol]) {
          try { result.playlist = JSON.parse(data[i][plCol]); } catch (e) { result.playlist = []; }
        }
        break;
      }
    }
    cache.put(cacheKey, JSON.stringify(result.playlist), 3);
  }
  return respond_(result, callback);
}

// Overwrites the saved playlist for a channel with the given JSON
// array. Creates a row for the channel (with no current track yet) if
// one doesn't already exist.
function savePlaylist(channel, playlistJson) {
  channel = (channel || '').trim();
  if (!channel) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'ERROR', message: 'channel is required' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  CacheService.getScriptCache().remove('playlist_' + channel.toLowerCase());
  const sheet = getOrCreateRadioSheet();
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const chCol = headers.indexOf('channel');
  const plCol = headers.indexOf('playlist_json');
  if (plCol === -1) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'ERROR', message: 'playlist_json column missing -- run addPlaylistColumn() first' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][chCol]).trim().toLowerCase() === channel.toLowerCase()) {
      sheet.getRange(i + 1, plCol + 1).setValue(playlistJson || '[]');
      return ContentService.createTextOutput(JSON.stringify({ status: 'OK' })).setMimeType(ContentService.MimeType.JSON);
    }
  }
  const row = new Array(headers.length).fill('');
  row[chCol] = channel;
  row[plCol] = playlistJson || '[]';
  const updatedCol = headers.indexOf('updated_at');
  if (updatedCol >= 0) row[updatedCol] = new Date().getTime();
  sheet.appendRow(row);
  return ContentService.createTextOutput(JSON.stringify({ status: 'OK' })).setMimeType(ContentService.MimeType.JSON);
}

function getOrCreateSheet() {
  if (SPREADSHEET_ID) {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    ensureBriefsColumns(ss);
    return ss;
  }

  // SPREADSHEET_ID isn't set, so without this cache EVERY single request
  // -- every 2-second radio poll from every open tab, every A-Cell load,
  // every save -- pays for a Drive-wide filename search just to find the
  // spreadsheet, before it can read or write anything. That's the single
  // most expensive thing this backend does, and it compounds badly the
  // moment several people are using the site at once (confirmed: this is
  // very likely what made A-Cell unusable during a live session with 5+
  // players). Caching the resolved ID means only the first request in a
  // cache window pays for the search; everything after opens directly.
  // This is a stopgap, not a substitute for actually setting
  // SPREADSHEET_ID above (paste it in from the Sheet's URL) -- that
  // removes this search entirely instead of just caching around it.
  const cache = CacheService.getScriptCache();
  const cachedId = cache.get('resolved_spreadsheet_id');
  if (cachedId) {
    try {
      const ss = SpreadsheetApp.openById(cachedId);
      ensureBriefsColumns(ss);
      return ss;
    } catch (e) {
      // Cached ID no longer valid (sheet moved/deleted/renamed) -- fall
      // through to the real search below instead of failing outright.
    }
  }

  const files = DriveApp.getFilesByName(SHEET_NAME);
  if (files.hasNext()) {
    const file = files.next();
    cache.put('resolved_spreadsheet_id', file.getId(), 21600);
    const ss = SpreadsheetApp.open(file);
    ensureBriefsColumns(ss);
    return ss;
  }

  const ss = SpreadsheetApp.create(SHEET_NAME);
  cache.put('resolved_spreadsheet_id', ss.getId(), 21600);
  const sheet = ss.getActiveSheet();
  sheet.setName(SHEET_NAME);

  const headers = COLUMNS.map(c =>
    c.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
  );
  sheet.appendRow(headers);

  const headerRange = sheet.getRange(1, 1, 1, COLUMNS.length);
  headerRange.setBackground('#1a1a18');
  headerRange.setFontColor('#e8e2d4');
  headerRange.setFontWeight('bold');
  headerRange.setFontSize(10);
  sheet.setFrozenRows(1);

  return ss;
}

// Delta Green Briefs header migrations -- self-healing, same pattern as
// getOrCreateCellsSheet()'s 'channel' column and getOrCreateRadioSheet()'s
// track_kind/paused/paused_at/loop columns above: adds any column below
// that's missing from a live sheet created before that column existed,
// so an existing deployment doesn't need a manual one-time migration
// run. Each is appended at the END of the header row (never inserted
// among the existing columns) -- this must match where each column sits
// in COLUMNS above (also always the end), since the new-agent-submission
// row builder in doPost (COLUMNS.map(...)) writes positionally.
function ensureBriefsColumns(ss) {
  // This used to re-verify both columns with a fresh read on every single
  // call -- and getOrCreateSheet() calls this on nearly every request --
  // even though the migration only ever needs to actually run once. A
  // cache flag skips the check entirely once it's confirmed clean, same
  // reasoning as the SPREADSHEET_ID cache right above.
  const cache = CacheService.getScriptCache();
  if (cache.get('briefs_columns_ensured') === '1') return;
  const sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) return; // brand-new spreadsheet -- getOrCreateSheet()'s creation path below already includes every column via COLUMNS
  let lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  ['Player Name', 'Profession'].forEach(function (name) {
    if (headers.indexOf(name) === -1) {
      lastCol++;
      sheet.getRange(1, lastCol).setValue(name);
      headers.push(name);
    }
  });
  cache.put('briefs_columns_ensured', '1', 21600);
}

function saveImageToDrive(base64DataUrl, filename, charName) {
  try {
    const base64 = base64DataUrl.split(',')[1];
    const mimeType = base64DataUrl.split(';')[0].split(':')[1];

    const blob = Utilities.newBlob(
      Utilities.base64Decode(base64),
      mimeType,
      filename
    );

    let folder;
    const folders = DriveApp.getFoldersByName('Delta Green — Character References');
    if (folders.hasNext()) {
      folder = folders.next();
    } else {
      folder = DriveApp.createFolder('Delta Green — Character References');
    }

    const file = folder.createFile(blob);
    file.setName((charName || 'unknown') + ' — ' + filename);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    // Store the file ID so the portal can use the image proxy endpoint
    // Format: gdrive:FILE_ID  — portal detects this prefix and calls ?action=imgdata&id=
    return 'gdrive:' + file.getId();
  } catch (err) {
    return 'Image upload failed: ' + err.message;
  }
}

function savePlateImage(data) {
  try {
    const url = saveImageToDrive(data.image_base64, data.image_name, data.char_name);
    return updateAgentField({
      action: 'update_field',
      agent_code: data.agent_code,
      field: data.field,
      value: url
    });
  } catch(err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ERROR', message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ── Agent File: AI-drafted appearance prompts (Face Plate / Outfit Plate /
// surveillance / post-injury). Server-side only -- reads the key from
// Script Properties so it's never exposed to the browser (same pattern as
// every other secret in this file, e.g. DRIVE_API_KEY above, which is
// restricted rather than secret for a different reason -- see its own
// comment). Set ANTHROPIC_API_KEY under Project Settings > Script
// Properties in the Apps Script editor; never hardcode a real key here. ──
function generateAppearancePrompt(data) {
  try {
    const apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
    if (!apiKey) {
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'ERROR', message: 'ANTHROPIC_API_KEY not set in Script Properties.' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const char = data.character || {};
    const injuries = data.injuries || [];
    const era = data.era || '';
    const eraLabels = {'90s':'1990s Cold War Aftermath','00s':'2000s War on Terror','10s':'2010s Digital Age','20s':'2020s Present Day'};
    const eraLabel = eraLabels[era] || '';
    const eraOutfitContext = {
      '90s': 'Era is the 1990s. Clothing should reflect early-to-mid 1990s fashion — heavier fabrics, baggier cuts, muted earth tones and neutrals, practical field-ready styling of the Cold War aftermath period.',
      '00s': 'Era is the 2000s. Clothing should reflect early-to-mid 2000s fashion — slightly slimmer cuts than the 90s, tactical-influenced civilian wear, post-9/11 federal agency aesthetic.',
      '10s': 'Era is the 2010s. Clothing should reflect 2010s fashion — fitted contemporary cuts, smart-casual federal professional register, modern tactical civilian crossover.',
      '20s': 'Era is the 2020s. Clothing should reflect current contemporary fashion — clean modern cuts, technical fabrics, present-day federal professional or civilian register.'
    };
    const eraNote = eraOutfitContext[era] || '';

    const isBase = data.mode === 'base' || injuries.length === 0;
    const isOutfit = data.mode === 'outfit';
    const isSurveillance = data.mode === 'surveillance';

    const baseDesc = [
      char.age_range, char.sex, char.nationality,
      'Build: ' + char.build,
      'Face: ' + [char.face_shape, char.eye_color + ' ' + char.eye_shape + ' eyes', char.nose, char.lips, char.skin].filter(Boolean).join(', '),
      'Hair: ' + [char.hair_color, char.hair_style, char.hair_texture].filter(Boolean).join(', '),
      char.facial_hair,
      char.face_scars ? 'Scars: ' + char.face_scars : '',
      char.body_markers ? 'Body markers: ' + char.body_markers : '',
      char.posture ? 'Posture: ' + char.posture : ''
    ].filter(Boolean).join('. ');

    const outfitDesc = isBase ? [char.jacket, char.shirt, char.trousers, char.footwear, char.accessories, char.jewelry].filter(Boolean).join(', ') : '';

    const injuryDesc = injuries.map(function(inj, i) {
      return (i + 1) + '. ' + inj.body_part + ' — ' + inj.injury + (inj.appearance ? '. Appearance impact: ' + inj.appearance : '');
    }).join('\n');

    let userPrompt;
    if (isBase) {
      // Mode 0 — Face lock. Canonical structure from Banana Pro Director 2.0 skill.
      userPrompt = 'You are a Higgsfield / Banana Pro image prompt writer. '
        + 'Write a Mode 0 FACE LOCK prompt using the canonical Banana Pro Director structure. '
        + 'This is a 3:4 HEADSHOT from forehead to upper chest only. Face fills most of the frame. '
        + 'The character wears a plain black ' + (char.sex === 'Female' ? 'thin-strap camisole' : 'ribbed tank') + ', no jewelry, no logos. '
        + 'Background is mid-gray seamless studio. Soft soft lighting from camera-left. '
        + 'No outfit styling. Identity only.\n\n'
        + 'CHARACTER SPEC:\n' + baseDesc + '\n'
        + (char.facial_hair ? 'Facial hair: ' + char.facial_hair + '\n' : '')
        + (char.face_scars ? 'Identity markers: ' + char.face_scars + '\n' : '')
        + (char.expression ? 'Expression: ' + char.expression + '\n' : '')
        + (eraNote ? '\nERA CONTEXT: ' + eraNote + '\n' : '')
        + '\nWrite the prompt using this EXACT structure — two paragraphs, no preamble, no labels:\n\n'
        + 'PARAGRAPH 1: Open with "A clean cinema-character-reference 3:4 headshot, framed from forehead to upper chest with the face filling most of the frame." '
        + 'Then: full identity description — heritage/nationality, build, skin tone and finish, hair (color, length, texture), face register (jaw, cheekbones, brow, eye shape and color, nose, lips), all identity markers. '
        + 'Then: wardrobe baseline ("She wears a plain black thin-strap camisole" or "He wears a plain black ribbed tank, no jewelry, no logos, no graphics"). '
        + 'Then: "Body squared to camera, head level, neutral relaxed expression, eyes to camera, lips closed and relaxed, subtle controlled energy."\n\n'
        + 'PARAGRAPH 2: Open with "Mid-gray seamless studio background — even neutral mid-gray, no seam line, no gradient, no falloff to black or white." '
        + 'Then lighting: "Relight from scratch overriding any reference lighting: one broad diffused source from camera-left and slightly above, a soft triangle of light on the shadow cheek, gentle wrap onto the face, no hard shadow edges, no rim light, no hair light, no kicker." '
        + 'Then skin: "Skin reads matte and velvety — zero shine on forehead, nose bridge, cheekbones, temples, and chin, no oily T-zone — in a low-contrast milky look. Real peach fuzz at the jaw and hairline, real soft fine even pore texture, subsurface scattering reading as semi-translucent biology, never plastic, never waxy AI render, never glass-skin, never harsh — fine flattering texture that keeps the face looking good, no acne, no blemishes, no rough pores." '
        + 'Close with: "Photographed on a 50mm prime at a wide aperture, natural round bokeh, even sharpness, soft natural film grain. Photographed not generated."';

    } else if (isOutfit) {
      // Mode 1A — Single-image character outfit, Banana Pro path. Canonical structure from Banana Pro Director 2.0 skill.
      userPrompt = 'You are a Higgsfield / Banana Pro image prompt writer. '
        + 'Write a Mode 1A FULL-BODY OUTFIT REFERENCE prompt using the canonical Banana Pro Director structure. '
        + 'THIS IS A FULL-BODY SHOT — the ENTIRE figure must be visible from crown of head to soles of feet. '
        + 'DO NOT write a headshot. DO NOT crop at waist or chest. Feet and shoes must be visible. '
        + 'The character is in a model stance (weight on one hip, body angled 15-30 degrees from camera, eyes to camera). '
        + 'Background is mid-gray seamless studio. Soft soft lighting from camera-left.\n\n'
        + 'CHARACTER:\n' + baseDesc + '\n\n'
        + 'OUTFIT (document every item precisely — this is a wardrobe reference):\n'
        + [char.jacket, char.shirt, char.trousers, char.footwear, char.accessories, char.jewelry].filter(Boolean).join('\n') + '\n\n'
        + (eraNote ? 'ERA CONTEXT: ' + eraNote + '\n\n' : '')
        + (char.expression ? 'Expression/stance: ' + char.expression + '\n\n' : '')
        + 'Write the prompt using this EXACT structure — two paragraphs, no preamble, no labels:\n\n'
        + 'PARAGRAPH 1: Full visual description of the character — hair, face briefly, then COMPLETE OUTFIT head-to-toe in order: '
        + 'jacket/outerwear, shirt/top, trousers/skirt, footwear, accessories, jewelry. '
        + 'Then pose: "Standing in a cocked-hip model stance, body angled [15-30] degrees from camera, weight shifted onto one hip, chin slightly tucked, eyes to camera, [expression]." '
        + 'NEVER mention headshot, portrait, chest-up, or upper body framing in this paragraph.\n\n'
        + 'PARAGRAPH 2: Open with "Mid-gray seamless studio background — even neutral mid-gray, no seam line, no gradient, no falloff to black or white." '
        + 'Lighting: "Relight from scratch overriding any reference lighting: one broad diffused source from camera-left and slightly above, gentle wrap onto the figure, no harsh shadows, no rim light, no hair light, no kicker, only the gentlest lifted shadow on the off-light side." '
        + 'Skin/fabric: "Skin and fabric read matte and velvety in a low-contrast milky look, no shine. Real fine even pore texture, subsurface scattering, real fabric weave and drape, never plastic, never waxy, never harsh." '
        + 'Close with: "Photographed on a 50mm prime at a wide aperture, natural round bokeh, even sharpness, soft natural film grain. Full body visible head to sole. Photographed not generated."';
    } else if (isSurveillance) {
      const scene = data.scene || '';
      const operation = data.operation || '';
      const location = data.location || '';
      const charCtx = data.char_context || '';
      userPrompt = 'You are a Banana Pro / Higgsfield AI cinematic prompt writer specialising in photorealistic surveillance and field photography.\n\n'
        + 'Write a cinematic surveillance photo prompt based on this after-action report scene.\n\n'
        + (operation ? 'OPERATION: ' + operation + '\n' : '')
        + (location ? 'LOCATION: ' + location + '\n' : '')
        + (charCtx ? 'AGENT: ' + charCtx + '\n' : '')
        + '\nSCENE DESCRIPTION:\n' + scene + '\n\n'
        + 'Write only the image prompt. 2-3 paragraphs. '
        + 'Focus on: environment and setting, lighting conditions (time of day, artificial/natural), camera angle and distance, atmospheric mood, grain and film aesthetic. '
        + 'If the agent is in the scene describe their positioning and body language. '
        + 'This should read like a surveillance photo or field documentation still — gritty, real, not staged.';
    } else {
      userPrompt = 'You are a Banana Pro / Higgsfield AI cinematic prompt writer specialising in photorealistic character references.\n\n'
        + 'Write a Mode 3 full-body appearance prompt for this Delta Green agent as they look RIGHT NOW, after their injuries. '
        + 'They are in a hospital or medical facility, wearing plain hospital clothes (hospital gown or scrubs — no tactical gear, no mission outfit). '
        + 'The prompt must incorporate all appearance impact notes from the medical record.\n\n'
        + 'BASE CHARACTER:\n' + baseDesc + '\n\n'
        + 'MEDICAL RECORD — APPEARANCE IMPACTS:\n' + (injuryDesc || 'None on file.') + '\n\n'
        + 'Write only the image prompt. 2-3 paragraphs. Photorealistic, clinical lighting, full body visible. '
        + 'Begin with the physical description, end with lighting and camera notes.';
    }

    const options = {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      payload: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 1000,
        messages: [{ role: 'user', content: userPrompt }]
      }),
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', options);
    const result = JSON.parse(response.getContentText());

    if (result.content && result.content[0] && result.content[0].text) {
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'OK', prompt: result.content[0].text }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Anthropic returns errors as {type:'error', error:{type, message}}
    // with no `content` key -- surface that message instead of a bare
    // "No content returned", since it's almost always the actionable part
    // (bad/retired model id, invalid key, rate limit, etc).
    const errMsg = result.error && result.error.message ? result.error.message : 'No content returned.';
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ERROR', message: errMsg }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch(err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ERROR', message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ── Agent File: actually render a Face/Outfit Plate image from a drafted
// prompt, via Gemini (Nano Banana 2) on the server -- same "key stays in
// Script Properties, never touches the browser" pattern as
// generateAppearancePrompt() above. Set GEMINI_API_KEY under Project
// Settings > Script Properties; never hardcode a real key here.
//
// safetySettings below turn DOWN sensitivity on violence/gore only
// (BLOCK_ONLY_HIGH) -- this is a tabletop-horror game where injury/scar/
// weapon descriptions in a character's own medical record are routine,
// not something that should trip a generic filter tuned for a general
// consumer app. Sexual-content and hate-speech thresholds are left at
// Google's default (BLOCK_MEDIUM_AND_ABOVE) -- there's no legitimate
// reason for this feature to need those loosened, and the API enforces a
// floor on some categories regardless. ──
function generatePlateImage(data) {
  try {
    const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    if (!apiKey) {
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'ERROR', message: 'GEMINI_API_KEY not set in Script Properties.' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const prompt = (data.prompt || '').trim();
    if (!prompt) {
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'ERROR', message: 'prompt is required.' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const parts = [{ text: prompt }];

    // Outfit Plate generation can optionally pass the existing Face Plate
    // image as a reference, so the same face carries over into the
    // full-body shot instead of Gemini inventing a new one from the text
    // description alone.
    if (data.reference_image_base64 && data.reference_image_base64.indexOf(',') !== -1) {
      const refMime = data.reference_image_base64.split(';')[0].split(':')[1];
      const refData = data.reference_image_base64.split(',')[1];
      parts.push({ inlineData: { mimeType: refMime, data: refData } });
    }

    const model = 'gemini-3.1-flash-image';
    const options = {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-goog-api-key': apiKey },
      payload: JSON.stringify({
        contents: [{ parts: parts }],
        generationConfig: { responseModalities: ['IMAGE'] },
        safetySettings: [
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' }
        ]
      }),
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent',
      options
    );
    const result = JSON.parse(response.getContentText());

    const candidate = result.candidates && result.candidates[0];
    const resultParts = candidate && candidate.content && candidate.content.parts;
    const imagePart = resultParts && resultParts.filter(function (p) { return p.inlineData; })[0];

    if (imagePart) {
      const dataUri = 'data:' + imagePart.inlineData.mimeType + ';base64,' + imagePart.inlineData.data;
      return ContentService
        .createTextOutput(JSON.stringify({ status: 'OK', image_base64: dataUri }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // No image back -- almost always a safety block (blockReason on the
    // prompt itself, or finishReason on the one candidate) or a bad/
    // unavailable model id. Surface whichever the response actually gives
    // us instead of a generic failure.
    const blockReason = result.promptFeedback && result.promptFeedback.blockReason;
    const finishReason = candidate && candidate.finishReason;
    const apiError = result.error && result.error.message;
    const message = apiError || (blockReason ? 'Blocked: ' + blockReason
      : finishReason && finishReason !== 'STOP' ? 'Generation stopped: ' + finishReason
      : 'No image returned.');

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ERROR', message: message }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ERROR', message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function backfillCodes() {
  const ss = getOrCreateSheet();
  const sheet = ss.getSheetByName(SHEET_NAME);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const codeCol = headers.indexOf('Agent Code');
  const nameCol = headers.indexOf('Char Name');

  if (codeCol < 0) { Logger.log('Agent Code column not found'); return; }

  for (let i = 1; i < data.length; i++) {
    if (!data[i][codeCol]) {
      const code = generateAgentCode(data[i][nameCol]);
      sheet.getRange(i + 1, codeCol + 1).setValue(code);
      Logger.log('Row ' + (i+1) + ': ' + code);
    }
  }
  Logger.log('Backfill complete');
}

// ── Housekeeping: a daily snapshot of the Characters sheet, so a
// destructive mistake (a bad manual edit, a bug -- the kind of thing
// that already happened once with this project) has a same-day
// fallback beyond Google Sheets' own version history.
//
// ONE-TIME SETUP: after pasting this file in and deploying, run
// installDailyBackupTrigger() ONCE from this editor (select it in the
// function dropdown above, then press Run) -- it'll ask you to
// authorize it the first time, then it schedules backupCharactersSheet()
// to run automatically every day after that. You never need to run
// either function manually again.
function installDailyBackupTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'backupCharactersSheet') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('backupCharactersSheet').timeBased().everyDays(1).atHour(4).create();
  Logger.log('Daily backup trigger installed -- runs around 4am your script timezone.');
}

function backupCharactersSheet() {
  const ss = getOrCreateSheet();
  const live = ss.getSheetByName(CHARACTERS_SHEET_NAME);
  if (!live) return;

  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const backupName = 'Backup_Characters_' + stamp;
  const existing = ss.getSheetByName(backupName);
  if (existing) ss.deleteSheet(existing); // re-running same day replaces, doesn't pile up

  const copy = live.copyTo(ss);
  copy.setName(backupName).hideSheet();

  // Keep the last 14 daily backups so the spreadsheet doesn't grow an
  // unbounded number of hidden sheet tabs over a long campaign.
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 14);
  ss.getSheets().forEach(s => {
    const m = s.getName().match(/^Backup_Characters_(\d{4}-\d{2}-\d{2})$/);
    if (m && new Date(m[1]) < cutoff) ss.deleteSheet(s);
  });
}
