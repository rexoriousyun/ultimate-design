"""Project storage.

Design files live in projects/<slug>/ (the agent's working directory).
App state (metadata, chat log, comments, version history) lives in data/<slug>/ so the
agent never sees it. Both are in the workspace (app/workspace.py), not the repo.
"""

import hashlib
import json
import re
import shutil
import time
from pathlib import Path

from app import tweaks, versions, workspace

PROJECTS_DIR = workspace.DIR / "projects"
DATA_DIR = workspace.DIR / "data"

DESIGN = "design"
DESIGN_SYSTEM = "design-system"
DS_FOLDER = "design-system"  # where an attached design system is copied inside a project
# Built-in design systems come with the workspace (design-systems/<id>/, listed in its
# manifest.json) and become read-only design-system projects at startup. Files under specimen/ support the
# specimen page and are not copied into designs.
BUILTIN_DIR = workspace.DIR / workspace.SYSTEMS
SPECIMEN_ASSETS = "specimen"
META_DEFAULTS = {"kind": DESIGN, "source": None, "design_system": None, "pending_note": None,
                 "builtin": None,  # the design-systems/<id> folder a built-in system comes from
                 "session_id": None, "entry": "index.html", "model": None, "source_dir": None,
                 "last_claude_code": None, "connectors": [],
                 # Reference material for a design: [{"source": path or URL, "dir": folder read}]
                 "references": [],
                 # Elements deleted in Edit mode, hidden until the agent's next turn removes them
                 "pending_deletes": [], "decisions_mark": 0,
                 # The version the user approved for building in a codebase: {sha, at, why} (the plugin's
                 # wait_for_approval and get_handoff read it).
                 "approved": None,
                 # Plan first: the agent proposes a plan for approval before it builds.
                 "plan_first": False}


def slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or "untitled"


def design_dir(slug: str) -> Path:
    return PROJECTS_DIR / slug


def _meta_path(slug: str) -> Path:
    return DATA_DIR / slug / "meta.json"


def _chat_path(slug: str) -> Path:
    return DATA_DIR / slug / "chat.jsonl"


def _git_dir(slug: str) -> Path:
    return DATA_DIR / slug / "git"


def exists(slug: str) -> bool:
    return _meta_path(slug).is_file()


def _unique_slug(name: str) -> str:
    base = slugify(name)
    slug, n = base, 2
    while exists(slug) or design_dir(slug).exists():
        slug, n = f"{base}-{n}", n + 1
    return slug


def get(slug: str) -> dict:
    # Defaults cover metadata written by older milestones.
    return {**META_DEFAULTS, **json.loads(_meta_path(slug).read_text())}


def save(meta: dict) -> None:
    _meta_path(meta["slug"]).write_text(json.dumps(meta, indent=2))


def list_all() -> list[dict]:
    if not DATA_DIR.exists():
        return []
    metas = [get(p.name) for p in DATA_DIR.iterdir() if exists(p.name)]
    return sorted(metas, key=lambda m: m["updated"], reverse=True)


def create(name: str, kind: str = DESIGN, source: str | None = None,
           model: str | None = None) -> dict:
    """kind DESIGN is a prototype; DESIGN_SYSTEM is extracted from `source`, a folder or file
    the agent may read but not write. model None = the default Claude model, else
    "ollama:<name>"; it is fixed for the project's life."""
    name = name.strip() or "Untitled"
    slug = _unique_slug(name)
    design_dir(slug).mkdir(parents=True)
    (DATA_DIR / slug).mkdir(parents=True)
    versions.init(_git_dir(slug), design_dir(slug))
    now = time.time()
    meta = {**META_DEFAULTS, "slug": slug, "name": name, "created": now, "updated": now,
            "kind": kind, "source": source, "model": model,
            "entry": "specimen.html" if kind == DESIGN_SYSTEM else "index.html"}
    save(meta)
    return meta


def duplicate(slug: str, sha: str | None = None, name: str | None = None) -> dict:
    """Copy the design files into a new project: the live files, or with `sha` the files as
    they were at that version (a branch). The chat and history are not copied."""
    source = get(slug)
    if sha is not None:
        known = {v["sha"]: i + 1 for i, v in enumerate(list_versions(slug))}
        if sha not in known:
            raise KeyError(sha)
    meta = create(name or source["name"] + " copy", source["kind"], source["source"], source["model"])
    meta = touch(meta["slug"], design_system=source["design_system"], connectors=source["connectors"])
    references = []
    for ref in source["references"]:  # fetched copies are copied; local folders are shared
        old = reference_dir(slug, ref["source"])
        if Path(ref["dir"]).is_relative_to(old):
            new = reference_dir(meta["slug"], ref["source"])
            shutil.copytree(old, new)
            ref = {**ref, "dir": str(new / Path(ref["dir"]).relative_to(old))}
        references.append(ref)
    meta = touch(meta["slug"], references=references)
    if source["source_dir"]:  # a fetched GitHub/Figma source: the copy gets its own
        shutil.copytree(source["source_dir"], fetched_source_dir(meta["slug"]))
        meta = touch(meta["slug"], source_dir=str(fetched_source_dir(meta["slug"])))
    if sha is None:
        shutil.copytree(design_dir(slug), design_dir(meta["slug"]), dirs_exist_ok=True)
        commit_version(meta["slug"], f"Duplicated from {source['name']}")
    else:
        versions.export(_git_dir(slug), design_dir(slug), sha, design_dir(meta["slug"]))
        commit_version(meta["slug"], f"Branched from {source['name']} version {known[sha]}")
    return meta


