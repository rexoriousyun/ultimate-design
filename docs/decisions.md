# Decisions

Newest last. Each entry: date, decision, why. Add one when a later agent could undo a
choice without knowing the reason.

## 2026-09-18 — Rebuild Claude Design locally, prototypes first
Rex wants Claude Design's workflow on his machine. v1 covers prototypes; decks, PPTX,
Figma and sharing come later or never. See `SPEC.md`.

## 2026-09-18 — Headless Claude Code as the engine, not the Messages API
Rex asked to use Claude Code instead of an API key. Claude Code also supplies the agent
loop, file tools and session resume, so the app does not implement them. Other backends
(e.g. Ollama) can come later behind the same `run`/`stop` interface.

## 2026-09-18 — Isolate the agent from Rex's own Claude Code setup
`--setting-sources ""` and `--strict-mcp-config` keep his CLAUDE.md, hooks (caveman),
plugins and MCP servers out of the design agent. Without them the agent inherited
unrelated instructions.

## 2026-09-18 — Python + FastAPI + plain JS, no build step
Rex approved Python. Plain JS keeps the UI editable by agents without a toolchain.

## 2026-09-18 — App state outside the design folder
`data/<slug>/` holds metadata, chat and git history; `projects/<slug>/` holds only design
files. The agent's `Glob` would otherwise see and might edit app files or `.git`.

## 2026-09-18 — Sandboxed canvas without allow-same-origin
The generated design cannot reach the studio's API or DOM. The price is an opaque origin,
so design file routes send `Access-Control-Allow-Origin: *`.

## 2026-09-18 — No autofocus on the chat box
It made the design-guide gate fail two keyboard checks and jumps the page on mobile.

## 2026-09-18 — Preview tools as an MCP server, verification enforced by the server
Claude Code can't take custom tools any other way. The prompt asks for `verify`; the server
nudges once if a turn wrote files without verifying, because prompts alone are not
reliable. One nudge only, to bound cost.

## 2026-09-18 — One git commit per user message, repository outside the work tree
Gives a version history and restore without the agent ever seeing `.git`. A restore is a
new commit, so nothing is lost, and the agent gets a note to re-read files.

## 2026-09-18 — Canvas features through an injected bridge script
The sandboxed iframe can't be reached from the studio, so comments, tweaks and options
run in `static/canvas-bridge.js`, injected only when the canvas asks (`?bridge=1`). The
design files never contain it, so exports and the agent's own previews stay clean.

## 2026-09-18 — Comments: no cropped screenshot, resolved by the agent
The spec planned a cropped screenshot per comment. Selector plus element text is enough
to find the element, and the agent can screenshot it with its own tools, so the image
was dropped. The agent resolves comments through an MCP tool rather than the server
guessing from the diff, and unresolved comments are resent, so none are silently lost.

## 2026-09-18 — Keeping an option is a chat message
Removing the other options by string surgery would break layouts and leave wrappers.
The agent does it with full context; the cost is one turn.

## 2026-09-18 — Tweak values apply without the model
Controls post values to the bridge, which sets CSS properties, `data-*` attributes and
text. Only "Keep values" writes files, via `app/tweaks.py`, then notes it for the agent.

## 2026-09-18 — A design system is a kind of project
It gets chat refinement, versions, comments and the canvas for free; only the prompt and
read-only source access differ (`TurnOptions`). The spec's separate `design-systems/`
folder and `read_reference` tool were dropped in favour of this.

## 2026-09-18 — Source access: --add-dir plus deny rules
`--add-dir` grants write as well as read. Deny rules passed with `--settings` take write
back; verified live before relying on it. The source is usually a real repo of Rex's.

## 2026-09-18 — A design system is copied into the design, and resynced
Copying (not linking) keeps each design's versions and exports self-contained. Resync
before each turn, with a note, so refining the system flows into designs that use it.

## 2026-09-18 — Exports: one-page PDF, handoff via the agent
A PDF of a web design split into A4 pages looks broken, so it is one page of the full
height with screen styles. Handoff notes need judgment about what the design means, so
the agent writes `HANDOFF.md` on request instead of the app generating it.

## 2026-09-18 — Local models through the same harness, not a second agent loop
Ollama speaks the Anthropic Messages API, so the `claude` CLI can drive a local model and
every tool, the MCP server, nudges, comments and versions work unchanged. The spec's
"OpenAI-compatible adapter" would have meant re-implementing all of that.

## 2026-09-18 — A proxy to switch thinking off, not changes to Rex's Ollama
Making Qwen3 act needed `thinking: disabled` on every request. A small in-process proxy
does that without editing Ollama models or settings Rex's other tools (Hermes) rely on.

## 2026-09-18 — Empty-turn nudge
A completed turn with no text and no tool call gets one retry. Found with local models,
harmless for Claude.

## 2026-09-18 — The agent fixes errors it did not write
In the milestone 2 check the agent found an error injected outside the chat and asked
instead of fixing it. Rex chose fixing: `verify` must end clean. The prompt asks for the
smallest fix (e.g. remove a call to a missing function, not build the missing feature)
and a note in the reply, so hand edits are not silently rewritten.

