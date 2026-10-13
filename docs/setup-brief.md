# Setup brief: Ultimate Design with your company's design guides

**For:** an AI assistant (e.g. Claude Code) on a work machine. **From:** the person who asked
you, called "the user" below. Hand this whole file to the assistant, or tell it:
"Follow docs/setup-brief.md in https://github.com/rexoriousyun/ultimate-design".

## The goal

Set up Ultimate Design, a local design studio, so that every design it makes follows this
company's design systems and written UX guides, and so that teammates can use the same setup.
Everything company-specific goes into a **workspace**: a folder kept in a private company
repository. The app's own repository is never changed. Background: `docs/workspace.md` in the
app's repository; read it before step 4.

You are done when:
1. The studio runs at http://localhost:8765 on the company workspace.
2. Each company design system the user named is in the workspace, read-only in the studio.
3. The company's written guides are in the workspace's `guides/` as Markdown.
4. A test design follows them, and the user has looked at it.
5. The workspace is committed (and pushed, if the user said where) with a README for teammates.

## Rules for you

- **Ask the user before:** creating any repository; uploading or pasting company material
  anywhere other than this machine and the company's own repository; picking which guides or
  systems count as official. Ask once per decision, with your recommendation.
- **Never put in the workspace:** tokens, keys or passwords (`FIGMA_TOKEN` goes in the shell
  environment only), customer data, names of real people, anything marked confidential beyond
  what the company allows in its own private repositories. The guides are sent to the model with
  every design.
- **Do not edit the app's repository.** Everything you make lives in the workspace folder.
- **Check each step** with the command given, and show the user its output. If a check fails,
  stop and report the command and its output; do not work around it.
- **The design agent spends the logged-in Claude account's usage.** Run only the designs this
  brief asks for unless the user asks for more.

## 0. Check the machine

```bash
uv --version            # https://docs.astral.sh/uv/ if missing
git --version
claude --version        # then, inside claude, /status: confirm it is the COMPANY account
```

Check: all three print versions, and the user confirms the Claude account is the company's.
Ask the user for a Figma personal access token only if there are Figma libraries (step 4).

## 1. Install the app

```bash
git clone https://github.com/rexoriousyun/ultimate-design ~/tools/ultimate-design
cd ~/tools/ultimate-design
uv sync
uv run playwright install chromium
```

Check: `uv run python -m app.workspace --help` lists `init`, `add-system` and `show`.
(Optional, five minutes: `uv run pytest -q` ends with "passed" and no "failed".)

## 2. Make the company workspace

Ask the user for the company's short name (here `acme`) and where the workspace repository should
live (an organisation on GitHub, GitLab or similar; private).

```bash
cd ~/tools/ultimate-design
uv run python -m app.workspace init ~/work/acme-design --name "Acme"
cd ~/work/acme-design && git init -q && git add -A && git commit -qm "Acme design workspace"
```

Make `PM_WORKSPACE` permanent: add `export PM_WORKSPACE=~/work/acme-design` to the shell profile
(`~/.zshrc` or `~/.bashrc`), and to `~/.claude/settings.json` under `"env"` together with
`"ULTIMATE_DESIGN_DIR": "<absolute path of ~/tools/ultimate-design>"`.

Check: in a new shell, `cd ~/tools/ultimate-design && uv run python -m app.workspace show` prints
the workspace path, `"legacy": false` and `"rules": "builtin"`.

## 3. Start the studio and connect Claude Code

```bash
cd ~/tools/ultimate-design && uv run uvicorn app.server:app --port 8765    # leave it running
claude plugin marketplace add rexoriousyun/ultimate-design
claude plugin install ultimate-design@ultimate-design
```

Restart Claude Code so it loads the plugin. Check: `curl -s localhost:8765/api/workspace` returns
`{"name":"Acme","rules":"builtin","guides":[]}`, and the `list_designs` tool answers (an empty list
is fine). Tell the user the studio is at http://localhost:8765.

## 4. Inventory the company's guidance

Ask the user for every source, then write the inventory as a table and get it confirmed:

| source | kind | goes to |
|---|---|---|
| e.g. Figma "Acme UI Kit" (URL) | tokens, components | design system |
| e.g. `@acme/tokens` package or repo | tokens | design system |
| e.g. component library repo / Storybook | components | design system (same system as its tokens) |
| e.g. brand book PDF | colours, type, logo rules | design system (as files) |
| e.g. Confluence "UX writing guide" | written rules | `guides/` |

