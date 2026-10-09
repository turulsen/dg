const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const { defineSecret } = require('firebase-functions/params');

initializeApp();

// The Handler password, mirrored from the same value already sitting in
// the Apps Script project's Script Properties (HANDLER_PASSWORD). Set it
// here with:
//   firebase functions:secrets:set HANDLER_PASSWORD
// Two independent copies of the same secret is a deliberate, temporary
// cost of the transition (Cloud Functions can't read Apps Script Script
// Properties) -- not a new secret, not a new thing to remember, just the
// same one value living in two places until Sheets/Apps Script is retired.
const HANDLER_PASSWORD = defineSecret('HANDLER_PASSWORD');

// Persists a custom claim onto the Firebase Auth USER RECORD itself,
// not just the one-shot custom token about to be minted below --
// required for the claim to survive this session's automatic ID token
// refresh. createCustomToken()'s own `additionalClaims` argument only
// ever lands on the FIRST ID token exchanged from that specific custom
// token; Firebase silently refreshes ID tokens roughly every hour using
// the refresh token, and that refreshed token is regenerated from the
// user record's OWN persisted custom claims, not from whatever
// createCustomToken() happened to be called with at sign-in time. Real
// live report that traced back to exactly this: a Handler (or Agent)
// session that worked fine right after signing in started failing
// every Handler-gated (or Agent-gated) Firestore read/write about an
// hour later with "Missing or insufficient permissions", no sign-out
// or other action involved at all -- the silently-refreshed token had
// simply lost the claim. setCustomUserClaims() requires the user
// record to already exist; on a brand-new uid's very first-ever sign-in
// it doesn't yet (Firebase auto-provisions the record lazily, the first
// time the client actually calls signInWithCustomToken()) -- that one
// first session still gets a working (if refresh-fragile) token via
// createCustomToken()'s own additionalClaims below, and every session
// from the next call onward persists correctly.
async function ensurePersistedClaims_(uid, claims) {
  try {
    await getAuth().setCustomUserClaims(uid, claims);
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err;
  }
}

// ════════════════════════════════════════════════════════════════
// exchangeAgentToken -- mints a Firebase custom auth token for an Agent
// Code, so the client can sign in once per session and let Firestore
// security rules do their own auth checks natively from then on
// (request.auth.token.agentCode), instead of a bespoke check on every
// read/write.
//
// IMPORTANT -- this deliberately does NOT re-implement a secret check.
// backend/Code.gs's requireAgentToken_() -- the "per-Agent bearer
// token" the original migration brief for this project assumed still
// existed -- was actually turned into a no-op earlier in this project;
// see that function's own comment in Code.gs for the reasoning (no real
// personal data at stake, and properly closing the race it half-guarded
// against would have meant a real transport change to a live,
// fire-and-forget write path for a security property this campaign
// doesn't need). The three hard constraints for this migration include
// "the auth bridge reuses what's already live rather than rebuilding
// it" and explicitly rule out a full auth/permissions redesign -- so
// this function mirrors that SAME real posture: knowing an Agent Code
// is already sufficient today (a player's own ?load=CODE link, a
// Cover Identity search result, or a Handler reading it off A-Cell's
// Sheet tab), so minting a sign-in token for any well-formed code is
// not a new hole, it's the existing one, just given a Firebase Auth
// identity to hang Firestore rules off of.
//
// If the campaign's risk profile ever changes, tightening this to a
// real shared secret is a self-contained change to this one function
// (plus a Firestore-side "known Agent Codes" allowlist check) -- not a
// project-wide auth redesign.
exports.exchangeAgentToken = onCall(async (request) => {
  const agentCode = String((request.data && request.data.agent_code) || '').trim().toUpperCase();
  if (!agentCode) {
    throw new HttpsError('invalid-argument', 'agent_code is required.');
  }
  // Loose shape check only (matches the format generateAgentCode() in
  // Code.gs produces, e.g. "JONE-E7FB") -- not a lookup, on purpose:
  // a brand-new Agent's first save is the moment their Firestore doc
  // is created, so requiring the doc to already exist would break
  // first-time character creation.
  if (!/^[A-Z0-9-]{3,32}$/.test(agentCode)) {
    throw new HttpsError('invalid-argument', 'agent_code is not a recognizable Agent Code.');
  }

  await ensurePersistedClaims_(agentCode, { agentCode: agentCode });
  const token = await getAuth().createCustomToken(agentCode, { agentCode: agentCode });
  return { token: token };
});

