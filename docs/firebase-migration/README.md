# Firebase migration -- Phase 1 (Foundation) setup

This is the manual setup for everything scaffolded on the
`firebase-migration` branch so far: a Firebase project, Firestore,
the auth bridge Cloud Functions, and the Sheets -> Firestore mirror
script. None of it touches the live GitHub Pages site or the live
Apps Script backend -- it's pure infrastructure you can set up and test
entirely on the side.

Every step below needs to be run by you (Gergő), not Claude -- Claude
Code's sandbox has no interactive browser/OAuth login and can't create
billing-linked Google Cloud resources on your behalf.

## 1. Create the Firebase project

1. Go to https://console.firebase.google.com/ and click **Add project**.
2. Name it whatever you like (e.g. `dg-campaign`). Google Analytics is
   optional -- skip it, this app doesn't need it.
3. Once created, go to **Build > Firestore Database** and click
   **Create database**. Choose a region close to your table (any
   `europe-west*` region if you're in Europe) and start in
   **production mode** (the security rules in `firestore.rules` at the
   repo root will be deployed over this).
4. Go to **Build > Storage** and click **Get started** (needed for
   Phase 4 later, but cheap to provision now while you're in the
   console). Same region as Firestore.
5. Note your **Project ID** (Project settings, gear icon top-left) --
   you'll need it in two places below.

## 2. Install the Firebase CLI and log in

```bash
npm install -g firebase-tools
firebase login
```

## 3. Point this repo at your project

Edit `.firebaserc` at the repo root and replace
`REPLACE_WITH_YOUR_FIREBASE_PROJECT_ID` with the real Project ID from
step 1.

## 4. Deploy Firestore rules, indexes, and Storage rules

From the repo root:

```bash
firebase deploy --only firestore:rules,firestore:indexes,storage
```

This is safe to run any time and re-run after any edit to
`firestore.rules`/`firestore.indexes.json`/`storage.rules` -- it never
touches your data, only the rules guarding it.

## 5. Create a service account for the mirror script + Code.gs bridge

Both the mirror script (`tools/firestore-mirror/`) and the Code.gs
dual-write bridge need to authenticate to Firestore from outside a
browser.

1. In the [Google Cloud Console](https://console.cloud.google.com/iam-admin/serviceaccounts)
   (same project), create a new service account -- e.g.
   `dg-campaign-mirror`.
2. Grant it the **Cloud Datastore User** role (covers Firestore
   read/write).
3. Create a JSON key for it and download it. **Treat this file like a
   password** -- it grants write access to your whole Firestore
   database. Don't commit it to the repo (it isn't inside any tracked
   directory here, but double-check `git status` after downloading it
   if you save it inside the repo folder for convenience).
4. Share your Delta Green Briefs Google Sheet with that service
   account's email address (`...@<project-id>.iam.gserviceaccount.com`)
   as a **Viewer** -- this is what lets the mirror script read it via
   the Sheets API.
5. Enable the Sheets API for the project: https://console.cloud.google.com/apis/library/sheets.googleapis.com

## 6. Run the mirror script (read-only shadow)

```bash
cd tools/firestore-mirror
npm install
GOOGLE_APPLICATION_CREDENTIALS=/path/to/your-service-account-key.json \
  npm run mirror -- --dry-run   # prints counts, writes nothing
GOOGLE_APPLICATION_CREDENTIALS=/path/to/your-service-account-key.json \
  npm run mirror                # actually writes to Firestore
```

Re-run this any time -- it's idempotent (safe to run repeatedly) and
only ever upserts by default. See `tools/firestore-mirror/mirror.js`'s
own header comment for the `--prune`/`--only=` flags.

At this point Firestore has a full copy of the live Sheet data, but
nothing on the live site reads from it yet -- exactly the "read-only
shadow" Phase 1 is meant to produce.

## 7. Deploy the auth bridge Cloud Functions

1. Set the Handler password secret (same value as the
   `HANDLER_PASSWORD` Script Property already set in your Apps Script
   project -- see step 8):
   ```bash
   firebase functions:secrets:set HANDLER_PASSWORD
   ```
2. Deploy:
   ```bash
   cd functions
   npm install
   cd ..
   firebase deploy --only functions
   ```

Read `functions/index.js`'s own comment on `exchangeAgentToken` before
relying on this in a real security review -- it deliberately mirrors
Code.gs's ACTUAL current auth model (no real per-Agent secret exists
today; see below), not a new one.

## 8. Wire up the Code.gs dual-write bridge (optional for now, needed before Phase 2+)

The dual-write bridge added to `backend/Code.gs` on this branch is a
**no-op until two Script Properties are set** -- so it's safe to leave
your live Apps Script deployment exactly as-is for now. When you're
ready to start keeping Firestore live-current (recommended before
Phase 2's Table Radio cutover, so Firestore isn't stale from day one
of relying on it):

1. Create a **second** service account key the same way as step 5
   (or reuse the same one), and grant it **Cloud Datastore User** on
   your Firebase project.
2. In the Apps Script editor (**Project Settings > Script Properties**),
   add:
   - `FIRESTORE_PROJECT_ID` = your Firebase Project ID
   - `FIRESTORE_SERVICE_ACCOUNT_JSON` = the full contents of the
     service account JSON key file, pasted as one value
3. **Copy the full updated `backend/Code.gs` into your Apps Script
   editor and redeploy.** There is no CLI/API deploy path for this
   project -- this is always a manual copy-paste-and-redeploy step, and
   it's the only way any Code.gs change (this one included) ever takes
   effect. Pushing to GitHub alone does nothing to the live backend.
4. Save a character or submit a Brief, then check the Firestore
   console -- you should see that document update within a couple of
   seconds. If you see nothing, check **Apps Script > Executions** for
   a logged `firestoreDualWrite_ failed for ...` error (it never blocks
   or shows up to the player, only in the execution log).

## What's real vs. what the original brief assumed

One correction worth knowing before you look at the auth code: the
original migration brief assumed `requireAgentToken_()` was a live
per-Agent bearer-token check to bridge into Firebase Auth. It isn't --
it was deliberately turned into a no-op earlier in this project (see
its own comment in `backend/Code.gs`), because the only thing it ever
protected against was low-stakes (one player editing another's notes),
and properly closing that gap would have meant a real transport change
to a live, fire-and-forget write path. The only *real* secret in this
app today is the Handler password.

`exchangeAgentToken` (the Cloud Function) mirrors that actual posture:
it mints a Firebase sign-in token for any well-formed Agent Code with
no real gate, same as today's `?load=CODE` link or a Cover Identity
search result. This isn't a regression -- it's the same security model
the live app already runs on, just given a Firebase Auth identity to
hang Firestore rules off of. If the campaign's risk profile ever
changes, tightening it is a self-contained change to that one function
(see its comment for exactly what that would involve) -- not a
project-wide auth redesign, and out of scope for this migration per
the brief's own "no full auth/permissions redesign" constraint.

## What's next

Phase 1 is infrastructure only -- nothing above changes what a player
sees. Phase 2 (Table Radio / Now Playing) is the first real cutover:
rewriting `assets/table-radio.js`'s poll loop as a Firestore
`onSnapshot` listener, tested on a Firebase Hosting preview channel
before touching the live file. That's the next unit of work on this
branch.
