# PLAN — parameter maps and evidence sweeps

## What this repo is

A corpus of visual-code techniques, lifted whole out of `design-substrate`'s tier 2. It ships
runnable constructions to copy and adapt — never to install — plus the toolchain that keeps
them honest.

What it already does, verified by running it:

- `recipes/web/` — 37 registered recipes plus `registry.js` (38 `.js` files; the README's
  "38 web recipes" counts the registry). `recipes/qt/` — 3 recipes plus a manifest.
- `engine/cli.js` — three verbs: `sync`, `render`, `harvest`.
- `sync` regenerates `recipes/<shelf>/manifest.json` by **executing** the modules — web in
  Chromium (`engine/recipes/manifest.js`), Qt in a real interpreter (`engine/recipes/qtManifest.js`).
  A module that throws, or loads without calling `UI.define()`, cannot reach the manifest.
- `render` mounts every `demo(container)` and commits a screenshot, failing anything that
  paints nothing (`engine/recipes/render.js`).
- `./node_modules/.bin/vitest run` → **104 tests across 11 files, all passing** (run
  2026-08-13, 54.2s wall, exit 0). `render.test.js` 28.4s and `reducedMotion.test.js` 52.8s
  dominate.

Nothing in this plan changes any of that. It adds.

---

## 1. Inventory

### What a recipe declares

The contract is `UI.define(spec)` in `recipes/web/registry.js:35-41`, which hard-requires
`id`, `primitive`, `demo`, `preview`. The serializable half is listed explicitly in
`registry.js:58-79`:

| field | what it is |
|---|---|
| `id`, `primitive`, `label`, `source`, `export`, `description` | identity and prose |
| `props` | `{ name: { type, default } }` — **name, type, default, and nothing else** |
| `hasPreview` | that `preview(container, props)` exists |
| `requires` | external globals (only `THREE` in practice) |
| `dependsOn` | other recipes on this shelf |
| `signature` | `{ within, requires[] }` — DOM fingerprint, consumed by the sibling repo |
| `snippet` | copy-paste usage string |

Two renderers on purpose (`registry.js:20-24`): `demo()` is the scripted showcase the
screenshot is taken of; `preview(container, props)` renders exactly the props handed to it.
The comment already states the intent this plan builds on — *"Documenting a prop and giving
no way to change it is documentation that cannot be checked."*

Worked source: `recipes/web/halftone.js:116-147`, `recipes/web/flow-field.js:152-186`.

### What the manifest captures

`recipes/web/manifest.json` — 37 components, `library` / `description` / `components[]`, one
object per recipe with exactly the fields above. Sorted by id, byte-stable, and
`engine/recipes/manifest.test.js:26` asserts a fresh build equals the committed file.

### What `render` actually verifies

`engine/recipes/render.js` proves four things and no more:

1. every module loads in Chromium without a page error;
2. `demo(container)` does not throw (`render.js:143-157`);
3. the container's screenshot has ≥2 quantised colours **and** ≥0.2% non-background pixels
   (`MIN_INK_RATIO`, `render.js:83`, `inspectPixels` at `:51-80`);
4. nothing throws asynchronously in the window after mounting (`render.js:178-182`).

Its own docstring is candid about the ceiling: *"What it does NOT catch, and no automatic
check here will, is output that is colourful and wrong — blob-shape rendered pinched vases
through every version of this gate."* Correct as far as it goes; §4 below argues the ceiling
is lower than it needs to be, because *relative* comparison answers questions absolute
inspection cannot.

Alongside it, `reducedMotion.test.js` measures rAF callbacks under
`prefers-reduced-motion: reduce` — the only existing check that renders the *same* recipe
under two conditions and compares. It is the closest thing here to a sweep.

### What a parameter map needs that the format does not have

Per parameter, all absent today:

- **range** — nothing says `cell` is useful in 2..32; only `default: 8`.
- **sweep points** — no declared values to render at.
- **effect** — no prose saying `angle` is what makes it read as print rather than pixelation.
  That knowledge exists in `halftone.js:5-8` as a file-level comment, unattached to the
  parameter and unreachable from the manifest.
- **breaking values** — `halftone.js:25` clamps `cell` to ≥2 and `:73` culls dots under
  0.25px radius. Both are real edges; neither is declared.
- **declared symmetries** — `angle: 0` and `angle: 90` produce the same image (measured
  below). Without a place to say so, a sweep cannot tell a symmetry from an inert parameter.
