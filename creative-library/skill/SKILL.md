---
name: creative-library
description: Load before any edit to UI code, however small, in addition to design-guide (it does not replace this one) — UI code is .html, .css, .scss, .jsx, .tsx, .vue, .svelte and .qml files, JS/TS that draws DOM or canvas, and Python that builds PyQt or PySide widgets (QWidget, QPainter, paintEvent, stylesheets). Holds the verified techniques to copy and adapt instead of hand-rolling: texture, depth, motion, grain, noise, distortion, generative pattern, shader displacement, dithering, halftone, glitch, flow field, charts, sprites, Wada colour palettes, each with the parameters that actually control it. Also on "make this feel hand-made", "add depth without 3D", "break up a flat field", or a design that looks flat, generic or machine-averaged.
---

# creative-library

Verified visual-code techniques. Every entry runs, every entry has a screenshot proving
it paints something, and every entry is copied and adapted rather than installed.

The library is the `creative-library/` folder of your ultimate-design clone
(`~/Documents/Github/ultimate-design/creative-library/` unless you cloned it elsewhere). Every path below is
relative to that folder, wherever your session runs (the shelves are under `skill/`), and its
commands run there.

## Shelves

- `skill/references/recipe-library-web.md` — the web shelf, one line per technique
- `skill/references/recipe-library-qt.md` — the PyQt6 shelf
- `skill/references/recipes.md` — how to read an entry, and what "verified" means here
- `recipes/web/intents.json` — what each web technique is for, in design words; search it by the ask
- `palettes/wada/combinations.md` — Sanzo Wada's 348 colour combinations, one line each with
  computed tags and the best text pair; `palettes/wada/README.md` for his method

## Using one

Read the shelf, pick by primitive and label, then open `recipes/<shelf>/<id>.js` (or
`.py`). Each web prop carries a parameter map (`controls`: what the knob does, `range`, `breaks`),
and `recipes/web/sweeps/<id>/<prop>.png` shows it swept. Copy the construction into the target project and adapt it. Do not add this
repo as a dependency — nothing here is versioned for that, and a recipe that cannot
be edited in place is not a recipe.

## Adding one

```
npm run harvest -- <url> --id <kebab-id> [--selector <css>]   # scaffold from a page
npm run sync                                                   # regenerate manifests
npm run render                                                 # screenshot every demo, fail on blank
```

A scaffold is not yet a recipe. Reduce the captured markup to the construction itself
and make `demo()` paint, or `render` will fail it — which is the point.

## What is not here

The accessibility floor, the stance on contested UI calls, the gate, and the audit.
Those are the `design-guide` repo, which reads this corpus's manifests to
notice when a page has rebuilt something that already exists.
