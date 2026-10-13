# Architecture

```
browser (static/)  --HTTP/SSE-->  FastAPI (app/server.py)
                                    |-- app/projects.py   project storage
                                    |-- app/versions.py   git history per project
                                    `-- app/engine.py     runs `claude -p` per turn
                                                             `-- app/preview_mcp.py (MCP, stdio)
                                                                  `-- app/preview.py (Chromium)
```

## Modules

| module | role |
|---|---|
| `app/server.py` | HTTP routes. Starts each chat turn as a background task (`run_turn`), streams its events, nudges the agent, commits a version. |
| `app/turns.py` | `Turn`: a running turn's events, followed by any number of HTTP responses from any index, so a closed tab never stops the agent. |
| `app/workspace.py` | The workspace (`docs/workspace.md`): the folder holding `projects/`, `data/`, built-in `design-systems/` and written `guides/` (`PM_WORKSPACE`, else `workspace/` in the repo, else the repo root of a checkout from before workspaces); `workspace.json` (`rules`: `builtin` or `design-guide`, `default_design_system`); the guides note at the head of each design message (`guides_note`); and `python -m app.workspace init / add-system / show`. |
| `app/projects.py` | Creates, lists, duplicates and deletes projects. Chat log, metadata, version wrappers, safe file lookup. |
| `app/versions.py` | Git plumbing with the repository outside the design folder. |
| `app/rulebook.py` | The rule book. A workspace with `"rules": "builtin"` gets `app/rulebook-builtin.json` (the accessibility floor `verify` measures: contrast, target size, reflow), with no design-guide call, no gate and no proposals. Otherwise design-guide is the rule book (`docs/gate-rulebook.md` sections 1-8): exports the project's rulebook (`design-guide export rulebook --project <design> --decisions data/<slug>`) into `data/<slug>/rulebook.json` at the start of every turn, or the reason it failed; turns its `layer: project` rules (the project's own taste-rule picks) into a note at the head of the turn's prompt (`settled`); which rules block (`confirmed`, `fail`, `stable`); the rules Rex dismissed (from the decision log); the in-page measures (`contrast`, `target-size`, `reflow`); and `design-guide gate --json` on a served page, turned into findings. `PM_DESIGN_GUIDE` overrides the command. |
| `app/target_size.js` | Evaluated by `app/preview.py` for the rulebook's `target-size` measure: interactive targets under the rule's minimum, with WCAG 2.5.8's inline and spacing exceptions. |
| `app/decisions.py` | The decision log (`docs/gate-rulebook.md` sections 9-14): Rex's picks, rejections and overrides appended to `data/<slug>/decisions.jsonl` in the shape of `docs/decision-log.schema.json`. Keeps a quoted reason only when it is an exact substring of what he wrote; coalesces Edit-mode changes per chat turn with `supersedes`; adds a later reason as a superseding copy. |
| `app/comments.py` | Element comments in `comments.json`, locked with `flock` because the server and the MCP server both write it. Formats open comments for the prompt. |
| `app/edits.py` | Edit-mode saves: text replaced in `.html`/`.js` where it occurs exactly once; style changes (size, spacing, type incl. font family, weight, tracking and line height, radius, alignment, colour, `translate`, `order`, and `display: none` for a delete) kept per page in `data/<slug>/style-edits.json` and written to one stylesheet per page (`studio-edits.css` for the entry page, `studio-edits-<page>.css` for others), each linked last by its page. |
| `app/connectors.py` | Connectors: MCP servers in `data/connectors.json` (Claude Code's `mcpServers` format) that projects turn on; `engine.py` adds them to the agent's MCP config. See `docs/connectors.md`. |
| `app/attachments.py` | Files attached to chat messages (and captured pages): stored in `data/<slug>/attachments/`, pending until the next message, Office files converted to text. |
| `app/sources.py` | Design-system sources from a GitHub URL (shallow clone) or Figma URL (API export with `FIGMA_TOKEN`), fetched into `data/<slug>/source/`. |
| `app/claude_code_mcp.py` | MCP server for Claude Code sessions (the "/design" link): create and change designs, read files and handoff notes, sync a design system, wait for the user's approval in the studio. Talks to the running app over HTTP and starts it when it isn't running. Packaged as the Claude Code plugin in `plugin/`. See `docs/claude-code.md`. |
| `app/conformance.js` | Evaluated by `app/preview.py` when a design has `design-system/`: colours and fonts on the page that the system's tokens don't define, minus declared `--ds-override-*` properties and Edit-mode colours, and look-alikes of the system's components (the component CSS is passed in by `preview.py`). Without a design system it checks a page's Wada palette instead: colours outside the combination, minus `--palette-override-*` and Edit-mode colours. A finding fails `verify`. |
| `app/techniques.py` | The technique library's web recipes for the studio: the catalogue from `recipes/web/manifest.json` (with each recipe's screenshot, header comment and intents from `recipes/web/intents.json`) and a live demo page per recipe, mounted the way the library's render gate mounts it. |
| `app/palette.py` | Wada palettes: reads `creative-library/palettes/wada/colors.json`, looks up a combination by number, and parses a page's `<meta name="palette" content="wada:NNN">` for `verify`. |
| `app/hierarchy.js` | Evaluated by `app/preview.py` for design projects (`Previewer(hierarchy=True)`, set by `PM_HIERARCHY=1`): measures each `data-priority` element's prominence (text size, weight, contrast, fill or outline, position) and reports where a lower priority, or unmarked text, stands out as much as a higher one. See `docs/agent.md`, Hierarchy. |
| `app/board.py` | The board: a design's pages as frames in rows, from the agent's `board.json` (page, title, width 390/834/1440, row; or `paper` letter/a4, `landscape`, `print` page/flow for a sheet of paper) or, without one, every page in one row. Unlisted pages join the first row; problems (bad JSON, missing page, bad width) are returned, shown on the board and reported by `verify`. |
| `app/tweaks.py` | Reads the design's tweaks block and rewrites its default values. |
| `app/export.py` | Single-file HTML (local CSS, JS, images and CSS `url()`s inlined as text or data URIs) and ZIP export. PNG and PDF come from `app/preview.py`. |
| `app/engine.py` | `ClaudeCodeEngine`: builds the `claude` command, parses `stream-json`, normalizes events, stops turns. Also `needs_verification`. |
| `app/ollama_proxy.py` | Pass-through proxy in front of Ollama that adds `thinking: disabled` and a default temperature to Messages requests (see `docs/agent.md`, Local models). |
| `app/compare.py` | Compare two versions: a full-page screenshot of one page at one width from each (`Previewer.full_page`), and the changed regions, found in the shared Chromium by comparing the two on a 12 px grid and merging nearby changed cells into boxes (no image library). Both cached under `data/<slug>/compare/`. |
| `app/thumbnails.py` | Home thumbnails: the latest version's entry page at 1440x900, device scale 0.3 (432x270 PNG), one shared Chromium, one render at a time, cached as `data/<slug>/thumb-<sha>.png`. |
| `app/preview.py` | Serves a project folder over local HTTP and renders it in headless Chromium: screenshots, console problems, the rulebook's in-page measures (`app/contrast.js`, `app/target_size.js`, reflow at 320px) as findings named by rule id, or, with no rulebook (previews, thumbnails), the built-in contrast check; project CSS/JS the page never loads, JS evaluation. |
| `app/preview_mcp.py` | MCP server exposing `verify`, `screenshot`, `eval_js`, `resolve_comment` to the design agent. |
| `app/prompts/system.md` | The design agent's system prompt. |
| `app/prompts/extract.md` | The system prompt for design-system projects; `{source}` is replaced with the source path. |
| `static/` | The studio UI: plain HTML/CSS/JS, no build step. |
| `static/tokens.css` | The "Paper" design tokens (`--pm-*`), light and dark. `static/style.css` uses only these. |
| `static/markdown.js` | Renders the Markdown subset agents use in replies, building DOM nodes (never parsing HTML). |
| `static/canvas-bridge.js` | Runs inside the canvas iframe: comment picking and pins, live tweaks, option list, Edit mode (select, multi-select, drag, align, resize, text). |

## Storage

All of it lives in the workspace (`app/workspace.py`), never in the repo:

```
workspace.json          {name, rules, default_design_system}
guides/                 written guides (.md/.txt) named to the design agent; README.md is for people
design-systems/<id>/    built-in design systems (listed in design-systems/manifest.json)
projects/<slug>/        design files only; the agent's working directory
data/<slug>/meta.json   name, kind, source, design_system, builtin, model, entry file, session id, pending note
data/<slug>/chat.jsonl  one stream event per line (see below), plus user messages
data/<slug>/comments.json  element comments, open and resolved (+ comments.lock)
data/<slug>/decisions.jsonl  the user's design decisions, append-only (docs/decision-log.schema.json); design-guide's periodic pass reads it
data/<slug>/rulebook.json   the project's rulebook (built in, or design-guide's), exported as each turn starts (or {"error": ...})
data/<slug>/git/        git repository whose work tree is projects/<slug>/
data/<slug>/thumb-<sha>.png  Home thumbnail of that version (older ones deleted)
data/<slug>/versions/<sha>.png  History thumbnail of that version (kept)
data/<slug>/compare/<sha>-<page>-<width>.png  a version's page, whole, for Compare (kept)
data/<slug>/compare/<a>-<b>-<page>-<width>.json  the changed regions between two versions (kept)
data/<slug>/attachments/     chat attachments (+ .txt for Office files); attachments.json index
data/<slug>/source/          a GitHub clone or Figma export (design-system projects)
data/<slug>/style-edits.json direct style edits by page, rendered to projects/<slug>/studio-edits*.css
data/<slug>/references/<hash>/ a GitHub clone or Figma export connected to a design as reference
projects/<slug>/board.json  the board's layout, written by the agent (optional)
data/settings.json           app settings: default_design_system
data/connectors.json         connectors, {"mcpServers": {name: config}}
creative-library/           in the repo, not the workspace: the technique library: recipes, their toolchain and skill (Node; own tests)
```

## Project kinds

| kind | entry | agent prompt | extra access |
|---|---|---|---|
| `design` | `index.html` | `system.md` | `creative-library/` read-only (the technique library) |
| `design-system` | `specimen.html` | `extract.md` | `source` (absolute folder, or a file's folder) read-only |

A design system project writes `tokens.css`, `README.md`, `specimen.html` and, when the
source has components, `components/components.css` (plus `components.js` for behaviour). It is
edited like any project (chat, versions, comments).

**Built-in design systems** come with the workspace as `design-systems/<id>/` (`tokens.css`,
`README.md`, `specimen.html`, and `specimen/` for files only the specimen uses), named in
`design-systems/manifest.json`. At startup (`lifespan`) `seed_builtin` makes each one a
design-system project with `meta.builtin = <id>` (slug from its name), or, when it exists,
mirrors the folder into it and commits a version if anything changed. A built-in
system is read-only in the studio: chat, edits, tweaks, restore and delete answer 403
naming the folder. Duplicating one gives an ordinary, editable design-system project.

A design uses a design system by `design_system` in its meta. `set_design_system` copies
every file of the system except its entry (`specimen.html`) and `specimen/` into `projects/<slug>/design-system/`,
queues a note and commits. Before every turn, `sync_design_system` recopies it if the
system changed and queues a note. The copy makes exports and versions self-contained.
Older `meta.json` files get missing keys from `META_DEFAULTS`.

A design system's `source` may be a GitHub or Figma URL: it is fetched at creation into
`data/<slug>/source/` (`meta.source_dir`), and `POST .../source/refresh` fetches it again.
`meta.last_claude_code` is set by the Claude Code link (`POST .../link`). A design system
with no `source` is built from files attached to its first message.

`data/settings.json` holds `default_design_system`: the system attached to every new
design unless the create request names another (or `null`). Until a person sets it, it is the
built-in system named by `workspace.json`'s `default_design_system`. Deleting that system clears it.
`meta.connectors` lists the connectors a project turned on. `meta.references` lists a
design's reference material as `{source, dir}`: each `dir` is a read-only folder for the
agent (`turn_options`), restated at the start of every prompt (`describe_references`) so a
new session still knows it. Duplicating copies fetched references and shares local ones.

A branch (`POST .../branch`) is a new project holding the files of one version, committed
as "Branched from <name> version <n>"; `duplicate` copies the live files.

A comment: `id`, `selector`, `tag`, `page` (its HTML page; `""` for the entry page),
`element_text`, `note`, `status` (`open`/`resolved`), `created`, `resolution` (the agent's
one-line summary).

App state stays out of `projects/<slug>/` so the agent never reads or edits it. The repo
ignores `workspace/`, and a workspace made by `init` ignores its own `projects/` and `data/`.

`pending_note` in `meta.json` is text prepended to the next prompt, then cleared. It tells
the agent about changes it did not make: a version restore, or tweak values the user kept.
Notes queue up (`projects.add_note`) until the next message.

## A chat turn

1. `POST /api/projects/{slug}/chat` logs the user message with the open comments, starts
   `run_turn` as a background task registered in `turns`, and returns a stream that
   follows it. `run_turn` calls `engine.run`. The prompt is `build_prompt`: pending notes, the message, then
   the open comments (`comments.prompt_block`). A message may be empty if comments are
   open. The engine gets `PM_COMMENTS_FILE` so the MCP server can resolve comments, and
   `PM_DECISIONS_FILE`, `PM_CHAT_FILE`, `PM_PROJECT_SLUG` and `PM_DECISION_CONTEXT` for
   `log_decision`, and `PM_RULEBOOK_FILE` for `verify`. `run_turn` first exports the
   project's rulebook (`rulebook.export`) and puts the workspace's guides note (`workspace.guides_note`,
   design projects only) at the head of the prompt; with design-guide as the rule book, after the agent's
   last write it runs the gate on the pages it wrote (`rules_pass`, a `findings` event). The message marks a new chat turn for the decision log (`meta.decisions_mark`),
   and `answers` (the questions form's, structured) are logged as picks.
2. Each normalized event is appended to `chat.jsonl` and sent as a server-sent event.
3. A `done` event stores the session id, so the next turn resumes the same conversation.
   A turn stopped before `done` does not store it (see SPEC known limits).
4. Nudges, each at most once per user message: if the turn completed with no text and no
   tool call (`is_empty_turn`), the server sends a `note` and runs one more turn with
   `EMPTY_NUDGE`; otherwise, if it wrote files and did not call `verify` after the last
   write, it sends a `note` and runs one more turn with `VERIFY_NUDGE`.
5. The design folder is committed with the user's message as the commit message, and a
   `version` event is sent. A stopped or disconnected turn is committed too.

Closing the browser tab ends only that response; the turn keeps running. A page that
loads while a turn runs (`running: true`) gets `turn_events`, the count of the turn's
events already reflected in `chat`, and follows `/turn?since=<turn_events>`. The count
is read before the chat, so an event landing in between shows twice at worst, never
goes missing. Stop sets `turn.stopped` (no further nudge run) and terminates the
current process. `busy(slug)` (a registered turn, or a running process) gates every
route that must not run during a turn.

## Stream events

Every line of `chat.jsonl` and every SSE `data:` payload is one JSON object with a `type`:

| type | fields | from |
|---|---|---|
| `user` | `text`, `comments`, `attachments`, `context` | server, when a message is sent (log only, not streamed) |
| `text` | `text` | engine: assistant text |
| `tool` | `id`, `name`, `summary` | engine: a tool call; `summary` like `Write index.html` |
| `tool_result` | `id`, `is_error` | engine: result of a tool call |
| `done` | `is_error`, `cost_usd`, `session_id`, `tokens` (`input`, `output`, `cache_read`, `cache_write`, from the CLI's `usage`), `local` (a local model's turn, left out of totals) | engine: the CLI's final result |
| `error` | `message` | engine: CLI exited without a result, or `Stopped.` |
| `note` | `text` | server: app message to the user, e.g. the verify nudge |
| `findings` | `rulebook`, `pages`, `findings: [{rule, page, title, layer, fix, blocking, dismissable, reasons, where}]`, `errors`, `exceptions: [{name, value, file}]` (the agent's declared `--ds-override-*` / `--palette-override-*` properties, `rulebook.declared_exceptions`, listed under "Exceptions the agent declared") | server: design-guide's gate on the pages the turn wrote, once per message after the agent's last write (`rules_pass`); rules Rex dismissed and the measures `verify` runs in the page are left out. Blocking findings start one follow-up turn with `RULES_NUDGE` |
| `plan` | `summary, steps: [str]` | server: the agent's accepted `propose_plan` call, moved here from its `tool` event like `questions` |
| `questions` | `questions: [{text, options?, multiple?}]` | server: the agent's accepted `ask_questions` call (the engine attaches the tool input to its `tool` event; the server moves it here after a successful `tool_result`, so the log holds it once) |
| `version` | `sha` | server: a version was committed (streamed only, not logged) |

## HTTP routes

| method | path | purpose |
|---|---|---|
| GET | `/` | studio page; its `/static/` stylesheets and scripts carry `?v=<content hash>` (`asset_url`) and the page is sent `Cache-Control: no-cache`, so a browser never pairs new markup with an old stylesheet. The canvas bridge script is versioned the same way (`bridge_tag`) |
| GET | `/api/techniques` | the library's web recipes: `[{id, label, primitive, description, intents, props, evidence, source, screenshot, notes}]`; `props` carry each parameter map (`controls`, `range`, `sweep`, `breaks`, `unswept`), `evidence` the sweep's verdict and strip URL per prop (`techniques.all_techniques`) |
| GET | `/library/demo/{technique_id}` | one recipe's own demo as a page (three.js and its dependencies only when declared), for the technique detail view (404 unknown) |
| GET | `/api/palettes/wada` | Sanzo Wada's 348 colour combinations, `{"<number>": {colors: [{name, hex}], harmony, value, strength, text_contrast}}` (`palette.all_combinations`; the tags are read from the library's generated `combinations.md`), for the palette note, Edit-mode colours and the palette browser |
| GET | `/api/models` | `{default, claude, local}`: the default Claude model, the Claude models a project can switch to (`engine.CLAUDE_MODELS`, id to name) and Ollama models as `ollama:<name>` |
| PUT | `/api/projects/{slug}/model` | switch the project's model `{model}` (null: the default Claude model) from the next message; between Claude models the session continues, to or from a local model it resets with a note (400 unknown, 409 while running) |
| GET | `/api/projects` | list projects, newest first; each has `version`: the latest version's sha, `"live"` for a page with no versions (projects from before version history; its thumbnail is rendered uncached), or null with no page; each also carries `palette` (the entry page's Wada palette) and `findings` (`{count, blocking}` from design-guide's last check, or null) for its Home card |
| GET | `/api/projects/{slug}/versions/{sha}/shot` | `?page=&width=`: one page of one version, whole, at one width (320-2560), as a PNG: a side of Compare (404 no such version or page, 400 a path outside the design or a width out of range) |
| GET | `/api/projects/{slug}/compare` | `?a=&b=&page=&width=`: what changed on the page from version a to b: `{a, b, page, width, files: [{path, added, removed}], missing: "a"/"b"/null, size: {width, heights}, boxes: [{x, y, w, h}]}` (app/compare.py) |
| GET | `/api/projects/{slug}/versions/{sha}/thumbnail` | a small PNG of one version's entry page for History, rendered once from the version's files and kept (`data/<slug>/versions/<sha>.png`) (404 no such version or no page) |
| GET | `/api/projects/{slug}/thumbnail` | PNG of the latest version's entry page (404 before a design exists); not cached while a turn runs, since it renders the live files |
| POST | `/api/projects` | create `{name, kind?, source?, model?, design_system?}`; a design system's `source` is an existing absolute path, a GitHub URL, a Figma URL (fetched now; 400 if that fails) or empty (built from attached files); `model` must be null (Claude) or a pulled Ollama model; a design gets `design_system`, or the default system when the field is left out |
| GET | `/api/projects/{slug}` | metadata + `chat`, `usage` (running totals over finished Claude turns: `turns`, `cost_usd`, `input`, `output`, `cache_read`, `cache_write`; `usage_total`), `files`, `folder` (absolute design folder), `versions`, `comments`, `attachments` (pending), `running`, `turn_events` |
| POST | `/api/projects/{slug}/duplicate` | copy design files into a new project |
| POST | `/api/projects/{slug}/branch` | new project from one version's files `{sha, name?}` (404 unknown version) |
| POST | `/api/projects/{slug}/references` | connect reference material to a design `{source}`: an absolute local path, or a GitHub or Figma URL fetched into `data/<slug>/references/<hash>/` (400 invalid or already connected, 409 while running) |
| DELETE | `/api/projects/{slug}/references` | disconnect `?source=`; a fetched copy is deleted, a local folder is left alone |
| PUT | `/api/projects/{slug}/plan-first` | `{on}`: the agent proposes a plan to approve before it builds, from the next message (`meta.plan_first`) |
| PUT | `/api/projects/{slug}/connectors` | turn connectors on for the project `{names}` (404 unknown name) |
| GET | `/api/settings` | `{default_design_system}` |
| GET | `/api/workspace` | the workspace in use: `{name, rules, guides}` (guides relative to `guides/`) |
| PUT | `/api/settings/default-design-system` | set `{design_system: slug}` or clear (`null`) |
| GET | `/api/connectors` | connectors: `[{name, target}]` |
| PUT | `/api/connectors/{name}` | add or replace `{config}` (a `.mcp.json` server entry with `command` or `url`) |
| DELETE | `/api/connectors/{name}` | remove a connector |
| DELETE | `/api/projects/{slug}` | delete project and its data (403 built in, 409 while running) |
| POST | `/api/projects/{slug}/chat` | run a turn `{message, context?, comment_ids?, answers?}`; `answers` (`[{question, options, chose, other, topic?, rule?}]`, sent by the questions form) become `pick` decisions for questions with options; `comment_ids` limits which open comments go with it (default: all; the rest stay open); `context` is what the user sees (`page`, `width`, Edit-mode `selected` `{selector, tag, text, count}`), turned into a "Studio context" line before the message (`describe_view`; the page and width only when they differ from the entry page at 1440px, the selection whenever there is one) and kept on the logged `user` event; response is `text/event-stream` (403 for a built-in design system) |
| POST | `/api/projects/{slug}/stop` | stop the running turn |
| POST | `/api/projects/{slug}/link` | record that a Claude Code session used the project (the MCP server calls it) |
| POST | `/api/projects/{slug}/edits` | save Edit-mode changes `{styles: {page: {selector: {prop: value}}}, texts: [{selector, before, after, page?}], before?: {page: {selector: {prop: value}}}}` as a version, and each change as an `override` decision (`before` is what the canvas computed before the edit, its `from`); returns `placed`, `unplaced`, `styles`, `files`, `deleted`, `decisions` (ids) (400 bad style or page, 403 built in, 409 while running). Deleted elements go to `meta.pending_deletes`; the next turn's note names them and, when that turn completes, `edits.drop_deletes` removes their rules (left in place, an `nth-of-type` rule would hide the next sibling once the element is gone) |
| POST | `/api/projects/{slug}/attachments` | attach a file to the next message: body = bytes, `?name=` (400 unsupported type or over 20 MB) |
| POST | `/api/projects/{slug}/attachments/capture` | attach a web page `{url}`: full-page PNG + visible text |
| POST | `/api/projects/{slug}/attachments/sketch` | attach a drawing `{page, width, height, scroll_y, overlay}`: the page rendered at the canvas's size and scroll with the strokes (a PNG data URL) laid over the viewport, saved as `sketch-N.png` (`Previewer.sketch`) |
| GET | `/api/projects/{slug}/attachments/{item_id}` | an attachment's file |
| DELETE | `/api/projects/{slug}/attachments/{item_id}` | remove a pending attachment |
| POST | `/api/projects/{slug}/source/refresh` | fetch a GitHub or Figma design-system source again |
| GET | `/api/projects/{slug}/turn` | follow the running turn from event `?since=N` (reattach after reload); ends at once if none runs |
| GET | `/api/projects/{slug}/board` | the board: `{rows, frames: [{page, title, width, height, row}], problems}` (live files) |
| GET | `/api/projects/{slug}/versions` | versions oldest first: `sha`, `time`, `message` |
| POST | `/api/projects/{slug}/restore` | restore `{sha}` as a new version, logged as one `reject` over the versions restored away; returns `sha`, `decisions` (403 built in, 409 while running) |
| GET | `/api/projects/{slug}/decisions` | the project's decision log, oldest first |
| GET | `/api/proposals` | rules design-guide proposes from every project's decision log (`design-guide proposals --decisions data/`; 404 when the workspace's rules are built in): `proposals`, `withheld`, `problems`, `logs`, `counted`, `threshold`, plus the rulebook's `categories` (502 when the CLI fails) |
| POST | `/api/projects/{slug}/approve` | the user approves the current version for building `{why?}`: `meta.approved = {sha, at, why}`, returned (400 no version yet, 403 built in, 409 while running). The plugin's `wait_for_approval` and `get_handoff` read it |
| POST | `/api/proposals/{proposal_id}/{action}` | `confirm` or `reject` a proposal `{why, rule_id?, title?, category?}` through design-guide's command, the only writer of rules (404 when the workspace's rules are built in); confirming needs the user's reason (400 without, before design-guide is asked); design-guide's refusal comes back as a 400 with its reason |
| POST | `/api/projects/{slug}/findings/dismiss` | Rex dismisses a rule's findings for this project `{rule, page?, why?}`: an `override` decision with `dismissed: true`, returned (404 not in the project's rulebook, 400 an accessibility-floor rule, 403 built in) |
| POST | `/api/projects/{slug}/decisions/why` | Rex's reason `{ids, why}` for decisions just logged (the studio's "why?" card); each is repeated with `why` set, superseding it (400 empty) |
| GET | `/api/projects/{slug}/comments` | open comments |
| POST | `/api/projects/{slug}/comments` | add `{selector, tag, element_text, note, page?}` |
| DELETE | `/api/projects/{slug}/comments/{comment_id}` | delete a comment |
| POST | `/api/projects/{slug}/tweaks` | keep `{values, page?}` as that page's tweaks block defaults (entry page by default), each changed tweak an `override` decision (`decisions` in the response); commits a version (400 without a block, 403 built in, 409 while running) |
| PUT | `/api/projects/{slug}/design-system` | attach `{design_system: slug}` or detach (`null`); designs only; commits a version; a change is a `pick` over the other design systems (`decisions` in the response) |
| GET | `/api/projects/{slug}/export/{fmt}` | download `html` (single file), `png` (full page, 1440 wide) or `pdf` of `?page=` (the entry page by default); `frames` (every board frame as one PDF, merged with pypdf); or `zip`. A page the board prints on paper exports as that paper (`Previewer.pdf_frame`): a designed page at its size, or a flow document paginated on Letter/A4 with 0.75in margins and print styles; any other page is one long page with screen styles |
| GET | `/p/{slug}/{path}` | live design file, unchanged ("Open in new tab") |
| GET | `/v/{slug}/{sha}/{path}` | design file at a past version, unchanged |
| GET | `/canvas/{slug}/{path}` | live design file for the canvas: HTML gets the canvas bridge; a missing page redirects to the entry page |
| GET | `/canvas-version/{slug}/{sha}/{path}` | the same for a past version |
| GET | `/static/...` | studio assets, including `canvas-bridge.js` |

Design files send `Access-Control-Allow-Origin: *` because the canvas iframe is
sandboxed without `allow-same-origin`, which gives it an opaque origin. The bridge is
chosen by path prefix, not a query parameter, so a relative link inside the design (to
`pricing.html`) stays under `/canvas/` and the next page gets the bridge too. "Open in
new tab" and the agent's own previews get files unchanged.

## Canvas bridge protocol

The studio (`static/app.js`) and `static/canvas-bridge.js` inside the iframe talk only via
`postMessage`. Every message carries `source`: `pm-studio` (to the canvas) or `pm-bridge`
(to the studio). Each side ignores messages not from the other window.

| direction | type | fields | meaning |
|---|---|---|---|
| bridge → studio | `ready` | `tweaks`, `options`, `tokens`, `fontTokens`, `sizeTokens`, `pageFonts`, `path`, `palette` (the page's `<meta name="palette">` content or null), `priorities` (how many `[data-priority]` elements), `fixedWidth` (the width in the page's `<meta name="viewport" content="width=N">`, 200-4000, or null) | page loaded; tweak definitions, `[data-option]` sections, the design system's colour tokens (`[{name, value}]`, read by fetching `design-system/` stylesheets), and the page's URL path (the studio follows links between pages with it) |
| bridge → studio | `picked` | `selector`, `tag`, `text` | user clicked an element in comment mode |
| bridge → studio | `escape` | | Esc pressed inside the design in comment or edit mode (focus is in the frame) |
| bridge → studio | `selected` | `count`, `selector`, `tag`, `text`, `textLeaf`, `box` | edit mode: selection changed (`selector: null` for none); the fields describe the primary (last) element, `count` is how many are selected (shift-click adds); `box` = measured width, height, padding, margin, gap, font size, radius, text align, `color`, `background` (hex, `""` if transparent), `x`/`y` (`translate`) |
| bridge → studio | `text-edited` | `selector`, `before`, `after` | edit mode: text changed in place (double-click, Enter to finish, Esc to cancel) |
| bridge → studio | `style-before` | `selector`, `prop`, `value` | edit mode: the computed value a property had before Edit mode first changed it on that element (once per element and property per page load); sent with the save as the decision's `from` |
| bridge → studio | `style-changed` | `selector`, `props` | edit mode: resized with the corner handle, dragged (`translate`, or `order` for every child when the parent is flex or grid), or aligned |
| studio → bridge | `edit-mode` | `on` | select on click, edit text on double-click, show the resize handle |
| studio → bridge | `set-style` | `selector`, `prop`, `value` | apply a style live (`!important` inline) |
| studio → bridge | `set-text` | `selector`, `text` | re-apply an unsaved text edit after a reload |
| studio → bridge | `edit-text` | | start editing the selected element's text |
| studio → bridge | `duplicate` | | preview a copy of the selected element after it; replies `structural` |
| studio → bridge | `wrap` | `layout` (`flex`/`grid`) | preview wrapping the selected siblings; replies `structural` (`ok: false` with a `reason` if they aren't siblings) |
| bridge → studio | `structural` | `ok`, `kind`, `selector` or `selectors`, `tag`, `text`, `labels`, `layout`, `reason` | a structural preview happened (or was refused) |
| bridge → studio | `scroll` | `y` | the page scrolled (debounced), so a sketch matches what was on screen |
| studio → bridge | `present` | `on` | present mode: pass stepping keys (arrows, Page Up/Down, Esc) to the studio |
| bridge → studio | `present-key` | `key` | a stepping key pressed inside a presented frame (not while typing) |
| studio → bridge | `align` | `edge` | align the selected elements' boxes: `left`, `center`, `right`, `top`, `middle`, `bottom` (via `translate`) |
| studio → bridge | `comment-mode` | `on` | hover outlines; clicks pick instead of acting |
| studio → bridge | `pins` | `pins: [{selector, label}]` | draw numbered pins on commented elements |
| studio → bridge | `set-tweak` | `name`, `value` | apply a tweak value live |
| studio → bridge | `scroll-to` | `option` | scroll an option section into view |
| studio → bridge | `priorities` | `on` | draw a numbered outline over each visible `[data-priority]` element (`.pm-priority`, no pointer events), redrawn on resize and load |

Selectors come from `selectorFor` in the bridge: the nearest unique id, then
`tag:nth-of-type(n)` steps. They can go stale if the agent restructures the page.

Tweak values apply as: `--name` → CSS custom property on `<html>` (plus `unit`); other
names → `data-<name>` attribute on `<html>`; `[data-tweak=name]` elements get the value as
text; a `tweak` event fires on `window`. Defaults apply on load.

## Studio UI (static/app.js)

Visual design: "Workbench", look A of the studio redesign Rex picked on 2026-10-08
(`docs/gate-studio-redesign.md`, mockups in `docs/design/redesign/`). It replaced "Paper", the
Claude Design handoff (`docs/design/paper-handoff.md`), which read as Claude. Zero-chroma greys
(the chrome has no hue, so it never shifts how a design's colours read), Geist and Geist Mono,
ink (`--pm-accent`) for the one primary action per view, one blue (`--pm-select`) for selection
and focus, a neutral grey around the canvas (`--pm-stage`). Tokens in `static/tokens.css`;
`static/style.css` has no raw values except 1-3 px hairlines and the 800 px breakpoint. Web fonts
load from Google Fonts and fall back to system fonts offline.

- **Motion** (style.css, "Motion"): what appears eases in. A Home section, a panel tab, a new
  chat message, the "why?" prompt and the Board fade and rise a few pixels (`animateIn` adds
  `.enter`); project cards stagger in; the canvas fades when the user picks a page, a version or
  Page view (`state.fadeCanvas`, played on the bridge's `ready`), never on the reload after an
  agent write; sheets, menus and the settings popover scale in from 98%; controls ease their
  colours. The saved conversation replayed when a project opens appears at once
  (`state.replaying`). Durations are tokens (`--pm-dur-*`, `--pm-rise`), all zero under
  `prefers-reduced-motion`.
- Hash routes: `#/` Projects, `#/systems` Design systems, `#/library` Library, `#/rules` Rules, `#/p/<slug>` Studio.
- **Controls:** selects draw their own caret (`appearance: none` plus two gradient halves
  in `currentColor`) so they match on every platform; Tweaks show colour and enum
  controls inline (label left, control right; a colour shows its hex), per the Paper spec.