## 2026-09-18 — verify checks contrast and unloaded files
Grove designs failed contrast and a local model shipped a page without its stylesheet;
neither raised an error, so `verify` was clean. Both are now reported, and the agent
must fix them. Design-system extraction is the exception for contrast: it records the
source's colours and lists failures instead of silently changing them.

## 2026-09-18 — Turns run in the background
A turn used to live inside the HTTP response, so closing or reloading the tab killed the
agent mid-work. Now `run_turn` is a task and responses only follow it; a reloaded page
reattaches. Stop is explicit (the Stop button), never implied by leaving.

## 2026-09-18 — Render Markdown instead of forbidding it
Both agents kept using Markdown despite prompts saying not to. A small DOM-building
renderer for the subset they use is simpler and safer than fighting the model, and never
parses HTML from model output.

## 2026-09-18 — "Paper" UI from Claude Design, restyle plus studio behaviours
Rex had Claude Design design the UI from `docs/design/` brief; of three directions it
detailed "Paper". Its handoff claimed CSS-only, but about a third needed JS; Rex chose the
restyle plus the studio behaviours (resize, Tweaks collapse, live step line, stage pill,
Esc, phone views). The same day Rex asked for the rest: Home thumbnails, filter and
search, folded forms and row cards on phones, and tokens for every remaining size.

## 2026-09-18 — Thumbnails rendered by the server, per version
A screenshot of the latest version's entry page, made with the same headless Chromium as
`verify` (device scale 0.3, no image library needed) and cached per version sha. One
shared browser renders one at a time and images load lazily, so a big Home page doesn't
start many browsers. While a turn runs the render isn't cached, because it comes from
the live files, which may not match the version yet.

## 2026-09-18 — Direct edits: unique text in place, styles in an overrides file
Mapping a DOM change back to source is guesswork in general. Text is replaced only when
it occurs exactly once in the design's files; otherwise the agent gets it as a message.
Styles go to `studio-edits.css` with `!important` under the bridge's selectors, generated
from JSON so repeated edits merge. Drag-to-move was left out: in flow layout there is no
faithful CSS for "put it there"; margins and alignment cover the need. (Superseded the
same day: see "Moves are CSS: order in flex/grid, translate elsewhere".)

## 2026-09-18 — Attachments are read-only files, not prompt content
The agent reads attached files with its own `Read` tool from a read-only folder, so large
files don't bloat every turn and images reach vision models natively. Office formats are
converted to text with the standard library; no new dependency.

## 2026-09-18 — Remote design-system sources are fetched, then treated as local
A GitHub URL becomes a shallow clone and a Figma URL an export (summary, JSON, frame
renders) in `data/<slug>/source/`, so extraction reuses the read-only-folder path. Figma
needs `FIGMA_TOKEN`; it is tested against a fake API only.

## 2026-09-18 — Conformance is advice, contrast is a failure
Colours and fonts outside the attached system are reported but don't fail `verify`,
because some are deliberate (contrast overrides, missing tokens) and the agent must say so.
(Superseded the same day: see "Conformance fails verify; exceptions are declared".)

## 2026-09-18 — The Claude Code link goes through the app's HTTP API
The MCP server holds no state: it drives the running app, so terminal and studio see the
same projects, turns and versions, and it asks the app for file locations rather than
assuming the repo layout. Turns block up to `wait_seconds`, then `wait_for_turn` resumes.
Errors are raised as `ToolError` because mcp 2.x hides other exceptions' text.

## 2026-09-18 — mcp 2.x
`FastMCP` was renamed `MCPServer` (`mcp.server.mcpserver`). Code written against 1.x
examples will not import.

## 2026-09-18 — Moves are CSS: order in flex/grid, translate elsewhere
Claude Design has drag, resize and align, so Rex asked for them. Dragging inside a flex or
grid parent reorders siblings with `order`, which stays true at every width; anywhere else,
and for aligning several elements, the move is a `translate` in px. Both land in the
edits stylesheet, so no source HTML is rewritten. A `translate` is a visual nudge that
won't adapt to other widths; the prompt tells the agent it may turn one into real spacing.

## 2026-09-18 — One edits stylesheet per page
Selectors from the bridge are per page (`nth-of-type` paths), so a shared stylesheet would
let one page's rule hit another page's element. Each page gets its own file, linked with a
path relative to the page. The old flat `style-edits.json` is read as the entry page's.

## 2026-09-18 — The canvas is chosen by path prefix
`?bridge=1` was lost as soon as a link in the design opened another page, so comments,
Edit mode and Tweaks stopped working there. `/canvas/` and `/canvas-version/` inject the
bridge into every HTML page under them, and relative links stay under the prefix. A page
missing from the live files or a version redirects to the entry rather than erroring.

