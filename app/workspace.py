"""The workspace: the one folder that holds everything that belongs to its owner, never the repo.

    <workspace>/
      workspace.json     {"name": ..., "rules": "builtin" | "design-guide"}
      design-systems/    built-in design systems (manifest.json + one folder each), read-only in the studio
      guides/            the owner's written UX guides (Markdown), read by the design agent every turn
      projects/  data/   designs and app state (meta, chat, versions, decisions, settings)

`PM_WORKSPACE` names it. Unset, it is `workspace/` in the repo (gitignored), except in a checkout
from before workspaces, where `projects/` or `data/` sit at the repo root: then the repo root is the
workspace and its rule book stays design-guide, so nothing changes until it is moved
(docs/workspace.md, docs/decisions.md 2026-10-13).

Rules: `builtin` checks the accessibility floor the app measures itself (app/rulebook-builtin.json);
`design-guide` exports the rule book from the `design-guide` command on every turn
(app/rulebook.py). A new workspace starts on `builtin`.
"""

import argparse
import json
import os
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
FILE = "workspace.json"
RULES = ("builtin", "design-guide")
GUIDES = "guides"
SYSTEMS = "design-systems"


def resolve(env: dict = os.environ, repo: Path = REPO) -> tuple[Path, bool]:
    """(workspace folder, whether it is a checkout from before workspaces)."""
    if env.get("PM_WORKSPACE"):
        return Path(env["PM_WORKSPACE"]).expanduser().resolve(), False
    if not (repo / "workspace").is_dir() and ((repo / "projects").is_dir() or (repo / "data").is_dir()):
        return repo, True
    return repo / "workspace", False


DIR, LEGACY = resolve()
DEFAULT_RULES = "design-guide" if LEGACY else "builtin"


def settings() -> dict:
    """workspace.json with its defaults. An unknown `rules` value is an error, not a fallback:
    a typo must not quietly switch a workspace's rule book."""
    path = DIR / FILE
    stored = json.loads(path.read_text()) if path.is_file() else {}
    current = {"name": None, "rules": DEFAULT_RULES, **stored}
    if current["rules"] not in RULES:
        raise ValueError(f"{path}: \"rules\" must be one of {', '.join(RULES)}, not {current['rules']!r}")
    return current


def rules() -> str:
    return settings()["rules"]


def guides() -> list[Path]:
    """The workspace's written guides, by name."""
    folder = DIR / GUIDES
    if not folder.is_dir():
        return []
    return sorted(p for p in folder.rglob("*") if p.is_file() and p.suffix.lower() in (".md", ".txt")
                  and p.name.lower() != "readme.md")


def guides_note() -> str:
    """A note for the design agent naming the guides, or "" when there are none."""
    files = guides()
    if not files:
        return ""
    names = "\n".join(f"- {p}" for p in files)
    return ("(Note from the app: this workspace has written design guides. Read the ones that apply "
            "to what you are doing before you design, and follow them; where a guide and a request "
            f"disagree, ask the user. Guides:\n{names})\n\n")


GITIGNORE = "# One person's designs and app state; the rest of the workspace is shared.\nprojects/\ndata/\n"
GUIDES_README = """# Guides

Your written design and UX guides, as Markdown (`.md`) or plain text, one topic per file
(e.g. `buttons.md`, `forms.md`, `voice-and-tone.md`). The design agent reads the ones that apply
before every design. This file is not given to the agent.

See docs/workspace.md in the ultimate-design repo for how to convert guides from other tools.
"""


def init(folder: Path, name: str | None = None) -> Path:
    """Make a new workspace with its folders, an empty design-system manifest and a .gitignore.
    Refuses a folder that already has a workspace.json."""
    folder = folder.expanduser().resolve()
    if (folder / FILE).exists():
        raise FileExistsError(f"{folder / FILE} already exists")
    (folder / GUIDES).mkdir(parents=True, exist_ok=True)
    (folder / SYSTEMS).mkdir(exist_ok=True)
    (folder / FILE).write_text(json.dumps({"name": name or folder.name, "rules": "builtin"}, indent=2) + "\n")
    if not (folder / GUIDES / "README.md").exists():
        (folder / GUIDES / "README.md").write_text(GUIDES_README)
    manifest = folder / SYSTEMS / "manifest.json"
    if not manifest.exists():
        manifest.write_text(json.dumps({"systems": []}, indent=2) + "\n")
    if not (folder / ".gitignore").exists():
        (folder / ".gitignore").write_text(GITIGNORE)
    return folder


def add_system(slug: str, system_id: str | None = None) -> Path:
    """Copy a design-system project from the studio into design-systems/<id>/ and list it in the
    manifest, so everyone who shares this workspace gets it, read-only, at the next start."""
    from app import projects  # projects imports this module

    if not projects.exists(slug) or projects.get(slug)["kind"] != projects.DESIGN_SYSTEM:
        raise KeyError(f"no design-system project {slug!r}")
    meta = projects.get(slug)
    system_id = system_id or slug
    target = DIR / SYSTEMS / system_id
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(projects.design_dir(slug), target, ignore=shutil.ignore_patterns(".git"))
    manifest = DIR / SYSTEMS / "manifest.json"
    book = json.loads(manifest.read_text()) if manifest.is_file() else {"systems": []}
    book["systems"] = [s for s in book["systems"] if s["id"] != system_id] + [{"id": system_id, "name": meta["name"]}]
    manifest.write_text(json.dumps(book, indent=2) + "\n")
    return target


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.workspace", description="Manage Ultimate Design workspaces.")
    sub = parser.add_subparsers(dest="command", required=True)
    p_init = sub.add_parser("init", help="make a new workspace folder")
    p_init.add_argument("folder", type=Path)
    p_init.add_argument("--name")
    p_add = sub.add_parser("add-system", help="share a studio design system through this workspace")
    p_add.add_argument("slug")
    p_add.add_argument("--id")
    sub.add_parser("show", help="print the workspace in use and its settings")
    args = parser.parse_args(argv)
    try:
        if args.command == "init":
            folder = init(args.folder, args.name)
            print(f"Workspace made at {folder}. Use it with PM_WORKSPACE={folder}")
        elif args.command == "add-system":
            print(f"Copied to {add_system(args.slug, args.id)}; it loads at the next start.")
        else:
            print(json.dumps({"workspace": str(DIR), "legacy": LEGACY, **settings(),
                              "guides": [str(p) for p in guides()]}, indent=2))
    except (FileExistsError, KeyError, ValueError) as err:
        print(f"error: {err}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
