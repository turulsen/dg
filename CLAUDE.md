# Working protocol for this repo

## Before fixing any reported bug

0. **Check whether `main` is simply behind, before assuming anything about
   the bug itself.** Run `git log origin/main..HEAD --oneline | wc -l` (and
   read a few of the messages) on whatever branch you're working from. A
   nonzero, non-trivial count means there may be fully-fixed, tested,
   BUGFIXES.md-documented work sitting unmerged — and a "we've seen this
   before" report can be *completely* explained by that alone, with nothing
   wrong in the code and nothing incomplete about the earlier fix. This is
   not hypothetical: on 2026-09-10, a session branch was found holding 141
   unmerged commits going back to Aug 26 — a full Firebase migration plus
   weeks of confirmed fixes, none of it live, because "committed and pushed
   to the session branch" had been silently treated as equivalent to
   "shipped." See "Deploy discipline" below for the actual rule this
   caused to be adopted. Do this check *before* step 1 below, since it
   changes what step 1 is even asking: a recurrence explained by deploy lag
   needs a cutover, not a new diagnosis.

1. **Read `BUGFIXES.md` in full first.** Check whether this exact symptom, or
   something close to it, was already addressed — and if so, whether that
   earlier fix was actually complete. A fix can be real but partial (e.g. it
   adds error-surfacing in one place while a separate, unrelated code path
   still silently overwrites it moments later) — the same user-visible
   symptom coming back is a sign the earlier fix needs to be *finished*, not
   evidence of a brand-new bug. Say so explicitly when that's the case,
   rather than writing up a second, disconnected entry for the same root
   issue.

2. **Read `README.md` and `FEATURES.md` before diagnosing.** `README.md` is
   the short page-by-page overview. `FEATURES.md` is the deeper reference —
   architecture, the full backend action table, the Sheets data model, and
   §13 pointing at GitHub Issues for what's currently open (see below) —
   written so a fresh session can understand a bug report without
   reverse-engineering it from the code alone. **Caveat:** `FEATURES.md`
   documents the app as of the pre-Firebase `claude/delta-green-agent-hub-sn79d4`
   branch, with a deliberately separate §12 summarizing Firebase migration
   status as of whenever it was last updated — treat its Firestore/Firebase
   specifics as probably stale (this migration has moved fast) and verify
   anything Firebase-related against the actual current code rather than
   trusting the doc outright; its Sheets/Apps Script architecture
   description is still the reliable part. Fixing behavior without checking
   these risks solving the wrong problem, or "fixing" something that's
   actually working as designed.

3. **Check GitHub Issues** (`https://github.com/turulsen/dg/issues`) for
   whether this is already tracked. See `VERSIONING.md` §5 for the full
   split between Issues (live, open items), `BUGFIXES.md` (narrative
   archive of what shipped), and `FEATURES.md` §13 (resolved/decided
   matters only, not a live list).

Doing all three first is often faster than re-deriving the same root cause
from scratch, and avoids the kind of redundant work that already happened
once today (a second pass rediscovering the first half of an already-logged
bug).

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

## Deploy discipline (cutover to `main`) — read this if you take nothing else away

A fix is not "done," "shipped," or safe to describe to the user in the past
tense until it is live on `main` — the *only* branch GitHub Pages actually
builds from (confirmed directly against the Pages deploy history, not
assumed: the most recent `pages-build-deployment` run's source SHA matches
`main`'s HEAD exactly, and no `gh-pages` or other publishing branch exists).
Committing and pushing to a session working branch is real, necessary work,
but it is **not** shipping — it's the step *before* shipping. Treating the
two as the same thing is exactly what let 141 commits of tested,
BUGFIXES.md-documented work sit invisible to real players for two weeks.

Rules, going forward:

- **Cutover is part of shipping a fix, not a separate future task.** When
  you commit a tested fix to the working branch and ask the user to
  approve pushing it, ask in the same breath whether to also cut it over to
  `main` right then — don't default to "push to my branch and call it
  done," since the session-branch convention this repo uses means nothing
  reaches `main` unless someone explicitly asks for that. Silently
  accumulating "I'll bundle the cutover later" is how this happened.
- **Prefer a fast-forward merge.** From a clean tree: `git fetch origin
  main`, `git checkout main && git pull --ff-only origin main`, then `git
  merge --ff-only <working-branch>` and `git push origin main`. This only
  works when `main` hasn't diverged from the working branch's own history
  (i.e. nobody's pushed something to `main` that the branch doesn't already
  contain) — check with `git merge-base origin/main <branch>` first; if the
  merge-base isn't `origin/main`'s own HEAD, `main` has diverged and needs
  a real merge (and possibly conflict resolution) instead.
- **Run the full suite against what's about to become `main`'s tip before
  pushing**, not just whatever subset touches the newest change — a
  fast-forward carries everything on the branch, including older work that
  may not have been re-verified together as a whole.
- **Tag right after the push**, per `VERSIONING.md`'s existing convention
  — this isn't optional busywork, it's what makes the next drift check
  fast (`git log <last tag>..<branch> --oneline | wc -l` instead of having
  to re-derive a merge-base by hand).
- **Check for drift at the start of every session**, not just when a bug
  report prompts suspicion (see step 0 above) — an idle branch accumulating
  unmerged work is the failure mode, so catch it while it's still small.

## Versioning, CI, and rollback

See `VERSIONING.md` for the full policy — semver tag cadence, what
`.github/workflows/ci.yml` actually checks (and deliberately doesn't),
and the rollback plan. The one thing worth knowing before reading that
file: the frontend (git/Pages) and backend (Apps Script) roll back
completely differently, and mixing up which one you're rolling back is
the main way a rollback makes things worse instead of better.