- **Home:** a section rail (`.rail`: Projects, Systems, Library, Rules with `#rules-count`, the
  number of open proposals read in the background; a bottom tab bar under 800 px) beside the
  section. Projects (`#/`) and Systems (`#/systems`) share the grid (`#project-list`): designs in
  one, design systems in the other. Above it, `#project-search` (always shown; `/` focuses it)
  filters the grid by name and, from two characters, lists in `#search-more` the other kind of
  project, techniques by intent (the library's `rankByIntent`) and Wada palettes by colour name;
  and `#project-tools` filters by state (All, Needs approval, Has findings) and by design
  system. "New…" (`#new-open`) opens `#new-dialog`, a `<dialog>` holding the create forms
  (`#new-project` unfolded, `#new-ds` on Systems) and Connectors; navigating closes it. The
  new-design form has a design system select (preset to the default) and prompt starters
  (`STARTERS`): each creates a design and puts its prompt in the composer to edit. The
  design-system form takes a source, files (`#ds-files`, opened by `#ds-files-pick`, names in
  `#ds-files-names`; uploaded as attachments of the new project), or both. Each card: a
  thumbnail (`<img loading="lazy">` from the thumbnail route with `?v=<version>`, or "No design
  yet"; aria-hidden and out of the tab order, the name link is the card's one tab stop), name,
  badge for design systems ("Built-in system" for one from `design-systems/`, which has no
  Delete), a meta line (model, attached system or source), `.card-state` (Approved for build,
  Changed since approval, findings of design-guide's last check, the page's Wada palette, from
  the project list's `approved`, `findings` and `palette`), time, actions (a design system's
  also "Default" and "New design"). Opening a built-in system hides the composer and the
  Comment, Edit and Draw tools and Restore, and `#ds-source-note` names its repo folder. On
  phones cards become rows with the thumbnail on the left.
- **Studio layout** (sections 5-8 of the redesign gate): `.studio-top` across the studio ("All
  projects", the project name as `#project-menu`, `#project-chip` with the design system and
  palette, the toolbar, and `#approve` as the one primary action; when the controls don't fit on
  one row the toolbar wraps, and `.top-actions` keeps Export and Approve together at the right
  end of their row), then `.studio-body`: the
  outline (`#outline`: the pages grouped by folder, Pages first, current page marked; the
  options list below), the canvas pane on `--pm-stage`, the resize handle, and the right panel.
- **Right panel** (`.chat-pane`): tabs (`.side-tabs`, arrow keys move between them) for Agent
  (the conversation), Inspect (the Edit-mode inspector, `#edit-panel`; Edit mode opens it and
  leaving Edit returns to Agent), Findings (the latest `findings` event, `#findings-count` on the
  tab) and History (`#history-list`). Under every tab, `.side-foot`: the "why?" prompt
  (`#side-prompt`), the comment and capture forms, and the composer. Width `--pm-chat-w`,
  changed by `#chat-resize` on its left edge (drag, or ← wider / → narrower in 16 px steps,
  clamped 320–560, remembered in `localStorage` as `pm-chat-w`). Agent text goes through
  `renderMarkdown`; user text stays plain.
- **Project settings** (`#project-menu`, a `<details>` from the project name): model, Claude
  Code link, design system or its source note, palette, Wada palettes and Techniques browsers,
  usage, references and connectors. Closes on Escape and on a click outside.
- **Steps:** consecutive `tool` events form one `<details class="steps">`. While a turn
  runs, its group carries `data-live` and its summary is one progress line (spinner,
  friendly label from `STEP_WORDS`, count, elapsed time, ticking each second); when the
  turn ends it becomes a muted "N steps" line.
- `followTurn` reads any turn stream: the chat POST, or `/turn` when the studio loads
  while a turn runs.
- **Canvas pane:** the stage on a neutral grey. The iframe renders at the chosen width
  (1440 / 834 / 390), or at the page's own width when it declares one (`fixedWidth` from the
  bridge: a letter sheet is 816; the viewport buttons are disabled meanwhile), and is scaled to
  fit (`fitCanvas`, `canvasWidth()`). Studio context, sketches and Compare use that width too.
- **Stage pill** (`#stage-pill`, `updateStagePill`): one status line over the canvas,
  comment mode first, then past version, then running.
- **Tweaks** float over the stage; `#tweaks-collapse` folds them into the `#tweaks-open`
  pill, and they fold by themselves in comment mode. `#tweaks-dirty` shows unsaved values.
- **Comments:** each open comment has a "Send" checkbox (ticked by default,
  `state.commentHold` keeps the unticked); only ticked ones go with the next message.
- **Comment mode:** Esc leaves it, from the studio or (forwarded by the bridge) from inside
  the canvas. Comment and Edit mode exclude each other.
- **Edit mode** (`#edit-mode`, `#edit-panel`): select an element, change width, height,
  padding, margin, gap, font size, radius, text alignment, position (Move ↔/↕), text
  colour and fill (a colour picker, or a design-system token from `ready.tokens`) in the
  inspector (live via `set-style`); resize with the corner handle; drag to move;
  shift-click to select several, then align them (`#edit-align-group`); motion (`.edit-motion`:
  an entrance, a hover state and a speed, previewed by the bridge's `motionCss` and saved by
  `edits.motion_css`, one output held by a test; "Play" replays it); double-click text
  to edit it. Type controls (font family from the design system's font tokens and the
  page's fonts, a size-token menu, weight, tracking, line height) show only for text, gap
  only for flex and grid containers. Delete hides the element (saved as `display: none`);
  Duplicate and "Wrap in row/grid" (siblings only) preview in the canvas (`data-pm-preview`)
  and, on save, go to the message box as exact instructions for the agent
  (`structuralMessage`), since mapping them back to source is guesswork. Changes are held in `state.edits.styles[page]` until "Save edits"; text that
  can't be placed is put in the message box for the agent. Disabled while an old version
  is shown. Tweaks fold away.
- **Pages:** `state.page` is the page on the canvas. `ready.path` updates it when a link
  inside the design opens another page; the outline switches pages (`#page-select` does on
  phones, where the outline is hidden). Pins show only the current page's comments; new
  comments, tweak saves and edits carry the page. After a turn that wrote files the page list
  is refreshed.
- **Connectors:** `#connector-choice` in the project settings turns connectors on per project.
- **Draw** (`#draw-mode`, `#draw-bar`, `#draw-layer`): a pen layer over the canvas (red or
  blue, fixed colours that read on any design; Undo, Clear), excluding Comment and Edit mode.
  "Attach sketch" sends the strokes with the page, width, frame height and the scroll
  position the bridge reports (`scroll` message); the server renders and composites them.
- **Present** (`#present`, `#present-view`): the board's frames full screen, one at a time,
  from the current page or selected frame: a screen frame fills the height at its device
  width, paper keeps its proportions; arrows or Page Up/Down step, Esc or Exit leaves (also
  when leaving full screen). The frame is a `/canvas/` page whose bridge, told `present`,
  passes those keys on unless the user is typing; each step returns focus to the overlay.
- **Palette and cost in the project settings:** `#palette-note` shows the canvas page's Wada palette ("Palette · Wada 006" and a swatch per colour, name and hex on hover; combinations fetched once from `/api/palettes/wada`), hidden on design systems and pages without one. `#usage-note` shows the project's turns and API-equivalent cost, tokens on hover; it starts from `usage` and adds each live `done`.
- **Turn footer:** each `done` adds `.turn-meta` with cost and tokens (in, out, cache read), and, when the agent read the technique library that turn, `.turn-techniques` naming the recipes and "Wada palettes" (from its Read steps, `noteTechnique`).
- **Priority marks:** `#priority-mode` ("Priority marks", in the toolbar), shown only when the page has `data-priority` marks, toggles the bridge's `priorities` overlay and stays on across reloads.
- **Palette browser:** `#palette-browse` ("Wada palettes", in the project settings of a design without a design system) opens `#palette-browser`, a native `<dialog>`: filters for the number of colours, harmony, value, strength, a colour name and "has a text pair (4.5:1)", then a grid of combinations (strip, number, names, tags), the page's own marked `aria-current`. Choosing one closes it and drafts "Use Wada NNN (...) as the palette for this design." in the chat box, not sent. Full screen on phones.
- **Edit-mode colours:** next to each colour picker, the design system's colour tokens, or else the page's Wada palette colours (written as hex).
- **Techniques:** `#technique-browse` ("Techniques", in a design's project settings) and "Apply technique…" in the Edit-mode inspector open `#technique-browser`, the same `library-dialog` as the palette browser: tiles with each recipe's screenshot, filtered by kind and by "What should it do?": a design ask ranked by the library's own `engine/recipes/rank.js` (imported from `/creative-library/`) against its intent index, each tile saying which purpose matched ("For: …"), with example asks as buttons; a tile opens a detail view with the live demo (`/library/demo/<id>` in a sandboxed iframe), "How it works" (the recipe's header comment) and "What can be tuned": each prop's `controls` sentence, range and default, its sweep strip (frames across its values, from `creative-library/recipes/web/sweeps/`) and a note when a still frame cannot show it or part of the range is flat. "Use on this design" drafts a request naming the recipe file, and the Edit-mode selection when it came from the inspector. The names in a turn's "From the technique library" footer open the same detail.
- **Rules** (`#/rules`, `#rules`, "Rules" in Home's rail; hidden, and `#/rules` sent Home, when `GET /api/workspace` says the rules are built in): design-guide's proposed rules (`docs/gate-rulebook.md` section 15). Each card names its kind (new rule, change a stance, revise a rule), what it is about, the direction and projects, every decision behind it (what was chosen over what, the project, the date, and Rex's words or "no reason given"), decisions against it, and for a new rule what confirming would write. "Confirm or reject…" unfolds the answer: his reason (needed to confirm), and for a new rule its id, title and a category from the rulebook's. A revision can only be rejected. Withheld proposals and unreadable log lines are listed under "Held back"; with no logs at all it says so rather than "nothing proposed".
- **Library** (`#/library`, `#library`): tabs for Techniques and Wada palettes. Choosing a technique or palette there starts a new design with the request waiting in its chat box (`createDesign`). Design systems are their own section (`#/systems`). The library's own maintenance gallery is still served at `/creative-library/` (with `/design-systems/`), and those mounts serve the screenshots and demo scripts.
- **Model:** `#model-select` in the project settings switches the project's model (disabled
  while a turn runs); the new-design form offers the same list.
- **References:** `#reference-choice` in the project settings (designs only) connects and
  disconnects reference folders or repos.
- **Export:** the per-page items (HTML, PNG, "PDF of this page") follow the page on the
  canvas (`?page=`); "PDF of all board frames" and the ZIP cover the whole design.
- **Board** (`#view-board`, `#board`): a Page | Board switch on the toolbar. The board
  renders `GET .../board` as rows of frames, each an `<iframe>` of `/p/` at the frame's
  device width and preview height (no pointer events), with a caption (title, page, width,
  "Open"). The surface is translated and scaled: wheel pans, Ctrl+wheel or pinch zooms
  around the pointer, drag pans, the zoom group steps through fixed levels, Fit computes
  the zoom from the board data (captions and row titles are counter-scaled to stay
  readable, so a measured fit would change with the zoom). A click selects a frame (sent as
  studio context); Open or a double-click shows that page in Page view at the frame's
  width. Page-only controls (viewport, page picker, Comment, Edit, Tweaks, options) step
  aside; the board is disabled while a past version is shown and reloads after file writes.
- **Studio context:** every message carries `viewContext()` (page, width, and the Edit-mode
  selection while Edit mode is on). A user bubble shows it as a muted line ("On 390px ·
  <h1> “Hello”") when it adds something beyond the entry page at desktop width.
- **Branch:** `#branch` in History makes a new project from the version on screen.
- **Plan first** (`#plan-first` in the composer, `aria-pressed`, the project's `plan_first`): each
  message asks the agent for a plan first (`PLAN_NOTE` before the prompt). A `plan` event
  renders as `planCard`: the summary and the steps as text fields (remove, "Add step"); "Build
  this" sends "Build this plan:" with the steps and `plan` set, which skips the note. Changing
  the plan in words is the composer. Any user message closes open plan cards.
- **Compare** (`#compare` in History, `#compare-view` over the stage): the version on screen
  against the current one ("Compare with current"), or on the current the version before it
  ("What changed last"). The canvas page at the canvas width, both versions whole, side by
  side in one scroll; the changed areas outlined on both (`#compare-highlight` hides them); the
  files changed with lines added and removed. Choosing a version, sending a message or opening
  another project closes it; Escape too.
- **Questions:** a `questions` event renders as a form in the log (`questionCard`): radio
  buttons or checkboxes for options, a free-text field per question, "Send answers" (which
  sends the answers as a numbered message) and "Just build it". Any user message closes
  open cards (`closeQuestionCards`), so a reloaded history shows them read-only.
- **Attachments:** paperclip (`#attach`), paste or drop files on the chat pane, or capture
  a page by URL (`#capture`); pending files show as chips (`#attachment-list`) and go
  with the next message, which may have no text. Sent files are linked in the user bubble.
- **Claude Code link:** `#link-note` shows when a Claude Code session last used the project.
- **Design systems from URLs:** the source field takes a GitHub or Figma URL; remote
  sources get a "Refresh source" button (`#ds-refresh`).
- **History** (`#tab-history`): one thumbnail per version, newest first (`GET
  .../versions/{sha}/thumbnail`); choosing one previews it via `/canvas-version/`, and "Restore
  this version" calls the restore route. Sending a message switches the canvas back to the live
  files. On the current version, "Approve for build" (`#approve`, top bar) calls the approve route
  and then reads "Approved for build" until the design changes; Claude Code waits for it
  (`docs/claude-code.md`).
- **Options** (`#options-bar`, in the outline) lists `[data-option]` sections; the one last
  jumped to is pressed; "Keep" sends a chat message.
- **Under 800 px:** `#studio[data-view]` shows the panel (Chat) or the Canvas, switched by
  `.view-switch`; the outline gives way to `#page-select`; picking an element switches to Chat
  for the comment form. The viewport buttons become `#viewport-select`, which clicks the
  matching button. Touch targets are 44 px.
- `WRITE_TOOLS` in `app.js` mirrors `WRITE_TOOLS` in `engine.py`: results of those tools
  reload the canvas.
