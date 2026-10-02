/* Real-shaped CI logs used as presets on /analyze and as analyser fixtures. */

export const SAMPLE_LOGS: { key: string; label: string; log: string }[] = [
  {
    key: "ts",
    label: "TypeScript · renamed export",
    log: `2026-03-04T11:20:01.0000000Z ##[group]Run pnpm --filter @acme/gateway typecheck
2026-03-04T11:20:01.0000000Z pnpm --filter @acme/gateway typecheck
2026-03-04T11:20:01.0000000Z shell: /usr/bin/bash -e {0}
2026-03-04T11:20:01.0000000Z ##[endgroup]
2026-03-04T11:20:04.1000000Z > @acme/gateway@2.4.1 typecheck /home/runner/work/acme/acme/services/gateway
2026-03-04T11:20:04.1000000Z > tsc --noEmit
2026-03-04T11:20:09.2000000Z src/serialize.ts(3,10): error TS2305: Module '"./types"' has no exported member 'OrderState'.
2026-03-04T11:20:09.2000000Z src/serialize.ts(21,31): error TS2339: Property 'state' does not exist on type 'DraftOrder'.
2026-03-04T11:20:09.2000000Z src/http.ts(88,14): error TS2345: Argument of type 'unknown' is not assignable to parameter of type 'DraftOrder'.
2026-03-04T11:20:09.3000000Z  ELIFECYCLE  Command failed with exit code 2.
2026-03-04T11:20:09.3000000Z ##[error]Process completed with exit code 2.`,
  },
  {
    key: "py",
    label: "Python · pydantic v2 upgrade",
    log: `##[group]Run uv run pytest tests/unit -x -q
uv run pytest tests/unit -x -q
##[endgroup]
==================================== ERRORS ====================================
________________ ERROR collecting tests/unit/test_settings.py _________________
tests/unit/test_settings.py:3: in <module>
    from ledger.settings import Settings
  File "/home/runner/work/ledger/ledger/src/ledger/settings.py", line 4, in <module>
    from pydantic import BaseSettings
  File "/home/runner/work/ledger/ledger/.venv/lib/python3.12/site-packages/pydantic/__init__.py", line 402, in __getattr__
    return _getattr_migration(attr_name)
E   ImportError: \`BaseSettings\` has been moved to the \`pydantic-settings\` package. See https://docs.pydantic.dev/2.9/migration/#basesettings-has-moved-to-pydantic-settings for more details.
=========================== short test summary info ============================
ERROR tests/unit/test_settings.py - pydantic.errors.PydanticImportError
!!!!!!!!!!!!!!!!!!!!!!!!!! Interrupted: 1 error during collection !!!!!!!!!!!!!!!!!!!!!!!!!!!
##[error]Process completed with exit code 2.`,
  },
  {
    key: "jest",
    label: "Jest · deterministic assertion",
    log: `##[group]Run npm test -- checkout.spec.ts
npm test -- checkout.spec.ts
##[endgroup]
> pricing@1.8.0 test
> jest checkout.spec.ts

 FAIL  src/checkout.spec.ts
  ● checkout › applies discount before tax normalisation

    expect(received).toBe(expected) // Object.is equality

    Expected: 201
    Received: 409

      42 |     const res = await checkout(order);
    > 43 |     expect(res.status).toBe(201);
         |                        ^
      44 |   });

      at Object.<anonymous> (src/checkout.spec.ts:43:24)
      at applyTax (src/pricing/tax.ts:17:11)

Tests:       1 failed, 146 passed, 147 total
##[error]Process completed with exit code 1.`,
  },
  {
    key: "go",
    label: "Go · signature change",
    log: `##[group]Run go test ./...
go test ./...
##[endgroup]
# github.com/acme/edge/internal/router [github.com/acme/edge/internal/router.test]
internal/router/router_test.go:22:18: not enough arguments in call to NewRouter
	have (Config)
	want (context.Context, Config)
internal/router/harness_test.go:14:9: not enough arguments in call to NewRouter
	have (Config)
	want (context.Context, Config)
FAIL	github.com/acme/edge/internal/router [build failed]
##[error]Process completed with exit code 1.`,
  },
  {
    key: "rust",
    label: "Rust · moved module",
    log: `##[group]Run cargo test -p edge-router
cargo test -p edge-router
##[endgroup]
   Compiling edge-router v0.9.2 (/home/runner/work/edge/edge/crates/edge-router)
error[E0432]: unresolved import \`crate::retry::BackoffPolicy\`
 --> crates/edge-router/src/client.rs:7:5
  |
7 | use crate::retry::BackoffPolicy;
  |     ^^^^^^^^^^^^^^^^^^^^^^^^^^^ no \`BackoffPolicy\` in \`retry\`
  |
help: consider importing this struct instead
  |
7 | use crate::retry::policy::BackoffPolicy;
error: could not compile \`edge-router\` (lib) due to 1 previous error
##[error]Process completed with exit code 101.`,
  },
  {
    key: "flaky",
    label: "Flaky · port collision",
    log: `##[group]Run npm run test:integration
npm run test:integration
##[endgroup]
  ● api › health responds

    Error: listen EADDRINUSE: address already in use 127.0.0.1:54321

      at Server.setupListenHandle [as _listen2] (node:net:1872:16)

  ● api › rejects stale token

    thrown: "Exceeded timeout of 5000 ms for a test."
##[error]Process completed with exit code 1.`,
  },
];
