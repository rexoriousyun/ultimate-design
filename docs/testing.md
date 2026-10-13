# Testing

```bash
uv run pytest            # everything; about 3 min (most of it real Chromium)
uv run pytest -k server  # one area while iterating, but run everything before reporting done
cd creative-library && ./node_modules/.bin/vitest run   # the technique library; about 2 min
```

Both must pass before reporting done when you touch `creative-library/`. The library has
no lockfile; `npm install` there once (Node, Playwright's Chromium). Its manifests and skill
shelves are generated: after changing a recipe run `npm run sync && npm run render` there,
and `npm run sweep -- <id>` (its parameter-map evidence; the suite's `sweep --check` fails until then),
When design-guide's rulebook format or measures change, refresh the pinned copies:
`design-guide export rulebook --project ~/Documents/Github/design-guide/fixtures/research-pass --out tests/fixtures/rulebook-sample.json`
and `design-guide export fixtures tests/fixtures/measures`. Confirming or rejecting a proposal writes into design-guide's knowledge, so it is never done by hand
for a check; `GET /api/proposals` and the Rules view are safe to look at. Tests never run the real CLI; by hand, check one
turn in the studio shows a `findings` card and that `data/<slug>/rulebook.json` holds a version,
then `node engine/cli.js export index` in `design-guide`, whose skill index reads
them (see `creative-library/README.md`).

Chromium must be installed once (`uv run playwright install chromium`) for the preview
tests. No test calls the real `claude` CLI or spends usage.

## Test files

| file | covers |
|---|---|
| `tests/conftest.py` | temp storage for every test, no built-in design systems unless a test provides them, and no reach to the machine's own Ollama, `client` fixture (one event loop per test), `live_server` (real uvicorn on a free port), `FakeEngine` that replays scripted turns, writes files like the agent and pauses on `pause()`; helpers `tool()`, `say()`, `done()` |
| `tests/test_projects.py` | slugs, safe file lookup, app state kept out of the design folder, duplicate, branch from a version, versions via projects, restore note |
| `tests/test_versions.py` | git plumbing: commit, log, show, restore removing later files, no `.git` in the work tree |
| `tests/test_engine.py` | event normalization (including the questions on an `ask_questions` call), `needs_verification`, command flags (isolation, MCP, connectors in the MCP config and allowed tools, read-only dirs with deny rules), stop, CLI failure, the design prompt with the technique library's real path filled in; token counts from the CLI's `usage` on `done`; a propose_plan call carries its plan |
| `tests/test_server.py` | routes, a full chat turn through `FakeEngine`, session resume, verify nudge (once only), versions preview and restore, comments in the prompt, bridge injection under `/canvas/` (every page; missing pages redirect to the entry), comments and tweaks per page, keeping tweaks, queued notes, branch route, sending only the chosen comments (the rest stay open), questions (an accepted `ask_questions` call becomes one `questions` event; a rejected one shows nothing), connectors (store, validate, choose per project, reach the turn, removal); the project's running cost and tokens (local turns left out); the Wada palettes route with each combination's tags; the library gallery and built-in systems served; what a Home card shows (palette, findings); Plan first: the note before the prompt, the `plan` event, an approved plan built without the note |
| `tests/test_preview.py` | real Chromium: screenshots, console/exception/request problems, contrast (grouping, large text, alpha compositing, exemptions), unloaded CSS/JS, design-system conformance (a failure; `--ds-override-*` and Edit-mode colours allowed; look-alikes of the system's components, with boxless wrappers and inner parts passing), fetch over HTTP, viewport width, single-page PDF |
| `tests/test_preview_mcp.py` | starts the MCP server exactly as the engine configures it and calls its tools over stdio, including text-only mode and `ask_questions` validation and the hierarchy check switched on by `PM_HIERARCHY`; `log_decision` keeps only the user's exact words; propose_plan validates and tells the agent to stop |
| `tests/test_rulebook.py` | design-guide's rulebook: the in-page measures give design-guide's verdict on its own fixture pages (`tests/fixtures/measures/`, from `design-guide export fixtures`), what blocks and what is only reported, withheld rules, dismissals (never the floor), a failed export failing `verify`, the gate's findings; and the studio's turns: the export every turn, the gate once after the last write with its nudge, the dismiss route, an edit's rule from `check.properties`. The CLI is a fake script (`tests/conftest.py`); proposed rules: the list with the rulebook's categories, confirming only with Rex's words, rejecting, design-guide's refusal, a broken pass; the decision log passed to the export, and the project's settled choices at the head of the agent's prompt; the built-in conformance checks against design-guide's design-system and palette fixtures, named by rule id, and skipped when dismissed; the agent's declared exceptions; the hierarchy check against design-guide's hierarchy fixtures; which rule an edit names when several read its property |
| `tests/test_plugin.py` | the Claude Code plugin: the marketplace entry and manifest, `.mcp.json` naming the launcher, the launcher serving the repo's MCP tools, the skill naming every tool and the approval rule; the approve route |
| `tests/test_decisions.py` | the decision log: the exact-quote guard, records valid against `docs/decision-log.schema.json`, Edit-mode coalescing per turn, reasons added later; and what the studio logs: answers as picks (silence and free-text-only questions are not), one reject per restore, edits with their `from`, kept tweaks, a design-system pick, the MCP env |
| `tests/test_comments.py` | comment storage: add, resolve (kept as history), delete, prompt format |
| `tests/test_tweaks.py` | reading the tweaks block and rewriting only its default values |
| `tests/test_bridge.py` | real Chromium: `canvas-bridge.js` ready message, live tweaks, selectors that find the element again, comment-mode picking, pins, Esc forwarded only in comment mode; edit mode selection and box (incl. colours and position), text editing (Enter, Esc), resize handle, shift-click multi-select and align, drag to move (`translate`) and to reorder in a flex row (`order`), page path and design-system colour tokens in `ready`; type and layout in the measured box; font and size tokens and page fonts in `ready`; duplicate and wrap previews, and a wrap of non-siblings refused; the page's palette and priority-mark count in `ready`; priority marks drawn over their elements on request, hidden ones skipped, removed when off |
| `tests/test_export.py` | single-file HTML inlining (CSS, url(), images, scripts incl. `</script>` escaping), remote and missing refs left alone, no reads outside the project, ZIP |
| `tests/test_design_systems.py` | design-system projects: source validation, built from attached files only, default design system for new designs (explicit choice wins, cleared on delete), extract prompt and read-only dirs per turn, attach/detach copy and note, resync before a turn, duplicate, old metadata; component files copied with the system and not required on every page; a design turn reads the technique library, a design-system turn does not |
| `tests/test_providers.py` | the default Claude model and the offered lineup; local models: provider env, bare model name, env reaches the CLI, Ollama tag listing and `vision` check against a fake Ollama, model validation, no-images flag |
| `tests/test_ollama_proxy.py` | proxy rewrite (thinking off, temperature default, `?beta=true` paths) and streamed pass-through against a fake upstream |
| `tests/test_turns.py` | background turns: `Turn.follow`, and against a real server: a turn survives the tab disconnecting, reattach from `since`, busy blocks, stop cancels a pending nudge |
| `tests/test_markdown.py` | real Chromium: `static/markdown.js` inline formatting, lists, headings as bold, HTML in model text stays text |
| `tests/test_studio_ui.py` | real Chromium, real server, `FakeEngine`: Home card meta and error state, live step card and stage pill while a turn runs, Tweaks collapse and auto-collapse in comment mode, Esc (studio and forwarded from the canvas), unsaved tag, past-version pill, chat resize by keyboard (clamped, remembered), phone Chat/Canvas views and a long model name kept inside a phone; Home thumbnails and placeholder (a thumbnail opens its project), filter and search at 20+ projects, folded forms on phones; attach/remove/send files; Edit mode select, inspector, text edit, save; Claude Code indicator; canvas following links between pages (page select, pins, comments per page); colour from a design-system token and align, saved; branch from a past version; default system toggle, connectors on Home and per project, prompt starters; design system from uploaded files; the questions form (options, multiple choice, free text, sent as one message, closed after) and "Just build it"; page, width and Edit-mode selection sent with a message and shown on the bubble; references connected and disconnected (a long path stays inside the chat pane); the board: rows and frames, page-only controls stepping aside, selecting a frame, Open at the frame's width, zoom steps, Fit that returns to the same level, keyboard zoom, the selected frame sent with a message, reload after the agent writes `board.json`, disabled on a past version; export links following the page on the canvas; type controls shown only for text and gap only for flex/grid, applied live and saved; delete, duplicate and wrap (refused for non-siblings) ending as a hidden element plus an instruction message; drawing strokes, undo, attaching a sketch and leaving draw mode with Esc; unticked comments held back; present mode stepping through the frames by key, button and from inside the design, then Esc; the toolbar never overflows the canvas pane and fits one row at 1440px with a page picker; a built-in design system shown read-only (badge, no Delete, no composer or edit tools) and the tools back on the next project; the page's Wada palette in the header with swatches, hidden on a page without one, and its colours offered in Edit mode; the priority toggle (only with marks, kept across a reload, toolbar still one row, label intact on a phone); each turn's cost, tokens and technique-library reads, and the project total, rebuilt after a reload; tooltips on icon buttons, the zoom showing its scale, the Home link to the library; the palette browser (all 348, the page's own marked, filters by size, harmony, text pair and colour, a choice drafted into the chat box, Esc closes; hidden with a design system; full width on a phone); card actions inside their card at 320px; the Techniques browser (screenshots, kind and search filters, the live demo, notes, a drafted request, reopening on the list, Esc), applying a technique to the Edit-mode selection, the turn footer opening a technique, the Library view starting designs from a technique, a palette and a design system, and fitting 320px and a phone; tile names that are their visible text; technique search answering a design ask (an example chip, the top 3, the "For:" reason, a negation keeping three.js out, an honest empty result); a technique's parameter map (controls, range, the sweep strip, a flat-range note); answers and Edit-mode saves logged as decisions, and the optional "why?" card; design-guide's findings card, and dismissing a non-floor rule; the Rules view: a proposal's decisions and reasons, a confirm refused without a reason then confirmed, and the no-logs message; the findings card's declared exceptions; the Workbench redesign: the section rail and Systems section, search across projects, techniques and palettes, filters by state and system, the New sheet, card states, the studio's outline, tabbed panel, History, settings popover and composer under every tab; motion (new things ease in, saved history and reduced motion do not); motion from the inspector (preview equals the saved CSS, saved, read back); Plan first (edit, remove, build, the toggle kept); Compare (what changed last, compare with current, highlight, close) |
| `tests/test_compare.py` | real Chromium: Compare finds the changed heading and footer of a long page (not the block between) and the files changed; a version's page shot at its width; no boxes when the page did not change; a page missing from a version; unknown versions, paths outside the design and odd widths refused |
| `tests/test_thumbnails.py` | real Chromium: thumbnail route size (432x270), per-version cache and cleanup, design-system specimen, no caching mid-turn, 404 without a design; each version's own thumbnail for History |
| `tests/test_hierarchy.py` | real Chromium: the `data-priority` check — a matching page is clean; missing marks; a lower priority outshining a higher one (with measurements in the report); fill counts; unmarked text rivalling priority 1; position below the fold; options compared only within themselves; nested marks; invalid values and hidden elements; off unless asked; report cap |
| `tests/test_board.py` | the board model: default frames (entry first, design system excluded), `board.json` rows, widths, repeated pages and unlisted pages, problems reported not raised, frame cap; the route; `verify` reporting board problems; the board's studio context |
| `tests/test_print.py` | paper frames on the board (sizes, landscape, flow is portrait only); PDF exports read with pypdf: a designed Letter page, an A4 document paginated, the entry page as one long screen page, the whole board as one PDF with each frame at its size, an unsafe `?page=` refused; `verify` failing content past a fixed page |
| `tests/test_context.py` | the studio context line (page, width, selection, sanitised user text, no path escape), its place in the prompt and the log; reference folders (read-only, restated every turn, validation, local folder untouched on disconnect), a GitHub reference cloned, copied on duplicate and deleted on disconnect |
| `tests/test_prompt.py` | rules in `app/prompts/system.md` and `extract.md` a later edit must not drop (including design-system components): placeholders instead of invented facts (and the old "invent plausible" rule gone), no filler, targeted changes, visual vocabulary, flex/grid gaps, exact values from source; Wada palettes for colour and for each direction, with the library paths the prompt names existing; the intent index named in the prompt exists |
| `tests/test_edits.py` | direct edits: text placed only when unique (plain or escaped, never in `design-system/`), style validation (colours, translate, order, type, delete), CSS merge and single link, a stylesheet per page with a relative link, unknown pages rejected, old flat store read as the entry page, route version and note; a delete hidden until the agent's turn, then its rule dropped (other edits on the element kept); motion presets validated and written only for motion that is welcome |
| `tests/test_attachments.py` | attachments: Office text extraction, add/remove/send, type and size limits, prompt block (text-only models), upload-send-agent access route flow, page capture (real Chromium); a sketch rendered at the canvas's size and scroll with the strokes composited on top (pixel-checked), bad page or non-PNG drawing refused |
| `tests/test_sources.py` | GitHub (a local repo stands in; subfolders, errors, refresh) and Figma (a fake API; export files, summary counts, token and API errors) sources |
| `tests/test_claude_code_mcp.py` | the Claude Code MCP server over stdio against a real server with `FakeEngine`: every tool, slow turns and `wait_for_turn`, errors that reach the client; questions relayed to Claude Code |
| `tests/test_workspace.py` | workspaces: `PM_WORKSPACE`, the repo's `workspace/` and a checkout from before workspaces; every storage path follows the workspace; `workspace.json` defaults and an unknown rule book refused; the built-in rule book (no design-guide call, floor rules measured in the page, no gate pass, no taste, no proposals); guides named in a design turn's prompt and readable by the agent; `init`, `show` and `add-system` (a shared system seeded for a teammate, the workspace's default design system) |
| `tests/test_builtin.py` | built-in design systems: seeded at startup from the workspace's `design-systems/` (listed systems with a folder only), followed on later starts (a version per change), a user project of the same name left alone, attached without the specimen and `specimen/`, read-only (403 on chat, edits, tweaks, restore, delete) but duplicable |
| `tests/test_palette.py` | Wada palettes: combinations read from the library data (001 and 006 as printed), meta parsing; real Chromium: a page in its palette is clean, an off-palette colour fails `verify` naming the palette, `--palette-override-*` and Edit-mode colours pass, an unknown number is reported, no meta means no check, a design system wins over a palette |
| `tests/test_techniques.py` | the technique catalogue (41 web recipes with screenshot, source and header notes), its routes and the screenshot mount, demo pages that load three.js and dependencies only when declared, and a demo painting in real Chromium; each recipe's intents in the catalogue; parameter maps and per-prop sweep evidence in the catalogue, and the strips served |
| `tests/test_docs.py` | the docs mention every route, event type, module, MCP tool, CLI flag and test file |

## Writing tests

- Test behaviour through the narrowest real layer: `versions` for git, `projects` for
  storage, the HTTP client plus `FakeEngine` for turn logic.
- Script agent behaviour with `FakeEngine([(files_to_write, events), ...])`; each tuple is
  one `engine.run` call. Helpers `tool()` and `done()` build events.
- `TestClient` buffers a streamed response until it ends, so it cannot test a turn
  mid-flight. Use `live_server` with `httpx.stream` for disconnect/reconnect behaviour.
- A scripted turn needs a `say()` or a tool call: `[done()]` alone is an empty turn and
  gets nudged.
- A key event must start where you claim it does: picking an element moves focus to the
  comment field, so a canvas Esc test dispatches the event inside the frame.
- A new test should fail without your change. For logic like the nudge, check by breaking
  the code briefly and watching the test fail.

## Manual end-to-end check (uses Rex's subscription)

Run after changing `engine.py`, `preview_mcp.py`, the system prompt or the chat route:

1. `uv run uvicorn app.server:app --port 8765`, open http://localhost:8765.
2. Create a project and send "a pricing page with three tiers".
3. Expect: steps including `Write index.html` and `verify index.html`, a short reply, a
   rendered page, and version 1 in the version bar.
4. Send a follow-up change. Expect the agent to remember the first turn and a version 2.
5. Move the slider to version 1: the canvas shows the old design. Restore it: version 3.
6. Press Stop during a turn: the chat shows "Stopped." and Send is enabled again.
   Reload the page during a turn: it keeps running and the chat keeps filling in.
7. Tweaks panel is present (the prompt asks for tweaks). Move a control: the canvas
   changes with no chat turn. "Keep values" makes a new version.
8. Comment mode: click a button in the canvas, add a note, press Send with an empty
   message. Expect only that element to change, a `resolve_comment` step, and the comment
   gone from the list.
9. Ask for "3 options for the hero". Expect an Options bar; "Keep" on one leaves only it.
10. Create a design system from a real repo (e.g. `~/Documents/Github/flambed-squirrel`).
    Send the prefilled message. Expect `tokens.css`, `README.md` and a specimen in the
    canvas, and `git status` in the source repo unchanged.
11. In a design, choose that system and send the prefilled restyle message. Expect the
    design to link `design-system/tokens.css` and use its values.
12. Export each format and open it: HTML works offline with styles, PNG and PDF show the
    whole page, ZIP contains the project (plus `HANDOFF.md` after "Write handoff notes").
13. Local model (needs Ollama with a pulled model): create a project with a "Local:" model
    and send the pricing prompt. Expect files and a reply within a few minutes, possibly
    after an "empty reply" note. Run it more than once: results vary.

## Visual and accessibility checks for studio UI changes

```bash
S=~/.claude/skills/visual-testing/scripts
node $S/capture_web.mjs --url 'http://localhost:8765/#/p/<slug>' --label studio \
  --out <scratch dir> --wait-for '#canvas'
cd ~/Documents/Github/design-guide && node engine/cli.js gate 'http://localhost:8765/#/p/<slug>'
cd ~/Documents/Github/design-guide && node engine/cli.js gate 'http://localhost:8765/#/'
```

Look at the screenshots (mobile, tablet, desktop, light and dark). The gate must report
`FAIL: none` for the studio itself, with two known exceptions:

- **Controls inside a closed `<details>` "never receive keyboard focus"** — a gate false
  positive (found 2026-09-18): the Export menu items and the connector checkboxes in the
  studio, and the Connectors card's fields on Home. Its observer
  (`design-guide/engine/observer/web.js`, the `visible` test) counts them as visible
  because they keep a box size; `checkVisibility()` is false. Tab reaches every item when
  the `<details>` is open. Reported to Rex; fix belongs in design-guide.
- **Findings under `#canvas`** are about the generated design, not the studio. The gate
  reaches into the iframe. Judge those as design feedback. Do not autofocus the chat box: it broke the gate's keyboard walk.
