# Retiring the Google Sheet — one-time steps

After these steps every page reads and writes Firestore directly. The
Apps Script backend and its Sheet are no longer used. Two things stay
behind until they aren't needed: the Drive image proxy, for any
`gdrive:` photo link that couldn't be moved, and the migration
functions themselves.

The page changes go live on GitHub Pages as soon as they're merged, so
**the pull request is merged only after steps 1–4 are done**. Until
then, steps 1–4 use the files from its branch, `claude/new-session-thjzt6`.
Everything in steps 1–4 is backwards-compatible with the pages as they
are today, so it can be done at any time, with players online.

## 1. Deploy the Firestore rules and Cloud Functions

In Cloud Shell (or anywhere with `firebase-tools` installed and logged
in — see README.md in this folder, sections 1 and 7):

```bash
git clone -b claude/new-session-thjzt6 https://github.com/turulsen/dg.git
cd dg
firebase use dg-app-b3447

# The AI keys move from Apps Script Script Properties to Secret Manager.
# Paste the same values the Apps Script project has under
# Project Settings > Script Properties (ANTHROPIC_API_KEY, GEMINI_API_KEY).
firebase functions:secrets:set ANTHROPIC_API_KEY
firebase functions:secrets:set GEMINI_API_KEY

cd functions && npm install && cd ..
firebase deploy --only firestore:rules,functions
```

This deploys:
- the rules: Agents write only their own character and Agent File (and
  may erase their own Agent from Agent Hub into Recently Deleted, which
  the Handler can restore for 24 hours); the new collections
  `deleted_agents`, `playlists`, `client_errors` and `config` get rules;
- the functions: `generatePrompt`, `generatePlateImage` and
  `dailyBackup` (a daily JSON snapshot in Storage under `backups/`,
  replacing the Sheet's daily Characters backup).

## 2. Update Apps Script

Paste the branch's `backend/Code.gs`
(https://raw.githubusercontent.com/turulsen/dg/claude/new-session-thjzt6/backend/Code.gs)
over the Apps Script project's Code.gs, then
**Deploy > Manage deployments > edit > New version > Deploy**. Version
v97 keeps Firestore in sync for everything the pages still send there
until step 5.

## 3. Copy the Sheet into Firestore

In the Apps Script editor:
1. Choose **runFullMigrationToFirestoreNow** in the Run dropdown and
   press **Run**.
2. Open the **Execution log**. It should end with `MIGRATION COMPLETE`
   and list what was copied under `counts`.
3. If it says `MIGRATION HAD n FAILURE(S)`, the lines under `failures`
   say what went wrong. Fix it and run again; it's safe to re-run.

It also lists, under `notes`:
- any character or Agent File that's in Firestore but not on the Sheet
  (nothing is deleted);
- any Player Note or Track Library entry that's on the Sheet but not in
  Firestore. Those two have been saved only to Firestore for a while,
  deletes included, so such a row is either one that was never copied
  or one somebody deleted on purpose -- the migration can't tell which,
  so it doesn't copy them. If the list is empty (the likely case),
  there's nothing to do. If it shows notes or tracks you want back, run
  **runCopySheetOnlyNotesAndTracksNow** once, before step 4.

The error log (`ClientErrors`) and the hidden `Backup_Characters_*`
tabs are the only Sheet data not copied: the first is a debugging log,
the second is replaced by the daily Firestore backup.

## 4. Move Drive images into Firebase Storage

1. Choose **runMigrateDriveFilesToStorageNow** and press **Run**.
2. If the log says `press Run again`, do that. It stops itself before
   Apps Script's 6-minute limit, and files already moved are skipped.
3. It ends with `All Drive files are now in Firebase Storage.`, or with
   a list of files it couldn't move. Those keep working through the old
   image proxy.

It writes with the same service account the Firestore mirror already
uses. If the log shows `Storage upload failed (HTTP 403)`, that account
lacks Storage access. In the Google Cloud console under IAM, give it the
**Storage Object Admin** role on the project, then run again.

## 5. Tell Claude it's done

Paste the two log summaries. The page changes are then merged. Reload
each device so it picks up the new offline cache, and you're done.

## 6. After the merge: switch off the Sheet's daily backup

The Apps Script project may still have a daily trigger copying the
Characters sheet (`backupCharactersSheet`, installed once by
`installDailyBackupTrigger`). Nothing writes that sheet any more, so it
would just copy a frozen tab every night; `dailyBackup` (step 1) backs up
Firestore instead. In the Apps Script editor open **Triggers** (the
clock icon on the left) and delete the `backupCharactersSheet` trigger.

## Rolling back

- **Pages:** revert the frontend merge on GitHub. Apps Script v97 still
  has every action, and the Sheet has everything written before the
  switch.
- **Anything written after the switch** exists only in Firestore. Run
  the migration in reverse only if you really need to (ask Claude
  first).
- **Rules and functions:** the new rules only change writes the old
  pages never made directly (`characters`/`briefs`/`agent_identity`,
  and the new collections), so they don't need rolling back.