## 2026-09-18 — Conformance fails verify; exceptions are declared
Claude Design corrects drift from the design system before the user sees it; advice alone
let off-system values stay. Now any colour or font outside the system fails `verify`.
Deliberate exceptions are declared as `--ds-override-*` custom properties (and explained
in the reply), so they are visible in the code and the check stays strict. Colours the
user picks in Edit mode are the user's decision and are allowed.

## 2026-09-18 — Default design system instead of Claude Design's "Published"
Claude Design applies a published system to every new project in an organization. This is
one user's machine, so it is one app-wide default (`data/settings.json`), preset in the
new-design form and used when the API request leaves `design_system` out. No admin lock.

## 2026-09-18 — Connectors are the user's MCP servers
Claude Design reads context from connected tools. The agent otherwise runs with
`--strict-mcp-config` so the user's own Claude Code setup never leaks in; connectors are an
explicit, per-project opt-in from a list the user keeps in `data/connectors.json`, in the
same format as `.mcp.json` so entries can be pasted. They are not imported automatically.

## 2026-09-18 — Starters are prompts, branches are projects
Claude Design has a template gallery. Here a starter is a prompt put in the composer to
edit, not a pre-made design, so it costs nothing until sent and matches the design system.
"Try something completely different" is a branch: a new project from one version's
files, so the original keeps its history untouched.

## 2026-09-19 — Hierarchy is declared by the agent and measured by verify
Rex's main complaint about Claude Design is that nothing makes a design read in order of
importance. Competitors (Sept 2026) give the model rules as context (Figma Make guidelines,
Stitch DESIGN.md, Claude Code skills), constrain it with pre-built parts (v0, Relume), or
critique afterwards (UX Pilot heatmaps, Stitch voice critique); none checks hierarchy
inside the generation loop. Model critiques are also unreliable at deciding which problem
matters most (UICrit, PerceptUI). So the agent states its intended order (`data-priority`)
and `verify` compares it with a deterministic prominence score from rendered styles, failing
until they agree. Missing marks fail too, so every design page carries its hierarchy (and
the handoff notes can use it). The score is a heuristic with visible parts, chosen over a
saliency model so each finding says what to change. Design-system specimens are exempt.

## 2026-09-19 — Renamed to Ultimate Design
Rex renamed the app from prototype-maker. The product name is "Ultimate Design"; the
identifier (repo folder, package, MCP server name) is `ultimate-design`. Internal prefixes
stay as they were: `PM_*` environment variables, `--pm-*` CSS tokens, the `pm` preview MCP
server and its `mcp__pm__*` tools. Renaming those would churn every file and the agent's
tool names for no user-visible gain. `docs/design/` keeps Claude Design's handoff as delivered.

## 2026-09-19 — Clarifying questions are a tool, answered in a form
Claude Design asks a few questions before building; our agent used to guess and state its
assumptions, which wastes a full turn when the guess is wrong. The agent now calls
`ask_questions` (a preview MCP tool, so the questions arrive structured and validated, not
parsed from prose) and ends its turn; the studio renders a form and sends the answers as the
next message. The CLI's own question tool can't be used: the agent runs headless with no one
to answer mid-turn. The prompt limits asking to a new page whose audience, main action,
priorities or content are open, and never twice in a row.

## 2026-09-19 — Claude Design's content rules, and what the user is looking at
Reading Claude Design's own guidance showed our prompt contradicting it: we told the agent
to invent plausible prices and names; Claude Design forbids invented facts and uses visible
placeholders. We now follow it (placeholders for facts about the user's business; sample
data inside product screens is allowed and said so), plus its rules on filler, targeted
changes, visual vocabulary, flex/grid gaps and exact values from source. Claude Design also
tells its model which artboard and element the user has selected; we now send the page,
width and Edit-mode selection with every message as one "Studio context" line (user-side
text is flattened to one line with backticks replaced, and the page must stay inside the
project). Reference folders are restated every turn rather than noted once, because a
stopped turn starts a new session that would otherwise not know them.

## 2026-09-19 — The board is a view over pages, laid out by rows
Claude Design explores directions as artboards side by side. Ours builds on what exists:
every frame is an HTML page, so comments, edits, tweaks, versions, `verify` and exports
keep working unchanged, and the board is a second view of the same files. The agent
describes it in `board.json` with rows and order, not coordinates: it never computes
positions, and a page can appear at several widths. Frames can't be dragged around yet.
Directions are low-fidelity pages the agent sketches when the look is open (Claude Design's
own guidance: settle the direction before building the full design, with an honest case
for each); `data-option` sections stay for variations of one section. Fit is computed from
the board data because captions are counter-scaled to stay readable, which makes the
rendered size depend on the zoom.

## 2026-09-19 — Viewport buttons say Desktop / Tablet / Mobile
The Paper handoff labelled them "Desktop 1440" and so on. With the Page | Board switch and a
page picker the toolbar no longer fit one row at 1440px, so the numbers moved to each
button's tooltip; the zoom readout ("1440px at 66%") still shows the exact width. The
toolbar also wraps as a last resort instead of overflowing (tested).

