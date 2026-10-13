# The design agent

The agent that builds prototypes is Claude Code running headless, once per chat turn,
with the project folder as its working directory. It uses Rex's logged-in Claude Code
subscription; there is no API key.

## Launch command (`ClaudeCodeEngine.command` in `app/engine.py`)

| flag | why |
|---|---|
| `-p` | print mode: one turn, prompt read from stdin |
| `--output-format stream-json --verbose` | one JSON event per line, parsed by `normalize` |
| `--system-prompt` | replaces Claude Code's default prompt with `app/prompts/system.md` (designs) or `extract.md` (design systems) |
| `--tools Read,Write,Edit,Glob,Grep` | built-in tools limited to file work; no Bash, no web |
| `--mcp-config` | starts `app/preview_mcp.py` as MCP server `pm`, plus the project's connectors (`app/connectors.py`, `docs/connectors.md`) |
| `--allowedTools mcp__pm` | pre-approves the preview tools (prompts are disabled, so unapproved tools are denied); each turned-on connector adds `mcp__<name>` |
| `--setting-sources ""` | ignores Rex's user/project settings: his CLAUDE.md, hooks and plugins stay out |
| `--strict-mcp-config` | only the `pm` MCP server, none of Rex's |
| `--no-chrome` | no browser extension |
| `--permission-mode acceptEdits` | file writes in the working directory need no approval |
| `--permission-prompts none` | anything that would prompt is denied instead of hanging |
| `--model`, `--effort` | the project's model (`meta.model`: a Claude model from `CLAUDE_MODELS` or `ollama:<name>`), else `PM_MODEL` (default `claude-opus-5-5`); `PM_EFFORT` (default `high`) |
| `--session-id` / `--resume` | first turn gets a new UUID; later turns resume it |
| `--add-dir` | each read-only folder: a design system's source; a design's reference folders and the technique library `creative-library/` (`LIBRARY_DIR`); the project's attachments |
| `--settings` | with any `--add-dir`: `permissions.deny` rules `Write(//<source>/**)` and `Edit(//<source>/**)`, because `--add-dir` alone also grants write. `//` makes the rule path absolute. |

`TurnOptions` (in `engine.py`) carries the per-turn differences: `mcp_env`,
`system_prompt`, `read_only_dirs`. The server builds it in `turn_options` by project kind.

The deny rules were verified live on 2026-09-18: with them, the agent read a file in the
added folder but its attempts to create and edit files there were refused, while writes
in its working directory succeeded.

Isolation was checked on 2026-09-18 with a probe asking the agent whether it saw any
CLAUDE.md or caveman instruction: it saw none, and only the five file tools.

Claude Code records the system prompt on a session's first request and reuses it, so
edits to `system.md` apply to new projects, not to existing conversations.

## Tools

Built-in: `Read`, `Write`, `Edit`, `Glob`, `Grep`, all confined to the project folder.

Preview tools (`app/preview_mcp.py`, shown to the agent as `mcp__pm__<name>`):

| tool | does |
|---|---|
| `verify(path="index.html")` | screenshots at 1440x900 and 390x844 plus a report of uncaught exceptions, console errors, failed requests (including HTTP 4xx/5xx and a missing entry file), findings of design-guide's in-page rules (contrast, target size, reflow) by rule id, and project CSS/JS files the page never loads |
| `screenshot(path, width, height, full_page)` | one screenshot at any size, with the same report |
| `eval_js(expression, path, width)` | evaluates JavaScript in the loaded page, returns JSON |
| `resolve_comment(comment_id, summary)` | marks a user comment resolved in `PM_COMMENTS_FILE` with a one-line summary |
| `log_decision(kind, topic, chose, over, quote, page, rule)` | records a `pick` or `reject` the user made in their message (a direction, an option) in `PM_DECISIONS_FILE`. `quote` is kept as the reason only if it is an exact substring of the user's last message in `PM_CHAT_FILE`, else dropped; the agent is told which |
| `propose_plan(summary, steps)` | shows the user a plan (a one-line summary, 1-10 steps) to approve before building, when the message starts with the studio's "Plan first is on" note; validates it and tells the agent to end the turn. The server turns an accepted call into a `plan` event; an approved plan comes back as "Build this plan:" with the steps as the user left them |
| `ask_questions(questions)` | asks the user 1-5 questions (`text`, optional `options` up to 6, `multiple`, and for the decision log `topic` and `rule`) before building; validates them and tells the agent to end the turn. The server turns an accepted call into a `questions` event, which the studio shows as a form |

