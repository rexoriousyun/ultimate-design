# prototype-maker — "Paper" handoff for Claude Code

Design canvas: a private Claude Design project (pages: Studio, Home, Mobile 390, Tokens & components).
Goal: restyle `static/` with markup + CSS only. `static/app.js` keeps working unchanged.

## Rules
- Import `tokens.css` first. Component CSS uses `var(--pm-*)` only — no raw colour, size, radius, shadow or duration.
- Keep every id and class from the brief's "Implementation mapping". New wrappers are fine; no renames.
- Style states from `[hidden]`, `:disabled`, `[aria-pressed="true"]`, `[aria-invalid="true"]`, `details[open]` — no new state classes.
- `:focus-visible { box-shadow: var(--pm-focus-ring); outline: 2px solid transparent; }` on every control (the transparent outline keeps forced-colors mode working).
- Hit areas ≥ 24×24 desktop, 44×44 under 800px. No positive tabindex, no autofocus.
- Fonts: Instrument Sans + Newsreader from Google Fonts (`display=swap`); stacks fall back to system fonts offline.

## Layout
- `#studio`: `display:flex; height:100dvh`. Chat pane `width: var(--pm-chat-w)` (resizable 320–560 via a new `<button aria-label="Resize chat">` handle that also takes ←/→). Canvas pane is an inset card: `margin: 12px 12px 12px 4px; border-radius: var(--pm-radius-lg)`.
- Canvas pane column: toolbar (52) → `#options-bar` (48, when shown) → `#canvas-stage` (flex 1) → `#version-bar` (56, at the bottom).
- `#tweaks-panel` floats: `position:absolute; top/right: var(--pm-space-5)` inside `#canvas-stage`, `width: var(--pm-tweaks-w)`, `box-shadow: var(--pm-shadow-float)`. Add a collapse button (`aria-expanded`); collapsed = a "Tweaks" pill in the same corner. Auto-collapse while `#comment-mode[aria-pressed=true]`.
- Stage background `--pm-stage`; `#canvas-box` sits on it with `--pm-shadow-canvas`; iframe background stays `--pm-canvas` (#fff).
- Under 800px: Chat and Canvas become two views switched by a new segmented control (`aria-pressed`), instead of the 60/40 stack. Both panes stay in the DOM; toggle with `hidden`. Viewport buttons collapse to one `<select>` (keep `.segmented` buttons in the DOM, visually hidden, or wire the select to click them). Inputs use 16px text so iOS doesn't zoom.

## Home
- Header bar with wordmark (display font) + `localhost:8765`.
- Two columns: 380px create column (`#new-project`, `#new-ds` as cards) and the project grid.
- `#project-list` → `display:grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))`. Each row card: thumbnail (new; screenshot of `index.html`, or swatches for design systems), `.open` link in display font, `.badge`, meta line (model · attached system), `.when`, Duplicate, `.danger` Delete.
- New (optional): filter toggles All / Designs / Design systems and a search field — show once there are 20+ projects.
- Error: `#ds-source[aria-invalid=true]` gets a 2px `--pm-danger` border; `#ds-error` (role="alert") sits directly under the field with an icon; `aria-describedby` links both.

## Chat pane
- `#project-name` display 26px. `#model-note`, `#ds-choice` on one muted meta line.
- `.msg.user`: right-aligned `--pm-bubble`, radius 14. `.msg.assistant`: display font 16px, no bubble. `.msg.note`: 12.5 muted. `.msg.error`: `--pm-danger` text on `--pm-danger-soft`.
- `.steps` finished: inline muted summary ("9 steps") next to `.turn-meta`. `.steps` for the running turn: a bordered card whose `<summary>` is one progress line (ring spinner + latest step label + count + elapsed time). Expanding shows the full `<ol>`; `.failed` items in `--pm-danger`.
- `#comments` and `#comment-form` sit between the log and the composer (not inside the scrolling log). The comment form gets an accent border + `--pm-accent-soft` halo. `#comment-target` is the field's `<label>`.
- Composer is a single rounded card: textarea without its own border; `#status` left; `#stop` (secondary, pill) and `#send` (round primary icon button with `aria-label="Send"`) right.

## Canvas overlays (`static/canvas-bridge.js`, fixed colours, not tokens)
- `.pm-hover`: `outline: 2px dashed #111214; outline-offset: 3px; box-shadow: 0 0 0 3px #fff;`
- `.pm-pinned`: same with `solid`.
- `.pm-pin`: 20px circle, `background:#111214; color:#fff; border:2px solid #fff; box-shadow: 0 0 0 1px rgb(0 0 0/.45), 0 2px 6px rgb(0 0 0/.3); font: 600 10px/16px system-ui`. The picked-but-unsaved element uses the inverse pin (white fill, dark border).
- The dark + white pairing reads on light, dark and busy designs.

## States (see the Studio page for each, light and dark)
Idle · Running (pill "Updates after every file write", Stop shown, Send/`#ds-select`/Keep values disabled) · Comment mode (Comment toggle filled with accent, stage pill with Esc hint) · Past version (pill + `#restore` primary in the version bar, Growth card shows the old design) · Options bar (joined chip + Keep, selected chip `--pm-accent-soft` + filled Keep) · Tweaks changed ("Unsaved" tag, Reset + Keep values enabled) · No design (`#canvas-empty`, no bars, no Tweaks).

## Checks before merge
- axe / your gate on Home, Studio (every state), both themes, 1280, 1440, 1920 and 390.
- Keyboard: Tab order chat header → log → comments → composer → toolbar → options → stage → Tweaks → version bar.
- Reduced motion: spinner static, pills and panels don't animate.