## 2026-09-19 — Delete hides now; duplicate and wrap go to the agent
Claude Design edits its own markup format, so it can duplicate or wrap instantly. Ours edits
real HTML the agent wrote; mapping a DOM change back to source is guesswork. Delete is
saved as `display: none` at once and the agent removes the element on its next turn, after
which the app drops the rule (keeping it would hide the next sibling). Duplicate and wrap
preview in the canvas and become an exact instruction in the message box; the user decides
when to spend the turn.

## 2026-09-19 — Print through Chromium's own paginator, merged with pypdf
Claude Design cuts flow documents between text lines itself and ignores CSS breaks. We
render paper pages with Chromium's print engine, so `break-before`, `break-inside` and
print styles work; margins come from the export (0.75in) so every page has them, not only
the first and last. The board PDF is one Chromium PDF per frame merged with pypdf (one
small pure-Python dependency), because a single print job can't mix page sizes reliably.

## 2026-09-19 — Design-system components are plain HTML and CSS first
Claude Design mounts a system's compiled component bundle. Our designs are plain HTML with
no build step, so extraction rebuilds the source's components as `ds-` classes (custom
elements only where behaviour needs them) and the README carries the exact markup to
copy. One system per design stays (Rex's call, 2026-09-19): several would touch the copy,
sync and conformance for a single-user tool.

## 2026-09-19 — Models switch per project; the session survives only between Claude models
A project's model was fixed at creation. Now any Claude model or pulled local model can be
chosen from the next message. Claude Code resumes a session under a different Claude model,
so the conversation continues. A local model runs through Ollama's API with a different
message history, so switching to or from one starts a new session and the agent gets a note
to read the files first.

## 2026-09-19 — Look-alikes of system components fail verify
Telling the agent to use the system's components was not enough: in a live run Haiku
loaded `components.css` and still styled its own `.invoice-card`. As with hierarchy, the
rule became a check: an element with its own box whose class names a system component, or
a filled button that isn't `ds-button`, fails `verify`. Name matching is crude on purpose;
the box requirement keeps layout wrappers (`.card-grid`) and parts inside the real
component out of it. After the check, the same agent switched to `ds-card` in one turn.

## 2026-10-06 — Opus 5.5 by default; the model list follows the current lineup
`claude-opus-5` and `claude-sonnet-5` were superseded and Rex no longer uses them. The
default is `claude-opus-5-5`, and the switchable list is Opus 5.5, Fable 5.1, Sonnet 5.5
and Haiku 4.5. Opus 5.5's own effort default is `medium`, but the engine always passes
`--effort` (`high` unless `PM_EFFORT` says otherwise), so turns keep the depth they had. No
stored project named an old model; one that did would still show it in the picker and run.
Tests point `OLLAMA_URL` at a closed port so a machine's pulled models (long Hugging Face
names overflowed the phone layout) never change what a test sees.

## 2026-10-06 — creative-library lives here, as a subtree with its own Node toolchain
Rex retired the separate `creative-library` repo and moved it in so the design agent could
use it. `git subtree add` kept its history (from its `library-shell-and-imports` branch;
its `master` held only the first commit). It stays a self-contained Node project in
`creative-library/` with its own tests, rather than being merged into `app/`: the recipes
are copied into designs, never imported, and its `sync`/`render`/`harvest` toolchain and
vitest suite work unchanged. `design-guide` still reads its manifests, now at
`../ultimate-design/creative-library` (Rex: design-guide is where creative direction is
decided). The old repo is archived in `projects-history/archive/`.

## 2026-10-06 — The design agent reads the library and copies from it
Designs get `creative-library/` as a read-only `--add-dir`, with write denied like other
read-only folders, and the prompt names the shelf index and the manifest by absolute path.
The agent copies a recipe's construction into the project and drops its `UI.define()`
registration, so exports and handoff stay self-contained; linking the library would break
both. Design-system projects don't get it: extraction records a source, it doesn't add
techniques.

## 2026-10-06 — Built-in design systems are seeded projects, read-only in the studio
Rexorious had to be pickable like an extracted system, with a specimen, thumbnail,
conformance and attach-by-copy. Making each `design-systems/<id>/` folder a real
design-system project at startup reuses all of that unchanged. The repo is the source of
truth (the website imports Rexorious from it too), so the studio refuses chat, edits,
tweaks, restore and delete on a built-in system (403) and a restart mirrors the repo back,
committing a version when files changed. Duplicate gives an editable copy. The specimen
is the original spec document; the files only it needs live in `specimen/` and are not
copied into designs.