The MCP server's environment: `PYTHONPATH` (repo root), `PM_PROJECT_DIR`, and
`PM_COMMENTS_FILE`, `PM_DECISIONS_FILE`, `PM_CHAT_FILE`, `PM_PROJECT_SLUG` and
`PM_DECISION_CONTEXT` (the decision log's `context` at the turn's start), `PM_RULEBOOK_FILE` (passed per turn by
the server as `mcp_env`). The system prompt's "The user's decisions" section says when to call
`log_decision` and that a reason is only ever the user's own words.

Pages are served from the project folder over `http://127.0.0.1:<random port>` (not
`file://`) so `fetch()` behaves as in the canvas. One Chromium instance is reused for the
life of the MCP process, which is one turn.

## Verification policy

Checks in every `verify` / `screenshot` report (`app/preview.py`):
- **Errors:** uncaught exceptions, console errors, failed or 4xx/5xx requests.
- **The rule book** (`app/rulebook.py`): the turn's rulebook (`PM_RULEBOOK_FILE`) supplies the
  checks. A workspace with `"rules": "builtin"` (`docs/workspace.md`) exports
  `app/rulebook-builtin.json`, the floor's contrast, target-size and reflow rules; otherwise it is
  design-guide's (`docs/gate-rulebook.md`). Its `measure` rules that ultimate-design implements run
  in the page: `contrast` (`app/contrast.js`, with the rule's thresholds), `target-size`
  (`app/target_size.js`) and `reflow` (the page opened at the rule's width, 320px). Each finding
  names its rule id and fix. A finding blocks a clean `verify` only when its rule is `confirmed`,
  `fail` and `stable`; proposed rules, observed detectors and rules the export withheld for the
  project are listed as "Also reported, not blocking". Rules the user dismissed are skipped. A failed
  export is a blocking "Rulebook unavailable" line, never a silent pass. Without a rulebook
  (previews, thumbnails, the Claude Code link) the built-in contrast check below runs instead.
- **Contrast** (`app/contrast.js`): text below 4.5:1, or 3:1 for large text (>= 24px, or
  >= 18.66px bold), grouped by colour pair, at most 10 groups. Backgrounds are composited
  through ancestors (alpha included). Skipped: text over background images or gradients
  (unknowable from styles), `:disabled` and `aria-disabled="true"` (WCAG exempts inactive
  components), and visually hidden text. Overlap from positioned elements is not seen.
- **Named by design-guide's rules:** the two conformance checks below and the hierarchy check are
  the one implementation of design-guide's `design-system-conformance`, `palette-conformance` and
  `hierarchy-matches-priority` rules (`design-system`, `palette` and `hierarchy` measures; its
  fixture pages, pinned in `tests/fixtures/measures/`, hold them to it).
  When the turn's rulebook has the rule, each finding starts with its id, and a rule Rex dismissed
  is not checked. They block as they always have, also while design-guide lists the rules as
  proposed (`docs/decisions.md`, 2026-10-08).
- **Design-system conformance** (`app/conformance.js`, only with `design-system/`):
  colours and font families on the page that the system's custom properties don't define
  (light and dark values both count). A failure: `verify` is not clean until they are
  gone. Allowed besides the system: custom properties named `--ds-override-*` in any
  stylesheet (the agent's declared exceptions, e.g. a contrast fix, which it explains in
  its reply) and colours in `studio-edits*.css` (the user's own Edit-mode choices).
  When the system ships components (`design-system/components/components.css`), look-alikes
  fail too: an element with its own box (fill, border or shadow) whose class names a
  system component but isn't it (`invoice-card` beside `ds-card`), or a filled button or
  link that isn't `ds-button`. Boxless layout wrappers and parts inside a real component
  pass. (A live Haiku run built its own cards despite the prompt; this check made it switch.)
- **Wada palette** (`app/palette.py`, same `conformance.js`, only without `design-system/`):
  a page that declares `<meta name="palette" content="wada:006">` may show only that
  combination's colours, plus `--palette-override-*` custom properties (a text ink, a field
  white) and Edit-mode colours. A meta naming no combination (outside 001-348) is reported.
  Fonts are not checked. A design system wins when both are present.
- **Hierarchy** (`app/hierarchy.js`, design projects only: the server sets `PM_HIERARCHY=1`,
  and a design system's specimen page is not checked). The design declares its order of
  importance with `data-priority="1"`, `"2"`, `"3"`. Each marked element gets a prominence
  score from its rendered styles:
  `text size x weight x text contrast x fill x outline x position`. The text is the
  strongest visible text inside it (not counting text inside a nested marked element); an
  element with no text uses `sqrt(area) / 6`. Weight is `font-weight / 400` clamped to
  0.8-1.6; contrast `0.4 + 0.6 x min(1, (ratio - 1) / 14)`; a solid background that differs
  from what is behind it multiplies by up to 2 (`1 + min(1, (ratio - 1) / 10)`), a visible
  border by 1.15; below the fold by `fold / top`, at least 0.4. Failures: no marks at all;
  a mark that isn't a whole number from 1; a lower priority scoring within 10% of (or
  above) a higher priority in the same scope (one `[data-option]` section, or the page);
  unmarked text within 10% of priority 1. Hidden marked elements are skipped. The report
  gives each element's measurements so the agent knows what to change. This is a
  heuristic, not an eye-tracking model: it ranks size, weight, contrast, fill and position,
  and does not see images' content, motion, or whitespace around an element.
- **Print pages:** for a board frame with `"paper"` and `"print": "page"`, content taller
  than the sheet fails `verify` (the PDF would cut it).
- **Board:** problems in `board.json` (invalid JSON, a frame naming a missing page or a
  width other than 390, 834 or 1440) are listed under "Board (board.json)" and fail
  `verify`, so a broken board can't go unnoticed. Only when `board.json` exists.
- **Unloaded files:** `.css` / `.js` files in the project that the checked page never
  requested (a design system's `components/` library is exempt: a page may not need it). Catches a page that forgot its stylesheet, which raises no error; a file
  meant for another page is reported too, and the agent judges.

1. The system prompt tells the agent to call `verify` after its last change and repeat
   until clean, and to judge the screenshots, not only the error list. It must fix every
   reported problem, including ones it did not cause, with the smallest fix, and say
   what it fixed (Rex's decision, 2026-09-18). If a design-system colour fails contrast,
  the agent declares a `--ds-override-*` property with a passing shade and says so. A
  multi-page design is verified page by page (`verify(path)`).
2. The server enforces it: if a completed turn wrote files (`Write`/`Edit`) with no
   `verify` after the last write, it runs one follow-up turn with `VERIFY_NUDGE`
   (`needs_verification` in `engine.py`; writes to `.md` files do not count). Only one nudge per user message, so a stubborn
   agent cannot loop.
Settled choices: every turn's prompt starts with the project's `layer: project` rules from the
rulebook (design-guide builds them from this project's decision log: a taste-rule pick, latest
wins, with the user's words when they gave them), as "settled in this project ... don't reopen
them unless the user asks". No such rules, no note.

3. After the agent's last write, the server runs design-guide's gate on the pages the turn
   wrote (at most 3, `written_pages` in `engine.py`): the `engine` rules, and measures
   ultimate-design does not implement (`token-only`). The findings go to the studio as a
   `findings` card. If any blocks, one follow-up turn gets `RULES_NUDGE` with them. Only Rex
   can dismiss a rule (never a floor rule); the agent explains any it leaves.

## Conventions the prompt teaches

- **Direct edits** — `studio-edits.css` (entry page) and `studio-edits-<page>.css` hold the
  user's Edit-mode changes, including type, moves as `translate` or `order`, and deletes as
  `display: none` (the agent removes the element; the app drops the rule after the turn);
  duplicates and wraps arrive as a message with exact selectors; keep them and their
  links, and carry a rule into the design's CSS if a restructure breaks its selector.
- **Content** — copy grounded in the user's material; missing facts about the user's
  business become visible placeholders (`[YOUR PRICE]`), illustrative data inside product
  screens may be sample data (said so); no filler; small changes stay small; follow an
  existing design's vocabulary; sibling groups laid out with flex or grid and `gap` so
  direct edits keep the layout; recreate from readable source with exact values; no copies
  of another company's branded interface. (Claude Design's own guidance, which our prompt
  contradicted on invented facts until 2026-09-19.)
- **Studio context and references** — a "(Studio context: ...)" line says which page and
  width the user sees and what they selected in Edit mode, so "this" resolves; a
  "(Reference material ...)" line lists read-only folders connected to the design, which the
  agent reads and builds from.
- **Questions before building** — before the first build of a new page, if the brief
  leaves the audience, main action, what matters most or the content open, ask 2-5 short
  questions with `ask_questions` and end the turn; not for changes, not twice in a row,
  not about details that can be adjusted later. "Just build it" means decide and say what
  was assumed. The answer about what matters most feeds `data-priority`.
- **Hierarchy** — decide the order of importance before styling, mark it with
  `data-priority`, style the page to read in that order, and fix `verify` findings by
  changing styling, not marks (unless the order was wrong, said in the reply).
- **Print** — paper frames on the board: `"print": "page"` for designed sheets at the
  paper's size (content 40px inside the edges, 72px around running text), `"flow"` for
  documents the export paginates (0.75in margins, print styles, one column, CSS breaks);
  12pt body minimum, near-black ink, readable in greyscale.
- **Board and directions** — `board.json` lays pages out as frames in rows. When the look
  is still open (no design system, references or stated aesthetic), the agent sketches 2-4
  genuinely different low-fidelity direction pages under `directions/`, each with its own
  Wada palette named in its title ("A · Warm editorial · Wada 006"), one row, stable
  titles, each direction's motivation and trade-off in the reply; after the user picks,
  it builds the real page and removes the sketches. Not in the same turn as questions.
  `data-option` sections remain for variations of one part of a page.
- **Pages** — a flow can be several HTML pages joined by relative links; the canvas
  follows them. Comments name their page.
- **Connectors** — `mcp__<name>__*` tools from services the user connected: read for
  context, never change anything there unless asked.
- **Sketches** — `sketch-N.png` attachments are the page as the user saw it with their pen
  marks on top.
- **Attachments** — listed after the message with absolute paths; the agent reads them with
  `Read` (the attachments folder is a read-only dir). Office files are given as extracted
  text; for a model without vision, images come with a note that it can't view them.

- **Design system** — if `design-system/` exists, read its `README.md`, link its
  `tokens.css`, use its tokens and patterns, never edit it. If it has `components/`, load
  them and use the README's exact component markup instead of imitating components.
  Extraction writes `components/components.css` (and `.js` only for behaviour) from the
  source's real components, `ds-` classes by default, with every state.
- **Technique library** (the agent finds techniques by purpose through `recipes/web/intents.json`,
  the library's intent index) — `{library}` in `system.md` becomes the absolute path of
  `creative-library/` (`engine.design_prompt`), which designs may read but not write. When
  a design needs a technique rather than a layout (texture, grain, pattern, an effect), the
  agent reads the shelf `skill/references/recipe-library-web.md` and the recipe's source,
  then copies and adapts the construction into the project, leaving out the `UI.define()`
  registration. It never links a library file: the project must stand alone for export.
- **Colour** — with no design system and no colours from the user, the palette is one of
  Sanzo Wada's 348 combinations (`{library}/palettes/wada/combinations.md`, method in its
  README), declared per page as `<meta name="palette" content="wada:NNN">` and checked by
  `verify`. Colours in unequal amounts (dominant, secondary, accents; large areas read
  lighter), a `--palette-override-*` text ink when no pair passes contrast (213 of 348
  have none), and two or three alternatives as a `palette` enum tweak.
- **Handoff notes** — on request, `HANDOFF.md`: screens and states, layout per width,
  tokens, components, interactions, and what is fake.
- **Tweaks block** — `<script type="application/json" id="tweaks">` in the entry file, a
  list of `{name, label, type, value, ...}` with types `color`, `range` (`min`, `max`,
  `step`, `unit`), `enum` (`options`), `boolean`, `text`. How values apply: see "Canvas
  bridge protocol" in `docs/architecture.md`. The agent should add three to six.
- **Options** — `<section data-option="1a" data-option-label="...">`, newest round on
  top. Keeping one arrives as an ordinary chat message.
- **Comments** — appended to the message as `[id] on \`selector\` (<tag> "text"): note`.
  The agent resolves each with `resolve_comment`; unresolved comments are sent again with
  the next message.

## Notes the app sends the agent

Text in parentheses starting "Note from the app:" is written by the app, not the user:

- `VERIFY_NUDGE` — see above.
- `pending_note` — prepended to the next user message after a version restore or after
  the user kept tweak values, telling the agent to re-read files it may remember
  differently.
- The workspace's guides (`workspace.guides_note`) — at the head of every message of a design
  project when the workspace's `guides/` has any: the absolute path of each guide, with "read
  the ones that apply before you design, and follow them; where a guide and a request disagree,
  ask the user". The folder is a read-only directory of the turn (`turn_options`).
- Open comments are appended after the message (see above).

## Local models (Ollama)

A project can use a local model instead of Claude (`model: "ollama:<name>"`, chosen at
creation or switched later; switching to or from a local model starts a new session). The same `claude` CLI runs, pointed at Ollama's
Anthropic-compatible Messages API, so every tool, the MCP server and the nudges still
apply. `provider_env` sets `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN=ollama`, an empty
`ANTHROPIC_API_KEY` and `ANTHROPIC_DEFAULT_HAIKU_MODEL` (Claude Code's background calls).
`PM_OLLAMA_URL` overrides `http://localhost:11434`.

What it took to make an 8B Qwen3 (`huihui_ai/qwen3-abliterated:8b` on a GTX 1070) work,
all found live on 2026-09-18:

1. **Screenshots break text-only models.** A tool result with an image makes Ollama reject
   the whole request (`400 ... model does not support multimodal requests`). `accepts_images`
   asks Ollama's `/api/show` for the `vision` capability; without it the server sets
   `PM_NO_IMAGES=1`, and `verify` / `screenshot` return the error report plus measured
   layout (`horizontalOverflow`, widths, page height) instead of images.
2. **Thinking ate the turn.** Qwen3 thinks by default and often planned the whole page in
   thinking, then ended the turn with no tool call. Claude Code sends no `thinking` field
   for unknown models, and `alwaysThinkingEnabled: false` / `MAX_THINKING_TOKENS=0` changed
   nothing, so `app/ollama_proxy.py` sits between the CLI and Ollama and adds
   `"thinking": {"type": "disabled"}` (plus `temperature: 0.3` if unset). The CLI posts to
   `/v1/messages?beta=true`; the proxy matches the path without the query string.
3. **Empty replies anyway.** Even with thinking disabled, this model sometimes reasons
   internally and Ollama strips it, returning a message with no content (seen: 860 output
   tokens, zero blocks). The server's `EMPTY_NUDGE` retries once.

Measured after all three: 2 of 3 fresh "a pricing page with three tiers" runs produced a
page (0 of 7 before), in 2.5–3.5 min each; the local model never verified unprompted.
Quality is far below Claude's: generic markup, and one run's page did not link its own
stylesheet; `verify` now reports that as an unloaded file.

Loading a local model can evict another model Ollama keeps in memory (Rex's Hermes keeps
`huihui_ai/qwen3-abliterated:8b` loaded; the 8 GB GPU holds one 8B model), so the tests
above used that already-loaded model.

## Design-system agent

Design-system projects use `app/prompts/extract.md` instead of `system.md`. It asks for
`tokens.css` (semantic custom properties, dark theme if present, web font imports),
`README.md` (usage rules with real values and where they came from) and `specimen.html`,
then `verify` on the specimen. A GitHub source is a read-only clone; a Figma source is an
export (`figma-summary.json`, `figma-file.json`, `frames/*.png`), and the prompt tells the
agent to start from the summary and frames and search the large JSON. Contrast failures that come from the source's own colours
are kept (the system records the source) and listed in the README under "Contrast
problems in the source". The source path is substituted into the prompt. Same tools
as the design agent, plus read-only access to the source (not the technique library).

Built-in design systems (`design-systems/<id>/`) never reach this agent: they are
read-only in the studio and change in the repo.

## Changing the agent

- Prompt wording: edit `app/prompts/system.md`. It is the only place the agent learns the
  project conventions. Keep it written from scratch; the leaked Claude Design prompt is a
  behaviour reference only.
- New preview tool: add it to `app/preview_mcp.py`, update the tool table above, the
  "Checking your work" section of the prompt, and `tests/test_preview_mcp.py`.
- New built-in tool: add it to `TOOLS` in `engine.py` and the flag table above. Keep Bash
  out unless there is a strong reason: the agent runs with edits auto-approved.
