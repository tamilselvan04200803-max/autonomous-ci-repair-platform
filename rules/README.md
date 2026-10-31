# Aegis Rules: Structural AST & Policy Guardrails

Aegis Rules is a modular library of structural syntax rules (`ast-grep`), semantic queries (`Semgrep`), and static policies used by Aegis Forge to reject invalid, evasive, or test-weakening patch candidates before they ever reach an execution sandbox.

---

## Core Invariants Enforced

1. **No Test Deletion**: Candidates must never delete existing assertions, test cases, or test files to fake a passing CI build.
2. **No Assertion Weakening**: Replacing strict equality (`toBe`, `strictEqual`) with loose truthy checks (`toBeDefined`, `truthy`) is immediately denied.
3. **No Hardcoded Fixture Escapes**: Modifying production code to return hardcoded values matching test expectations without addressing the underlying logic.
4. **No Unauthorized Network Egress**: Candidates must never insert telemetry calls, HTTP requests (`fetch`, `curl`, `axios`), or external sockets.

---

## Directory Layout

```
rules/
├── ast-grep/                   # Tree-sitter AST structural pattern rules
│   ├── no-test-deletion.yml    # Rejects removal of it(), test(), def test_*
│   └── no-hardcoded-fixtures.yml # Flags synthetic fixture returns
├── semgrep/                    # Semgrep semantic search and taint rules
│   └── no-weakened-assertions.yml # Flags assertion downgrades and loose checks
└── README.md                   # Rules documentation and integration guide
```

---

## Usage with Ast-Grep and Semgrep

### Run with `ast-grep`
```bash
# Scan a candidate patch workspace
ast-grep scan --config rules/ast-grep/
```

### Run with `semgrep`
```bash
# Run policy verification across candidate diffs
semgrep --config rules/semgrep/ src/ tests/
```