def delete(slug: str) -> None:
    shutil.rmtree(design_dir(slug), ignore_errors=True)
    shutil.rmtree(DATA_DIR / slug, ignore_errors=True)
    if settings()["default_design_system"] == slug:
        set_default_design_system(None)


def mark_linked(slug: str) -> None:
    """Record that a Claude Code session used this project (app/claude_code_mcp.py), without
    moving it up the Home list the way touch() does."""
    meta = get(slug)
    meta["last_claude_code"] = time.time()
    save(meta)


def touch(slug: str, **fields) -> dict:
    meta = get(slug)
    meta.update(fields, updated=time.time())
    save(meta)
    return meta


def append_chat(slug: str, event: dict) -> None:
    with _chat_path(slug).open("a") as f:
        f.write(json.dumps(event) + "\n")


def read_chat(slug: str) -> list[dict]:
    path = _chat_path(slug)
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().splitlines() if line]


def list_files(slug: str) -> list[str]:
    root = design_dir(slug)
    return sorted(str(p.relative_to(root)) for p in root.rglob("*") if p.is_file())


def commit_version(slug: str, message: str) -> str | None:
    first_line = message.strip().splitlines()[0] if message.strip() else "Update"
    if not _git_dir(slug).exists():  # projects created before milestone 2
        versions.init(_git_dir(slug), design_dir(slug))
    return versions.commit(_git_dir(slug), design_dir(slug), first_line[:72])


def latest_version(slug: str) -> str | None:
    if not _git_dir(slug).exists():
        return None
    return versions.head(_git_dir(slug), design_dir(slug))


def list_versions(slug: str) -> list[dict]:
    return versions.log(_git_dir(slug), design_dir(slug))


def file_at_version(slug: str, sha: str, rel: str) -> bytes | None:
    return versions.show(_git_dir(slug), design_dir(slug), sha, rel)


def diff_versions(slug: str, a: str, b: str) -> list[dict]:
    return versions.diff_stat(_git_dir(slug), design_dir(slug), a, b)


def export_version(slug: str, sha: str, dest: Path) -> None:
    """Write one version's files into `dest` (a version thumbnail renders from there)."""
    versions.export(_git_dir(slug), design_dir(slug), sha, dest)


def restore_version(slug: str, sha: str) -> str | None:
    """Restore the design to a version and tell the agent before its next turn."""
    known = {v["sha"]: i + 1 for i, v in enumerate(list_versions(slug))}
    if sha not in known:
        raise KeyError(sha)
    new_sha = versions.restore(_git_dir(slug), design_dir(slug), sha,
                               f"Restored version {known[sha]}")
    add_note(slug, f"the user restored the design to version {known[sha]}. The files may "
                   "differ from what you last wrote. Read them again before editing.")
    return new_sha


def add_note(slug: str, text: str) -> None:
    """Queue a note for the agent, prepended to the next user message (see server.chat)."""
    note = f"(Note from the app: {text})"
    existing = get(slug).get("pending_note")
    touch(slug, pending_note=f"{existing}\n{note}" if existing else note)


def _settings_path() -> Path:
    return DATA_DIR / "settings.json"


def settings() -> dict:
    """App-wide settings: {"default_design_system": slug or None}. Until the user picks one, the
    default is the built-in system the workspace names (workspace.json "default_design_system")."""
    path = _settings_path()
    stored = json.loads(path.read_text()) if path.exists() else {}
    shared = workspace.settings().get("default_design_system")
    fallback = next((m["slug"] for m in list_all() if m["builtin"] == shared), None) if shared else None
    return {"default_design_system": fallback, **stored}


def set_default_design_system(ds_slug: str | None) -> dict:
    """The design system new designs start with (Claude Design's "Published" system)."""
    if ds_slug is not None and (not exists(ds_slug) or get(ds_slug)["kind"] != DESIGN_SYSTEM):
        raise KeyError(ds_slug)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    current = {**settings(), "default_design_system": ds_slug}
    _settings_path().write_text(json.dumps(current, indent=2))
    return current


def reference_dir(slug: str, source: str) -> Path:
    """Where a remote reference (GitHub, Figma) is fetched for a design."""
    return DATA_DIR / slug / "references" / hashlib.sha1(source.encode()).hexdigest()[:10]


def drop_reference(slug: str, source: str) -> None:
    """Disconnect a reference; a fetched copy is deleted, a local folder is left alone."""
    meta = get(slug)
    shutil.rmtree(reference_dir(slug, source), ignore_errors=True)
    touch(slug, references=[r for r in meta["references"] if r["source"] != source])


