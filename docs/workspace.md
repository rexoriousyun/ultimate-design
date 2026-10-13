# Workspaces: your guides, your design systems, your data

Everything that belongs to a person or a company lives in a **workspace**, a folder outside the
app's code. The repo holds only the app. Code: `app/workspace.py`.

```
<workspace>/
  workspace.json      settings (below)
  guides/             written design and UX guides, Markdown or text, one topic per file
  design-systems/     built-in design systems: manifest.json + one folder per system
  projects/  data/    designs and app state; personal, never committed (the workspace's .gitignore)
  .gitignore          made by `init`: projects/ and data/
```

`workspace.json`:

| key | values | default |
|---|---|---|
| `name` | shown nowhere yet; for people reading the file | the folder's name |
| `rules` | `"builtin"`: the accessibility floor the app measures itself. `"design-guide"`: the rule book of the separate `design-guide` command (`docs/gate-rulebook.md`) | `"builtin"` |
| `default_design_system` | the id of a system in `design-systems/` that new designs start with, until a person picks another default on Home | none |

An unknown `rules` value stops the app with an error rather than falling back.

## Which workspace is used

1. `PM_WORKSPACE`, if set (absolute path, `~` allowed).
2. Otherwise `workspace/` inside the repo (gitignored).
3. A checkout from before workspaces, with `projects/` or `data/` at the repo root and no
   `workspace/`, keeps using the repo root and the `design-guide` rule book, unchanged. Moving it
   is described at the end.

`uv run python -m app.workspace show` prints the workspace in use, its settings and its guides.

## What is enforced and what is read

| source | how it reaches a design | enforced? |
|---|---|---|
| accessibility floor (contrast 4.5:1 / 3:1 large, targets 24 px, reflow at 320 px) | every `verify` (`app/rulebook-builtin.json`) | contrast and target size block; reflow is reported |
| design system (tokens, fonts, components) | copied into the design; `verify` checks colours, fonts and look-alike components | yes, blocks |
| `guides/` | named at the head of every message; the agent may read the folder | no: the agent reads and follows them; a person reviews |
| `design-guide` rules (only with `"rules": "design-guide"`) | exported each turn, gate after the last write | per rule |

So: put anything that can be a token or a component into a design system, and everything else
into `guides/`.

## Setting up a company workspace

This section is written so a person or an AI assistant can follow it step by step. To hand the whole job to an AI assistant, give it `docs/setup-brief.md`. Each step ends
with a check.

### 1. Make it and share it

```bash
uv run python -m app.workspace init ~/work/acme-design --name "Acme"
cd ~/work/acme-design && git init && git add -A && git commit -m "Acme design workspace"
```

Push it to a **private** repository your company controls. Everyone who designs with it clones it
and points the app at it:

```bash
export PM_WORKSPACE=~/work/acme-design     # in the shell profile, or before `uvicorn`
```

Check: `uv run python -m app.workspace show` prints that folder and `"rules": "builtin"`.

The design agent runs on whatever account the `claude` CLI on that machine is logged in to. On a
work machine, log it in with the company's account (`claude` then `/login`) before the first
design.

### 2. Design systems (tokens, components, brand)

For each system (a Figma library, a token package, a component repository, a brand PDF):

1. Run the app and open **Home → New → New design system**. Give it the system's name and one of:
   - a local folder or file (a token package, a component repo, a CSS file, a screenshot);
   - a GitHub URL (`https://github.com/org/repo/tree/main/packages/tokens` for one folder);
   - a Figma file URL (set `FIGMA_TOKEN` to a personal access token first; never commit it);
   - files (PDF brand books, decks, screenshots) with or without a source.
   The design agent extracts `tokens.css`, a `README.md` written for the agent, components and a
   specimen page. It reads the source and never changes it.
2. Review the specimen in the studio and correct it in chat until it matches the real system.
   Ask for `components/` for the components designs use most (buttons, inputs, cards, tables).
3. Share it through the workspace (the app need not be running):
   ```bash
   uv run python -m app.workspace add-system <slug> --id acme
   ```
   `<slug>` is the design system's id in the studio's URL (`#/p/<slug>`). This copies it to
   `design-systems/acme/` and lists it in `design-systems/manifest.json`.
4. To make it the default for every new design, add `"default_design_system": "acme"` to
   `workspace.json`.
5. Commit and push the workspace.

Check: restart the app; Home → Systems shows the system as "Built-in system", read-only, and a new
design starts with it when it is the default. To change a shared system later, duplicate it in the
studio, change the copy, and run `add-system` on the copy with the same `--id`.

### 3. Written guides

Convert each written guide (Confluence, Notion, Google Docs, PDF, a wiki) into Markdown under
`guides/`, one topic per file: `buttons.md`, `forms.md`, `errors-and-empty-states.md`,
`voice-and-tone.md`, `navigation.md`, `accessibility.md`, `data-tables.md`. Sub-folders are fine.

Write them for an agent that will follow them literally:

- Start each file with its source and date: `Source: <link>, copied 2026-10-13`.
- State rules as instructions, one per bullet: "Put the primary action last in a button group."
  Not background or history.
- Give the reason when it is not obvious, and an example of right and wrong when the rule is
  about wording or layout.
- Leave out anything a token or component already settles (colours, sizes, radii): that belongs in
  the design system, where it is checked.
- No secrets, customer data or names of real people: the guides go to the model with every design.

`guides/README.md` is for people and is not given to the agent.

Check: `uv run python -m app.workspace show` lists every guide; in a new design, ask "which of the
workspace guides apply to a sign-up form?" and the agent names the right files.

Guides that change often can instead be connected live: add the tool's MCP server as a connector
(`docs/connectors.md`) and turn it on per project. Copies in `guides/` are preferred: they are
reviewed, versioned and the same for everyone.

### 4. Each teammate

1. Install `uv`, the `claude` CLI (logged in with the company account) and git.
2. Clone this repo and the company workspace.
3. `uv run playwright install chromium` once, in the repo.
4. Set `PM_WORKSPACE` to the workspace clone, then `uv run uvicorn app.server:app --port 8765`.
5. For Claude Code, install the plugin (`README.md`) and set `ULTIMATE_DESIGN_DIR` to the repo
   and `PM_WORKSPACE` to the workspace, in the shell profile or in `env` of
   `~/.claude/settings.json`.

Their designs, chats and decisions stay in their own `projects/` and `data/`, which the
workspace's `.gitignore` keeps out of the shared repository.

## Moving an older checkout into a workspace

A checkout from before workspaces keeps its folders at the repo root (see above). To move it:
stop the app, move `projects/`, `data/` and any `design-systems/` folders into one folder
(for example `workspace/` in the repo), add a `workspace.json` with the rule book it used
(`{"rules": "design-guide"}`), and start the app with that folder as the workspace. design-guide's
own project registry (`~/.config/design-guide/projects.json`) stores absolute paths to projects;
update those paths after moving, or design-guide loses the projects it knew.
