# End-to-end suite (`test/e2e/`)

The unit suite (`test/run_tests.py`) fakes Firestore inside each page, so
it can't see the real security rules, two devices saving at once, or the
old data real players have. This suite runs the **real pages** against
**local Firebase emulators**: Auth, Firestore and Storage with this
repo's real `firestore.rules` / `storage.rules`, and the real Cloud
Functions in their emulator mode (no AI calls). Several browsers act as
the Handler and players at the same time. Every production Google /
Firebase host is blocked in the browser, so it **never touches the live
campaign**.

```
test/e2e/run.sh            # every scenario, Chromium
E2E_ONLY=s04,s07 test/e2e/run.sh
python3 test/e2e/snapshot.py ~/.cache/dg-e2e/live.json   # read-only copy of the live Agents
E2E_REPLAY=~/.cache/dg-e2e/live.json test/e2e/run.sh     # ...replayed in s14
```

Needs Java (Firestore emulator) and Node. The first run installs
firebase-tools, the Firebase web SDK, pdf-lib and JSZip into
`$DG_E2E_TOOLS` (default `~/.cache/dg-e2e`). Results go to
`test/e2e/out/` (`report.md`, `report.json`, screenshots of failures);
it's git-ignored. The live snapshot holds real players' data: keep it
out of the repo (the default path is outside it).

## What runs after every scenario

- no page error, and no native `alert()`/`confirm()` (dead in an iOS
  home-screen app);
- no request to a production host;
- no `NaN`, `undefined`, `[object Object]` or `Infinity` on screen;
- no Firestore/Storage rule refusing a request;
- every character saved in the scenario is valid JSON with HP/WP/SAN
  within their maximums.

## Scenarios

| | |
|---|---|
| s01 | A new player on a phone builds an Agent with New Recruit and signs the Contract |
| s02 | The Handler signs in, makes a Cell, adds Agents; an open player page follows live |
| s03 | In play: SAN to 0 (INSANE), HP to 0 (KIA), Edit with the Oath's N and Y |
| s04 | One Agent open on two devices at once: both devices' changes count |
| s05 | The connection drops mid-play; the change saves when it's back |
| s06 | Evidence restricted to one Agent: the other can't see it, and the rules refuse a direct read |
| s07 | The Handler deletes an Agent their player has open; the page doesn't bring it back; restore |
| s08 | Every import format (Kappa Black, xlsx, a DD Form 315 the notebook exported) saved for real |
| s09 | Old `stats/` bookmarks forward to Agent Hub; other missing pages show the not-found page |
| s10 | Private mode: storage throws on every call |
| s11 | iPhone home-screen app: Cancel an edit and Discard a draft without native dialogs |
| s12 | A returning device with the previous release (`origin/main`) cached by the service worker |
| s13 | A roll lands in the Cell's feed and on the Handler's Live Rolls |
| s14 | Old-data replay: every live Agent on the Agent File, in A-Cell, and through the PDF export |

## Not covered yet

- **WebKit.** Playwright's WebKit build isn't installed in this
  environment; WebKitGTK and its WebDriver are, and can be driven
  through a proxy instead of Playwright's routing (the next step).
- Random-walk "monkey" testing with the same checks after every tap.
