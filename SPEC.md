# Ultimate Design — spec (v1)

A local tool modelled on Anthropic's Claude Design: describe a prototype in chat, an agent
writes live HTML into a project folder, a canvas renders it, and you refine it with chat,
element comments and generated tweak controls.

Status: **approved 2026-09-18. Milestones 1–5 done.** Standalone with workspaces since
2026-10-13 (`docs/workspace.md`).

Maintainers: start with `CLAUDE.md` (rules and doc map) and `docs/`.

## Decisions already made

| question | answer |
|---|---|
| model provider | Headless Claude Code (`claude -p`) on Rex's subscription instead of an API key; engine interface so another backend (e.g. Ollama) can be tried later |
| v1 scope | prototypes (pages, flows, clickable UIs). Decks later. |
| location | this repo, `~/Documents/Github/ultimate-design` |

## Stack

- Python 3.11+ via `uv`. FastAPI + uvicorn backend.
- Agent engine: the `claude` CLI in print mode with `stream-json` output, run in the
  project folder. It supplies the agent loop, file tools and session resume. Rex's own
  CLAUDE.md, hooks, plugins and MCP servers are excluded (`--setting-sources ""`,
  `--strict-mcp-config`). Model `claude-opus-5-5` and effort `high` by default, set with
  `PM_MODEL` / `PM_EFFORT`. Preview tools reach the agent as an MCP server.
- Playwright (Python, Chromium) for screenshots, console capture and export.
- Frontend: plain HTML/CSS/JS served by FastAPI. No build step.
- Each project has a git repository in `data/<slug>/git`, one commit per user message.
  Restoring a version makes a new commit, so history is never lost.

## What v1 does

### 1. Projects
- A project is a folder `projects/<slug>/` holding only the design's files (HTML, CSS,
  JS, images, data JSON). App state (`meta.json`, `chat.jsonl`, `comments.json`, git history)
  lives in `data/<slug>/` so the agent never sees or edits it.
- Home screen lists projects; create / open / duplicate / delete.

