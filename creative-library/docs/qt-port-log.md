# Qt port log — phase 6

What crossed from web to desktop, what did not, and why. Same convention as
design-guide's `docs/port-log.md`: a drop is recorded with a reason, so "we decided against it" and "we
forgot" stay distinguishable.

## Tier 0 — invariants

Six of twelve now evaluate against a PyQt6 window through the real entry pipeline:
`control-accessible-name`, `focus-visible`, `focus-order-sane`, `target-size-minimum`,
`keyboard-reachable`, `form-field-labeled`. Zero findings on `clean_app.py`; the seeded
defects caught on `broken_app.py`.

`engine/checks/subjects.js` is what made that possible — a platform-neutral view of "what is
interactive here, and where", reading `bundle.dom` on the web and `bundle.tree` on Qt.
Before it, only the two checks that happened never to touch the DOM worked, and only when
called directly rather than through `runChecks`.

The other six are not-applicable, and mostly correctly so:

| entry | why not on Qt |
|---|---|
| `html-lang` | A document language attribute. There is no analogue; Qt localisation is not a per-window declaration. |
| `zoom-not-disabled` | A viewport meta tag. Desktop windows do not have one, and OS-level scaling is not the app's to suppress. |
| `contrast-minimum` | Delegated to axe-core, a browser DOM/CSS scanner. Computing contrast from Qt would mean sampling rendered pixels — real, but a different check, not this one. |
| `heading-order` | Also axe-delegated. Qt exposes a `heading` role, so this is the most portable of the three and the best candidate if the axe dependency is ever replaced. |
| `image-alt` | Also axe-delegated. Qt's `img` role carries a tooltip-derived name, so the same caveat applies. |
| `reduced-motion-respected` | Needs computed styles to diff under `prefers-reduced-motion`. Qt has no style tree and no OS-level reduced-motion signal the probe can emulate. |

## Tier 2 — recipes

**Two of six survive. One is ported; one is deferred.** (Superseded — see the 2026-08-03 update below.)

| recipe | verdict |
|---|---|
| `icon` | **Ported** (`recipes/qt/icon.py`). Identical 24×24 path data and 1.75 stroke, rendered via `QSvgRenderer`, with a committed screenshot from the render gate. |
| `canvas-chart` | **Portable, not ported.** `QPainter` is the same imperative 2D model as Canvas 2D, so this is a genuine rewrite rather than a translation — deferred rather than dropped. |
| `gooey-blobs` | **Dropped.** Needs `feGaussianBlur` feeding an alpha-contrast `feColorMatrix`. Qt has `QGraphicsBlurEffect` but no colour-matrix-on-alpha compositing, so the merge-on-approach behaviour cannot be reproduced. |
| `squiggle-wobble` | **Dropped.** Needs `feTurbulence` → `feDisplacementMap`. Qt has no turbulence or displacement primitive. |
| `liquid-glass` | **Dropped.** Same reason, plus `backdrop-filter`, which has no Qt equivalent. |
| `three-scene` | **Dropped.** A thin wrapper over a CDN-hosted three.js build. Qt's 3D story is Qt3D/`QOpenGLWidget` — a different API with a different lifecycle, so nothing of this recipe transfers except the idea. |

The three SVG-filter recipes failing together is the honest headline: **the web tier-2 shelf
leans heavily on SVG filter primitives, and that is the part of it that does not travel.**
What travels is artwork and layout logic.

`icon.py` duplicates the path data rather than importing across the language boundary,
because recipes are copied, not imported — a Qt project takes that one file. The duplication
is guarded by `engine/recipes/qtManifest.test.js`, which asserts both files carry the same
icon names, the same path data, and the same stroke width.

### One bug the port found

The first Qt render produced a valid pixmap with **10 painted pixels** at `dpr=2` against 247
at `dpr=1` — for artwork that should simply scale. `QSvgRenderer.render(painter)` with no
bounds leans on the painter viewport interacting with `devicePixelRatio`. Passing an explicit
target rect in logical coordinates removes the interaction: 247 / 829 / 1799 painted pixels
at dpr 1 / 2 / 3.

Worth noting because it is the exact failure mode `npm run render` exists to catch
on the web side — a recipe that runs without error and paints almost nothing.

**The Qt shelf now has that gate too** (`engine/recipes/qtRender.js`). Each recipe exposes a
`demo()` returning a QPixmap; `recipes render` runs it, counts pixels differing from the
demo's own background, fails the recipe if that count is zero, and commits the screenshot.
Measuring against the corner colour rather than transparency is deliberate — a Qt demo fills
an opaque background, so a transparency test would wave a blank white rectangle straight
through. Tested against a recipe that fills a pixmap and draws nothing on it.