## 2026-10-07 — Colour from Sanzo Wada's combinations, declared per page and checked
Rex wanted the method of *A Dictionary of Color Combinations* in the tool. The data is the
MIT dataset mattdesl/dictionary-of-colour-combinations (159 colours, 348 combinations,
CMYK converted through ICC profiles), vendored in `creative-library/palettes/wada/`; nothing
was taken from the book's scans, and Wada's method is summarised in our own words. When a
design has no design system and the user gave no colours, the agent picks a combination,
declares it as `<meta name="palette" content="wada:NNN">` on each page, and `verify` fails
colours outside it, reusing the design-system conformance check with a palette instead of
tokens (`--palette-override-*` for declared extras). A meta per page, not a project setting,
because board directions each carry their own palette (Rex: directions use Wada palettes
instead of greyscale). Text ink is the usual override: 213 of the 348 have no pair at
4.5:1. The harmony, value and strength tags in `combinations.md` are computed from Lab with
hand-set thresholds; they approximate Wada's categories and are labelled as measurements.
Wada's area rule (unequal amounts, large areas read lighter) is in the prompt only; nothing
measures it.

## 2026-10-07 — The studio shows what the agent works with
A review found the newer features worked but left no trace in the studio. Now: the page's
Wada palette sits in the header (the bridge reads the meta, the colours come from
`/api/palettes/wada`) and its colours are offered in Edit mode when there is no design
system; each turn says what it read from the technique library, derived in the browser
from its Read steps rather than stored, so old chats show it too; a toolbar toggle draws
the `data-priority` order over the canvas; and SPEC 10's token counts and per-project
total are back, with a local model's turns left out (the CLI prices them as if Claude).
The zoom readout shows only the scale, because with a page picker the toolbar cut
"1440px at 55%" to "14…" and the width is on the viewport buttons already. The app serves
the library's gallery at `/creative-library/` so it no longer needs its own server.

## 2026-10-07 — The palette browser drafts a message instead of restyling
Choosing a combination in the "Wada palettes" browser puts "Use Wada NNN (...) as the
palette for this design." in the chat box rather than changing the design. Restyling a
page to a new palette means rebalancing which colour takes which area and fixing text
contrast, which is the agent's job and costs a turn, so the user sees and can edit the
request before spending it. The browser's tags come from the library's generated
`combinations.md`, so the JavaScript generator stays their only source.

## 2026-10-07 — The technique library lives in the studio, not in its own gallery
Linking Home to the library's maintenance gallery put a differently styled page, a Qt shelf
and a second design-system list in front of users, and left techniques out of the design
flow. Now the studio presents the web recipes itself, in its own style and with the palette
browser's pattern: browse, open a live demo, and draft a request for the agent. Where the
user is decides the action: in a design, "Use on this design" (or on the Edit-mode
selection); in the Library, "Start a design with it". The Qt shelf stays out (designs are
web). The gallery remains for working on the library. Tiles use their visible text as their
name, with spaces between the parts, because an aria-label built from the same parts still
failed the label-in-name check.

## 2026-10-07 — The intent index: a separate file, cases written first, one ranker
PLAN phase 4. Plain word overlap missed the README's own asks ("hand-made", "depth without
3D"), so each web recipe now says what it is for in `recipes/web/intents.json`, a hand-written
file beside the manifest rather than a new `UI.define()` field (that would mean touching and
re-syncing all 41 recipes for data no recipe uses at runtime). The expectations
(`engine/recipes/intent-cases.json`) were written before the index, and the index avoids their
wording, so the test measures how asks generalise rather than a lookup of copied sentences;
both are one author's judgement, which the test cannot remove. 17 of 18 asks land a
hand-picked recipe in the top 3. The miss, "a retro broken screen", is kept as a recorded gap
(no synonyms; "screen" also means a print dot screen) instead of tuning the index to it. The
ranker (`engine/recipes/rank.js`) is pure, so the studio imports the same file the library
tests: one ranker. Matched words are stems ("handmad"), so the studio shows the matched
purpose phrase instead.

## 2026-10-07 — Synonyms close the intent ranker's gap
"a retro broken screen" missed VHS glitch because the ranker matched words literally. The fix
is a short table of design synonyms in rank.js (broken ~ corrupted ~ glitch, screen ~ monitor
~ tv, mouse ~ cursor ~ pointer, photo ~ image ~ picture, retro ~ vintage ~ old, …), written as
general vocabulary rather than from the failing ask. To keep it from being fitted to that one
case, four new asks that need synonyms were added first: three missed before the table. One
still missed after it, which exposed that two-letter words ("tv") never entered the index; a
short list of meaningful two-letter words fixed that. A synonym scores one below an exact
match, so the literal reading wins ties. 22 of 22 asks now land in the top 3; the gap is
marked closed in intent-cases.json rather than deleted.

## 2026-10-07 — Parameter maps for the whole library, measured
The library's PLAN phases 0-3, done. Every web recipe prop now says what it controls, its
useful range and where it breaks, and a sweep in Chromium proves it changes the picture across
that range (`recipes/web/sweeps/`, checked in the suite by `sweep --check`). Choices a later
change might undo without knowing why:
- Five recipes were nondeterministic (unseeded `Math.random()`); each now takes a `seed`, so
  the same props paint the same picture. Their default compositions changed once as a result.
