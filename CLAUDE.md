# Ultimate Design — instructions for coding agents

A local rebuild of Anthropic's Claude Design: chat on the left, live HTML canvas on the
right, and a design agent (headless Claude Code) that writes and checks the prototype.
Scope and milestones: `SPEC.md`. Read the doc for the area you are changing before you
change it.

## Doc map

| doc | covers | update it when you change |
|---|---|---|
| `SPEC.md` | scope, milestones, status, known limits | a milestone's status, scope, or a limit |
| `docs/architecture.md` | modules, storage layout, HTTP routes, stream events | a route, an event type, a module, where data lives |
| `docs/agent.md` | how the design agent is launched, its prompt, its tools, verification | `app/engine.py`, `app/prompts/system.md`, `app/preview_mcp.py` |
| `docs/testing.md` | what each test file covers, how to verify by hand | a test file, or the manual verification steps |
| `docs/decisions.md` | dated decisions and why | you make a choice a later agent might undo without knowing why |
| `README.md` | how to run and test | commands or requirements |
| `docs/claude-code.md` | the Claude Code plugin and MCP link: install, tools, approval in the studio | `app/claude_code_mcp.py`, `plugin/`, `.claude-plugin/` |
| `docs/connectors.md` | connectors: MCP servers the design agent can use | `app/connectors.py` or how the engine passes them |
| `docs/design/` | the original Paper handoff from Claude Design, and `redesign/`: the Workbench mockups the studio now follows (`docs/gate-studio-redesign.md`) | the UI's look deviates from Workbench on purpose (note why in `decisions.md`) |
| `creative-library/README.md` | the technique library the design agent copies from: recipes, the `sync`/`render`/`harvest` toolchain, its skill, the seam with design-guide (`PLAN.md` there: parameter maps) | a recipe or the library's toolchain |
| `docs/workspace.md` | workspaces: where personal data, built-in design systems and written guides live, the rule book a workspace uses, team setup | `app/workspace.py`, `projects.seed_builtin`, storage paths, `app/rulebook-builtin.json` |
| `docs/setup-brief.md` | step-by-step brief for an AI assistant setting up a company workspace (design systems, guides, test, teammate README) | `app/workspace.py` commands, the plugin's tools, or the workspace layout |

`tests/test_docs.py` fails when routes, event types, modules, MCP tools, CLI flags or test
files are missing from these docs. Treat a failure as "update the doc", not "loosen the test".

## Commands

```bash
uv run uvicorn app.server:app --port 8765   # run the app
uv run pytest                               # full suite; must pass before you report done
uv run playwright install chromium          # once, for preview tests
cd creative-library && ./node_modules/.bin/vitest run   # the library's own suite; must also pass when you touch it
```

`creative-library/` is a Node project inside this Python one (its history came in with
`git subtree`). It has its own `package.json` and tests; nothing in `app/` imports it. The
design agent reads it, read-only, and copies from it.

## Rules

- **Every change comes with tests.** New behaviour gets a test that fails without it.
  Bug fixes start with a test that reproduces the bug. Run the whole suite, not one file.
- **Every change keeps the docs true.** Update the docs in the map above in the same change.
  If you add a new area, add a doc and a row to the map.
- **Record decisions.** A non-obvious choice gets an entry in `docs/decisions.md` with the
  date, the choice and the reason.
- **Don't spend the maintainer's usage in tests.** Tests use `FakeEngine` (`tests/conftest.py`) or a
  fake CLI script. A live `claude -p` run uses the logged-in account's subscription: do it only for the manual
  end-to-end check in `docs/testing.md`, and say you did.
- **UI changes are checked visually.** Screenshot the studio (visual-testing skill) and
  run the design-guide gate, as described in `docs/testing.md`.
- **Stop the dev server by PID.** `pkill -f uvicorn...` from an agent shell matches the
  shell's own command line and kills it.
- **Personal data stays in the workspace.** Designs, app state, built-in design systems and
  guides live in `workspace/` (or `PM_WORKSPACE`), which is never committed
  (`docs/workspace.md`). Nothing personal goes into the repo.
- Commit only when the maintainer asks.
