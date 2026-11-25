"""Two-phase PREPARE/RUN sandbox runner wrapping AgentSentinel security hardening (A4)."""

from __future__ import annotations

import hashlib
import shutil
import subprocess
import tempfile
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Protocol, runtime_checkable

from agentsentinel.sandbox.container import ContainerConfig, HardenedContainerRunner

from aegis.domain.models import VerificationReport
from aegis.sandbox.tar_stream import build_repo_tar_bytes

if TYPE_CHECKING:
    from collections.abc import Sequence


class DockerUnavailableError(RuntimeError):
    """Raised fail-closed when Docker daemon or image is unavailable."""


@runtime_checkable
class SubprocessExecutor(Protocol):
    """Testable protocol for subprocess execution."""

    def __call__(
        self,
        cmd: list[str],
        *,
        input: bytes | None = None,
        timeout: float | None = None,
    ) -> subprocess.CompletedProcess[bytes]:
        ...


def _default_executor(
    cmd: list[str],
    *,
    input: bytes | None = None,
    timeout: float | None = None,
) -> subprocess.CompletedProcess[bytes]:
    if not shutil.which(cmd[0]):
        raise DockerUnavailableError(f"Executable not found: {cmd[0]}")
    return subprocess.run(
        cmd,
        input=input,
        capture_output=True,
        timeout=timeout,
        check=False,
    )


_LOCKFILE_CANDIDATES: tuple[str, ...] = (
    "uv.lock",
    "poetry.lock",
    "requirements.txt",
    "requirements-dev.txt",
    "pyproject.toml",
)


def compute_lockfile_hash(repo_root: Path) -> str:
    """Compute SHA-256 across declared Python lockfiles/manifests in deterministic order."""
    hasher = hashlib.sha256()
    found = False
    for name in _LOCKFILE_CANDIDATES:
        candidate = repo_root / name
        if candidate.is_file():
            found = True
            hasher.update(name.encode("utf-8"))
            hasher.update(b":")
            hasher.update(candidate.read_bytes().replace(b"\r\n", b"\n"))
            hasher.update(b"\n")
    if not found:
        hasher.update(b"NO_LOCKFILE")
    return hasher.hexdigest()


@dataclass(frozen=True)
class PrepareSpec:
    """PREPARE phase configuration: installs dependencies with index-scoped network."""

    base_image: str = "python:3.11-slim"
    package_index_url: str = "https://pypi.org/simple"
    timeout_seconds: float = 300.0


@dataclass(frozen=True)
class RunPhaseConfig:
    """RUN phase configuration: zero network, read-only rootfs, tar-streamed workspace."""

    image: str = "agentsentinel-runner:py311"
    pids_limit: int = 256
    memory_limit: str = "512m"
    cpus: str = "1.0"
    timeout_seconds: int = 60
    max_output_bytes: int = 262_144


@dataclass(frozen=True)
class SandboxRunResult:
    """Bounded output captured from one sandboxed container run."""

    exit_code: int
    stdout: str
    stderr: str
    timed_out: bool
    tar_sha256: str
    image: str


def _looks_like_docker_infra_failure(rc: int, stderr: str) -> bool:
    lowered = stderr.lower()
    return rc == 125 and (
        "cannot connect" in lowered
        or "docker daemon" in lowered
        or "error during connect" in lowered
        or "pipe" in lowered
    )