- **which entry point exercises it** — `props` is consumed by `preview()`, but some
  parameters only exist on the technique's own API. `halftone`'s `invert` is declared in
  `props` and never forwarded by `preview` (`halftone.js:130-137` → `make()` at `:98-114`
  calls `apply(canvas, { cell, angle })`). Measured effect through `preview`: **0.00%**.
- **evidence** — one committed screenshot per recipe, at the default. No frames across a range.
- **cost** — the README promises it; nothing in the format records it.

There is also a structural gap: `props` is declared *and* the technique's real signature is
declared separately in `snippet` prose, and the two can disagree. `halftone`'s snippet
advertises `ink`, which `props` never mentions.

---

## 2. Findings

### 2a. Verified by running it here

All numbers below are from probes I ran against this checkout: `preview()` mounted in
Chromium at 640×400, screenshotted, and diffed pixel-for-pixel in-page (the same data-URL →
canvas → `getImageData` trick `render.js` already uses). Metric: **fraction of pixels whose
maximum channel delta exceeds 12/255**.

**Noise floor — render the same props twice:**

| recipe | default context | `reducedMotion: 'reduce'` |
|---|---|---|
| `halftone` | 0.0000% | 0.0000% |
| `noise-grain` | 0.000% | — |
| `pattern-hatch` | 0.000% | — |
| `flow-field` | 0.246% | **0.000%** |
| `particle-field` | 10.749% | **12.278%** |

`flow-field` is frozen by the reduced-motion context (`flow-field.js:134` skips the rAF loop
and the primed static pass is deterministic — it seeds its own PRNG at `:25-28`).
`particle-field` is **not**: it seeds positions from unseeded `Math.random()`
(`particle-field.js:57-65`), so two mounts differ by ~12% of pixels whatever the context. Its
declared props are `count`, `linkDist`, `speed`, `dotRadius` — none of them a seed.

**`halftone` sweeps, base `{cell:8, angle:45}`, noise floor 0.0000%:**

```
cell   [2,3,4,6,8,12,16,24,32]
  adjacent-step %: 17.73 16.05 13.70 11.50 10.72 9.63 9.25 8.69
  vs-first      %: 17.73 17.89 17.20 17.23 16.94 16.88 17.09 17.29

angle  [0,15,30,45,60,75,90]
  adjacent-step %: 11.03 11.15 11.17 11.16 11.07 11.05
  vs-first      %: 11.03 11.06 10.96 11.03 11.05  0.02   <-- 0 and 90 are the same image

invert [false,true]
  adjacent-step %: 0.00
```

Four things fall directly out of that table:

1. **`invert` is a declared parameter that does nothing** — 0.00% against a 0.0000% floor.
   The negative control Phase 1 needs already exists in the corpus; no fixture required.
2. **Endpoint comparison is unsound.** `angle` 0 vs 90 is 0.02%. A sweep that compared range
   ends would report `angle` inert while every adjacent step moves 11% of pixels. The square
   lattice is 90°-symmetric (`halftone.js:49-53`), which is a fact about the technique and
   must be *declarable*, not discovered as a failure.
3. **The changed-pixel fraction saturates.** `cell` vs-first sits flat at ~17% while adjacent
   steps decay 17.73 → 8.69. It answers "did this change", not "by how much". Magnitude and
   ordering need a different statistic (§4).
4. **A useful range is measurable, not guessed.** `cell` moves the image by ≥8.7% at every
   step across 2..32, so the whole declared range earns its place.

**Cross-repo:** `recipes/web/manifest.json` is consumed by exactly two things in the sibling.
`design-guide/engine/checks/recipeReinvention.js:70-78` reads `signature.within` and
`signature.requires`; `design-guide/engine/export/skillIndex.js:134-142` reads `id`,
`primitive`, `label`, `source`. Nothing reads `props`.

**Also verified:** `creative-library/skill/references/recipe-library-web.md` and
`recipe-library-qt.md` are **byte-identical** to `design-guide/skill/references/` copies, and
the generator lives only in `design-guide` (`engine/export/skillIndex.js`). This repo has no
writer for its own copies and no guard test over them.

### 2b. Sources worth intake

Named for what they add that this shelf lacks, with their reuse terms — which matter, because
this library's whole model is *copy and adapt*.