### 2. Agent loop
- Claude Code's own loop. It runs until the model stops calling tools.
- Tools: Claude Code's `Read`, `Write`, `Edit`, `Glob`, `Grep` in the project folder,
  plus `verify`, `screenshot`, `eval_js`, `ask_questions`, `resolve_comment` from the preview
  MCP server (console problems are part of every `verify`/`screenshot` report). Read-only
  folders (a design system's source, reference material) come through `--add-dir` with
  write-deny rules.
- The chat shows each tool step as a collapsible line, like Claude Code. Stop button
  interrupts the loop.
- The prompt is written from scratch for this project. The leaked Claude Design prompt is
  a reference for behaviour only; no copied text.

### 3. Canvas
- Right pane: iframe serving the project's entry file. Reloads after each file write.
- Viewport toggle: desktop 1440, tablet 834, mobile 390.
- Version slider: step through past turns (git commits).

### 4. Element comments
- Comment mode: click an element in the canvas, type a note. The host stores a CSS selector,
  the element's tag and text in `comments.json` (no screenshot; see docs/decisions.md).
- Open comments are attached to the next message and stay open until the agent marks them
  resolved. They are never dropped (Claude Design's known bug).

### 5. Tweaks panel
- Convention: a design declares its tweakable values in
  `<script type="application/json" id="tweaks">` with name, type
  (color / range / enum / boolean / text), default and limits.
- The host renders controls from that block and applies changes live through CSS custom
  properties and `postMessage`. No model call per tweak.
- "Keep these values" writes the current values back as new defaults.
- The system prompt tells the agent to expose a few high-impact tweaks on every design.

### 6. Variations
- Ask for N options; the agent writes each as a `<section data-option="1a">` in one file,
  newest on top. Pick one to continue from; the rest can be discarded.

### 7. Design system
- Per project, or shared from `design-systems/<name>/`: `tokens.css`, `tokens.json` and a
  `README.md` of rules.
- "Extract from…" points `read_reference` at a local codebase, CSS file or screenshot; the
  agent writes the design-system folder, then shows a specimen page for review.
- The active design system is loaded into the prompt on every turn (cached).
- Optional: seed from Rex's `design-guide` tokens.

### 8. Self-verification
- Before the agent ends a turn that changed files, it must screenshot the result at desktop
  and mobile widths and check the console. Errors go back into the loop.

### 9. Export
- Standalone HTML (assets inlined), PNG (full page), PDF (Playwright print).
- Handoff bundle: the project folder plus `HANDOFF.md` (screens, tokens, components,
  interactions) for a Claude Code session to implement in a real codebase.

### 10. Cost visibility
- Each turn shows input / output / cache-read tokens and an estimated cost. Running total
  per project. Prompt caching on the system prompt, tools and design system.

## Out of scope for v1
Slides/decks, PPTX, Figma import, Canva export, sharing and collaboration, GitHub
integration, voice input, video export.

## Milestones (each ends with a check that is run, not assumed)

1. **Skeleton** — FastAPI app, project CRUD, canvas iframe, chat pane, agent loop with file
   tools. Check: prompt "a pricing page with three tiers" produces a file that renders.
2. **Verify + history** — screenshot / console tools, required self-check, git commit per
   turn, version slider. Check: an injected JS error is caught and fixed by the agent.
3. **Comments + tweaks + variations** — Check: a click-comment on a button changes only
   that button; a tweak slider changes the page without a model call.
4. **Design system + export** — Check: extract tokens from a real repo here (e.g.
   `flambed-squirrel`) and a new design uses them; HTML/PNG/PDF/handoff exports open.
5. **Second provider** — local models via Ollama. Check: same milestone-1 prompt
   runs end to end on a local model; quality compared side by side.

## Milestone results
- **1** (2026-09-18): pricing prompt produced a working 3-file page; follow-ups resume.
- **2** (2026-09-18): the agent called `verify` unprompted, fixed what it saw and re-verified
  before finishing. Injected-error check: the agent *caught* a `renderTestimonials is not
  defined` error it had not written, but chose to ask rather than fix it ("looks like the
  start of work you meant to do"). Rex decided it should fix them; after the prompt
  change the same check passed on a fresh project: the agent made the requested edit,
  found the injected error with `verify`, removed the broken line, re-verified and
  said what it fixed.
- **3** (2026-09-18): the agent added a five-control tweaks block unprompted. In the real UI:
  tweak changes applied live with no chat turn and survived a canvas reload; "Keep
  values" made a version. A headline comment sent with an empty message was addressed
  (now six words or fewer), verified and resolved via `resolve_comment`. "3 options for the hero"
  produced an Options bar; "Keep" on 1b left only that option, wrappers and unused CSS
  removed. 68 tests. (The spec's check named a button; the live run used a headline.)
- **4** (2026-09-18): a design system extracted from `flambed-squirrel` ("Grove") in 3 min:
  `tokens.css` with real values annotated by source file, `README.md`, a specimen page;
  the source repo's `git status` stayed clean. A new design attached to it linked
  `design-system/tokens.css` and used its tokens throughout, with no raw hex in its CSS.
  Exports: single-file HTML rendered fully from an isolated folder with no local
  requests; PNG 1440 wide full page; PDF one page; ZIP with `HANDOFF.md` (199 lines,
  all requested sections). 89 tests.
- **5** (2026-09-18): local models run through the same `claude` harness pointed at
  Ollama's Anthropic-compatible API (not a separate OpenAI adapter). Three fixes were
  needed for an 8B Qwen3: text-only preview for models without vision, a proxy that
  disables thinking, and an empty-turn nudge. Pricing prompt: 2 of 3 fresh runs produced
  a page (0 of 7 before the fixes), 2.5–3.5 min each vs about 1 min on Claude. Quality
  side by side: Claude's page is a polished, branded design; the local pages are bare
  default-browser markup, and one did not link its own stylesheet. 105 tests.

## After v1 (2026-09-18)
Added on Rex's request to close gaps with Claude Design: direct canvas editing (Edit
mode), chat attachments and page capture, design-system conformance in `verify`, design
systems from GitHub or Figma URLs, and a Claude Code MCP link (`docs/claude-code.md`).

Second pass, from a September 2026 comparison with Claude Design: multi-page flows in the
canvas (links followed, page picker, comments and edits per page); Edit mode drag to move,
shift-click multi-select with align, text colour and fill (design-system tokens offered);
design-system conformance as a `verify` failure with declared `--ds-override-*`
exceptions; a default design system for new designs; connectors (the user's MCP servers,
per project; `docs/connectors.md`); design systems built from uploaded files; prompt
starters; branching a new project from any version.

Third pass (2026-09-19), from competitor research on UI/UX principles: a hierarchy harness.
The agent ranks each page's key elements with `data-priority`, and `verify` fails when the
measured prominence (size, weight, contrast, fill, position) disagrees with that order or
when unmarked text rivals priority 1.

Clarifying questions (2026-09-19): before the first build of a new page with an open
brief, the agent asks 2-5 questions with `ask_questions`; the studio shows a form with
options, free text, "Send answers" and "Just build it".

Context (2026-09-19): designs can connect reference material (a local folder, GitHub or
Figma) that the agent reads read-only; every message tells the agent the page, width and
Edit-mode selection the user sees; the prompt follows Claude Design's content rules
(placeholders instead of invented facts, no filler, targeted changes).

Board (2026-09-19): a Page | Board view shows a design's pages side by side as frames
in rows (`board.json`, written by the agent), with zoom, pan, frame selection as studio
context, and Open. When the look is open, the agent sketches 2-4 low-fidelity directions as
frames before building the full design.

Editing depth and print (2026-09-19): Edit mode gained font family, weight, tracking and
line height (contextual controls), delete (hidden until the agent removes it), and
duplicate and wrap (previewed, then sent to the agent). Paper frames on the board export as
designed pages or paginated documents, and the whole board exports as one PDF.
Also (2026-09-19): design systems carry real components (`components/`), models switch per
project, Present shows the board's frames full screen, Draw attaches a sketch of the
page with pen marks, and each open comment can be held back from the next message.

Technique library and built-in systems (2026-10-06): the separate `creative-library` repo
moved in as `creative-library/` with its history. The design agent reads it (read-only)
and copies a verified technique into a design instead of rebuilding one from memory.
Rexorious, Rex's identity system, moved to `design-systems/rexorious/` and shipped as a
built-in design system: seeded as a read-only project at startup, picked like any other,
changed in the repo. The default model is Opus 5.5. Live check (2026-10-07, Opus 5.5,
$1.16): asked for a hand-made gig-flyer page with grain and halftone, the agent read the
shelf, `halftone.js` and `noise-grain.js`, copied both constructions into the page (no
library links), and finished on a clean `verify`.

Wada palettes (2026-10-07): with no design system and no colours from the user, a design's
colours come from one of Sanzo Wada's 348 combinations (*A Dictionary of Color
Combinations*, from an open dataset in `creative-library/palettes/wada/`). Each page names
it in a meta tag and `verify` fails colours outside it; board directions each get their
own combination instead of greyscale; alternatives are a `palette` tweak; a "Wada palettes"
browser in the studio filters all 348 and drafts the request. Live check
(2026-10-07, Opus 5.5, $1.20): for a tea house with no look in mind, the agent read the
method and the index and sketched three directions on Wada 094, 166 and 192, each named in
its title, colours in unequal amounts, all clean in `verify` with no overrides needed.

Library in the studio (2026-10-07): the technique library has a place in the product instead
of a link to its own gallery. A Techniques browser (header, and "Apply technique…" for the
Edit-mode selection) shows each recipe's screenshot, live demo and notes and drafts the
request; Home has a Library view of techniques, Wada palettes and design systems to start
new designs from. Search there takes a design ask ("make this feel hand-made"), ranked by the
library's intent index (its PLAN phase 4, done 2026-10-07: all 22 hand-named asks land in
the top 3, with a small table of design synonyms).

Parameter maps (2026-10-07): every technique's props say what they control, their useful
range and where they break, measured by a sweep in Chromium (the library's PLAN phases 0-3).
The technique detail shows each knob with its strip of frames as evidence.

design-guide is the rule book (2026-10-07, joint step 2): `verify` checks design-guide's
exported rulebook (contrast, target size and reflow in the page; the rest through its gate
after each turn), findings name their rule, Rex can dismiss non-floor rules per project,
and his picks, rejections and overrides go to a decision log design-guide turns into
proposed rules (`docs/gate-rulebook.md`). He confirms or rejects them in Home → Rules, in his own words. Conformance, palette and hierarchy are still
ultimate-design's own checks without rule ids, until design-guide has rules for them.

Packaged (2026-10-08, joint step 3): a Claude Code plugin in this repo (`plugin/`) gives any
project the studio's tools and a skill; designs are approved in the studio ("Approve for
build") before Claude Code implements them (`docs/claude-code.md`).

Redesigned (2026-10-08): look A, Workbench, and the new structure (`docs/gate-studio-redesign.md`):
a section rail with Systems, one search, a New sheet, and a canvas-first studio with the agent,
inspector, findings and history in one right panel.

Added 2026-10-08: Compare two versions (side by side, changed areas outlined), Plan first (approve or
edit the agent's plan before it builds) and motion in Edit mode (entrance, hover, speed).

Workspaces (2026-10-13): everything personal (designs, app state, built-in design systems,
written guides) lives in a workspace folder outside the code, so the repo can be public and a
company can share its own workspace. A workspace's rule book is the built-in accessibility floor
or design-guide; written guides reach the agent with every design message
(`docs/workspace.md`, `docs/decisions.md`).

## Known limits
- Wada palettes: the combinations' tags (same-tone, light, soft...) are computed approximations of Wada's
  categories, and his rule of unequal amounts is taught, not measured. Screen colours are
  a conversion of the book's print CMYK.
- Built-in rule book (`"rules": "builtin"`): only the three in-page floor measures (contrast,
  target size, reflow). Written guides in a workspace's `guides/` are read by the agent, never
  measured; design-guide's other floor checks (axe: names, labels, focus, keyboard) run only
  with `"rules": "design-guide"`.
- Rexorious has no `components/` yet: designs build its buttons, cards and tables from the
  README's descriptions, and `verify` cannot flag look-alikes of components it lacks. Its
  specimen is the original 16-section spec document, which paints in Nightshift only.
- The library's recipes are copied by the agent, so a later fix to a recipe does not reach
  designs that already copied it. The design agent sees only the web shelf (the Qt shelf is
  for desktop apps).
- Direct edits: text is placed automatically only when it occurs once in the files (else
  the agent gets it); style edits target the bridge's structural selectors, which a
  restructure can break (the agent is told to carry them over). A free move or an align
  is a px `translate`, which does not adapt to other widths; only reordering inside a
  flex or grid parent (`order`) is layout-true.
- The hierarchy score is a heuristic from rendered styles: it does not see what an image
  shows, motion, or the whitespace around an element, and its weights are hand-set.
- Board frames can't be dragged or resized by hand; layout is rows from `board.json`.
  Frames are previews; to interact, Open one. At very small zoom a phone frame's caption
  overflows it.
- Starters are prompts, not pre-made template designs. No video export (Claude Design has
  none either). No admin lock on the design system (single user).
- Connectors were checked live with a local stdio server only; a remote server that needs
  an interactive OAuth login may not work headless.
- Figma sources are tested against a fake API only (no token on this machine).
- A turn stopped before it finishes starts a new Claude Code session next time, so the
  agent loses that chat's context (the files remain).
- Each project's sessions appear in Claude Code's session list for that folder.
- Cost shown per turn is the CLI's API-equivalent figure; on a subscription it counts
  against usage limits, not money. A turn with verification costs about $0.40–0.65.
- Comment selectors can go stale if the agent restructures the page; the pin then
  disappears but the comment stays open and is still sent.
- A design's own click handlers are suppressed only while comment mode is on.
- The extracted design system copies the source faithfully, including its accessibility
  problems (Flambed Squirrel's faint text is 3.09:1 on white); they are listed in its
  README, and designs built on it override failing colours because `verify` checks
  contrast.
- Local models: unreliable (about 1 in 3 turns does nothing even after the nudge), much
  weaker at design, and never verify unprompted. Text-only `verify` sees errors, contrast,
  overflow and unloaded files, but not appearance.
  Loading a local model can evict another Ollama model (8 GB GPU).
- The contrast check skips text over images and gradients, and cannot see overlap from
  positioned elements.
- The verify nudge only checks that `verify` was called after the last write, not that
  the agent acted on what it reported.
