# Versioning, CI, and Rollback

How releases are marked, what CI actually checks, and — the part that
matters most under pressure — how to undo a bad change on each of this
app's two independently-deployed halves. Read this before cutting a tag
or trying to roll anything back; it assumes you've already read
`CLAUDE.md`.

---

## 1. Why two version numbers already existed before this file did

Before any of this, the codebase already had two ad hoc counters:

- `backend/Code.gs`'s own header comment (`// Google Apps Script backend
  v82 — ...`), bumped by convention whenever the backend changes in a way
  worth tracking.
- `sw.js`'s `CACHE_NAME` (`dg-hub-shell-v65`), bumped on every
  `SHELL_FILES`-listed change so returning visitors don't get stuck on
  stale JS.

Neither of those is a *release* marker — they're deployment-unit
counters for two things that version independently of each other and of
the repo as a whole (the backend redeploys on its own schedule, the
shell cache bumps on every relevant frontend commit). The git tags this
file introduces are a third, higher-level number: which commit was
actually live on `main` at a point in time, cross-referencing what the
other two counters read at that same point. All three keep existing
side by side — nothing here replaces `Code.gs`'s version comment or
`CACHE_NAME`.

## 2. Semantic version tags

Format: `vMAJOR.MINOR.PATCH`, as annotated git tags on `main` (never on
`firebase-migration` or a session branch — `main` is the only branch
GitHub Pages actually serves, so it's the only one a version tag means
anything for).

- **PATCH** — a bug fix, performance fix, or doc correction with no new
  user-facing capability. (E.g. this session's Firestore-before-Sheets
  write-latency fix would have been a patch bump.)
- **MINOR** — a new feature or capability, backward compatible. (E.g.
  the Loop toggle, the mixed auto-advance playlist, the broadcast-wide
  mix sliders.)
- **MAJOR** — reserved for a genuinely breaking change: an old client
  (a cached PWA install, a stale tab) would behave wrong or lose data
  against a new backend, or a schema migration retires an old shape
  with no compatibility path. The eventual full Firebase cutover
  (Sheets stops being the write path of record) is the kind of thing
  that would earn a major bump when it happens. Ordinary feature work
  doesn't.

**v1.0.0** marks the current `main` HEAD as of 2026-09-06 — a
deliberate starting line, not a reconstruction of the 260 commits
before it. Don't backfill v0.x tags onto old commits; it's not worth
the archaeology and there's no consumer depending on that history being
versioned.

### When to cut a tag

Tag `main` right after (not before) a push to it — that's already the
point in this repo's existing "cutover" workflow where a change is
confirmed working and promoted from `firebase-migration`/a session
branch onto the live branch. Concretely:

```bash
git checkout main && git pull --ff-only origin main
git tag -a vX.Y.Z -m "$(cat <<'EOF'
One-line summary of what shipped.