| source | why | terms |
|---|---|---|
| [iquilezles.org/articles](https://iquilezles.org/articles/) | The reference for SDFs, smooth-minimum, domain warping, fBm, Voronoi, domain repetition, band-limited procedural patterns. The shelf has zero SDF entries. Actively extended — several articles carry "(new)". | Site states technical code snippets are MIT; the shader *art* requires a licence. Snippets are intakeable, whole shaders are not. |
| [thebookofshaders.com](https://thebookofshaders.com/) | Structured curriculum: shaping functions, noise, cellular noise, fBm, convolution, and — most relevant — the Simulation chapters on **ping-pong buffers**, Game of Life, ripples, reaction-diffusion. Feedback is on the README's list and absent from the shelf. | Text is "Copyright (c) Patricio Gonzalez Vivo, 2015 - All rights reserved". Treat as a **method reference to learn from and re-implement**, not a source to copy. |
| [surma.dev/things/ditherpunk](https://surma.dev/things/ditherpunk/) | The reference treatment of monochrome dithering — quantisation error, Floyd–Steinberg, ordered/Bayer, blue noise. `image-dither` declares only `levels` and `mono`; this is where the missing parameters come from. | Not verified. Check before intake. |
| [tylerxhobbs.com/words/flow-fields](https://www.tylerxhobbs.com/words/flow-fields) | A practitioner's essay explicitly about *variations* on flow fields and what makes them look good — i.e. it is already parameter-map-shaped. `flow-field.js` exposes 4 props; this essay is the source for which of them carry the look. | Not verified. Check before intake. |
| [ronja-tutorials.com](https://www.ronja-tutorials.com/post/034-2d-sdf-basics/) | 2D SDF basics, worked step by step. Complements iq, which assumes fluency. | Not verified. |
| [generativeartistry.com/tutorials](https://generativeartistry.com/tutorials/) | Nine complete generative-pattern constructions (Tiled Lines, Joy Division, Cubic Disarray, Circle Packing, Un Deux Trois, Hypnotic Squares, Piet Mondrian). Directly the "reach beyond product UI" the README asks for; each is a one-file canvas recipe. | No licence stated on the tutorials page; a source repo exists. Check before intake. |
| [Shadertoy](https://www.shadertoy.com/terms) | Enormous breadth. **Its default licence is CC BY-NC-SA 3.0** — non-commercial and share-alike. Usable as a *sighting* of a technique; unusable as a source to copy into a library whose promise is unrestricted copy-adapt, unless the individual shader states otherwise. | Verified via the site terms and third-party summaries. |

Blunt consequence for the README's intake question: the highest-volume sources are the most
restricted. Intake policy has to be per-source and recorded per-recipe, or this library
launders licences.

### 2c. How other libraries document parameters and ranges

- **Storybook `argTypes`** —
  [storybook.js.org/docs/api/arg-types](https://storybook.js.org/docs/api/arg-types),
  [Controls](https://storybook.js.org/docs/essentials/controls). The closest existing
  precedent to `props` here: `{ control: { type: 'range', min, max, step } }`. Confirms
  min/max/step is the minimum viable shape. Its known weakness is instructive —
  [issue #32454](https://github.com/storybookjs/storybook/issues/32454): min/max are UI hints
  and are **not enforced**, so a documented range is never verified against behaviour. That
  is precisely the gap an evidence sweep closes.
- **W&B sweep configs** —
  [docs.wandb.ai/models/sweeps/define-sweep-configuration](https://docs.wandb.ai/models/sweeps/define-sweep-configuration).
  A parameter is `values: [...]` **or** a distribution with `min`/`max`/`distribution`
  (`uniform`, `log_uniform_values`, `int_uniform`). Worth copying: the explicit
  values-vs-distribution split, and log spacing — `cell` at [2,4,8,16,32] is far more
  informative than [2,10,18,26,34].
- **Morris elementary-effects screening** —
  [en.wikipedia.org/wiki/Elementary_effects_method](https://en.wikipedia.org/wiki/Elementary_effects_method),
  [gsa-module docs](https://gsa-module.readthedocs.io/en/stable/implementation/morris_screening_method.html).
  The established name for exactly this problem: one-at-a-time perturbation over a range,
  used to *screen out non-influential parameters*. Statistic is the mean and standard
  deviation of the per-step effect; non-influential parameters cluster at the origin. This is
  the right vocabulary and the right two-number summary for a sweep report.

### 2d. Automated visual-difference measurement

- **pixelmatch** — [github.com/mapbox/pixelmatch](https://github.com/mapbox/pixelmatch).
  ISC, no dependencies, works on raw typed arrays in Node *and* the browser. YIQ perceptual
  colour distance plus anti-aliased-pixel detection (`includeAA`, `threshold` default 0.1).
  ~28ms on a 1440×900 frame. This is also what Playwright's own `toHaveScreenshot` uses —
  [playwright.dev/docs/test-snapshots](https://playwright.dev/docs/test-snapshots) — so the
  metric would match the visual-regression tooling the rest of Rex's work already uses.
- **odiff** — [github.com/dmtrKovalenko/odiff](https://github.com/dmtrKovalenko/odiff). Same
  YIQ + AA algorithm, SIMD, ~6× faster. A drop-in if sweep runtime becomes the constraint.
  Native binary, so a heavier install than this repo currently carries.
- **SSIM** — structural rather than per-pixel; better matched to human judgement, ~3× the
  cost of pixelmatch. Comparative accuracy against human raters, from Cloudinary's write-up
  ([blog](https://cloudinary.com/blog/detecting_the_psychovisual_impact_of_compression_related_artifacts_using_ssimulacra)):
  Butteraugli 80%, DSSIM 82%, SSIMULACRA 87%. Relevant here only for the *magnitude* question
  in §4, not the did-it-change question.
- **Perceptual hash / CLIP embeddings** — pHash is a layout fingerprint; CLIP cosine distance
  is semantic. Both are wrong tools for this job: a parameter change *should* alter layout,
  and semantic similarity would call every halftone the same image.

**Inferred, not verified:** that pixelmatch's AA detection is worth its cost on this corpus.
The in-page diff I ran needs no dependency at all and already separated signal (8.7–17.9%)
from a zero floor by three orders of magnitude on `halftone`. AA suppression matters when the
floor is small-but-nonzero, which on this shelf so far means only `flow-field` unfrozen
(0.246%). Phase 2 decides this with data.

---

## 3. Proposed format — worked on `recipes/web/halftone.js`

**Extend `props` in place. Do not add a parallel `params` block.** Two structures naming the
same parameters is the drift this repo built a manifest generator to prevent. `type` and
`default` keep their present meaning and shape, so anything reading them today is unaffected.

```js
// recipes/web/halftone.js — inside UI.define({ ... })
props: {
  cell: {
    type: 'number',
    default: 8,
    unit: 'px',
    // --- parameter map ---
    controls: 'Dot pitch. Sets how coarse the screen reads — the single knob between "a printed image" and "a pattern of circles".',
    range: [2, 32],
    sweep: [2, 3, 4, 6, 8, 12, 16, 24, 32],   // log-ish, per W&B; explicit values beat a step
    breaks: {
      below: 'Clamped to 2 at halftone.js:25. Under ~2 the radius falls below the 0.25px cull at :73 and cells drop out entirely rather than getting smaller.',
      above: 'Past ~32 on a 220x150 source there are too few cells to carry the image.',
    },
    cost: 'none — the per-cell average reads every source pixel exactly once at any cell size',
  },
  angle: {
    type: 'number',
    default: 45,
    unit: 'deg',
    controls: 'Screen angle. At 0 the lattice is axis-aligned and reads as pixelation; rotating it is the entire difference between print and mosaic.',
    range: [0, 90],
    sweep: [0, 15, 30, 45, 60, 75],
    // Declared symmetry: the lattice is square, so these values are expected to render
    // identically. The sweep ASSERTS this, so a wrong claim fails too.
    identical: [[0, 90]],
    cost: 'none',
  },
  invert: {
    type: 'boolean',
    default: false,
    controls: 'Swaps ink for paper — dot radius tracks lightness instead of darkness.',
    sweep: [false, true],
    // Not currently reachable: preview() drops it (halftone.js:130-137 -> make() at :98-114).
    // Declared anyway. The sweep must fail this until preview forwards it or the claim is dropped.
    cost: 'none',
  },
},
```

Every field is either a **claim the sweep can falsify** (`range`, `sweep`, `identical`) or
**prose for a reader** (`controls`, `breaks`, `cost`). No field is decorative and none is
optional-but-meaningless: a parameter with no `sweep` is reported as unswept, not skipped
silently — the same rule the rest of this engine follows for absent evidence.

The evidence is **generated, never authored**. `npm run sweep` writes:

```
recipes/web/sweeps/halftone.json          # measured deltas, noise floor, verdicts
recipes/web/sweeps/halftone/cell-2.png … cell-32.png
recipes/web/sweeps/halftone/angle-0.png  … angle-75.png
```

and `recipes/web/sweeps/halftone.json` looks like:

```json
{
  "id": "halftone",
  "generatedBy": "recipes sweep",
  "context": { "viewport": [640, 400], "reducedMotion": "reduce", "repeats": 3 },
  "noiseFloor": 0.0,
  "params": {
    "cell":   { "verdict": "effective", "steps": [0.1773, 0.1605, 0.1370, 0.1150, 0.1072, 0.0963, 0.0925, 0.0869],
                "meanEffect": 0.1216, "minStep": 0.0869, "frames": ["cell-2.png", "..."] },
    "angle":  { "verdict": "effective", "steps": [0.1103, 0.1115, 0.1117, 0.1116, 0.1107],
                "meanEffect": 0.1112, "minStep": 0.1103, "identicalHolds": [[0, 90, 0.0002]] },
    "invert": { "verdict": "inert", "steps": [0.0], "meanEffect": 0.0,
                "reason": "every adjacent step is at or below the noise floor (0.0000)" }
  }
}
```

`meanEffect` and the step spread are the Morris two-number summary. The manifest gains the
authored half only — `registry.js:58-79` maps `props` through unchanged, so the extra keys
ride along for free. `recipes/web/sweeps/*.json` stays **out** of the manifest: derived data
with one writer, and it is per-machine-verifiable rather than declarative.

---

## 4. What "verified" means for a parameter map

The README's open question. Answer, in the form of what the gate must prove:

**A parameter map is verified when, for every declared parameter, a run of the sweep on this
machine produced a verdict from measured pixels — and at least one parameter somewhere in the
run came back inert.** Concretely, five conditions:

1. **The recipe has a measured noise floor.** Render the same props 3× and diff pairwise.
   This is the first thing, not an afterthought, because every other number is meaningless
   without it. Measured: `halftone` 0.0000%, `flow-field` 0.000% frozen, `particle-field`
   12.278% frozen. A floor is a property of the recipe, never a constant in the harness.
2. **A recipe whose floor exceeds the smallest claimed effect is `unsweepable`, reported with
   the reason.** It is not a pass and not a failure of the parameter map — it is a missing
   seed. `particle-field` is the standing example. This follows the engine's existing rule
   that absent evidence is never a pass (`engine/types.js:20-23`, `render.js:16-18`).
3. **Effects are measured between adjacent sweep values, never between range ends.** The
   `angle` 0-vs-90 result (0.02% against 11% per step) is the proof. Endpoint comparison would
   have marked the parameter that carries the entire technique as doing nothing.
4. **A parameter is `effective` when every adjacent step exceeds `max(4 × floor, 1% of
   pixels)`.** The 4× and 1% are provisional — set from `halftone`, `flow-field`,
   `noise-grain` and `pattern-hatch`, calibrated across the shelf in Phase 2. A parameter that
   fails on some steps and not others is `partial`, reported with which segment is flat: that
   is a *finding about the useful range*, which is what the map is for.
5. **Declared `identical` pairs must actually be identical** (≤ floor). A symmetry claim is a
   claim, and a wrong one fails the same way an inert parameter does. This is what keeps
   condition 3 from being an escape hatch.

**What "verified" does not mean, stated plainly so nobody claims it later:** it does not mean
the parameter does what `controls` says in prose. The sweep proves a parameter *changes the
output* and *over which values*; it cannot prove `angle` is what makes it read as print. That
sentence is reviewed by eye against the committed sweep frames, exactly as `render.js:44-47`
already says of blob-shape's pinched vases. The frames exist so that review is possible — the
current single default screenshot makes it impossible.

**The measurement, and why it is enough:** fraction of pixels whose max channel delta exceeds
12/255, computed in-page from screenshot buffers. No new dependency; the technique is already
in `inspectPixels` (`render.js:51-80`). It separates signal from floor by three orders of
magnitude on every recipe I probed. Its one known defect is **saturation** — `cell`'s
vs-first stays flat at ~17% while adjacent steps decay 17.73 → 8.69, so it ranks nothing.
That is acceptable for did-it-change and unacceptable for how-much. If magnitude claims are
ever wanted, that needs SSIM or a per-frame summary statistic (dot count, mean ink), and it is
a separate decision — do not let a saturating metric quietly become a magnitude claim.

---

## 5. Phases

Each verify is written so it can fail, and says what failure looks like.

### Phase 0 — noise floor harness, no format change

**Done 2026-10-07.** `engine/recipes/sweep.js`, `npm run sweep [-- --floor | --check] [ids]`.
Predictions held: halftone floor 0, particle-field 21.5% (≥5% predicted), flow-field frozen at 0.
One harness bug found on the way: an `inline-block` stage collapsed previews that size to their
container; the stage is a block now, as in render.js.

Add `engine/recipes/sweep.js`: mount `preview()` under a chosen context, screenshot, diff
in-page. Add `recipes sweep` to `engine/cli.js`. No recipe edited.

**Verify:** `sweep --floor` over all 41 web recipes prints a floor per recipe, and
`./node_modules/.bin/vitest run` still reports 106 tests / 12 files with no existing test
modified. *Fails if:* the floor for `halftone` is not 0, or for `particle-field` is not
≥5% — both predicted here from measurement, so a disagreeing run means the harness is
measuring something other than what I measured.

### Phase 1 — the format on three recipes, with the negative control

**Done 2026-10-07.** Maps on halftone, pattern-hatch, flow-field. The sweep reported
`halftone.invert` inert and exited 1, as predicted (preview() dropped it); forwarding it
flipped it to effective (47% of pixels). Tests assert the three verdicts by name, a
dropped-prop negative control, and a wrong symmetry claim (0 vs 45) failing.

Apply §3 to `halftone`, `pattern-hatch`, `flow-field`. Nothing else touched. Regenerate the
manifest. Commit the sweep JSON and frames.

**Verify — this is the phase's whole point, and it must produce a failure:**

1. `recipes sweep halftone` reports `cell` **effective** (min adjacent step ≥8%), `angle`
   **effective** (steps ≈11%), and `invert` **inert** (0.00%), and **exits non-zero because
   of `invert`**.
2. The declared `identical: [[0, 90]]` for `angle` holds at ≤ the floor.
3. A test asserts all three verdicts by name.

*Fails if:* `invert` comes back effective (the harness is reading the wrong buffer, or the
diff is comparing an image to itself — the failure mode the reduced-motion test was written
to catch: "a needle built out of the haystack"). *Also fails if:* nothing in the run is inert,
which would mean the negative control is not wired in.

Then, one fix, one run — either forward `invert` through `preview()` and watch the verdict
flip to effective, or delete the claim. Both are legitimate; the sweep going from red to green
for a stated reason is the evidence either way.

### Phase 2 — floor audit and threshold calibration across the shelf

**Done 2026-10-07.** Five recipes were unsweepable, every one from unseeded `Math.random()`:
click-to-split 32%, particle-field 21.5%, three-points 20%, proximity-dots 10.9%, absorb-drops
1.7%. Rather than only proposing a seed, each now takes a `seed` prop (mulberry32), and all 41
floors are exactly 0 (`recipes/web/sweeps/floors.json`). With a deterministic shelf the
provisional thresholds were too coarse: real, small effects (a star rating's fill, an icon's
glyph, a sparkline's end dot) moved 0.1-1% of the stage, and grain changes pixels by only
3-11/255. Calibrated: a pixel counts as changed above 4/255, a step is an effect above
max(4 x floor, 0.05%). Dropped and motion-only props still read exactly 0.0, so the gap stays
clean. A symmetry holds when the pair differs by under a tenth of the parameter's mean step:
rotated lattices differ by edge antialiasing at the finer cut (halftone 0.08%, pattern-hatch
1.9% against ~28% steps). The Phase 1 verdicts were unchanged by the recalibration.

Run the floor probe on all 41. Publish the distribution. Set the `effective` thresholds from
it. Recipes above the floor get `unsweepable` with a named reason and a proposed seed prop.

**Verify:** the report names every unsweepable recipe. `particle-field` must be on that list —
predicted here at 12.278%. *Fails if:* it is absent (the harness froze something it should
not have), or if the list is empty (a floor probe that finds no noise anywhere is a probe that
is not running). Second check: with thresholds set, re-run Phase 1's three recipes and get the
same three verdicts — a threshold that flips a known-good verdict is mis-calibrated.

### Phase 3 — roll across the shelf

**Done 2026-10-07.** All 41 web recipes mapped (153 props): `controls`, `range`, `sweep`,
`breaks`, `cost` as §3, plus two additions: `unswept: reason` for props a still frame cannot show
(motion, pointer, interaction: 21 props, each named), and `sweepWith` to sweep one prop around
another base when its effect only shows there (three-points' sizeAttenuation needs points above
the 1px minimum; noise-grain's numOctaves needs coarse grain). Result: 132 effective, 5 partial
(each recorded in `breaks` as a finding about the useful range), 21 unswept, 0 inert. A probe
pass (`engine/recipes/probe.mjs`) swept every prop with generic values first; it found
canvas-chart ignoring `data` and liquid-glass's `blur` invisible on a smooth backdrop (both
previews fixed), and that noise-grain's numOctaves only matters up to 2. `sweep --check` is the
gate, run in the suite; editing one `sweep` array without re-sweeping fails it (tested).

Parameter maps for the remaining recipes, in batches, each batch swept before the next starts.
Add `sweep --check` as a gate: every declared prop must have a `sweep`, and every recipe with
a parameter map must have current committed sweep evidence.

**Verify:** `sweep --check` exits non-zero on a recipe whose props changed without re-running
the sweep. Prove it by editing one `sweep` array and re-running without regenerating.
*Fails if:* it exits zero — a staleness check that cannot detect staleness. Second: the full
suite still passes, and `npm run sync` reports no unexpected manifest change.

### Phase 4 — intent index

**Done 2026-10-07.** `recipes/web/intents.json` (what each recipe is for), `engine/recipes/rank.js`
(stemming, compounds, negation, weights intent 3 / label 2 / description 1; shared with Ultimate
Design's studio), `engine/recipes/intent-cases.json` (18 hand-named asks, written first).
Result: 17 of 18 in the top 3, nonsense returns empty; the miss, "a retro broken screen", was
a ranker gap (no synonyms). Closed the same day with synonym groups in rank.js, checked against
four new asks written before the table (three of them missed before it; one more miss exposed
that two-letter words like "tv" were dropped from the index): 22 of 22. It went ahead of phases 1-3, so it ranks on purpose
phrases, not yet on `controls` prose.

`engine/recipes/techniques.js:111-125` already ranks by word overlap against label,
description, primitive and id. `controls` prose gives it far more surface. Add a small file of
intent phrases with hand-named expected recipes.

**Verify:** each README intent ("make this feel hand-made", "add depth without 3D", "break up
a flat field") returns its hand-named recipe in the top 3, and a nonsense intent returns
empty. *Fails if:* the top-3 misses — which is the useful outcome, because it names what the
shelf does not cover. Do not fix a miss by editing the expectation.

### Phase 5 — intake beyond product UI

Harvest against §2b, prioritising the gaps: SDF (zero entries), feedback/ping-pong (zero),
reaction-diffusion (zero), ordered/blue-noise dithering (`image-dither` has `levels` and
`mono` only), generative pattern from generativeartistry. Add a `provenance: { source, url,
terms }` field, required for anything harvested.

**Verify:** each new recipe passes `render` *and* comes with a sweep in which at least one
declared parameter is effective. *Fails if:* a recipe renders but every parameter is inert —
that is a screenshot, not a technique, and it does not belong on this shelf. Second: no recipe
carries `provenance.terms` naming a non-commercial or share-alike licence, given this library
is copied into other people's projects.

---

## 6. Effect on the sibling `design-guide`

**None, if the format stays additive — and §3 is additive.**

Two consumers, both read through `design-guide/engine/corpus.js` (`CORPUS_ROOT`, sibling
directory, `CREATIVE_LIBRARY` override):

| consumer | fields read | affected by §3? |
|---|---|---|
| `engine/checks/recipeReinvention.js:70-78` | `components[].signature.{within,requires}` | no — untouched |
| `engine/export/skillIndex.js:134-142` (`shelfContent`) | `id`, `primitive`, `label`, `source` | no — untouched |

Neither reads `props`. New keys inside `props` entries are invisible to both. A missing
sibling already degrades to not-applicable (`recipeReinvention.js:66-68`), so nothing newly
breaks.

**What *would* break it, and is worth knowing before Phase 5:**
`design-guide/engine/export/skillIndex.test.js:214-227` regenerates the shelf shards from
`CORPUS_ROOT` and asserts they byte-match the committed
`design-guide/skill/references/recipe-library-{web,qt}.md`. So **adding a recipe here, or
changing any `id`/`primitive`/`label`/`source`, fails design-guide's suite** until it
regenerates and recommits. Phases 0–4 change none of those. Phase 5 changes all of them, and
the two repos have to move together for that phase. I did not run design-guide's suite —
this is read from its source.

**Two loose ends found while tracing the seam,** reported not fixed:

- `skill/references/recipe-library-{web,qt}.md` in *this* repo are byte-identical copies of
  design-guide's generated shards, and the generator lives only there. Nothing here writes or
  guards them, so they drift the moment Phase 5 adds a recipe. Two hand-maintained copies of a
  component index is the exact failure `engine/recipes/manifest.js:4-8` documents ui-master
  dying of. *Resolved 2026-10-06:* `npm run sync` now writes both shelves
  (`engine/recipes/shelf.js`), and `shelf.test.js` fails when they fall behind a manifest.
- `knowledge/recipes/prefer-existing-recipe.md` — the entry that drives
  `recipeReinvention` — now lives only here, while the check and its tests live in
  design-guide, which has no `knowledge/recipes/` directory. Inferred from file layout; I did
  not run design-guide's entry loader to confirm the check is unbound. *Resolved
  2026-10-06:* the entry now lives at `design-guide/knowledge/recipes/` and was removed here.

---

## 7. The README's other two open questions

**"Intake: harvested, or authored deliberately?"** — the licensing survey (§2b) forces a
partial answer regardless of taste: the two highest-volume sources are the two most
restricted (Shadertoy defaults to CC BY-NC-SA; Book of Shaders text is all-rights-reserved).
For those, intake means *read the method, re-implement, cite* — which is authoring, with the
reference as a source of truth rather than a source of code. `harvest` stays the right tool
for MIT-snippet sources (iq) and for permissively-licensed tutorial code. Recording
`provenance.terms` per recipe is what makes the distinction auditable instead of remembered.

**"Does `canvas-builder` overlap here?"** — unanswered. A real `canvas-builder` checkout does
sit beside this one at `project ideas/canvas-builder` (its own git repo, with `src/`, `app/`,
`scripts/`, `test/` and a `CLAUDE.md`), but it was outside the read scope of this pass, so I
did not open it. Nothing in *this* repo or in design-guide references it. Answering this needs
one deliberate read of that repo's README against §3's format — specifically whether it emits
documents or renders parameterised constructions, because only the second overlaps.

---

## Sources

- [iquilezles.org/articles](https://iquilezles.org/articles/)
- [thebookofshaders.com](https://thebookofshaders.com/)
- [surma.dev/things/ditherpunk](https://surma.dev/things/ditherpunk/)
- [tylerxhobbs.com/words/flow-fields](https://www.tylerxhobbs.com/words/flow-fields)
- [ronja-tutorials.com — 2D SDF basics](https://www.ronja-tutorials.com/post/034-2d-sdf-basics/)
- [generativeartistry.com/tutorials](https://generativeartistry.com/tutorials/)
- [Shadertoy terms](https://www.shadertoy.com/terms)
- [Storybook ArgTypes](https://storybook.js.org/docs/api/arg-types) · [Controls](https://storybook.js.org/docs/essentials/controls) · [issue #32454 — min/max not enforced](https://github.com/storybookjs/storybook/issues/32454)
- [W&B sweep configuration](https://docs.wandb.ai/models/sweeps/define-sweep-configuration)
- [Elementary effects method](https://en.wikipedia.org/wiki/Elementary_effects_method) · [gsa-module: Morris screening](https://gsa-module.readthedocs.io/en/stable/implementation/morris_screening_method.html)
- [pixelmatch](https://github.com/mapbox/pixelmatch) · [odiff](https://github.com/dmtrKovalenko/odiff) · [Playwright visual comparisons](https://playwright.dev/docs/test-snapshots)
- [Cloudinary: SSIMULACRA vs DSSIM vs Butteraugli agreement with human raters](https://cloudinary.com/blog/detecting_the_psychovisual_impact_of_compression_related_artifacts_using_ssimulacra)