class AegisSandboxRunner:
    """Two-phase PREPARE (index-only) -> RUN (network=none, tar stream) runner."""

    def __init__(self, *, executor: SubprocessExecutor | None = None) -> None:
        self._exec = executor or _default_executor

    def prepare(self, repo_root: Path, *, spec: PrepareSpec | None = None) -> str:
        """Build or reuse cached dependency image layer keyed by lockfile hash."""
        cfg = spec or PrepareSpec()
        lock_hash = compute_lockfile_hash(repo_root)
        tag = f"aegis-ci-prep:{lock_hash[:16]}"

        inspect_res = self._exec(
            ["docker", "image", "inspect", tag],
            timeout=10.0,
        )
        if inspect_res.returncode == 0:
            return tag

        dockerfile_lines = [
            f"FROM {cfg.base_image}",
            "RUN useradd -u 65534 -m -s /bin/sh nobody_runner || true",
            "WORKDIR /tmp/prep",
        ]
        if (repo_root / "requirements.txt").is_file():
            dockerfile_lines.extend([
                "COPY requirements.txt .",
                f"RUN pip install --no-cache-dir -i {cfg.package_index_url} -r requirements.txt",
            ])
        elif (repo_root / "pyproject.toml").is_file():
            dockerfile_lines.extend([
                "COPY pyproject.toml .",
                f"RUN pip install --no-cache-dir -i {cfg.package_index_url} .",
            ])
        dockerfile_lines.append("USER 65534:65534")

        with tempfile.TemporaryDirectory(prefix="aegis_prep_") as tmp_dir:
            prep_dir = Path(tmp_dir)
            (prep_dir / "Dockerfile").write_text(
                "\n".join(dockerfile_lines) + "\n", encoding="utf-8"
            )
            for fname in ("requirements.txt", "pyproject.toml"):
                src = repo_root / fname
                if src.is_file():
                    (prep_dir / fname).write_bytes(src.read_bytes().replace(b"\r\n", b"\n"))
            build_cmd = [
                "docker",
                "build",
                "--build-arg",
                f"PIP_INDEX_URL={cfg.package_index_url}",
                "-t",
                tag,
                str(prep_dir),
            ]
            res = self._exec(build_cmd, timeout=cfg.timeout_seconds)
            if res.returncode != 0:
                err = res.stderr.decode("utf-8", errors="replace")
                raise DockerUnavailableError(f"PREPARE build failed ({res.returncode}): {err}")
        return tag

    def build_run_command(
        self,
        *,
        container_name: str,
        command: str | Sequence[str],
        config: RunPhaseConfig,
        seccomp_profile: Path | None = None,
    ) -> list[str]:
        """Construct zero-bind-mount hardened docker run args matching AgentSentinel invariants."""
        # Validate limits through AgentSentinel regression ContainerConfig invariant
        _kernel_cfg = ContainerConfig(
            image=config.image,
            network_disabled=True,
            read_only_rootfs=True,
            memory_limit=config.memory_limit,
            pids_limit=config.pids_limit,
            cpus=config.cpus,
            timeout_seconds=int(config.timeout_seconds),
            execution_profile="regression-v2",
        )
        cmd_str = command if isinstance(command, str) else " ".join(command)
        args = [
            "docker",
            "run",
            "-i",
            "--rm",
            "--name",
            container_name,
            "--user",
            "65534:65534",
            "--network",
            "none",
            "--read-only",
            "--tmpfs",
            "/tmp:rw,noexec,nosuid,size=64m",  # noqa: S108
            "--tmpfs",
            "/workspace:rw,nosuid,size=128m",
            "--cap-drop=ALL",
            "--security-opt",
            "no-new-privileges",
        ]
        if seccomp_profile is not None:
            args.extend(["--security-opt", f"seccomp={seccomp_profile}"])
        args.extend([
            f"--pids-limit={_kernel_cfg.pids_limit}",
            f"--memory={_kernel_cfg.memory_limit}",
            f"--cpus={_kernel_cfg.cpus}",
            "-w",
            "/workspace",
            "-e",
            "PYTHONUNBUFFERED=1",
            "-e",
            "PYTHONDONTWRITEBYTECODE=1",
            "-e",
            "PYTEST_ADDOPTS=-o cache_dir=/tmp/.pytest_cache",
            _kernel_cfg.image,
            "sh",
            "-c",
            f"tar -xf - -C /workspace && {cmd_str}",
        ])
        return args

    def run_tar_sandbox(
        self,
        repo_root: Path,
        *,
        command: str | Sequence[str],
        config: RunPhaseConfig | None = None,
    ) -> SandboxRunResult:
        """Stream repo via tar into isolated --network=none container and run command."""
        cfg = config or RunPhaseConfig()
        tar_pkg = build_repo_tar_bytes(repo_root)
        seccomp_profile = HardenedContainerRunner(ContainerConfig(image=cfg.image))._profile_path()
        cname = f"aegis-run-{uuid.uuid4().hex[:12]}"
        cmd = self.build_run_command(
            container_name=cname,
            command=command,
            config=cfg,
            seccomp_profile=seccomp_profile,
        )
        try:
            proc = self._exec(cmd, input=tar_pkg.tar_bytes, timeout=float(cfg.timeout_seconds))
        except subprocess.TimeoutExpired:
            # Best-effort force removal of timed-out container
            self._exec(["docker", "rm", "-f", cname], timeout=5.0)
            return SandboxRunResult(
                exit_code=124,
                stdout="",
                stderr="Execution timed out",
                timed_out=True,
                tar_sha256=tar_pkg.sha256,
                image=cfg.image,
            )

        stdout = proc.stdout[: cfg.max_output_bytes].decode("utf-8", errors="replace")
        stderr = proc.stderr[: cfg.max_output_bytes].decode("utf-8", errors="replace")
        if _looks_like_docker_infra_failure(proc.returncode, stderr):
            raise DockerUnavailableError(f"Docker unavailable: {stderr.strip()}")

        return SandboxRunResult(
            exit_code=proc.returncode,
            stdout=stdout,
            stderr=stderr,
            timed_out=False,
            tar_sha256=tar_pkg.sha256,
            image=cfg.image,
        )


def reproduce_baseline(
    runner: AegisSandboxRunner,
    repo_root: Path,
    *,
    command: str | Sequence[str],
    runs: int = 3,
    config: RunPhaseConfig | None = None,
) -> VerificationReport:
    """Reproduce original failure ``runs`` times via tar-streamed sandbox."""
    if runs < 1:
        raise ValueError("runs must be >= 1")
    codes: list[int] = []
    for _ in range(runs):
        res = runner.run_tar_sandbox(repo_root, command=command, config=config)
        codes.append(res.exit_code)
    failures = sum(1 for c in codes if c != 0)
    return VerificationReport(
        reproduction_runs=runs,
        reproduced_failures=failures,
        exit_codes_before=tuple(codes),
        network_disabled=True,
        read_only_rootfs=True,
        execution_notes=f"Reproduced {failures}/{runs} failures via tar-stream sandbox",
    )
