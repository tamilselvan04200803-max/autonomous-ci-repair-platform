"""Contract test for AgentSentinel Kernel sandbox compatibility and stdlib tarfile streaming.

Docs URL: https://docs.python.org/3/library/tarfile.html
"""

from __future__ import annotations

import io
import tarfile

import pytest
from agentsentinel.sandbox.container import ContainerConfig, HardenedContainerRunner


@pytest.mark.contract
def test_agentsentinel_container_and_tarfile_contract(tmp_path) -> None:  # type: ignore[no-untyped-def]
    cfg = ContainerConfig.regression(pids_limit=256, timeout_seconds=60)
    assert cfg.network_disabled is True
    assert cfg.read_only_rootfs is True
    runner = HardenedContainerRunner(cfg)
    args = runner.build_docker_run_args("test-c", tmp_path, ["pytest", "-q"])
    assert "--network" in args and "none" in args
    assert "--read-only" in args
    assert "--cap-drop=ALL" in args
    assert "no-new-privileges" in args
    assert "65534:65534" in args

    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as tf:
        info = tarfile.TarInfo(name="src/app.py")
        payload = b"print('ok')\n"
        info.size = len(payload)
        info.mode = 0o644
        info.uid = 65534
        info.gid = 65534
        tf.addfile(info, io.BytesIO(payload))
    buf.seek(0)
    with tarfile.open(fileobj=buf, mode="r") as tf:
        names = tf.getnames()
        assert names == ["src/app.py"]