## The deferred open question: do tier-3 tokens mean anything in Qt?

PLAN.md deferred this here. The answer is **partly, and the split is not where I expected.**

**Colour, type and shape tokens transfer.** Qt style sheets accept the same concepts — a
background colour, a font family and size, a border radius — and `icon.py` already takes a
colour parameter precisely because Qt cannot inherit one the way `currentColor` does. A
derived `tokens.json` is directly usable to generate a Qt style sheet.

**Spacing transfers with a caveat.** Qt layouts express spacing through
`setContentsMargins`/`setSpacing` rather than per-widget padding, so a token set survives but
the *application* is coarser: one spacing value per layout, not per element.

**Motion mostly does not.** Tier 3's motion tokens are CSS transition and animation
durations. Qt animates through `QPropertyAnimation`, which is imperative and per-property —
a duration token is still meaningful, but the easing token's CSS `cubic-bezier` has no direct
`QEasingCurve` equivalent, and there is no declarative transition to attach a duration to.

**Elevation does not.** `box-shadow` tokens have no Qt counterpart; `QGraphicsDropShadowEffect`
exists but is applied per-widget and does not compose the way a shadow scale assumes.

So desktop gets art direction, minus motion and elevation — which is a narrower answer than
"judgment and techniques but no art direction", and worth revisiting only when someone
actually builds a Qt app from a derived token set.


## Tier 2 update — 2026-08-03

The web shelf grew from 6 recipes to 33 while the Qt shelf stayed at 1, which reads as
neglect and mostly is not. Classified by whether the technique *can* cross:

| bucket | n | crosses? |
|---|---|---|
| three.js | 5 | No. Qt3D/`QOpenGLWidget` is a different API with a different lifecycle; nothing transfers but the idea. |
| SVG filter primitives | 6 | No. `feTurbulence`, `feDisplacementMap`, `feColorMatrix`-on-alpha, `backdrop-filter` have no Qt equivalent. |
| Canvas 2D | 8 | Yes — `QPainter` is the same imperative model. Genuine rewrites, not translations. |
| Plain SVG geometry | 11 | Yes — paths and arcs become `QPainterPath`. |
| DOM/CSS dependent | 3 | Needs rethinking. `elementFromPoint`, `@keyframes`. |

So **11 of 33 structurally cannot cross** and ~19 could. The gap is 19, not 32. The 2026-07
headline holds and got sharper: the web shelf leans on SVG filter primitives, and that is
precisely the part that does not travel.

**Ported today: `pixel-sprite` and `acorn-hoard`.** Qt shelf 1 → 3.

`pixel_sprite.py` is the strongest kind of port after `icon.py`: byte-identical row-maps and
palette, because the technique is *a data format plus two rendering decisions* and neither is
a web idea. Both decisions carry over in dialect —

- blit through a 1:1 buffer and scale once: `QImage` + `drawImage`, not 1,024 `fillRect`s;
- turn interpolation **off** on the destination: `SmoothPixmapTransform` unset is Qt's
  `imageSmoothingEnabled = false`, and setting either one turns pixel art to mush.

`acorn_hoard.py` is the second-strongest: not identical artwork but identical *logic*. The
row capacities, the centre-on-the-widest-row rule, and the overflow report are the same
arithmetic; only the draw calls differ.

### Two bugs the port found

**Sibling recipes were unimportable.** Both Qt loaders used
`importlib.util.spec_from_file_location` without putting the recipes directory on `sys.path`,
so `acorn_hoard.py` failed with `No module named 'pixel_sprite'` the moment it arrived. Wrong
in principle as well as in practice: recipes are copied, not imported across a package
boundary, so a Qt project holds both files side by side and Python must be able to see that.
Caught by the render gate on the first run.

**The web recipe emitted negative zero.** `-r * rowH` is `-0` for the bottom row and
`-((rowsUsed - 1) * rowH)` is `-0` for a single-row pile; Python returns plain `0` for both.
Cosmetic until something compares with `Object.is`, and invisible without a second
implementation to disagree with. Found by the cross-language guard on its first run, which is
the entire argument for writing one.

`engine/recipes/qtPixelSprite.test.js` compares the two directly — same palette, same pixels
per pose, same widening, same mood maps, and the same layout for every count from 0 past
capacity. Deliberate duplication still rots; nothing about editing the JavaScript makes
anyone open the Python.