def fetched_source_dir(slug: str) -> Path:
    """Where a GitHub or Figma source is fetched to (app/sources.py)."""
    return DATA_DIR / slug / "source"


def data_dir(slug: str) -> Path:
    return DATA_DIR / slug


def comments_path(slug: str) -> Path:
    return DATA_DIR / slug / "comments.json"


def keep_tweaks(slug: str, values: dict, page: str | None = None) -> str | None:
    """Write tweak values into a page's tweaks block (the entry page by default) as its
    new defaults."""
    rel = page or get(slug)["entry"]
    path = resolve_file(slug, rel)
    if path is None:
        raise FileNotFoundError(rel)
    path.write_text(tweaks.set_defaults(path.read_text(), values))
    add_note(slug, "the user changed default values in the tweaks block of "
                   f"{rel} with the Tweaks panel. Read it again before editing.")
    return commit_version(slug, "Kept tweak values")


def _files(root: Path) -> dict[str, bytes]:
    return {str(p.relative_to(root)): p.read_bytes() for p in sorted(root.rglob("*"))
            if p.is_file()} if root.exists() else {}


def _mirror(wanted: dict[str, bytes], target: Path) -> bool:
    """Make the folder hold exactly these files. True if anything changed."""
    if wanted == _files(target):
        return False
    shutil.rmtree(target, ignore_errors=True)
    target.mkdir(parents=True)
    for rel, content in wanted.items():
        (target / rel).parent.mkdir(parents=True, exist_ok=True)
        (target / rel).write_bytes(content)
    return True


def _design_system_files(ds_slug: str) -> dict[str, bytes]:
    """What a project gets from a design system: everything except the specimen page and
    the files that support it."""
    entry = get(ds_slug)["entry"]
    return {rel: content for rel, content in _files(design_dir(ds_slug)).items()
            if Path(rel).name != entry and not rel.startswith(SPECIMEN_ASSETS + "/")}


def _copy_design_system(slug: str, ds_slug: str) -> bool:
    """Make projects/<slug>/design-system/ match the design system. True if anything changed."""
    return _mirror(_design_system_files(ds_slug), design_dir(slug) / DS_FOLDER)


def builtin_systems() -> dict[str, str]:
    """The workspace's built-in design systems: folder id to display name."""
    manifest = BUILTIN_DIR / "manifest.json"
    if not manifest.is_file():
        return {}
    systems = json.loads(manifest.read_text())["systems"]
    return {s["id"]: s["name"] for s in systems if (BUILTIN_DIR / s["id"]).is_dir()}


def seed_builtin() -> None:
    """At startup: make each built-in design system a design-system project, and bring an
    existing one back in line with its folder (a new version when its files changed)."""
    by_id = {m["builtin"]: m for m in list_all() if m["builtin"]}
    for ds_id, name in builtin_systems().items():
        meta = by_id.get(ds_id)
        if meta is None:
            meta = create(name, DESIGN_SYSTEM)
            meta = touch(meta["slug"], builtin=ds_id)
        if _mirror(_files(BUILTIN_DIR / ds_id), design_dir(meta["slug"])):
            commit_version(meta["slug"], f"{name} from design-systems/{ds_id}/")


def set_design_system(slug: str, ds_slug: str | None) -> str | None:
    """Attach a design system (copied into design-system/) or detach it (None)."""
    if ds_slug is not None and (not exists(ds_slug) or get(ds_slug)["kind"] != DESIGN_SYSTEM):
        raise KeyError(ds_slug)
    if ds_slug is None:
        shutil.rmtree(design_dir(slug) / DS_FOLDER, ignore_errors=True)
        touch(slug, design_system=None)
        add_note(slug, f"the user removed the design system; the {DS_FOLDER}/ folder is gone. "
                       "Keep the current look unless asked to change it.")
        return commit_version(slug, "Removed design system")
    name = get(ds_slug)["name"]
    _copy_design_system(slug, ds_slug)
    touch(slug, design_system=ds_slug)
    add_note(slug, f"this project now uses the design system \"{name}\", copied into "
                   f"{DS_FOLDER}/. Read {DS_FOLDER}/README.md and use its tokens from now on.")
    return commit_version(slug, f"Use design system {name}")


def sync_design_system(slug: str) -> None:
    """Before a turn: refresh the copy if the design system changed, and tell the agent."""
    ds_slug = get(slug)["design_system"]
    if not ds_slug or not exists(ds_slug):
        return
    if _copy_design_system(slug, ds_slug):
        add_note(slug, f"the design system in {DS_FOLDER}/ was updated. Read "
                       f"{DS_FOLDER}/README.md again and bring the design in line with it.")


def resolve_file(slug: str, rel: str) -> Path | None:
    """Return the file inside the project, or None if missing or outside it."""
    root = design_dir(slug).resolve()
    path = (root / rel).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        return None
    return path
