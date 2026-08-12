# Manila folder hover tabs — abandoned

**Branch:** this one (`design-graveyard/manila-folder-tabs`), forked from
`claude/delta-green-agent-hub-sn79d4` at the point it was dropped.
**Status:** abandoned, never merged to `main`. `main` was never touched by
any of this work.

## What was attempted

Real manila-folder photo texture + a hover-lift animation for the
`.tw`/`.tab-strip`/`.folder-body` tab system shared by `agent-hub.html`,
`a-cell.html`, `dg-agent-portal.html`, and `index.html`.

Went through several mockup rounds (published as a Claude Artifact,
"Case File Motion") before landing on a confirmed direction: a fanned
stack of individually rounded, notch-shaped folder tabs over a photo
manila texture, each tab's shape computed at runtime via
`clip-path: path(...)` from measured pixel positions (`assets/folder-tabs.js`),
so the count/width of tabs (real Agent roster data) and the folder's
fluid width didn't have to be known at author time.

It shipped to this branch, passed the full Chromium/Playwright regression
suite, and looked correct in every screenshot taken during development.

## Why it was dropped

On a real iPhone (Safari), it broke badly: sharp corners instead of
rounded, oversized/barely-visible tabs, tabs growing in width mid-
interaction. None of this reproduced in Chromium testing.

Leading diagnosis (never confirmed against real WebKit — no Safari/iOS
browser was available in the dev environment to verify against): a known
WebKit bug where `clip-path` and `filter` fight when applied to the same
element, which the tab-shading relied on for the active/inactive/hover
dimming effect.

A follow-up attempt replaced the whole clip-path system with a simpler,
JS-free design (shared background painted once behind a transparent
tab-strip/body, plain rounded-rect tabs, dimming via an overlay instead
of `filter`) specifically to avoid every risky property combination the
first version used. This was also never verified on a real device before
the whole effort was dropped in favor of just reverting to `main`.

## What's here

The two commits from `claude/delta-green-agent-hub-sn79d4` that built and
then tried to fix this system, preserved as history on this branch for
reference if the idea gets revisited with a way to actually test on real
Safari/iOS. The working feature branch has been reset back to `main`.

Mockup artifact (published during design, may or may not still be live):
`https://claude.ai/code/artifact/ac33c192-950a-4985-a7f0-5eefd91e6d0a`
