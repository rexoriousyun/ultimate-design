/**
 * Renders every tier-2 recipe's own `demo(container)` in Chromium and writes a screenshot.
 *
 * PLAN.md phase 5.4's verify is that a harvested recipe "renders in CI and its screenshot is
 * committed". This is the rendering half, and it is the part that makes tier 2 mean
 * anything: a recipe is a promise that this code works, and the only way to keep that
 * promise honest is to run it. A recipe whose `demo()` throws, or which paints nothing at
 * all, fails here rather than failing in someone's project after they copied it.
 *
 * A blank render counts as a failure. The common way a copied construction rots is not an
 * exception — it is quietly painting nothing (a filter referencing a missing id, a canvas
 * never sized), which a try/catch would wave straight through. So the screenshot is
 * inspected for whether anything was actually drawn.
 *
 * Recipes that declare `requires` are skipped when the dependency is absent, and reported
 * as skipped rather than passed — the same rule the rest of the engine follows for absent
 * evidence. `three-scene` needs a CDN-hosted THREE global, so it skips offline instead of
 * failing a run for a reason that has nothing to do with the recipe.
 */

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

import { recipeFiles } from './manifest.js';
import { threeBuildPath, THREE_VERSION } from './three.js';

const VIEWPORT = { width: 640, height: 400 };

// The one external dependency any recipe declares. Read off disk from the pinned
// devDependency, not fetched — see engine/recipes/three.js.

/**
 * Inspects the rendered pixels of `png` and reports whether anything was actually drawn.
 *
 * The previous implementation claimed in its own docstring to count distinct pixel colours
 * and did not — it counted child elements and text. Those are not the same test: a demo that
 * appends an empty <svg>, or a canvas it never draws into, has children and paints nothing,
 * which is exactly how a copied construction rots. So this decodes the screenshot for real,
 * with no new dependency: the buffer goes back into the page as a data URL, through a canvas,
 * and out as ImageData.
 *
 * What it catches: blank and near-blank output. What it does NOT catch, and no automatic
 * check here will, is output that is colourful and *wrong* — blob-shape rendered pinched
 * vases through every version of this gate. The committed screenshot is the artifact for
 * that, and looking at it is a review step, not a test.
 *
 * Colours are quantised to 5 bits per channel so antialiasing on a single-colour shape does
 * not register as variety.
 */
async function inspectPixels(page, png) {
  return page.evaluate(async (dataUrl) => {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('screenshot failed to decode'));
      img.src = dataUrl;
    });
    if (img.width < 2 || img.height < 2) return { colors: 0, inkRatio: 0 };

    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

    const counts = new Map();
    for (let i = 0; i < data.length; i += 4) {
      const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    // "Ink" is everything that is not the dominant colour — usually the background. A demo
    // that painted nothing is one flat colour, so its ink ratio is zero.
    let dominant = 0;
    for (const n of counts.values()) if (n > dominant) dominant = n;
    const pixels = data.length / 4;
    return { colors: counts.size, inkRatio: (pixels - dominant) / pixels };
  }, `data:image/png;base64,${png.toString('base64')}`);
}

/** Below this fraction of non-background pixels, a render is blank in every way that matters. */
const MIN_INK_RATIO = 0.002;

/**
 * @param {string} recipesDir
 * @param {{outDir?: string}} [opts]
 * @returns {Promise<Array<{id: string, status: 'rendered'|'skipped'|'failed', reason?: string, screenshot?: string}>>}
 */
export async function renderRecipes(recipesDir, opts = {}) {
  const outDir = opts.outDir ?? path.join(recipesDir, 'screenshots');
  fs.mkdirSync(outDir, { recursive: true });

  const files = recipeFiles(recipesDir);
  const browser = await chromium.launch();
  const results = [];

  try {
    const page = await browser.newPage({ viewport: VIEWPORT });
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.setContent(
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>recipe render</title>' +
        '<style>body{margin:0;font-family:system-ui,sans-serif;color:#1a1a1a;background:#fff}' +
        '#stage{padding:16px}</style></head><body><div id="stage"></div></body></html>',
    );
    // Satisfy the one declared external dependency before deciding anything is unrenderable.
    // Every three.js recipe used to skip unconditionally, which was fine at one recipe and is
    // not fine as a shelf grows: a skipped recipe is an unverified promise, and "it renders"
    // is the only thing tier 2 actually guarantees. Loaded from the pinned devDependency, so
    // this no longer depends on the network being up.
    const threePath = threeBuildPath();
    if (threePath) await page.addScriptTag({ path: threePath });

    for (const file of files) {
      await page.addScriptTag({ content: fs.readFileSync(path.join(recipesDir, file), 'utf8') });
    }

    const ids = await page.evaluate(() => window.UI.all().map((c) => c.id));

    for (const id of ids) {
      const requires = await page.evaluate((cid) => window.UI.get(cid).requires ?? [], id);
      // A declared dependency this environment cannot supply is a skip with a reason, never
      // a silent pass and never a failure blamed on the recipe.
      //
      // This used to read `requires.some(() => typeof window.THREE === 'undefined')` — the
      // predicate ignored its argument, so ANY declared requirement was treated as a
      // requirement for THREE. It only looked correct while THREE was the sole external
      // dependency on the shelf. Recipe-to-recipe dependencies are `dependsOn` and are
      // satisfied by the harness loading every file, so they never reach this check.
      const missing = await page.evaluate(
        (cid) => (window.UI.get(cid).requires ?? []).some((r) => /\bTHREE\b/.test(r))
          && typeof window.THREE === 'undefined',
        id,
      );
      if (requires.length > 0 && missing) {
        results.push({ id, status: 'skipped', reason: `unmet dependency: ${requires.join(', ')}` });
        continue;
      }

      const before = pageErrors.length;
      const mounted = await page.evaluate((cid) => {
        const stage = document.getElementById('stage');
        stage.innerHTML = '';
        try {
          window.UI.get(cid).demo(stage);
          return { ok: true };
        } catch (err) {
          return { ok: false, message: err.message };
        }
      }, id);

      if (!mounted.ok) {
        results.push({ id, status: 'failed', reason: `demo() threw: ${mounted.message}` });
        continue;
      }

      // Screenshot once and inspect that same buffer, so the pixels that are judged are
      // exactly the pixels that get committed.
      const stage = await page.$('#stage');
      const png = await stage.screenshot();
      const pixels = await inspectPixels(page, png);
      if (pixels.colors < 2 || pixels.inkRatio < MIN_INK_RATIO) {
        results.push({
          id,
          status: 'failed',
          reason:
            'demo() ran but painted nothing into the container ' +
            `(${pixels.colors} distinct colour(s), ${(pixels.inkRatio * 100).toFixed(3)}% non-background pixels)`,
        });
        continue;
      }

      const file = path.join(outDir, `${id}.png`);
      fs.writeFileSync(file, png);

      const async = pageErrors.slice(before);
      results.push({
        id,
        status: async.length > 0 ? 'failed' : 'rendered',
        reason: async.length > 0 ? `threw after mounting: ${async.join('; ')}` : undefined,
        screenshot: path.relative(path.dirname(path.dirname(recipesDir)), file),
      });
    }
  } finally {
    await browser.close();
  }

  return results;
}