- Thresholds were calibrated on the seeded shelf (all floors 0): a pixel changes above 4/255
  and a step counts above 0.05% of the stage, because real effects ran as small as 0.1% and
  grain as faint as 3/255. Symmetry claims hold within a tenth of the parameter's mean step.
- Props a still frame cannot show (motion, pointer, click) are `unswept` with a reason rather
  than forced through a timed capture, which would be nondeterministic again.
- The sweeps found three previews that misrepresented their props: halftone dropped `invert`,
  canvas-chart ignored `data`, and liquid-glass's smooth backdrop hid `blur`. All fixed.
- Evidence is one strip per prop (frames side by side, cropped to the box any frame painted),
  not a PNG per value: one image to review by eye, one file per prop in the repo (~11 MB total).
- The studio shows each map with its evidence strip in the technique detail, and the ranker
  reads the `controls` prose as description (the 22 intent asks still all land).

## 2026-10-07 — design-guide is the rule book; Rex's decisions are logged
Rex approved the joint gate with design-guide (`docs/gate-rulebook.md`, all fifteen proposals
as written). ultimate-design reads one exported, versioned rulebook from design-guide and never
its files; every `verify` finding names a rule id, a severity and a fix; a missing rulebook fails
`verify`. Rex's picks, rejections and overrides go to `data/<slug>/decisions.jsonl`, with his
reason only in his own words (an exact quote, or null). The accessibility floor cannot be
dismissed and never comes from decisions. Rules come only from design-guide's periodic pass,
confirmed by Rex in the studio through design-guide's command. Read the gate before changing any
of this: each point there was argued by both sessions.

## 2026-10-07 — How the studio logs Rex's decisions (step 2a)
Choices inside the approved gate that a later change might undo:
- Edit-mode coalescing (section 13) is done with `supersedes`, never by editing: a later value for
  the same element and property in the same chat turn supersedes the earlier record and keeps its
  `from`; going back to the original value writes a no-op superseding record (`chose == from`),
  which the pass drops with what it supersedes. The turn boundary is `meta.decisions_mark`, the
  log's length when the last chat message was sent.
- `from` is read in the canvas: the bridge reports each property's computed value the first time
  Edit mode changes it (`style-before`). The server cannot know what the agent's CSS computed to.
- A questions-form answer is a pick only when the question offered options. With options ticked,
  the free-text field is the reason (his words beside a choice); with none ticked, it is the choice
  and every option is in `over`. A question without options chooses nothing.
- A restore is one `reject` over all the versions restored away, not one per change (design-guide's
  review: one restore would flood the pass).
- A reason given afterwards (the "why?" card) is a superseding copy of each record, so the log stays
  append-only and the pass's "drop superseded" keeps the reasoned copy.
- `dismissed` (top-level, required) separates a dismissed finding from an edit of a value, which both
  carry `rule`; design-guide asked for it because the pass reads them in opposite directions.

## 2026-10-07 — verify reads design-guide's rulebook (step 2b)
Choices inside the approved gate that a later change might undo:
- The rulebook is exported at the start of every turn (about 1 s), not cached across turns:
  design-guide's version hash and the project's users, tokens and decisions all change it, and a
  fresh export needs no invalidation logic. A failed export is stored as `{"error": ...}` and
  fails `verify`.
- ultimate-design implements only the measures it can do exactly: `contrast`, `target-size`,
  `reflow`, each held to design-guide's own fixture pages in the suite. `token-only` is left to
  design-guide's gate: its detector carries a page of exemptions learned on real sites, and a
  second copy would drift. Section 4's "one implementation of each check" is kept that way.
- The gate runs once per message, after the agent's last write, on the pages it wrote (at most
  3, about 3 s each), as the gate's open risk proposed. Blocking findings get one follow-up turn,
  like the verify nudge, so the agent cannot loop.
- Blocking means `confirmed` + `fail` + `maturity: stable`. design-guide keeps `severity: fail`
  on rules whose detector is still observed; those are reported, not enforced.
- An Edit-mode change names the first non-floor rule whose `check.properties` covers the
  property. Floor rules are skipped there: a colour choice is taste, and a floor-marked record
  would be dropped from the pass.
- Without a rulebook configured (previews, thumbnails, the Claude Code link) the built-in
  contrast check still runs, so nothing that worked before loses its check.

## 2026-10-07 — Rex confirms proposals in the studio (step 2c)
- The Rules view is a Home section beside Projects and Library, not part of a project: a
  proposal rests on decisions from several projects.
- The studio never writes a rule. Confirm and reject call `design-guide proposals confirm|reject`;
  the server refuses a confirm without a reason before design-guide is asked, and passes
  design-guide's own refusals through unchanged.
- A new rule's category is a choice from the rulebook's existing categories (Rex's ux-master
  taxonomy), never free text.
- The answer form is folded under "Confirm or reject…": with every form open, three proposals
  took two screens and read as a form rather than a list.

## 2026-10-08 — Packaged as a Claude Code plugin (step 3)
Rex lifted "don't package yet" for ultimate-design (creative-library stays unpackaged).
- A plugin, not a bare MCP registration: it carries the skill that tells Claude when to use the
  studio and the approval rule, and installs the same way as Iris (a directory marketplace in
  this repo).