One design system per product brand the company actually ships; tokens and components of the
same brand belong to the same system.

## 5. Build each design system

For each system, with the studio running, use the plugin tool:

```
sync_design_system(source="<absolute local path, GitHub URL or Figma URL>", name="Acme UI")
```

For a PDF or slides with no code source, ask the user to create it in the studio instead:
Home, New, New design system, name, then Choose files.

The tool waits for the design agent and returns its report and the system's `README.md`
(`wait_for_turn` if it is still running). The agent writes `tokens.css`, a `README.md` for
itself, components and a `specimen.html`. Then:
1. Ask the user to open the system in the studio and compare its specimen with the real one.
   Fix differences with `send_message(project="Acme UI", message="...")`, one topic per message.
   Ask for `components/` for the components designs use most: buttons, inputs, selects,
   checkboxes, cards, tables, alerts, navigation.
2. When the user says it matches, share it through the workspace:
   ```bash
   cd ~/tools/ultimate-design
   uv run python -m app.workspace add-system <slug> --id acme
   ```
   `<slug>` is the system's id in `list_designs`.
3. If it is the main system, add `"default_design_system": "acme"` to
   `~/work/acme-design/workspace.json`.

Check: `ls ~/work/acme-design/design-systems/acme` shows `tokens.css`, `README.md` and
`specimen.html`; after restarting the studio, Home, Systems shows it as a built-in system.

## 6. Convert the written guides

For each written source, export or copy it and rewrite it as Markdown in
`~/work/acme-design/guides/`, one topic per file (`buttons.md`, `forms.md`,
`errors-and-empty-states.md`, `voice-and-tone.md`, `navigation.md`, `data-tables.md`,
`accessibility.md`, as the sources cover). For every file:

- First line: `Source: <link or document name>, copied <date>`.
- Rules as instructions, one per bullet ("Put the primary action last in a button group."),
  with the reason when it is not obvious and a right/wrong example for wording or layout rules.
- Leave out what the design system already fixes (colours, sizes, radii, fonts).
- Keep the meaning exactly. Where a source is ambiguous or two sources disagree, do not choose:
  list the question for the user.

Check: `uv run python -m app.workspace show` lists every guide; show the user the file list and
the open questions.

## 7. Test it

```
create_design(name="Setup check", prompt="A sign-up form for a new <product> account, with an error state.")
```

If the result lists questions from the design agent, answer them with `send_message` (or
"just build it" when the user has no preference). Then `get_design(project="Setup check")`.
Check, and report to the user:
- the tool's result starts with "Done." and lists no errors;
- the design uses the default system (its files link `design-system/tokens.css`);
- the studio's Findings panel for the design shows nothing blocking;
- ask the agent with `send_message`: "Which workspace guides did you follow, and where?" and
  check that the answer names the right guide files.

Ask the user to look at it in the studio. Fix what they find in the guides or the system, not in
this design. Delete the test design afterwards if the user wants.

## 8. Commit and hand over

Write `~/work/acme-design/README.md` for teammates, containing: what this workspace is, the
inventory table from step 4, and these steps:

1. Install `uv`, git, and Claude Code; log Claude Code in with the company account.
2. Clone `https://github.com/rexoriousyun/ultimate-design` and this workspace repository.
3. In the app: `uv sync && uv run playwright install chromium`.
4. Set `PM_WORKSPACE` to this repository's folder (shell profile, and `env` in
   `~/.claude/settings.json` with `ULTIMATE_DESIGN_DIR`).
5. Run `uv run uvicorn app.server:app --port 8765` and open http://localhost:8765.
6. Optional: `claude plugin marketplace add rexoriousyun/ultimate-design`,
   `claude plugin install ultimate-design@ultimate-design`.
7. To change a design system or guide: change it here, by pull request; restart the studio.

```bash
cd ~/work/acme-design && git add -A && git status --short   # check: no projects/ or data/
git commit -qm "Design systems and guides"
```

Push only to the private repository the user named in step 2.

## Report to the user

- The inventory table, and which items are done.
- For each design system: its id, its source, and anything that did not match the original.
- The guide files, and the open questions from step 6.
- The test design's result (step 7).
- Where the workspace is, and whether it was pushed.
