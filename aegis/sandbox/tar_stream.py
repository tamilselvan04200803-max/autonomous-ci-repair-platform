"""Deterministic POSIX-normalized in-memory tar stream builder (Milestone A4)."""

from __future__ import annotations

import hashlib
import io
import os
import stat
import tarfile
from dataclasses import dataclass
from pathlib import Path

from agentsentinel.sandbox.intake import excluded_path, relative_path, safe_read

_TEXT_SUFFIXES = frozenset({
    ".py", ".pyi", ".sh", ".txt", ".md", ".toml", ".yaml", ".yml", ".ini", ".cfg", ".json", ".in",
})
_SECRET_SUFFIXES = frozenset({".pem", ".key"})


@dataclass(frozen=True)
class RepoTarArchive:
    """Deterministic in-memory tar payload ready to stream into a container via stdin."""

    tar_bytes: bytes
    sha256: str
    included_paths: tuple[str, ...]


def _is_link_or_reparse(path: Path) -> bool:
    info = path.lstat()
    if stat.S_ISLNK(info.st_mode):
        return True
    attrs = int(getattr(info, "st_file_attributes", 0))
    return bool(attrs & 0x400)


def build_repo_tar_bytes(repo_root: Path) -> RepoTarArchive:
    """Create a deterministic tar archive containing safe regular repo files with LF endings."""
    root = repo_root.resolve()
    rel_files: list[str] = []
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        cur = Path(dirpath)
        safe_dirs: list[str] = []
        for d in sorted(dirnames):
            child = cur / d
            if _is_link_or_reparse(child):
                continue
            rel_dir = child.relative_to(root).as_posix()
            if excluded_path(rel_dir):
                continue
            safe_dirs.append(d)
        dirnames[:] = safe_dirs

        for fn in sorted(filenames):
            file_path = cur / fn
            if _is_link_or_reparse(file_path):
                continue
            rel = file_path.relative_to(root).as_posix()
            try:
                relative_path(rel)
            except ValueError:
                continue
            if excluded_path(rel) or file_path.suffix.lower() in _SECRET_SUFFIXES:
                continue
            rel_files.append(rel)

    rel_files.sort()
    buf = io.BytesIO()
    included: list[str] = []
    with tarfile.open(fileobj=buf, mode="w") as tf:
        for rel in rel_files:
            raw = bytes(safe_read(root, rel))
            suffix = Path(rel).suffix.lower()
            if suffix in _TEXT_SUFFIXES or Path(rel).name in {"Makefile", "Dockerfile"}:
                raw = raw.replace(b"\r\n", b"\n")
            info = tarfile.TarInfo(name=rel)
            info.size = len(raw)
            info.mode = 0o755 if suffix == ".sh" else 0o644
            info.uid = 65534
            info.gid = 65534
            info.uname = "nobody"
            info.gname = "nogroup"
            info.mtime = 0
            tf.addfile(info, io.BytesIO(raw))
            included.append(rel)

    data = buf.getvalue()
    return RepoTarArchive(
        tar_bytes=data,
        sha256=hashlib.sha256(data).hexdigest(),
        included_paths=tuple(included),
    )
