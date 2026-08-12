/* ══════════════════════════════════════════════
   TABLE RADIO -- AMBIENT LAYERS + STINGERS (combined)

   Paste this whole file into the existing Apps Script project that
   already backs get_now_playing / set_now_playing / pause_now_playing /
   resume_now_playing / get_playlist / save_playlist / list_tracks /
   upload_track / delete_track / list_cells / set_cell_channel, then
   redeploy. Purely additive -- doesn't touch any existing function,
   sheet, or action. Combines what were two separate handoffs
   (acell-table-radio-ambient-addition.gs and
   acell-table-radio-stingers-addition.gs) into one file so there's a
   single thing to paste in and wire up.

   ── Ambient layers (rain/wind/static) ──
   Persistent per-channel on/off state, Handler-toggled, playing
   underneath whatever track is tuned. Adds an `ambient_layers` array to
   the EXISTING get_now_playing response (piggy-backed on the poll every
   listener's browser already makes every 2s) and a new
   `set_ambient_layer` action.
   Storage: sheet tab "AmbientLayers" -- channel | layer_id | active | started_at
   (one row per channel PER layer, since several layers can be active
   on one channel at once).

   ── Stingers (one-shot SFX) ──
   Fundamentally different from ambient layers: there's only ever "the
   most recently fired stinger" per channel, stamped with a FRESH
   timestamp on every single trigger -- even re-firing the exact same
   stinger twice in a row counts as a new event, since listeners diff
   the timestamp, not the stinger's identity. Adds a `last_stinger`
   field to the SAME get_now_playing response, and a new
   `trigger_stinger` action.
   Storage: sheet tab "Stingers" -- channel | stinger_id | fired_at
   (ONE row per channel, upserted every trigger -- only the single most
   recent firing matters, unlike AmbientLayers' one-row-per-layer).

   getOrCreateSheet_(name) below assumes this project already has a
   helper of that name/shape (referenced elsewhere in this project's
   own docs) that returns a sheet tab by name within the correct
   spreadsheet file (the one already holding "Delta Green Briefs" /
   Characters / etc). If your project's actual helper has a different
   name, point both ensure*Sheet_() functions at whatever you already
   use elsewhere in this file for those tabs -- the important part is
   that AmbientLayers/Stingers land in the SAME spreadsheet, not a new
   file.
   ══════════════════════════════════════════════ */

/* ── Ambient layers ── */

var AMBIENT_LAYER_IDS = ['rain', 'wind', 'static'];
var AMBIENT_SHEET_NAME = 'AmbientLayers';

function ensureAmbientSheet_() {
  var sheet = getOrCreateSheet_(AMBIENT_SHEET_NAME); // <-- see header note if this helper name doesn't match your project
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['channel', 'layer_id', 'active', 'started_at']);
  }
  return sheet;
}

// Always returns all 3 known layer ids for a channel, defaulting any
// layer with no row yet to inactive -- so the client never has to
// special-case a missing layer, just reads a fixed-size array.
function getAmbientLayers_(channel) {
  var sheet = ensureAmbientSheet_();
  var data = sheet.getDataRange().getValues(); // [ [channel, layer_id, active, started_at], ... ], row 0 = header
  var byId = {};
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(channel)) {
      byId[data[i][1]] = { active: !!data[i][2], started_at: data[i][3] || null };
    }
  }
  return AMBIENT_LAYER_IDS.map(function (id) {
    var row = byId[id] || { active: false, started_at: null };
    return { id: id, active: row.active, started_at: row.started_at };
  });
}

// Handler-only write: flips one layer on/off for one channel. Upserts
// the (channel, layer_id) row. Stamps a FRESH started_at only on the
// OFF->ON transition -- mirrors set_now_playing's own started_at
// semantics, so re-confirming an already-active layer doesn't reset its
// loop phase for everyone already hearing it. Clears started_at on
// turn-off, so a later turn-on always looks like a clean fresh start.
function setAmbientLayer_(channel, layerId, active) {
  if (AMBIENT_LAYER_IDS.indexOf(layerId) === -1) {
    return { status: 'ERROR', message: 'Unknown layer_id: ' + layerId };
  }
  var sheet = ensureAmbientSheet_();
  var data = sheet.getDataRange().getValues();
  var rowIndex = -1;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(channel) && data[i][1] === layerId) { rowIndex = i; break; }
  }
  var wasActive = rowIndex !== -1 && !!data[rowIndex][2];
  var startedAt;
  if (!active) {
    startedAt = null;
  } else if (wasActive) {
    startedAt = data[rowIndex][3]; // still on, keep the existing loop phase
  } else {
    startedAt = Date.now(); // OFF -> ON: fresh start
  }

  if (rowIndex === -1) {
    sheet.appendRow([channel, layerId, active, startedAt]);
  } else {
    sheet.getRange(rowIndex + 1, 3, 1, 2).setValues([[active, startedAt]]);
  }
  return { status: 'OK' };
}