// ════════════════════════════════════════════════════════════════
// handlerLogin -- the Firebase-side twin of Code.gs's handlerLogin_():
// the one place the real Handler password is ever sent. On success,
// mints a Firebase custom auth token carrying `handler: true`, so
// Firestore rules can gate Handler-only writes (Cells, Evidence,
// Operations, Radio, Tracks, Character delete/restore) the same way
// requireHandlerAuth_()/requireHandlerSession_() do today.
exports.handlerLogin = onCall({ secrets: [HANDLER_PASSWORD] }, async (request) => {
  const password = String((request.data && request.data.handler_password) || '');
  const expected = HANDLER_PASSWORD.value();
  if (!expected) {
    throw new HttpsError('failed-precondition', 'Handler auth is not configured on the server.');
  }
  if (password !== expected) {
    throw new HttpsError('permission-denied', 'invalid Handler password');
  }

  // A stable uid ('handler') is fine here -- unlike Agent Codes, there
  // is exactly one Handler credential in this campaign (same as
  // Code.gs's single HANDLER_PASSWORD Script Property), not one per
  // person.
  await ensurePersistedClaims_('handler', { handler: true });
  const token = await getAuth().createCustomToken('handler', { handler: true });
  return { token: token };
});

// ════════════════════════════════════════════════════════════════
// AI generation for the Agent File -- moved here from the retired Apps
// Script backend (generateAppearancePrompt / generatePlateImage in
// backend/Code.gs). The API keys live only in Secret Manager:
//   firebase functions:secrets:set ANTHROPIC_API_KEY
//   firebase functions:secrets:set GEMINI_API_KEY
// (the same values that sat in the Apps Script project's Script
// Properties). The caller must be signed in -- as an Agent (via
// exchangeAgentToken) or as the Handler -- and each Agent gets the same
// limits the Apps Script had: 10 prompts / 3 images per 10 minutes.
// ════════════════════════════════════════════════════════════════
const { getFirestore } = require('firebase-admin/firestore');
const { buildAppearancePrompt } = require('./ai-prompts');

const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
const STORAGE_BUCKET = 'dg-app-b3447.firebasestorage.app';

function callerKey_(request) {
  const t = (request.auth && request.auth.token) || {};
  if (t.handler === true) return 'HANDLER';
  if (t.agentCode) return String(t.agentCode);
  throw new HttpsError('unauthenticated', 'Sign in first.');
}

// Fixed-window counter per caller per bucket, in a transaction so two
// simultaneous calls can't both slip under the limit.
async function checkRateLimit_(key, bucket, maxCalls, windowSeconds) {
  const ref = getFirestore().collection('rate_limits').doc(bucket + '_' + key);
  const now = Date.now();
  let allowed = true;
  // A failing counter (e.g. the functions' service account without
  // Firestore access) must not block the AI calls outright: before this,
  // such an error escaped as the SDK's bare "internal" on every request.
  // Let the call through and log why, so the cause shows in functions:log.
  try {
    allowed = await getFirestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const d = snap.exists ? snap.data() : null;
      if (!d || now - d.window_start > windowSeconds * 1000) {
        tx.set(ref, { window_start: now, count: 1 });
        return true;
      }
      if (d.count >= maxCalls) return false;
      tx.update(ref, { count: d.count + 1 });
      return true;
    });
  } catch (err) {
    logger.error('rate limit check failed; allowing the call', { bucket: bucket, key: key, error: (err && err.message) || String(err) });
  }
  if (!allowed) throw new HttpsError('resource-exhausted', 'Rate limit reached for this Agent -- please wait a few minutes and try again.');
}