- The launcher runs the MCP server from the repo with `uv`, not a copy inside the plugin, so the
  tools can never be out of step with the studio they drive.
- The user confirms a design in the studio: "Approve for build" on the version bar. Approval is
  of a version, so any change after it un-approves; `get_handoff` says so first. Terminal
  sessions wait for it (`wait_for_approval`) rather than asking in the terminal, which would move
  the decision out of the interface Rex wanted kept.
- The MCP server starts the studio when it isn't running (local URL only), detached so it
  outlives the terminal session, as the studio should.

## 2026-10-08 — The decision log takes design-guide's A/B answers too
design-guide's redesign (its gate, section 5, accepted by Rex) writes its own A/B answers as
decision-log v1 records, so one pass reads one stream. Two facts about an A/B pick had no field
and are load-bearing for its confidence, so v1 gained two optional fields, written only by
design-guide: `subject.scenario` (the demo pair answered; breadth counts distinct ones) and
`via` (elicited, in-build, derived, authored). Additive: every record the studio writes stays
valid and never carries them, so the version stays 1. Rejected: an adapter over design-guide's
old pick ledgers, or a second schema, which would have split the stream again.

## 2026-10-08 — The agent is told the project's settled choices
Gate 1, section 14 said a project's decisions are settled within it and the design agent does not
reopen them. design-guide's export now takes the project's decision log (`--decisions`) and
returns its taste-rule picks as `layer: project` rules, so the server passes `data/<slug>` on every
export and puts those rules at the head of the turn's prompt, in the user's words when there are
some. Every turn, not once: a resumed session may have lost the earlier note, and the list is short.

## 2026-10-08 — Conformance checks carry design-guide's rule ids, and keep blocking
design-guide's redesign (section 8) named ultimate-design's design-system and palette checks as the
one implementation of two new rules, `design-system-conformance` and `palette-conformance`, with
its own fixture pages; ultimate-design's checks give its verdict on all four. Findings now start
with the rule id, and a dismissed rule is not checked.
- They keep blocking `verify` although design-guide lists both rules as proposed until Rex accepts
  them in its Inbox. Gate 1 says a proposed rule binds nothing, but these checks bound before the
  rules existed (Rex's own decisions in this repo), and letting them stop blocking would quietly
  weaken verify until he acts. Rex confirmed it on 2026-10-08: "keep the proposed rules blocking,
  accept them later" (this holds for hierarchy-matches-priority too).
- The agent's declared exceptions (`--ds-override-*`, `--palette-override-*`) are listed on the
  findings card, as gate 1 section 12 promised: they are the agent's mechanism, so Rex sees each one.

## 2026-10-08 — Which rule an edit names when several read its property
design-guide's rulebook now has three non-floor rules that read colour (no-raw-design-values,
palette-conformance, hierarchy-matches-priority), and the export sorts rules by id, so "the first
match" quietly changed which rule a colour edit named. An edit now names a confirmed rule before
a proposed one, then the lowest id: a colour or spacing edit counts toward the token rule, a
font-size edit toward hierarchy. The hierarchy check's findings carry `hierarchy-matches-priority`
and a dismissal skips it, as for the two conformance checks.

Revised the same day with design-guide: the edit is matched against the project's own export
(withheld rules are not in it), and ranked palette page first (palette-conformance), then the
token rule over hierarchy for colour, background, border and font family (hierarchy keeps
font-size and font-weight), and only then confirmed over proposed. Ranking confirmed first would
have let a confirmed rule win over the one this page is actually about.

## 2026-10-08 — The studio is redesigned: look A, Workbench, and the new structure
Rex said the interface looked too much like Claude, and that it has to hold many design systems,
layouts and mockups. He picked look A and every structural change in `docs/gate-studio-redesign.md`
(mockups in `docs/design/redesign/`). This deliberately leaves the "Paper" handoff from Claude
Design (`docs/design/`). Choices a later change might undo:
- The chrome has no hue at all, light or dark, and the canvas sits on a neutral grey: the studio
  judges other people's colours, and a tinted surround shifts them. Only selection and focus use
  a colour (one blue); ink is the one primary action per view, so Export became secondary next to
  Approve for build.
- Design systems left the project grid and the Library for their own section, and the create
  forms left Home for a "New…" sheet.
- The agent moved from the left frame to the right panel's first tab; the composer, the comment
  and capture forms and the "why?" prompt sit under every tab, so a message about an Edit-mode
  selection, or a reason for an edit just saved, never needs a tab switch.
- History shows a rendered thumbnail per version (kept per sha) instead of a slider; Approve for
  build moved to the top bar.
