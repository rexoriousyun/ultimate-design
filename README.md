# Ultimate Design

A local chat-to-prototype design studio. Describe a page or flow in chat; a design agent
(headless Claude Code) writes HTML/CSS/JS into a project folder, checks the rendered result
itself, and the canvas shows it live. Refine it with chat, comments on elements, direct edits
and generated tweak controls. Every turn is saved as a version you can compare and restore.

Modelled on Anthropic's Claude Design. This is an independent project, not affiliated with or
endorsed by Anthropic.

It ships with `creative-library/`, a library of verified visual techniques (grain, halftone,
flow fields, glitch, charts, three.js scenes and more) that the design agent reads and copies
from, and Sanzo Wada's 348 colour combinations for designs without a design system.

## Requirements

- [`uv`](https://docs.astral.sh/uv/) and Python 3.11+
- the `claude` CLI (Claude Code), logged in. The design agent
  runs on that account, so on a work machine log in with your company's account.
- Node.js, only to run the technique library's own tests

## Run

```bash
uv run playwright install chromium   # once
uv run uvicorn app.server:app --port 8765
```

Open http://localhost:8765.

## Your workspace

Your designs, chats and settings, and anything you add (design systems shared with a team,
written UX guides), live in a **workspace** folder, never in the repo: `workspace/` here by
default (gitignored), or wherever `PM_WORKSPACE` points. A company can keep one workspace in a
private repository with its design systems and guides, and each person points the app at their
clone of it. How to set one up, and how to bring in Figma libraries, token packages and written
guides: `docs/workspace.md`.

```bash
uv run python -m app.workspace init ~/work/acme-design --name Acme
PM_WORKSPACE=~/work/acme-design uv run uvicorn app.server:app --port 8765
```

## Options

| variable | default | |
|---|---|---|
| `PM_WORKSPACE` | `workspace/` in the repo | the workspace folder (`docs/workspace.md`) |
| `PM_MODEL` | `claude-opus-5-5` | the design agent's model |
| `PM_EFFORT` | `high` | its effort |
| `PM_OLLAMA_URL` | `http://localhost:11434` | local models through Ollama |
| `FIGMA_TOKEN` | | build design systems from Figma files |
| `PM_DESIGN_GUIDE` | `design-guide` | the rule book command, for workspaces with `"rules": "design-guide"` |

## Use it from Claude Code

The repo is also a Claude Code plugin: Claude designs in the studio, waits for you to press
"Approve for build" there, then implements what you approved. Set up: `docs/claude-code.md`.

## Test

```bash
uv run pytest
cd creative-library && npm install && ./node_modules/.bin/vitest run   # the technique library (Node)
```

Tests never call a model: they use a fake engine.

## Docs

- `docs/workspace.md` — workspaces: guides, design systems, rules, team setup.
- `SPEC.md` — scope, milestones, status, known limits.
- `CLAUDE.md` — rules for agents maintaining this repo, and the doc map.
- `docs/architecture.md` — modules, storage, routes, stream events.
- `docs/agent.md` — how the design agent is launched, its tools and verification.
- `docs/testing.md` — test files and manual checks.
- `docs/decisions.md` — why things are the way they are.
- `docs/claude-code.md` — using it from Claude Code.
- `docs/connectors.md` — giving the design agent MCP servers for context.
- `creative-library/README.md` — the technique library.

## License

MIT (`LICENSE`). The Wada colour data keeps its own MIT license
(`creative-library/palettes/wada/LICENSE.md`).
