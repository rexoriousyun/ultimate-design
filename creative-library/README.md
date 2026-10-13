# creative-library

A library of visual-code techniques — the methods, not only the snippets. What a
technique is, why it reads the way it does, what happens when you vary it, and
working code that produces it.

## The problem

Creative coding techniques — flow fields, dithering, feedback buffers, signed
distance fields, shader displacement, halftone, glitch, procedural pattern — are
rare in training data relative to CRUD code. A model either does not know a
technique exists, knows the name but hallucinates the API, or reproduces one
canonical variant without understanding which parameter carries the effect.

The result is that AI-built visuals cluster on a handful of remembered demos. Not
because the space is small, but because the reachable space is.

A snippet alone does not fix this. Copied code produces the one output it was
captured at. What makes a technique usable is knowing which knob does the work,
which values break it, and what it costs to run.

## What this is

Per technique:

- **Method** — what it is, the mechanism in plain terms, what visual property it
  actually controls.
- **Working code** — runnable, dependency-light, adapted rather than installed.
- **Parameter map** — which inputs matter, their useful ranges, and what each one
  does to the output.
- **Evidence** — rendered frames across that range, so both a person and an agent
  can see the effect instead of inferring it.
- **Cost** — where it runs (CPU, canvas, GPU), and roughly how expensive.

Indexed by intent as well as by name — "make this feel hand-made", "add depth
without 3D", "break up a flat field" — because that is how the need arrives. The index
is `recipes/web/intents.json`, ranked by `engine/recipes/rank.js` and tested against
hand-named asks in `engine/recipes/intent-cases.json`.

## Where this came from

This is `design-substrate`'s tier 2, lifted out whole. That repo (archived at
`projects-history/archive/design-substrate.{bundle,worktree.tgz}`, 84 commits) already
held the corpus and its toolchain; the rest of it became the sibling `design-guide`.

What came across: **38 web recipes**, **3 Qt recipes**, their screenshots and
manifests, `engine/recipes/` (8 modules — sync, render, harvest, three, techniques),
`knowledge/recipes`, and the two shelf documents. The `substrate recipes <sub>`
command became this repo's own three-verb CLI, one level shallower.

So the corpus already exists and already passes its gates — 104 tests across 11 files.
The work left is the part that motivated splitting it out: **parameter maps and
evidence sweeps per entry**, so a technique can be varied rather than only pasted, and
reach beyond product UI.

## Inside ultimate-design

Since 2026-10-06 this library lives in `ultimate-design/creative-library/` (moved with its
history by `git subtree`; the separate repo is archived in
`projects-history/archive/creative-library.*`). It is still its own Node project: run its
commands from this folder. Ultimate Design's design agent gets this folder read-only and
copies recipes from it into designs (see `docs/agent.md` there). The brand systems that
used to sit in `design-system/` are now built-in design systems of a studio workspace
(`design-systems/` in the workspace, `docs/workspace.md` there). Users browse this library in the studio (its Library view and
Techniques browser); the gallery (`index.html`, served by the studio at
`/creative-library/`) is the maintenance view and still shows them when served from the
ultimate-design root.

## The seam with design-guide

`design-guide` reads this library's manifests — never the recipe sources — so its
`recipeReinvention` check can flag a page that rebuilt a technique that already exists,
and so its exported skill index can name the shelves. It resolves this folder as
`../ultimate-design/creative-library` from its own root, overridable with
`CREATIVE_LIBRARY`. A missing library degrades to not-applicable rather than failing.
After `npm run sync` here, run `node engine/cli.js export index` there.

## Scope

In: the techniques, their parameter maps, evidence renders, intent-based indexing, and
the sync/render/harvest toolchain. Also colour: `palettes/wada/`, Sanzo Wada's 348 colour
combinations with his method (`palettes/wada/README.md`); `sync` writes its index.

Out: a component library, anything installed as a dependency, the accessibility floor,
and the build-time gate — that is `design-guide`.

## The checks

```
npm install                       # once; there is no lockfile
./node_modules/.bin/vitest run    # every test file; engine/recipes/rank.test.js holds the intent cases
npm run sync && npm run render    # regenerate manifests and skill shelves, screenshot every demo
npm run sweep -- <ids>            # sweep each mapped prop: recipes/web/sweeps/<id>.json + strips
npm run sweep -- --check          # is every recipe mapped, and its evidence current and passing
```

`skill/skill.test.js` fails when `skill/SKILL.md` names a file that is not there: sessions in
other repos follow those paths literally. It also holds the skill's description to naming UI files
(`.qml`, PyQt/PySide, `.html`, `.css`, `.jsx`, `.tsx`), so any UI edit loads it.

`engine/recipes/shelf.test.js` also compares design-guide's copies of the two shelves
(`design-guide/skill/references/recipe-library-{web,qt}.md`) with what `npm run sync` writes,
so a recipe change shows the drift here rather than only in design-guide's suite. It looks for
design-guide in `DESIGN_GUIDE_DIR`, beside ultimate-design, then `~/Documents/Github/`, and skips
when there is none.

`render` fails any recipe that runs and paints nothing, which is how a copied
construction usually rots. `sweep` fails any declared parameter that does not change the
picture, and any symmetry claim that does not hold (PLAN.md phases 0-3): every prop carries a
parameter map, and its evidence strip shows the range for review by eye.

## Open questions

- What counts as verified for a *parameter map*? Runs without error is not enough; the
  evidence sweep has to show the parameter does what the map claims.
- Intake: harvested from references Rex drops, or authored deliberately?
- Does `canvas-builder` overlap here, or is it strictly a document/emit tool?
