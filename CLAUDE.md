# Working protocol for this repo

## Before fixing any reported bug

1. **Read `BUGFIXES.md` in full first.** Check whether this exact symptom, or
   something close to it, was already addressed — and if so, whether that
   earlier fix was actually complete. A fix can be real but partial (e.g. it
   adds error-surfacing in one place while a separate, unrelated code path
   still silently overwrites it moments later) — the same user-visible
   symptom coming back is a sign the earlier fix needs to be *finished*, not
   evidence of a brand-new bug. Say so explicitly when that's the case,
   rather than writing up a second, disconnected entry for the same root
   issue.

2. **Read `README.md` in full (or at least the relevant page's row in its
   table) before diagnosing.** It documents what every page/feature is
   actually supposed to do — which tabs exist, what's scoped to a Cell vs.
   global, what's local-device-only (`localStorage`) vs. server data, which
   pieces are still on the Apps Script/Sheets backend vs. migrated to
   Firestore, etc. Fixing behavior without checking this risks solving the
   wrong problem, or "fixing" something that's actually working as designed.

Doing both first is often faster than re-deriving the same root cause from
scratch, and avoids the kind of redundant work that already happened once
today (a second pass rediscovering the first half of an already-logged bug).

## Standing rules already established (see `BUGFIXES.md`/`sw.js` for full
context, kept here as a quick reference)

- `backend/Code.gs` is a git-tracked mirror only. Pushing to GitHub never
  updates the live Apps Script backend — it always needs a manual
  paste-and-redeploy into the Apps Script editor.
- Bump `sw.js`'s `CACHE_NAME` in the same commit as any change to a
  `SHELL_FILES`-listed file, or returning visitors can stay stuck on old JS
  indefinitely.
- Apps Script's Run-dropdown hides any function whose name ends in `_` —
  diagnostic/wrapper functions meant to be run manually must not have a
  trailing underscore.