// Local emulator runs (tests) never reach the real AI APIs.
const IN_EMULATOR = process.env.FUNCTIONS_EMULATOR === 'true';
const FAKE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAGElEQVR4nGNgGAWjYBSMglEwCkbBwAQABAgAAWm3N0IAAAAASUVORK5CYII=';

exports.generatePrompt = onCall({ secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 120 }, async (request) => {
  const key = callerKey_(request);
  await checkRateLimit_(key, 'prompt', 10, 600);
  if (IN_EMULATOR) return { status: 'OK', prompt: 'EMULATOR PROMPT: ' + buildAppearancePrompt(request.data || {}).slice(0, 80) };
  // trim(): a key pasted with a stray newline or space makes fetch() throw
  // on the header before any request is sent.
  const apiKey = String(ANTHROPIC_API_KEY.value() || '').trim();
  if (!apiKey) throw new HttpsError('failed-precondition', 'ANTHROPIC_API_KEY is not set on the server.');
  // Anything thrown past this point would reach the player only as the
  // SDK's bare "internal" -- report it as a readable ERROR instead, the
  // way the Apps Script version's try/catch did.
  try {
    const userPrompt = buildAppearancePrompt(request.data || {});
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 1000, messages: [{ role: 'user', content: userPrompt }] })
    });
    const result = await resp.json().catch(() => ({}));
    if (result.content && result.content[0] && result.content[0].text) {
      return { status: 'OK', prompt: result.content[0].text };
    }
    const message = (result.error && result.error.message) || ('No content returned (HTTP ' + resp.status + ').');
    logger.error('generatePrompt: Anthropic API error', { status: resp.status, error: result.error || null });
    return { status: 'ERROR', message: message };
  } catch (err) {
    logger.error('generatePrompt failed', err);
    return { status: 'ERROR', message: 'Prompt service error: ' + ((err && err.message) || String(err)) };
  }
});

// A Bond's description for the New Recruit wizard (assets/recruit-wizard.js):
// two or three sentences, in the Agent's own voice, from the Bond's name
// and relationship and what the wizard knows of the Agent so far. Same
// sign-in and rate limiting as the prompts above.
function clip_(v, n) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n); }
function bondPrompt_(d) {
  const a = d.agent || {}, b = d.bond || {};
  const who = [clip_(a.name, 80), clip_(a.profession, 80), a.employer ? 'working for ' + clip_(a.employer, 80) : '',
    a.age ? 'age ' + clip_(a.age, 10) : '', clip_(a.sex, 20), clip_(a.nationality, 60)].filter(Boolean).join(', ');
  const existing = clip_(d.existing, 600);
  return 'You are helping a player create an Agent for the tabletop game Delta Green (a modern horror game about ' +
    'government agents who secretly fight the unnatural). A Bond is a person the Agent cares about, whose relationship ' +
    'the work slowly erodes.\n\nAgent: ' + (who || 'not described yet') + '.\nBond: ' + clip_(b.name, 80) +
    (b.relationship ? ' (' + clip_(b.relationship, 80) + ')' : '') + '.\n' +
    (existing ? 'The player\'s notes so far, to keep and build on: ' + existing + '\n' : '') +
    '\nWrite two or three short sentences, in the first person as the Agent, about who this person is to them: ' +
    'something specific and human about the relationship, and one quiet hint of strain or of what the Agent keeps from them. ' +
    'No supernatural events, no melodrama, no names other than the Bond\'s. Reply with the sentences only.';
}
exports.generateBondDescription = onCall({ secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 60 }, async (request) => {
  const key = callerKey_(request);
  await checkRateLimit_(key, 'bond', 20, 600);
  const data = request.data || {};
  if (!clip_(data.bond && data.bond.name, 80)) throw new HttpsError('invalid-argument', 'The Bond needs a name.');
  if (IN_EMULATOR) return { status: 'OK', description: 'EMULATOR BOND: ' + clip_(data.bond.name, 80) };
  const apiKey = String(ANTHROPIC_API_KEY.value() || '').trim();
  if (!apiKey) throw new HttpsError('failed-precondition', 'ANTHROPIC_API_KEY is not set on the server.');
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 300, messages: [{ role: 'user', content: bondPrompt_(data) }] })
    });
    const result = await resp.json().catch(() => ({}));
    if (result.content && result.content[0] && result.content[0].text) {
      return { status: 'OK', description: String(result.content[0].text).trim() };
    }
    const message = (result.error && result.error.message) || ('No content returned (HTTP ' + resp.status + ').');
    logger.error('generateBondDescription: Anthropic API error', { status: resp.status, error: result.error || null });
    return { status: 'ERROR', message: message };
  } catch (err) {
    logger.error('generateBondDescription failed', err);
    return { status: 'ERROR', message: 'Bond service error: ' + ((err && err.message) || String(err)) };
  }
});

