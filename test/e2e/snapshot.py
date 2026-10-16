"""Download a read-only snapshot of the live campaign's public-read
collections (characters, briefs, cells, operations) for the e2e suite's
old-data replay (scenario s13). Only reads -- nothing is ever written to
the live project. The snapshot holds real players' data: keep it out of
the repo (default path is outside it).

    python3 test/e2e/snapshot.py [out.json]
    E2E_REPLAY=out.json test/e2e/run.sh"""
import json, os, sys, urllib.request

LIVE = "https://firestore.googleapis.com/v1/projects/dg-app-b3447/databases/(default)/documents"
COLLS = ["characters", "briefs", "cells", "operations"]
out = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/.cache/dg-e2e/live-snapshot.json")
snap = {}
for c in COLLS:
    docs, tok = [], ""
    while True:
        url = f"{LIVE}/{c}?pageSize=300" + (f"&pageToken={tok}" if tok else "")
        d = json.loads(urllib.request.urlopen(url, timeout=30).read())
        docs += [{"id": x["name"].split("/")[-1], "fields": x.get("fields", {})} for x in d.get("documents", [])]
        tok = d.get("nextPageToken")
        if not tok:
            break
    snap[c] = docs
    print(f"{c}: {len(docs)}")
os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
json.dump(snap, open(out, "w"))
print("written", out)