- On phones the rail is a bottom tab bar (Rex's recorded pick, tab-bar), and the outline gives way
  to the page dropdown.

## 2026-10-08 — Static assets are versioned by content
After the redesign Rex saw "only the sidebar in the middle of the screen": his browser kept the old
`style.css` (static files had no cache headers) and paired it with the new markup. The studio page
now references its stylesheets and scripts as `?v=<content hash>` and is itself sent `no-cache`;
the canvas bridge script is versioned too. A changed file is a new URL, so this cannot recur.

## 2026-10-08 — Motion: short, on what changed, never on the agent's own reloads
Rex asked for smooth transitions throughout. Motion is 120-280 ms fades and a 6 px rise, on what
the user just caused or what just arrived (a section, a tab, a message, a sheet). Two things are
left still on purpose: the canvas reload after each agent write (it would flash many times a
turn), and the saved conversation when a project opens (dozens of messages animating at once is
noise, not continuity). All durations are tokens set to zero under prefers-reduced-motion
(design-guide's `reduced-motion-respected`).

## 2026-10-08 — Compare, Plan first and motion editing
Rex asked to build the three ideas from a look at other tools (Bolt's diff view, the plan step
of Lovable, Stitch and v0, Figma Motion).
- Compare shows screenshots, not two live canvases: a picture of each version scrolls as one,
  lines up exactly, and can carry outlines of what changed. The changed regions come from
  comparing pixels in the shared Chromium, so no image library is added; the threshold keeps
  anti-aliasing out, and nearby changes merge so a changed paragraph is one box, not forty.
- Plan first is a per-project toggle the agent learns about from a note before each message,
  like the other per-message notes, rather than a change to the system prompt per project. The
  plan is edited in place and approved as a plain message ("Build this plan: …"), so the chat
  history reads on its own and the agent needs no other channel.
- Motion editing offers presets (three entrances, three hover states, three speeds), not
  keyframes or curves: the inspector edits what a page already has, and a timeline is a
  different tool. Saved motion plays only under prefers-reduced-motion: no-preference. The
  presets are written as custom properties too, so the inspector reads them back from the page.

## 2026-10-08 — A page that declares its width is shown at that width
Rex saw a strip of background on the right of a flyer's direction pages. They are letter sheets
made 816 px wide (`<meta name="viewport" content="width=816">`, no print bleed: nothing on the left
or in `@page`), and the canvas drew them in a 1440 frame. The canvas now follows the width the
page declares rather than the device buttons, because such a page has no other layout to show; the
buttons are disabled while it is on screen rather than silently ignored.

## 2026-10-08 — creative-library loads on every UI edit, alongside design-guide
Rex (via iris-secretary, Iris redesign reach item 2) asked for creative-library's skill to load on
any UI edit, not only when a technique is named. Naming the file types was not enough: fresh Haiku
sessions on a `.qml` and an `.html` edit loaded design-guide only, since both skills claim the same
trigger and Haiku took one. The description now says it loads in addition to design-guide, and
with that both sessions loaded both. The shelf drift check with design-guide's copies now runs in
creative-library's suite (`shelf.test.js`), so a recipe change fails where it is made.

## 2026-10-13 — Workspaces: the repo is generic, everything personal moves out
Rex wants the app public, standalone, and usable at work with a company's own UX guides and
design systems, with his personal taste switched off there entirely and his own data kept apart.
- One folder, the workspace (`PM_WORKSPACE`, else `workspace/` in the repo, gitignored), holds
  projects, app state, built-in design systems and written guides. A company shares one as its
  own private repository; each person's `projects/` and `data/` stay out of it.
- A checkout from before workspaces (`projects/` or `data/` at the repo root, no `workspace/`)
  keeps the repo root and design-guide, so merging changes nothing until the data is moved on
  purpose. A new workspace defaults to the built-in rule book.
- Rule book `builtin`, not a stripped design-guide (option B of three): design-guide is a
  separate, unpublished repo whose knowledge folder mixes the floor with Rex's taste and
  decision history and has no switch for either. The built-in rule book is design-guide's three
  floor measures the app already implements, copied into `app/rulebook-builtin.json` and kept in
  design-guide's format, so a later split of design-guide (engine plus packs) can slot back in
  without changing workspaces. In `builtin` there is no gate, no proposals and no Rules view.
- Written company guides are read, not measured: they are named to the agent with every design
  message and the folder is readable. Turning prose rules into checks needs the design-guide
  split. Tokens and components belong in a design system, where `verify` enforces them.
- `workspace.json` may name a default design system for everyone; a person's own pick on Home
  still wins, because it is stored per person in `data/settings.json`.
- Rexorious left the repo for Rex's workspace. MIT licence.

## 2026-10-13 — Public as one squashed commit; the maintainer's own setup stays as it was
The public repository starts from a single commit of the current files, not this history:
older commits still hold Rexorious, the author's email and docs written around one person,
and rewriting each of them is more work than it is worth. The full history stays with the
maintainer, as `archive/master` (privately). Commits use the GitHub no-reply address.
Personal use is unchanged by going public: the maintainer's workspace (`workspace/`,
`"rules": "design-guide"`), design-guide, the Iris tracker and the installed skills all live
outside the repo, so the public code is the same code the maintainer runs.
