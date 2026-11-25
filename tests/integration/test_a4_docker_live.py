"""Live Docker integration tests verifying network air-gap, memory limit, and fork-bomb protection."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest
from aegis.sandbox.runner import AegisSandboxRunner, RunPhaseConfig


def _has_live_docker_and_image(image: str = "agentsentinel-runner:py311") -> bool:
    if not shutil.which("docker"):
        return False
    res = subprocess.run(["docker", "info"], capture_output=True, timeout=3, check=False)
    if res.returncode != 0:
        return False
    img = subprocess.run(["docker", "image", "inspect", image], capture_output=True, timeout=3, check=False)
    return img.returncode == 0


_SKIP_DOCKER = pytest.mark.skipif(
    not _has_live_docker_and_image(),
    reason="Live Docker daemon or agentsentinel-runner:py311 image unavailable",
)


@pytest.mark.integration
@_SKIP_DOCKER
def test_live_socket_connect_memory_hog_and_fork_bomb_blocked(tmp_path: Path) -> None:
    repo = tmp_path / "probe_repo"
    repo.mkdir()
    (repo / "net_probe.py").write_text(
        "import socket\ns = socket.create_connection(('1.1.1.1', 80), timeout=2)\n",
        encoding="utf-8",
    )
    (repo / "mem_probe.py").write_text(
        "buf = bytearray(900 * 1024 * 1024)\n",
        encoding="utf-8",
    )
    (repo / "fork_probe.py").write_text(
        "import os\nwhile True:\n    os.fork()\n",
        encoding="utf-8",
    )
    runner = AegisSandboxRunner()
    cfg = RunPhaseConfig(image="agentsentinel-runner:py311", pids_limit=32, memory_limit="128m", timeout_seconds=10)

    r_net = runner.run_tar_sandbox(repo, command="python net_probe.py", config=cfg)
    assert r_net.exit_code != 0

    r_mem = runner.run_tar_sandbox(repo, command="python mem_probe.py", config=cfg)
    assert r_mem.exit_code != 0

    r_fork = runner.run_tar_sandbox(repo, command="python fork_probe.py", config=cfg)
    assert r_fork.exit_code != 0
