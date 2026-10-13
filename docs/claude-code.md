# Using Ultimate Design from Claude Code

Ultimate Design ships as a Claude Code plugin, so any project can design in the studio and
then build what the user approved. The plugin (`plugin/`, listed by this repo's
`.claude-plugin/marketplace.json`) holds three things:

- `.mcp.json` and `bin/ultimate-design-mcp`: the MCP server `app/claude_code_mcp.py`, run from
  a clone of this repo (`ULTIMATE_DESIGN_DIR`; without it, `~/Documents/Github/ultimate-design`)
  with `uv`, so the plugin never carries a stale copy of the app. It talks to the studio over HTTP (`PM_URL`,
  default `http://127.0.0.1:8765`) and starts the studio in the background when it isn't
  running (log: `data/studio.log` in the workspace, `docs/workspace.md`; `PM_AUTOSTART=0` turns that off; only for a local URL).
- `skills/ultimate-design/SKILL.md`: when to reach for the studio, the tools, and the rule below.

Everything done from the terminal shows up in the studio, which marks the project
"Claude Code · <time>". `creative-library/` is not packaged: the design agent reads it inside
this repo, as before.

## The user confirms the design in the studio

The terminal builds and changes designs; the user decides in the studio. When a design is right
they press **Approve for build** on the version bar (`POST /api/projects/{slug}/approve`, stored
as `meta.approved`). `wait_for_approval` waits for that, and `get_handoff` opens with whether the
current version is approved ("NOT APPROVED" when the design changed after approval). The skill
tells Claude not to implement before it.

## Set up (once)

Clone this repo, then tell the plugin where it is, and which workspace to use, in
`~/.claude/settings.json` (or the shell profile):

```json
{ "env": { "ULTIMATE_DESIGN_DIR": "/path/to/ultimate-design", "PM_WORKSPACE": "/path/to/workspace" } }
```

```bash
claude plugin marketplace add /path/to/ultimate-design   # or the GitHub owner/repo
claude plugin install ultimate-design@ultimate-design
```

The studio the plugin starts inherits `PM_WORKSPACE`. A studio already running keeps the
workspace it started with.

Plugin files (the skill, `.mcp.json`) are copied at install: after changing them, run
`claude plugin marketplace update ultimate-design` and `claude plugin update
ultimate-design@ultimate-design`. The app itself is read from the repo, so app changes need no
reinstall. Without the plugin, the server alone still works:
`claude mcp add ultimate-design -- uv run --directory /path/to/ultimate-design python -m app.claude_code_mcp`.

## Tools

| tool | does |
|---|---|
| `list_designs()` | projects with kind, model, design system and studio link |
| `create_design(name, prompt?, design_system?)` | new design; with a prompt the agent builds it and the tool waits; without `design_system` it gets the default system, if one is set |
| `send_message(project, message)` | a change, as if typed in the studio; waits for the result. If the design agent asked questions instead of building, they are listed; answer with another `send_message` |
| `wait_for_turn(project)` | keep following a turn that outlasted `wait_seconds` (default 600) |
| `wait_for_approval(project, wait_seconds?)` | wait until the user presses "Approve for build" in the studio for the current version; returns their approval and reason, or that it is still waiting |
| `get_design(project)` | absolute file paths, latest version, a thumbnail image |
| `get_handoff(project, write_notes?)` | whether the current version is approved, then `HANDOFF.md` plus file paths; `write_notes` asks the agent to write it first |
| `sync_design_system(source, name?)` | extract a design system from a path (e.g. the repo you're in), GitHub URL or Figma URL |
| `use_design_system(project, design_system)` | attach a system to a design |

Projects are named by slug or name (case-insensitive).

## Typical use

- "Sync the design system from this repo, then make a settings page with it":
  `sync_design_system("/path/to/repo")`, then `create_design("Settings", prompt=..., design_system=...)`.
- "Build the checkout design in our app": `wait_for_approval("Checkout")` if it isn't approved
  yet, then `get_handoff("Checkout", write_notes=true)`, then implement from the listed files in
  the real codebase.

## Notes

- A turn uses your Claude Code subscription the same way the studio does.
- If the app isn't running, the first tool call starts it (up to 30 s); if it still can't be
  reached, tools fail with a message saying how to start it.
