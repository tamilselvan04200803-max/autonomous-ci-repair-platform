# Aegis-CI Claims Registry

Every quantitative or security claim published in `README.md` or documentation must map to a checked-in artifact and a reproducible command below.

| Claim ID | Statement | Artifact / Source | Verification Command | Status |
|---|---|---|---|---|
| `C1` | Event log detects any 1-byte tampering via SHA-256 hash chain | `aegis/ledger/store.py` | `.\.venv\Scripts\python.exe -B -m pytest tests/unit/test_a1_domain_and_chain.py` | Verified (6/6 tests pass incl. contract) |
| `C2` | GitHub `/webhook` verifies HMAC-SHA256 on raw bytes before parsing and rejects invalid/fork/loop events | `aegis/ingest/webhook.py` | `.\.venv\Scripts\python.exe -B -m pytest tests/unit/test_a2_ingest_and_github.py` | Verified (passed with contract tests) |
| `C3` | Deterministic triage classifies pytest/ruff/mypy/pip across >=60 real-format logs with unknown -> `UNCLASSIFIED` | `aegis/triage/parsers.py`, `tests/fixtures/triage_corpus/` | `.\.venv\Scripts\python.exe -B -m pytest tests/unit/test_a3_triage_and_redactor.py` | Verified (68 corpus logs + flake + redactor pass) |
| `C4` | Two-phase sandbox enforces `--network=none`, `--read-only`, `--cap-drop=ALL`, non-root `65534:65534`, tar-stream delivery | `aegis/sandbox/runner.py`, `aegis/sandbox/tar_stream.py` | `.\.venv\Scripts\python.exe -B -m pytest tests/unit/test_a4_sandbox.py` | Pending (A4) |
| `C5` | Read-only MCP v2 server exposes zero write tools; B2 vs B1 localization judged by Section 7.5 pre-registered rule | `aegis/mcp/server.py`, `docs/measurements/localization_experiment.json` | `.\.venv\Scripts\python.exe -B -m pytest tests/unit/test_a5_graph_and_mcp.py` | Pending (A5) |
| `C6` | Bounded repair governor never exceeds case/minute/daily caps and replay reproduces identical patch hashes | `aegis/repair/governor.py`, `aegis/repair/cassettes.py` | `.\.venv\Scripts\python.exe -B -m pytest tests/unit/test_a6_repair_loop.py` | Pending (A6) |
| `C7` | Policy Gate `P1..P8` passes >=2 allow & >=2 deny fixtures per rule and blocks test-weakening / dangerous AST | `aegis/policy/gate.py`, `config/policy.yaml` | `.\.venv\Scripts\python.exe -B -m pytest tests/unit/test_a7_policy_gate.py` | Pending (A7) |
| `C8` | Write-token wrapper rejects any ref outside `refs/heads/aegis/*`; replay creates zero duplicate PRs | `aegis/delivery/deliverer.py` | `.\.venv\Scripts\python.exe -B -m pytest tests/unit/test_a8_deliverer_and_e2e.py` | Pending (A8) |
| `C9` | Tier A (>=40 cases) and Adversarial suite (>=12 cases) achieve 0% gated attack success rate in deterministic replay | `benchmarks/results/tier_a_replay.json` | `.\.venv\Scripts\python.exe -B -m aegis.bench.runner --replay` | Pending (A9) |
