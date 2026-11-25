# Pinned Versions Registry (`Aegis-CI` + `AgentSentinel` + `Aegis Forge`)

Recorded: 2026-11-25 (`docs/MASTER_PLAN.md` Section 9 & Section 10 Rule 3).

## Python Control Plane (`.venv`, Python 3.13.7 / `requires-python = ">=3.11"`)

| Package | Pinned Version | Notes |
|---|---|---|
| `agentsentinel` | `0.1.0` | Editable kernel from `C:\Users\tamil\Downloads\agentsenitnel\agent_sentinel` |
| `mcp` | `2.3.0` | Official MCP Python SDK v2 (`from mcp.server import MCPServer`) |
| `fastapi` | `0.165.0` | Webhook HTTP ingress |
| `starlette` | `1.10.0` | Bundled ASGI core |
| `uvicorn` | `0.54.0` | ASGI server |
| `httpx` | `0.28.1` | GitHub REST & OpenAI-compatible async/sync client |
| `pydantic` | `2.14.4` | Frozen domain & strict JSON schema validation |
| `PyJWT` | `2.15.1` | GitHub App RS256 JWT minting |
| `cryptography` | `50.0.2` | RSA/Ed25519 cryptographic primitives |
| `PyYAML` | `6.0.4` | Policy gate YAML configuration |
| `anyio` | `4.16.0` | Async I/O compatibility |
| `pytest` | `8.4.2` | Test runner |
| `pytest-cov` | `5.0.0` | Coverage reporting |
| `mypy` | `1.20.2` | Strict static type checking (`--strict`) |
| `ruff` | `0.17.1` | Fast linter & security rules (`S`, `ANN`, `PTH`) |
| `types-PyYAML` | `6.0.12.20261122` | Mypy stubs for PyYAML |

## External Protocol & API Pins

- **GitHub REST API Header:** `X-GitHub-Api-Version: 2026-03-10`
- **GitHub Webhook Auth:** `X-Hub-Signature-256` (HMAC-SHA256 raw bytes, constant-time compare)
- **Container Kernel Image (AgentSentinel):** `agentsentinel-runner:py311` (`python:3.11`)

## Node.js Web Control Plane (`package.json`)

- **Node.js:** `>=20.0.0` (CI matrix Node 20 & Node 22)
- **Next.js:** `16.4.3` | **React:** `19.3.1` | **TypeScript:** `5.9.3` | **ESLint:** `9.39.4`