// Reads one of this project's own Plate/reference images straight out
// of Storage (no CORS involved server-side) -- only agent-plates/ and
// agent-refs/ objects, never an arbitrary URL.
async function storageReferenceImage_(url) {
  const m = /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/([^/]+)\/o\/((?:agent-plates|agent-refs)%2F[^?/]+)(\?.*)?$/.exec(String(url || ''));
  if (!m || m[1] !== STORAGE_BUCKET) return null;
  try {
    const { getStorage } = require('firebase-admin/storage');
    const file = getStorage().bucket(STORAGE_BUCKET).file(decodeURIComponent(m[2]));
    const [meta] = await file.getMetadata();
    if (Number(meta.size) > 8 * 1024 * 1024) return null;
    let mime = meta.contentType || '';
    if (mime.indexOf('image/') !== 0) {
      const ext = (/\.(png|jpe?g|webp|gif)$/i.exec(file.name) || [])[1] || '';
      mime = ext ? 'image/' + (ext.toLowerCase() === 'jpg' ? 'jpeg' : ext.toLowerCase()) : '';
    }
    if (!mime) return null;
    const [buf] = await file.download();
    return { mimeType: mime, data: buf.toString('base64') };
  } catch (e) {
    return null;
  }
}

exports.generatePlateImage = onCall({ secrets: [GEMINI_API_KEY], timeoutSeconds: 180, memory: '512MiB' }, async (request) => {
  const key = callerKey_(request);
  await checkRateLimit_(key, 'plate_image', 3, 600);
  const apiKey = String(GEMINI_API_KEY.value() || '').trim();
  if (!apiKey) throw new HttpsError('failed-precondition', 'GEMINI_API_KEY is not set on the server.');
  const data = request.data || {};
  const prompt = String(data.prompt || '').trim();
  if (!prompt) return { status: 'ERROR', message: 'prompt is required.' };
  if (prompt.length > 4000) return { status: 'ERROR', message: 'prompt is too long.' };
  if (data.reference_image_base64 && data.reference_image_base64.length > 8 * 1024 * 1024) {
    return { status: 'ERROR', message: 'reference image is too large.' };
  }
  // An Outfit Plate is a full-body shot, but its reference image is the
  // Face Plate -- a tight 3:4 headshot -- and Gemini anchors on the
  // reference's framing, so outfit plates kept coming back as headshots
  // even with the "identity only" line in the prompt. So: ask for a tall
  // 9:16 frame outright (3:4 for a Face Plate), and put the reference
  // first with its own label, so the full-body instructions come last.
  // plate_type comes from the Agent File; a page older than it sends none,
  // so fall back on the prompt (every outfit prompt says "full body").
  const isOutfit = data.plate_type ? data.plate_type === 'outfit' : /full[\s-]*body/i.test(prompt);
  let ref = null;
  if (data.reference_image_base64 && data.reference_image_base64.indexOf(',') !== -1) {
    ref = {
      mimeType: data.reference_image_base64.split(';')[0].split(':')[1],
      data: data.reference_image_base64.split(',')[1]
    };
  } else if (data.reference_image_url) {
    ref = await storageReferenceImage_(data.reference_image_url);
  }
  const parts = [];
  if (ref) {
    parts.push({ text: isOutfit
      ? 'Reference image (next): use it ONLY for this person\'s face and likeness. Ignore its framing, crop and camera distance -- it is a close-up headshot, the output is not.'
      : 'Reference image (next): use it for this person\'s likeness.' });
    parts.push({ inlineData: ref });
  }
  parts.push({ text: prompt });
  if (IN_EMULATOR) return { status: 'OK', image_base64: 'data:image/png;base64,' + FAKE_PNG, refs: ref ? 1 : 0 };
  // Same as generatePrompt: never let a thrown error reach the player as
  // a bare "internal".
  try {
    const model = 'gemini-3.1-flash-image';
    const resp = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: parts }],
        generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: isOutfit ? '9:16' : '3:4' } },
        safetySettings: [
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' }
        ]
      })
    });
    const result = await resp.json().catch(() => ({}));
    const candidate = result.candidates && result.candidates[0];
    const resultParts = candidate && candidate.content && candidate.content.parts;
    const imagePart = resultParts && resultParts.filter((p) => p.inlineData)[0];
    if (imagePart) {
      return { status: 'OK', image_base64: 'data:' + imagePart.inlineData.mimeType + ';base64,' + imagePart.inlineData.data };
    }
    const blockReason = result.promptFeedback && result.promptFeedback.blockReason;
    const finishReason = candidate && candidate.finishReason;
    const apiError = result.error && result.error.message;
    logger.error('generatePlateImage: no image', { status: resp.status, error: result.error || null, blockReason: blockReason || null, finishReason: finishReason || null });
    return { status: 'ERROR', message: apiError || (blockReason ? 'Blocked: ' + blockReason
      : finishReason && finishReason !== 'STOP' ? 'Generation stopped: ' + finishReason : 'No image returned.') };
  } catch (err) {
    logger.error('generatePlateImage failed', err);
    return { status: 'ERROR', message: 'Image service error: ' + ((err && err.message) || String(err)) };
  }
});

