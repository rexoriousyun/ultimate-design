/**
 * Reduced motion, for the recipes the gate cannot see.
 *
 * `reduced-motion-respected` reads CSS animation off the observed bundle. Against a canvas
 * recipe it returns **not-applicable — "subject has no animation to evaluate"**, because a
 * requestAnimationFrame loop painting into a canvas is not a CSS animation and leaves no trace
 * in computed style. That verdict is honest (absent evidence is never a pass) and it is also a
 * hole: particle-field and three-points animate continuously and the gate would say the same
 * not-applicable whether they honoured the preference or ignored it entirely.
 *
 * So this asserts the behaviour directly, by counting the rAF callbacks a recipe schedules in
 * a browser context that reports `prefers-reduced-motion: reduce`. It is a corpus guard, not a
 * unit test: it runs the committed shelf, so a recipe added later without the branch fails
 * here rather than shipping as something anybody can copy.
 *
 * The second test is the one that keeps the first honest. "No recipe animated under reduce" is
 * also what you get from a harness where nothing runs at all — the same too-clean result that
 * has been wrong repeatedly in this repo. Asserting that particle-field *does* loop without
 * the preference set is what proves the counter is wired to anything.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

import { recipeFiles, readManifest } from './manifest.js';
import { threeBuildPath, needsThree } from './three.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RECIPES_DIR = path.join(REPO_ROOT, 'recipes', 'web');

const PAGE =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>motion probe</title>' +
  '<style>body{margin:0}#stage{padding:8px;width:600px;height:300px}</style>' +
  '</head><body><div id="stage"></div></body></html>';

let browser;
beforeAll(async () => { browser = await chromium.launch(); }, 120_000);
afterAll(async () => { await browser?.close(); });

/**
 * Mounts one recipe's demo() and returns how many rAF callbacks it scheduled while running.
 * @returns {Promise<number>} callbacks in the sampling window, or -1 if the demo threw.
 */
async function rafCount(id, reducedMotion) {
  const context = await browser.newContext({ viewport: { width: 640, height: 400 }, reducedMotion });
  const page = await context.newPage();
  try {
    await page.setContent(PAGE);
    const threePath = threeBuildPath();
    if (threePath) await page.addScriptTag({ path: threePath });
    // Wrap before any recipe is loaded. Recipes only schedule frames from demo(), so a plain
    // evaluate is enough here — no addInitScript needed.
    await page.evaluate(() => {
      window.__raf = 0;
      const original = window.requestAnimationFrame;
      window.requestAnimationFrame = function (cb) {
        window.__raf++;
        return original.call(window, cb);
      };
    });
    for (const file of recipeFiles(RECIPES_DIR)) {
      await page.addScriptTag({ content: fs.readFileSync(path.join(RECIPES_DIR, file), 'utf8') });
    }
    const mounted = await page.evaluate((cid) => {
      try {
        window.UI.get(cid).demo(document.getElementById('stage'));
        return true;
      } catch {
        return false;
      }
    }, id);
    if (!mounted) return -1;

    // Sample a window that starts after mount, so one-off setup frames are not counted as a
    // running loop.
    await page.waitForTimeout(400);
    const start = await page.evaluate(() => window.__raf);
    await page.waitForTimeout(600);
    return (await page.evaluate(() => window.__raf)) - start;
  } finally {
    await context.close();
  }
}

/**
 * Every recipe whose demo() this environment can actually mount. A recipe declaring THREE is
 * included once the pinned build is installed — excluding them unconditionally (the first
 * version of this) left three animated recipes asserting nothing about reduced motion, which
 * is the same unverified-promise hole the render harness had.
 */
function runnableIds() {
  const declared = readManifest(RECIPES_DIR).components;
  const hasThree = threeBuildPath() !== null;

  const runnable = declared.filter(
    (c) => (c.requires ?? []).length === 0 || (hasThree && needsThree(c.requires)),
  );
  const skipped = declared.filter((c) => !runnable.includes(c));
  // Never a silent cap: an untested recipe is named, not quietly dropped from the count.
  if (skipped.length > 0) {
    console.warn(`reduced-motion unverified (dependency unavailable): ${skipped.map((c) => c.id).join(', ')}`);
  }
  return runnable.map((c) => c.id);
}

describe('prefers-reduced-motion, measured rather than assumed', () => {
  it('no recipe drives an animation loop when the preference is set', async () => {
    const running = [];
    for (const id of runnableIds()) {
      const frames = await rafCount(id, 'reduce');
      if (frames > 0) running.push(`${id}: ${frames} frames in 600ms`);
    }
    expect(running).toEqual([]);
  }, 180_000);

  it('particle-field does loop without the preference — otherwise the test above proves nothing', async () => {
    const frames = await rafCount('particle-field', 'no-preference');
    expect(frames).toBeGreaterThan(10);
  }, 60_000);

  it('path-draw renders complete and static under reduce, and animates without it', async () => {
    // A CSS transition driven by a JS timer, so it schedules no rAF at all and the counter
    // above is blind to it. The observable difference is the dash pattern: the reveal exists
    // only while the path is dashed, so `none` is the whole degradation.
    async function dashState(reducedMotion) {
      const context = await browser.newContext({ reducedMotion });
      const page = await context.newPage();
      try {
        await page.setContent(PAGE);
        for (const file of recipeFiles(RECIPES_DIR)) {
          await page.addScriptTag({ content: fs.readFileSync(path.join(RECIPES_DIR, file), 'utf8') });
        }
        await page.evaluate(() => window.UI.get('path-draw').demo(document.getElementById('stage')));
        await page.waitForTimeout(300);
        const first = await page.evaluate(
          () => getComputedStyle(document.querySelector('#stage path')).strokeDashoffset,
        );
        await page.waitForTimeout(500);
        // Awaited before returning, not `return page.evaluate(...)`: the finally below closes
        // the context, and an unawaited promise loses the race about half the time with
        // "Target page, context or browser has been closed".
        const state = await page.evaluate(
          (before) => {
            const style = getComputedStyle(document.querySelector('#stage path'));
            return { dash: style.strokeDasharray, moved: style.strokeDashoffset !== before };
          },
          first,
        );
        return state;
      } finally {
        await context.close();
      }
    }

    expect(await dashState('reduce')).toEqual({ dash: 'none', moved: false });
    expect((await dashState('no-preference')).moved).toBe(true);
  }, 90_000);
});
