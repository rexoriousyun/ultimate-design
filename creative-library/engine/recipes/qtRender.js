/**
 * Runs every Qt recipe's `demo()` and commits a screenshot — the Qt half of what
 * `npm run render` already does for the web shelf.
 *
 * The gate exists because of a specific failure it would have caught. The first version of
 * `recipes/qt/icon.py`'s `pixmap()` produced a perfectly valid QPixmap containing ten lit
 * pixels at dpr=2 — no exception, no error, essentially blank artwork. Nothing in the manifest
 * pipeline noticed, because importing a module proves it imports and says nothing about
 * whether it draws. A recipe that runs and paints nothing is the normal way a copied
 * construction rots, and only looking at the output catches it.
 *
 * "Painted something" is measured against the demo's own first pixel rather than against
 * transparency: a Qt demo fills an opaque background, so an all-transparent test would pass
 * a blank white rectangle. Counting pixels that differ from the corner colour asks the real
 * question — did anything get drawn on top.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/** Runs offscreen so this works on a headless machine and in CI. */
const RENDERER = `
import importlib.util, json, os, pathlib, sys

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")


# The recipes directory goes on sys.path so a recipe can import a sibling recipe, which is how
# a Qt project actually holds them: recipes are copied, not imported across a package
# boundary, so acorn_hoard.py and pixel_sprite.py sit in the same folder. Loading purely by
# file path left siblings unimportable — caught by the render gate the moment acorn_hoard
# arrived, with "No module named 'pixel_sprite'".
recipes_dir, out_dir = sys.argv[1], sys.argv[2]
sys.path.insert(0, str(pathlib.Path(recipes_dir).resolve()))
results = []

try:
    from PyQt6.QtWidgets import QApplication
except Exception as exc:
    print(json.dumps({"unavailable": "PyQt6 is not importable: %s" % exc, "results": []}))
    raise SystemExit(0)

app = QApplication([])
pathlib.Path(out_dir).mkdir(parents=True, exist_ok=True)

for p in sorted(pathlib.Path(recipes_dir).glob("*.py")):
    if p.name.startswith("_"):
        continue
    spec = importlib.util.spec_from_file_location(p.stem, p)
    module = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(module)
    except Exception as exc:
        results.append({"id": p.stem, "status": "failed", "reason": "import failed: %s" % exc})
        continue

    recipe = getattr(module, "RECIPE", None)
    if recipe is None:
        continue
    rid = recipe.get("id", p.stem)

    demo = getattr(module, "demo", None)
    if demo is None:
        results.append({"id": rid, "status": "failed", "reason": "no demo() to render"})
        continue

    try:
        pm = demo()
    except Exception as exc:
        results.append({"id": rid, "status": "failed", "reason": "demo() raised: %s" % exc})
        continue

    if pm is None or pm.isNull() or pm.width() < 2 or pm.height() < 2:
        results.append({"id": rid, "status": "failed", "reason": "demo() returned no usable pixmap"})
        continue

    img = pm.toImage()
    corner = img.pixelColor(0, 0)
    painted = 0
    for y in range(0, img.height(), 2):
        for x in range(0, img.width(), 2):
            if img.pixelColor(x, y) != corner:
                painted += 1

    if painted == 0:
        results.append({"id": rid, "status": "failed", "reason": "demo() ran but painted nothing"})
        continue

    shot = str(pathlib.Path(out_dir) / (rid + ".png"))
    pm.save(shot)
    results.append({"id": rid, "status": "rendered", "painted": painted,
                    "screenshot": "recipes/qt/screenshots/" + rid + ".png"})

print(json.dumps({"unavailable": None, "results": results}))
`;

/**
 * @param {string} recipesDir Absolute path to recipes/qt.
 * @param {{outDir?: string}} [opts]
 * @returns {{unavailable: string|null, results: object[]}}
 */
export function renderQtRecipes(recipesDir, opts = {}) {
  if (!fs.existsSync(recipesDir)) return { unavailable: null, results: [] };
  const outDir = opts.outDir ?? path.join(recipesDir, 'screenshots');

  let raw;
  try {
    raw = execFileSync('python3', ['-c', RENDERER, recipesDir, outDir], { encoding: 'utf8' });
  } catch (err) {
    // No python3 is a legitimate environment. Reported as unavailable rather than as every
    // recipe failing, which would read as "the shelf is broken".
    return { unavailable: `python3 could not run the Qt renderer: ${err.message}`, results: [] };
  }

  return JSON.parse(raw.trim().split('\n').pop());
}
