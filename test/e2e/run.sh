#!/bin/bash
# End-to-end suite: the real pages against local Firebase emulators
# (Auth, Firestore + Storage with this repo's real rules, the Cloud
# Functions in emulator mode -- no AI calls), every production Google /
# Firebase host blocked in the browser. Never touches the live campaign.
#
#   test/e2e/run.sh                 # every scenario, Chromium
#   test/e2e/run.sh webkit          # same on WebKit (Safari's engine)
#   E2E_ONLY=s01,s05 test/e2e/run.sh
#   E2E_REPLAY=path/to/snapshot.json test/e2e/run.sh   # old-data replay
#
# Tools (firebase-tools, the Firebase web SDK, pdf-lib, JSZip) are
# installed once into $DG_E2E_TOOLS (default ~/.cache/dg-e2e). Needs Java
# for the Firestore emulator. Results: test/e2e/out/ (report.md, shots/).
set -u
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
TOOLS="${DG_E2E_TOOLS:-$HOME/.cache/dg-e2e}"
OUT="$REPO/test/e2e/out"
ENGINE="${1:-chromium}"
mkdir -p "$TOOLS" "$OUT"
if [ ! -x "$TOOLS/node_modules/.bin/firebase" ] || [ ! -d "$TOOLS/node_modules/firebase" ]; then
  echo "installing e2e tools into $TOOLS"
  (cd "$TOOLS" && npm install --no-audit --no-fund firebase-tools@13 firebase@12.18.0 pdf-lib@1.17.1 jszip@3.10.1 >/dev/null) || exit 2
fi
FB="$TOOLS/node_modules/.bin/firebase"

PROJ="$(mktemp -d)"
cp "$REPO/firestore.rules" "$REPO/storage.rules" "$REPO/firestore.indexes.json" "$PROJ/"
mkdir -p "$PROJ/functions"
cp "$REPO"/functions/*.js "$REPO/functions/package.json" "$PROJ/functions/"
ln -s "$REPO/functions/node_modules" "$PROJ/functions/node_modules"
printf 'HANDLER_PASSWORD=testpw\nANTHROPIC_API_KEY=e2e\nGEMINI_API_KEY=e2e\n' > "$PROJ/functions/.secret.local"
cat > "$PROJ/firebase.json" <<JSON
{ "firestore": { "rules": "firestore.rules", "indexes": "firestore.indexes.json" },
  "storage": { "rules": "storage.rules" },
  "functions": [{ "source": "functions", "codebase": "default" }],
  "emulators": { "auth": { "host": "127.0.0.1", "port": 9099 }, "functions": { "host": "127.0.0.1", "port": 5001 },
                 "firestore": { "host": "127.0.0.1", "port": 8080 }, "storage": { "host": "127.0.0.1", "port": 9199 },
                 "hub": { "host": "127.0.0.1", "port": 4400 }, "logging": { "host": "127.0.0.1", "port": 4500 },
                 "ui": { "enabled": false }, "singleProjectMode": true } }
JSON
(cd "$PROJ" && "$FB" emulators:start --project dg-app-b3447 --only auth,functions,firestore,storage > "$OUT/emulators.log" 2>&1) &
EMU=$!
# The returning-device scenario serves the last release (origin/main)
# first, then this checkout: serve.py re-reads its root from this file.
OLD_ROOT="$(mktemp -d)"
git -C "$REPO" archive "${E2E_OLD_REF:-origin/main}" | tar -x -C "$OLD_ROOT" 2>/dev/null || echo "note: no ${E2E_OLD_REF:-origin/main} to serve as the old build"
ROOT_FILE="$(mktemp)"; echo "$REPO" > "$ROOT_FILE"
E2E_ROOT_FILE="$ROOT_FILE" python3 "$REPO/test/e2e/serve.py" 8952 &
SRV=$!
cleanup() { kill $SRV 2>/dev/null; pkill -P $EMU 2>/dev/null; kill $EMU 2>/dev/null; sleep 1; pkill -f "cloud-firestore-emul[a]tor" 2>/dev/null; rm -rf "$PROJ" "$OLD_ROOT" "$ROOT_FILE"; }
trap cleanup EXIT
for i in $(seq 1 120); do grep -q "All emulators ready" "$OUT/emulators.log" && break; sleep 1; done
if ! grep -q "All emulators ready" "$OUT/emulators.log"; then echo "emulators did not start; see $OUT/emulators.log"; tail -20 "$OUT/emulators.log"; exit 2; fi
cd "$REPO" && E2E_TOOLS="$TOOLS" E2E_ENGINE="$ENGINE" E2E_OLD_ROOT="$OLD_ROOT" E2E_ROOT_FILE="$ROOT_FILE" python3 "$REPO/test/e2e/e2e.py"
RC=$?
cleanup
trap - EXIT
exit $RC
