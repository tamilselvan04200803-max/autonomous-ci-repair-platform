"""Milestone A4 TDD tests: Deterministic tar streaming, two-phase PREPARE/RUN, and security flags."""

from __future__ import annotations

import io
import subprocess
import tarfile
from pathlib import Path
from typing import Any

import pytest
from aegis.sandbox.runner import (
    AegisSandboxRunner,
    DockerUnavailableError,
    PrepareSpec,
    RunPhaseConfig,
    compute_lockfile_hash,
    reproduce_baseline,
)
from aegis.sandbox.tar_stream import build_repo_tar_bytes


@pytest.mark.unit
def test_tar_stream_normalizes_crlf_excludes_secrets_git_and_is_reproducible(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    (repo / "src").mkdir(parents=True)
    (repo / ".git").mkdir()
    (repo / ".git" / "HEAD").write_text("ref: refs/heads/main\n", encoding="utf-8")
    (repo / ".env").write_text("SECRET=12345\n", encoding="utf-8")
    (repo / "secret.pem").write_text("PRIVATE\n", encoding="utf-8")
    (repo / "src" / "main.py").write_bytes(b"def f():\r\n    return 1\r\n")
    (repo / "visible_ci.sh").write_bytes(b"#!/bin/sh\r\npytest -q\r\n")

    t1 = build_repo_tar_bytes(repo)
    t2 = build_repo_tar_bytes(repo)
    assert t1.sha256 == t2.sha256
    assert set(t1.included_paths) == {"src/main.py", "visible_ci.sh"}

    with tarfile.open(fileobj=io.BytesIO(t1.tar_bytes), mode="r") as tf:
        members = {m.name: m for m in tf.getmembers()}
        assert ".git/HEAD" not in members
        assert ".env" not in members
        assert "secret.pem" not in members
        py_bytes = tf.extractfile(members["src/main.py"]).read()
        sh_bytes = tf.extractfile(members["visible_ci.sh"]).read()
        assert b"\r\n" not in py_bytes
        assert b"\r\n" not in sh_bytes
        assert members["src/main.py"].uid == 65534
        assert members["src/main.py"].gid == 65534
        assert members["visible_ci.sh"].mode == 0o755


@pytest.mark.unit
def test_prepare_lockfile_hash_and_cache_reuse(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "requirements.txt").write_text("pytest==8.4.2\n", encoding="utf-8")
    h1 = compute_lockfile_hash(repo)
    (repo / "requirements.txt").write_text("pytest==8.4.2\nhttpx==0.28.1\n", encoding="utf-8")
    h2 = compute_lockfile_hash(repo)
    assert h1 != h2

    built_tags: list[str] = []

    def fake_exec(cmd: list[str], **_kwargs: Any) -> subprocess.CompletedProcess[bytes]:
        if cmd[:3] == ["docker", "image", "inspect"]:
            return subprocess.CompletedProcess(cmd, 1, b"", b"No such image")
        if cmd[:2] == ["docker", "build"]:
            tag = cmd[cmd.index("-t") + 1]
            built_tags.append(tag)
            return subprocess.CompletedProcess(cmd, 0, b"built", b"")
        raise AssertionError(f"Unexpected cmd: {cmd}")

    runner = AegisSandboxRunner(executor=fake_exec)
    spec = PrepareSpec(package_index_url="https://pypi.org/simple")
    img_tag = runner.prepare(repo, spec=spec)
    assert img_tag.startswith("aegis-ci-prep:")
    assert h2[:16] in img_tag
    assert len(built_tags) == 1


@pytest.mark.unit
def test_run_phase_enforces_hardened_docker_flags_no_bind_mounts_no_secrets(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "app.py").write_text("x = 1\n", encoding="utf-8")
    monkeypatch.setenv("GITHUB_APP_PRIVATE_KEY", "SECRET_MUST_NOT_LEAK")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-TEST_DUMMY_SECRET")

    captured_cmds: list[list[str]] = []
    captured_inputs: list[bytes] = []

    def fake_exec(cmd: list[str], **kwargs: Any) -> subprocess.CompletedProcess[bytes]:
        captured_cmds.append(cmd)
        captured_inputs.append(kwargs.get("input", b""))
        return subprocess.CompletedProcess(cmd, 1, b"FAILED test_x\n", b"")

    runner = AegisSandboxRunner(executor=fake_exec)
    cfg = RunPhaseConfig(image="aegis-ci-prep:deadbeef00000000", timeout_seconds=45, pids_limit=128)
    result = runner.run_tar_sandbox(repo, command="pytest -q --junitxml=/tmp/junit.xml", config=cfg)
    assert result.exit_code == 1
    assert len(captured_cmds) == 1
    cmd = captured_cmds[0]

    # Exact security flags asserted (Section 5)
    assert "--network" in cmd and cmd[cmd.index("--network") + 1] == "none"
    assert "--read-only" in cmd
    assert "--cap-drop=ALL" in cmd
    assert "--security-opt" in cmd and "no-new-privileges" in cmd
    assert "--user" in cmd and cmd[cmd.index("--user") + 1] == "65534:65534"
    assert "--pids-limit=128" in cmd
    assert "--memory=512m" in cmd
    assert "--cpus=1.0" in cmd
    # No Windows/host bind mounts (-v / --mount) allowed in RUN!
    assert "-v" not in cmd
    assert "--mount" not in cmd
    assert "--tmpfs" in cmd
    # No secrets leaked in Docker env flags or tar payload
    cmd_str = " ".join(cmd)
    assert "SECRET_MUST_NOT_LEAK" not in cmd_str
    assert "sk-TEST_DUMMY_SECRET" not in cmd_str
    assert len(captured_inputs[0]) > 0


@pytest.mark.unit
def test_reproduce_baseline_k_times_and_docker_unavailable_fails_closed(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "app.py").write_text("x = 1\n", encoding="utf-8")

    # Fail-closed when docker binary/daemon unavailable
    def failing_docker(cmd: list[str], **_kwargs: Any) -> subprocess.CompletedProcess[bytes]:
        return subprocess.CompletedProcess(cmd, 125, b"", b"Cannot connect to the Docker daemon")

    runner = AegisSandboxRunner(executor=failing_docker)
    with pytest.raises(DockerUnavailableError):
        runner.run_tar_sandbox(repo, command="pytest -q")

    # Baseline 3x reproduction helper
    calls = 0

    def sim_exec(cmd: list[str], **_kwargs: Any) -> subprocess.CompletedProcess[bytes]:
        nonlocal calls
        calls += 1
        return subprocess.CompletedProcess(cmd, 1, b"1 failed\n", b"")

    sim_runner = AegisSandboxRunner(executor=sim_exec)
    report = reproduce_baseline(sim_runner, repo, command="pytest -q", runs=3)
    assert calls == 3
    assert report.reproduction_runs == 3
    assert report.reproduced_failures == 3
    assert report.exit_codes_before == (1, 1, 1)
    assert report.network_disabled is True
    assert report.read_only_rootfs is True
