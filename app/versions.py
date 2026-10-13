"""Per-project version history in git.

The repository lives in data/<slug>/git and its work tree is projects/<slug>/, so the
agent never sees a .git folder in the design. One commit per chat turn.
"""

import subprocess
from pathlib import Path

GIT_IDENTITY = ["-c", "user.name=ultimate-design", "-c", "user.email=ultimate-design@localhost",
                "-c", "commit.gpgsign=false"]


def _git(git_dir: Path, work_tree: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", f"--git-dir={git_dir}", f"--work-tree={work_tree}", *GIT_IDENTITY, *args],
        capture_output=True, check=check)


def init(git_dir: Path, work_tree: Path) -> None:
    subprocess.run(["git", "init", "-q", "--bare", str(git_dir)], check=True, capture_output=True)
    # A bare repo refuses a work tree unless told otherwise.
    _git(git_dir, work_tree, "config", "core.bare", "false")


def commit(git_dir: Path, work_tree: Path, message: str) -> str | None:
    """Commit everything in the work tree. Returns the new sha, or None if nothing changed."""
    _git(git_dir, work_tree, "add", "-A")
    if not _git(git_dir, work_tree, "status", "--porcelain").stdout.strip():
        return None
    _git(git_dir, work_tree, "commit", "-q", "-m", message)
    return _git(git_dir, work_tree, "rev-parse", "HEAD").stdout.decode().strip()


def log(git_dir: Path, work_tree: Path) -> list[dict]:
    """Versions oldest first: [{"sha", "message", "time"}]."""
    result = _git(git_dir, work_tree, "log", "--reverse", "--format=%H%x00%ct%x00%s", check=False)
    if result.returncode != 0:  # no commits yet
        return []
    versions = []
    for line in result.stdout.decode().splitlines():
        sha, ts, message = line.split("\x00", 2)
        versions.append({"sha": sha, "time": int(ts), "message": message})
    return versions


def head(git_dir: Path, work_tree: Path) -> str | None:
    """The latest version's sha, or None before the first commit."""
    result = _git(git_dir, work_tree, "rev-parse", "--verify", "-q", "HEAD", check=False)
    return result.stdout.decode().strip() if result.returncode == 0 else None


def show(git_dir: Path, work_tree: Path, sha: str, path: str) -> bytes | None:
    """File contents at a version, or None if the file or version does not exist."""
    if not sha.isalnum():
        return None
    result = _git(git_dir, work_tree, "show", f"{sha}:{path}", check=False)
    return result.stdout if result.returncode == 0 else None


def diff_stat(git_dir: Path, work_tree: Path, a: str, b: str) -> list[dict]:
    """Files changed from version a to b: [{"path", "added", "removed"}] (lines; None for a
    binary file)."""
    if not (a.isalnum() and b.isalnum()):
        return []
    result = _git(git_dir, work_tree, "diff", "--numstat", a, b, check=False)
    files = []
    for line in result.stdout.decode().splitlines():
        added, removed, path = line.split("\t", 2)
        files.append({"path": path, "added": None if added == "-" else int(added),
                      "removed": None if removed == "-" else int(removed)})
    return files


def restore(git_dir: Path, work_tree: Path, sha: str, message: str) -> str | None:
    """Make the work tree match a version (removing files it lacks) and commit that."""
    _git(git_dir, work_tree, "read-tree", "-u", "--reset", sha)
    return commit(git_dir, work_tree, message)


def export(git_dir: Path, work_tree: Path, sha: str, dest: Path) -> None:
    """Write the files of a version into `dest` (for branching a new project from it)."""
    archive = _git(git_dir, work_tree, "archive", "--format=tar", sha).stdout
    subprocess.run(["tar", "-x", "-C", str(dest)], input=archive, check=True, capture_output=True)
