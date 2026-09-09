const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
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
  const token = await getAuth().createCustomToken('handler', { handler: true });
  return { token: token };
});