// ════════════════════════════════════════════════════════════════
// Daily backup -- replaces the Apps Script backupCharactersSheet()
// trigger (a hidden copy of the Characters sheet every day, 14 kept).
// Writes characters + briefs to backups/YYYY-MM-DD.json in Storage
// (not public: storage.rules has no rule for backups/, so only the
// console and the Admin SDK can read them) and deletes files older
// than 14 days.
// ════════════════════════════════════════════════════════════════
const { onSchedule } = require('firebase-functions/v2/scheduler');

exports.dailyBackup = onSchedule({ schedule: 'every day 04:00', timeZone: 'Europe/Copenhagen' }, async () => {
  const db = getFirestore();
  const out = { taken_at: new Date().toISOString() };
  for (const coll of ['characters', 'briefs', 'cells', 'evidence', 'operations']) {
    const snap = await db.collection(coll).get();
    out[coll] = {};
    snap.forEach((d) => { out[coll][d.id] = d.data(); });
  }
  const { getStorage } = require('firebase-admin/storage');
  const bucket = getStorage().bucket(STORAGE_BUCKET);
  const day = out.taken_at.slice(0, 10);
  await bucket.file('backups/' + day + '.json').save(JSON.stringify(out), { contentType: 'application/json' });
  const [files] = await bucket.getFiles({ prefix: 'backups/' });
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  for (const f of files) {
    const m = /backups\/(\d{4}-\d{2}-\d{2})\.json$/.exec(f.name);
    if (m && new Date(m[1]).getTime() < cutoff) await f.delete().catch(() => {});
  }
});