Backend: vNN (redeployed: yes/no)
Shell cache: dg-hub-shell-vNN
EOF
)"
git push origin vX.Y.Z
```

The tag message's "Backend redeployed: yes/no" line matters — a git tag
only proves what code *would* be live if the backend had been
redeployed to match. If a `backend/Code.gs` change hasn't been
paste-and-deployed into Apps Script yet (see `CLAUDE.md`), say so in
the tag message, so a future rollback doesn't assume the backend and
the tag agree when they don't.

## 3. CI (`.github/workflows/ci.yml`)

Runs on every push to `main` and `firebase-migration` only — not
`claude/new-session-*` or other short-lived branches, which get
validated indirectly once their work lands on one of these two via the
existing cutover-merge pattern. Two jobs:

1. **Shell-cache discipline** (`scripts/check-shell-cache-bump.js`) —
   hard-fails the push if any `SHELL_FILES`-listed file changed without
   `sw.js`'s `CACHE_NAME` also changing in the same push. This is the
   exact bug class `sw.js`'s own header comment documents already
   happening for real (the Aug 27 `stats/dice-roller.js` move breaking
   every install for over a week) — now enforced instead of only
   remembered.
2. **QA harness** (`test/run_tests.py`) — the existing 550+-check
   Playwright suite, run headless against a local static server. Fails
   the push on any non-zero exit.

**Deliberately not checked:** whether `backend/Code.gs`'s own version
comment was bumped, and whether Apps Script was actually redeployed.
Both are judgment calls (not every `Code.gs` diff deserves a version
bump; redeploy is an out-of-band manual step CI has no way to observe)
that would produce false-positive noise if auto-enforced. They stay a
human/session discipline (§1 of `CLAUDE.md`), not a CI gate.

**No branch protection is configured to block on this** (yet) — the
existing workflow pushes directly to `main` without PRs, and requiring
status checks to pass would need that to change first. CI here reports;
it doesn't currently gate. Revisit if the direct-push workflow ever
changes to a PR-based one.

## 4. Rollback plan

This app has **two independently-deployed halves that roll back
differently** — the frontend (static site) and the backend (Apps
Script). Rolling back one does *not* roll back the other. Mixing this
up is the single most likely way a rollback attempt makes things worse
instead of better.

### 4a. Frontend (the static site GitHub Pages serves from `main`)

Pages serves directly from `main`'s root with no build step, so
"rollback" is just git:

1. Find the last good tag (`git tag -l` or check `git log --oneline` on
   `main` for the last commit before the regression).
2. Prefer `git revert` of the specific bad commit(s) over resetting
   `main` backward — keeps history linear-forward and doesn't require a
   force-push (this repo's own git-safety rules already avoid
   `reset --hard`/force-push except by explicit request).
3. If the regression spans many commits and a revert would conflict
   badly, checking out the old tag's tree and committing it forward is
   the fallback: `git checkout vX.Y.Z -- . && git commit -m "Roll back to vX.Y.Z"`.
   Still a forward commit, not a rewrite of history.
4. Push to `main`. Pages redeploys automatically within about a minute
   — no separate deploy step exists to trigger.

**Critical: bump `CACHE_NAME` forward, never backward, even when
rolling back.** If the rollback restores older file contents, it still
needs a *new*, higher `CACHE_NAME` value than whatever was live right
before the rollback — reusing an old value risks a returning visitor's
service worker treating it as "already cached, nothing to do" and
serving whatever it happened to have from before, which may not even be
the version the rollback intended. The rule is about the *value going
forward*, not about matching what a given commit "originally" had.

### 4b. Backend (Google Apps Script + Sheets)

`backend/Code.gs` in this repo is a **mirror only** — git has never
been the deploy path for it, so a frontend-style git revert changes
nothing live. Two ways to actually roll back the backend, in order of
preference:

1. **Apps Script's own deployment history (fastest, preferred).** Every
   "New Version" created via Deploy → Manage Deployments is kept,
   immutable, and re-selectable — it's already a version history that
   predates and doesn't depend on this file. To roll back: Apps Script
   editor → Deploy → Manage Deployments → Edit the active (Head)
   deployment → pick an earlier Version number from the dropdown →
   Deploy. This reverts the live backend in under a minute, with no
   copy-pasting, and works even if the git tag/commit that matches that
   version has been lost track of.
2. **Re-paste an old git-tagged `Code.gs` (fallback).** Only needed if
   Apps Script's own version history has been pruned past the point you
   need, or Script Properties changed in a way that makes an old
   deployment version incompatible on its own. Check out the target
   tag, copy `backend/Code.gs`'s contents, paste into the Apps Script
   editor, and — per the standing rule in `CLAUDE.md` — create a **new
   deployment version** (saving alone does not redeploy).

Either way, a backend rollback is a manual action a human takes in the
Apps Script editor. Nothing in this repo's CI or git history can do it
automatically, and no amount of `git revert` on `main` touches it.

### 4c. When frontend and backend disagree

A rolled-back frontend talking to a NOT-rolled-back backend (or vice
versa) is the actual dangerous state — e.g. a rolled-back
`a-cell.html` sending an old action shape to a backend that only
understands the new one, or the reverse. Before considering a rollback
finished, check both halves are actually at versions meant to talk to
each other (the tag message's "Backend: vNN (redeployed: yes/no)" line
from §2 is what makes this checkable after the fact).
