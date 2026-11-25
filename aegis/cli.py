"""Aegis-CI CLI entry point with subcommands: webhook, run, verify-chain, export, bench, status."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import TYPE_CHECKING

from aegis.domain.models import (
    Diagnosis,
    FailureClass,
    FailureEvent,
)
from aegis.orchestrator.pipeline import Pipeline

if TYPE_CHECKING:
    from collections.abc import Callable


def _build_parser() -> argparse.ArgumentParser:
    """Build the CLI argument parser."""
    parser = argparse.ArgumentParser(
        prog="aegis-ci",
        description="Aegis-CI: Evidence-gated CI repair control plane",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    subparsers = parser.add_subparsers(dest="command", help="Available subcommands")

    # webhook subcommand
    webhook_parser = subparsers.add_parser("webhook", help="Process a GitHub webhook event")
    webhook_parser.add_argument("--repo", required=True, help="Repository string (org/repo)")
    webhook_parser.add_argument("--run-id", required=True, help="Unique run identifier")
    webhook_parser.add_argument("--head-sha", required=True, help="Head commit SHA")
    webhook_parser.add_argument("--delivery-id", required=True, help="GitHub delivery ID")
    webhook_parser.add_argument("--actor", default="github-app", help="Event actor")
    webhook_parser.add_argument("--failure-class", help="Pre-classified failure class")

    # run subcommand
    run_parser = subparsers.add_parser("run", help="Run a full pipeline from a failure event")
    run_parser.add_argument("--repo", required=True, help="Repository string (org/repo)")
    run_parser.add_argument("--run-id", required=True, help="Unique run identifier")
    run_parser.add_argument("--head-sha", required=True, help="Head commit SHA")
    run_parser.add_argument("--failure-event", required=True, help="JSON failure event file path")

    # verify-chain subcommand
    verify_parser = subparsers.add_parser(
        "verify-chain", help="Verify the hash chain of a pipeline run"
    )
    verify_parser.add_argument("--run-id", required=True, help="Run identifier")
    verify_parser.add_argument(
        "--db-path", default=".aegis_checkpoint.db", help="Checkpoint database path"
    )

    # export subcommand
    export_parser = subparsers.add_parser("export", help="Export the evidence bundle for a run")
    export_parser.add_argument("--run-id", required=True, help="Run identifier")
    export_parser.add_argument(
        "--db-path", default=".aegis_checkpoint.db", help="Checkpoint database path"
    )
    export_parser.add_argument(
        "--output", help="Output file path (default: evidence_bundle_<run_id>.json)"
    )

    # bench subcommand
    bench_parser = subparsers.add_parser("bench", help="Run benchmark suite")
    bench_parser.add_argument("--config", help="Benchmark configuration file")
    bench_parser.add_argument(
        "--replay", action="store_true", help="Run in replay mode with cassettes"
    )

    # status subcommand
    status_parser = subparsers.add_parser("status", help="Show pipeline status for a run")
    status_parser.add_argument("--run-id", required=True, help="Run identifier")
    status_parser.add_argument(
        "--db-path", default=".aegis_checkpoint.db", help="Checkpoint database path"
    )

    return parser


def cmd_webhook(args: argparse.Namespace) -> int:
    """Handle the webhook subcommand - process GitHub webhook and start pipeline."""
    # Parse the failure event from the webhook payload
    failure_event = FailureEvent(
        run_id=args.run_id,
        repo=args.repo,
        workflow_run_id=int(args.delivery_id.split("-")[-1]) if "-" in args.delivery_id else 1,
        run_attempt=1,
        head_sha=args.head_sha,
        base_branch="main",
        delivery_id=args.delivery_id,
        actor=args.actor,
        workflow_name="CI",
    )

    # Start the pipeline
    pipeline = Pipeline(repo=args.repo, run_id=args.run_id, head_sha=args.head_sha)
    pipeline.start(failure_event)
    pipeline.fetch()
    pipeline.triage(
        Diagnosis(
            failure_class=FailureClass.F1_TEST_REGRESSION,
            parser="pytest",
            failing_command="pytest",
            error_summary="Webhook triage placeholder",
            confidence=0.85,
        )
    )

    print(f"[webhook] Pipeline started for {args.repo}, run_id={args.run_id}")
    print(f"  State: {pipeline.status()}")

    return 0


def cmd_run(args: argparse.Namespace) -> int:
    """Handle the run subcommand - execute a full pipeline."""
    # Load failure event from file
    failure_event_path = Path(args.failure_event)
    if not failure_event_path.exists():
        print(f"[error] Failure event file not found: {failure_event_path}", file=sys.stderr)
        return 1

    with failure_event_path.open(encoding="utf-8") as f:
        event_data = json.load(f)

    failure_event = FailureEvent(**event_data)

    # Build and run the pipeline
    pipeline = Pipeline(repo=args.repo, run_id=args.run_id, head_sha=args.head_sha)
    pipeline.start(failure_event)
    pipeline.fetch()

    # In a real implementation, we would have actual triage, sandbox, localization, repair
    # For now, we'll gate with the policy config and deliver if allowed
    from aegis.policy.config import load_policy_config
    from aegis.policy.gate import PolicyGate

    policy_config = load_policy_config(
        args.policy_path if hasattr(args, "policy_path") else "config/policy.yaml"
    )
    PolicyGate(policy_config)

    # Create a minimal diagnosis and verification for demo purposes
    diagnosis = Diagnosis(
        failure_class=FailureClass.F1_TEST_REGRESSION,
        parser="pytest",
        failing_command="pytest",
        error_summary="Test regression",
        confidence=0.85,
    )

    # The policy gate needs a patch and verification - for CLI demo we'll just evaluate structure
    # and show the pipeline flow
    pipeline.triage(diagnosis)

    # Check pipeline status
    print(f"[run] Pipeline state: {pipeline.status()}")
    print(f"[run] Event chain head: {pipeline.event_chain_head()}")
    print(f"[run] Chain verified: {pipeline.verify_chain()}")

    return 0


def cmd_verify_chain(args: argparse.Namespace) -> int:
    """Handle the verify-chain subcommand."""
    db_path = Path(args.db_path)
    run_id = args.run_id

    # Read the checkpoint database and verify the chain
    import sqlite3

    conn = sqlite3.connect(str(db_path))
    rows = conn.execute(
        "SELECT seq, prev_hash, hash FROM event_log WHERE run_id = ? ORDER BY seq",
        (run_id,),
    ).fetchall()
    conn.close()

    if not rows:
        print(f"[error] No event log found for run_id={run_id} in {db_path}", file=sys.stderr)
        return 1

    # Verify chain integrity
    chain_valid = True

    for i, (_seq, prev_hash, event_hash) in enumerate(rows):
        if i == 0:
            # First event should have prev_hash = head_sha
            if prev_hash != "genesis":
                chain_valid = False
                print(f"[warn] seq=0 prev_hash unexpected: {prev_hash!r}")
        else:
            prev_seq = rows[i - 1]
            if event_hash != prev_seq[2]:
                chain_valid = False

    if chain_valid:
        print(f"[verify-chain] Chain for run_id={run_id} is VALID")
    else:
        print(f"[verify-chain] Chain for run_id={run_id} has INTEGRITY ISSUES", file=sys.stderr)
        return 1

    print(f"[verify-chain] Total events: {len(rows)}")
    for seq, prev_hash, event_hash in rows:
        print(f"  seq={seq}: prev_hash={prev_hash[:16]}... hash={event_hash[:16]}...")

    return 0


def cmd_export(args: argparse.Namespace) -> int:
    """Handle the export subcommand - export evidence bundle."""

    run_id = args.run_id
    db_path = Path(args.db_path)
    output_path = Path(args.output) if args.output else Path(f"evidence_bundle_{run_id}.json")

    # Read checkpoint DB to reconstruct the bundle
    import sqlite3

    conn = sqlite3.connect(str(db_path))
    row = conn.execute(
        "SELECT payload_json FROM checkpoint WHERE run_id = ? ORDER BY seq DESC LIMIT 1",
        (run_id,),
    ).fetchone()
    conn.close()

    if not row:
        print(f"[error] No checkpoint found for run_id={run_id} in {db_path}", file=sys.stderr)
        return 1

    # For a full export, we'd replay the entire event log
    # For now, export the checkpoint state
    import json

    payload = json.loads(row[0]) if isinstance(row[0], str) else row[0]
    output_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"[export] Evidence bundle exported to {output_path}")
    return 0


def cmd_bench(args: argparse.Namespace) -> int:
    """Handle the bench subcommand."""
    print("[bench] Benchmark subcommand invoked")
    if args.replay:
        print("[bench] Running in replay mode")
    else:
        print("[bench] Running in live mode")
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    """Handle the status subcommand - show pipeline status."""
    import sqlite3

    db_path = Path(args.db_path)
    run_id = args.run_id

    conn = sqlite3.connect(str(db_path))
    row = conn.execute(
        "SELECT current_state, event_seq FROM checkpoint "
        "WHERE run_id = ? ORDER BY seq DESC LIMIT 1",
        (run_id,),
    ).fetchone()
    conn.close()

    if not row:
        print(f"[error] No checkpoint found for run_id={run_id} in {db_path}", file=sys.stderr)
        return 1

    state, seq = row
    print(f"[status] run_id={run_id}")
    print(f"  Current state: {state}")
    print(f"  Last event seq: {seq}")

    return 0


def main(argv: list[str] | None = None) -> int:
    """Entry point for the aegis-ci CLI."""
    parser = _build_parser()
    args = parser.parse_args(argv)

    if not args.command:
        parser.print_help()
        return 0

    # Route to the appropriate command handler
    commands: dict[str, Callable[[argparse.Namespace], int]] = {
        "webhook": cmd_webhook,
        "run": cmd_run,
        "verify-chain": cmd_verify_chain,
        "export": cmd_export,
        "bench": cmd_bench,
        "status": cmd_status,
    }

    handler = commands.get(args.command)
    if handler is None:
        print(f"[error] Unknown command: {args.command}", file=sys.stderr)
        parser.print_help()
        return 1

    return handler(args)


if __name__ == "__main__":
    sys.exit(main())
