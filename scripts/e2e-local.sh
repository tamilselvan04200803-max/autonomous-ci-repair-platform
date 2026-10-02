#!/usr/bin/env bash
# Full local loop: real buggy repo → run → candidates → real runner → upstream → signed bundle → offline verify.
# Requires: a running control plane started with FORGE_RUNNER_SECRET, plus git, node, psql, curl.
#   FORGE_RUNNER_SECRET=dev-runner npm run dev        (in another terminal)
#   AEGIS_RUNNER_SECRET=dev-runner ./scripts/e2e-local.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
URL="${AEGIS_URL:-http://localhost:3000}"
SECRET="${AEGIS_RUNNER_SECRET:-dev-runner}"
DB="${DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:5432/app_db}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

say "1. A repository with a real bug"
git init -q --bare -b main "$WORK/remote.git"
mkdir -p "$WORK/src/src" "$WORK/src/test" && cd "$WORK/src"
git init -q -b main && git config user.email dev@example.com && git config user.name dev
printf 'export function add(a, b) {\n  return a - b;\n}\n' > src/math.mjs
printf 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { add } from "../src/math.mjs";\ntest("add", () => {\n  assert.equal(add(2, 2), 4);\n});\n' > test/math.test.mjs
git add -A && git commit -qm "feat: math" && git remote add origin "$WORK/remote.git" && git push -q origin main
SHA="$(git rev-parse HEAD)"
LOG="$(node --test test/math.test.mjs 2>&1 || true)"
FULL="$(printf '##[group]Run node --test test/math.test.mjs\nnode --test test/math.test.mjs\n##[endgroup]\n%s\n##[error]Process completed with exit code 1.\n' "$LOG")"

say "2. Open a repair run (twice — the second must deduplicate)"
REQ="$(node -e 'console.log(JSON.stringify({log:process.argv[1],repo:"local/e2e-"+Date.now(),commitSha:process.argv[2],workflow:"ci"}))' "$FULL" "$SHA")"
AUTH=(); [ -n "${FORGE_ADMIN_TOKEN:-}" ] && AUTH=(-H "authorization: Bearer $FORGE_ADMIN_TOKEN")
RES="$(curl -fsS -X POST "$URL/api/runs" "${AUTH[@]}" -H 'content-type: application/json' -d "$REQ")"; echo "$RES"
curl -fsS -X POST "$URL/api/runs" "${AUTH[@]}" -H 'content-type: application/json' -d "$REQ"; echo
RID="$(node -e 'console.log(JSON.parse(process.argv[1]).id)' "$RES")"

say "3. Two candidate patches (standing in for model output) — B has a vacuous test"
PATCH=$'--- a/src/math.mjs\n+++ b/src/math.mjs\n@@ -1,3 +1,3 @@\n export function add(a, b) {\n-  return a - b;\n+  return a + b;\n }\n'
TEST=$'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { add } from "../src/math.mjs";\ntest("add sums", () => { assert.equal(add(1, 2), 3); });\n'
psql -q "$DB" -v rid="$RID" -v patch="$PATCH" -v test="$TEST" <<'SQL'
INSERT INTO patch_candidates (run_id,label,approach,files_changed,insertions,deletions,risk_score,tests_passed,tests_total,status,note,patch,test_path,test_content,test_command) VALUES
 (:'rid','Candidate A','fix operator in add()',1,1,1,0.10,0,0,'proposed','', :'patch','test/regression.test.mjs', :'test','node --test test/regression.test.mjs'),
 (:'rid','Candidate B','vacuous test',1,1,1,0.05,0,0,'proposed','', :'patch','test/vacuous.test.mjs','import {test} from "node:test"; test("ok",()=>{});','node --test test/vacuous.test.mjs');
SQL

say "4. The real runner, in a fresh clone"
git clone -q "$WORK/remote.git" "$WORK/ci" && cd "$WORK/ci"
AEGIS_URL="$URL" AEGIS_RUNNER_SECRET="$SECRET" AEGIS_RUN_ID="$RID" AEGIS_EXTRA_CHECKS="node --check src/math.mjs" \
  node "$ROOT/runner/aegis.mjs" verify | grep -v '^\[aegis\] \$ git'

say "5. Upstream CI verdict → certification"
curl -fsS -X POST "$URL/api/runs/$RID/upstream" "${AUTH[@]}" -H 'content-type: application/json' -d '{"conclusion":"success"}'; echo

say "6. Download and verify the signed bundle offline"
curl -fsS "$URL/api/runs/$RID/bundle" -o "$WORK/bundle.json"
curl -fsS "$URL/api/keys?format=pem" -o "$WORK/key.pem"
node "$ROOT/runner/aegis.mjs" verify-bundle "$WORK/bundle.json" --key "$WORK/key.pem"

say "7. Tamper with the patch inside the bundle — must fail"
node -e 'const f=require("fs"),p=process.argv[1];const e=JSON.parse(f.readFileSync(p));const s=JSON.parse(Buffer.from(e.payload,"base64"));s.predicate.bundle.patch=String(s.predicate.bundle.patch).replace("a + b","a * b");e.payload=Buffer.from(JSON.stringify(s)).toString("base64");f.writeFileSync(p+".t",JSON.stringify(e))' "$WORK/bundle.json"
if node "$ROOT/runner/aegis.mjs" verify-bundle "$WORK/bundle.json.t" --key "$WORK/key.pem"; then echo "UNEXPECTED: tampered bundle verified"; exit 1; else echo "tampered bundle rejected ✓"; fi

say "Done — open $URL/runs/$RID"