/* ── Stingers ── */

var STINGER_IDS = [
  'knock', 'wood-creak',
  'gunshot-pistol', 'gunshot-shotgun', 'gunshot-rifle-semi', 'gunshot-rifle-auto',
  'explosion-small', 'explosion-medium', 'explosion-large',
  'scream-woman', 'scream-man', 'child-laughter', 'child-crying'
];
var STINGER_SHEET_NAME = 'Stingers';

function ensureStingerSheet_() {
  var sheet = getOrCreateSheet_(STINGER_SHEET_NAME); // <-- see header note if this helper name doesn't match your project
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['channel', 'stinger_id', 'fired_at']);
  }
  return sheet;
}

// Returns { id, fired_at } for the last stinger fired on this channel,
// or null if none has fired yet.
function getLastStinger_(channel) {
  var sheet = ensureStingerSheet_();
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(channel)) {
      return { id: data[i][1], fired_at: data[i][2] };
    }
  }
  return null;
}

// Handler-only write: fires one stinger on one channel. Upserts the
// single (channel) row -- always with Date.now(), regardless of whether
// the same stinger_id was already the last one fired, so re-triggering
// the same sound is always a NEW event to listeners.
function triggerStinger_(channel, stingerId) {
  if (STINGER_IDS.indexOf(stingerId) === -1) {
    return { status: 'ERROR', message: 'Unknown stinger_id: ' + stingerId };
  }
  var sheet = ensureStingerSheet_();
  var data = sheet.getDataRange().getValues();
  var rowIndex = -1;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(channel)) { rowIndex = i; break; }
  }
  var firedAt = Date.now();
  if (rowIndex === -1) {
    sheet.appendRow([channel, stingerId, firedAt]);
  } else {
    sheet.getRange(rowIndex + 1, 2, 1, 2).setValues([[stingerId, firedAt]]);
  }
  return { status: 'OK' };
}

/* ══════════════════════════════════════════════
   WIRING -- the only two edits needed in your EXISTING doGet/doPost.
   Everything above is new, self-contained code; everything below is a
   small addition to code you already have.
   ══════════════════════════════════════════════ */

/*
  Inside your existing doGet(e) switch(action) block, find the
  'get_now_playing' case. It already builds some object (call it `np`
  below, whatever your actual variable is named) with track_url etc,
  OR returns early with something like {status:'NOT_FOUND'} when no
  track is set on that channel. Ambient layers AND stingers are both
  independent of whether a track is playing -- the Handler might have
  rain going, or fire a knock, with no music cued at all -- so both new
  fields need to land in BOTH outcomes, not just the "track found" one:

    case 'get_now_playing':
      var ambientLayers = getAmbientLayers_(e.parameter.channel);
      var lastStinger = getLastStinger_(e.parameter.channel);

      // ... your existing lookup ...
      // if NO track is set on this channel (your existing early return):
      //   return jsonpWrap_({ status: 'NOT_FOUND', ambient_layers: ambientLayers, last_stinger: lastStinger }, e.parameter.callback);
      // if a track IS set (your existing np/response object):
      //   np.ambient_layers = ambientLayers;
      //   np.last_stinger = lastStinger;
      //   return jsonpWrap_(np, e.parameter.callback); // your existing wrap-and-return, unchanged

  (jsonpWrap_ above is a stand-in for however this project already
  wraps a response as JSONP -- use whatever that actually is.)

  Inside your existing doPost(e) switch(action) block (parsing
  e.postData.contents as JSON into some `body` object), ADD two new cases:

    case 'set_ambient_layer':
      var ambientResult = setAmbientLayer_(body.channel, body.layer_id, body.active === '1' || body.active === true);
      return ContentService.createTextOutput(JSON.stringify(ambientResult))
        .setMimeType(ContentService.MimeType.JSON);

    case 'trigger_stinger':
      var stingerResult = triggerStinger_(body.channel, body.stinger_id);
      return ContentService.createTextOutput(JSON.stringify(stingerResult))
        .setMimeType(ContentService.MimeType.JSON);

  (Neither response body is ever actually read by the client -- every
  write in this app is a mode:'no-cors' POST, so the client can't see it
  either way. This matches how set_now_playing/pause_now_playing already
  work: the client always re-polls get_now_playing afterward to confirm
  the write actually landed, rather than trusting the POST's own
  response.)
*/
