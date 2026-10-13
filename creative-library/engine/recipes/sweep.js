/**
 * Evidence sweeps for parameter maps — PLAN.md §3–§5, phases 0–3.
 *
 * A parameter map is a claim: "this prop changes the output, over these values". This file is
 * what checks the claim. It mounts a recipe's own `preview(container, props)` in Chromium
 * under a fixed context, screenshots it, and diffs frames in-page (the same decode-through-a-
 * canvas trick render.js uses, so no image library is needed).
 *
 * The rules it enforces are PLAN §4's:
 * 1. Every recipe gets a measured noise floor: the default props rendered three times, diffed
 *    pairwise. Every other number is read against it.
 * 2. A recipe whose floor is above the effect threshold is `unsweepable`, with the reason. That
 *    is neither a pass nor a parameter failure; it is a missing seed.
 * 3. Effects are measured between ADJACENT sweep values, never between range ends (halftone's
 *    angle 0 and 90 are the same image while every step between them moves 11% of pixels).
 * 4. A parameter is `effective` when every adjacent step clears the threshold, `inert` when
 *    none does, `partial` when some do — partial names the flat segment of the range.
 * 5. Declared `identical` pairs must render the same. A symmetry claim is a claim.
 *
 * The metric is the fraction of pixels whose largest channel delta exceeds 12/255. It answers
 * "did this change", not "by how much": it saturates, so it never backs a magnitude claim.
 *
 * Evidence is generated, never authored: recipes/web/sweeps/<id>.json plus one strip image per
 * parameter (its sweep values side by side), so a person can check the `controls` prose by eye.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

import { recipeFiles, readManifest } from './manifest.js';
import { threeBuildPath } from './three.js';

/** The fixed context every frame is rendered in. Reduced motion freezes most animation. */
export const CONTEXT = { viewport: [640, 400], reducedMotion: 'reduce', settleMs: 350, repeats: 3 };

/**
 * Thresholds — set in phase 2 from the floor distribution across the shelf (see PLAN.md and
 * recipes/web/sweeps/floors.json). A step counts as an effect when it clears
 * max(FLOOR_MULTIPLE × floor, MIN_EFFECT). A recipe is unsweepable when its floor alone
 * reaches MIN_EFFECT: noise that large hides any effect worth claiming.
 */
export const THRESHOLDS = { FLOOR_MULTIPLE: 4, MIN_EFFECT: 0.0005, IDENTICAL_TOLERANCE: 0.0005, IDENTICAL_RATIO: 0.1 };

const DELTA = 4; // per-channel difference, out of 255, below which a pixel counts as unchanged (see THRESHOLDS)

/** A stable hash of a recipe's declared props, so stale evidence can be detected without a browser. */
export function declarationHash(props) {
  const stable = (v) => (Array.isArray(v) ? v.map(stable)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])])) : v);
  return crypto.createHash('sha1').update(JSON.stringify(stable(props ?? {}))).digest('hex').slice(0, 12);
}

/** The default value of every prop, which is the base each one-at-a-time sweep varies from. */
export function defaultsOf(props) {
  return Object.fromEntries(Object.entries(props ?? {}).filter(([, p]) => 'default' in p).map(([k, p]) => [k, p.default]));
}

/**
 * Judges one parameter's adjacent steps against the threshold.
 * @returns {{verdict: 'effective'|'partial'|'inert', flat: number[]}} `flat` holds the indices
 *   of the steps that did not clear the threshold (step i is values[i] → values[i+1]).
 */
export function judge(steps, floor, t = THRESHOLDS) {
  const threshold = Math.max(t.FLOOR_MULTIPLE * floor, t.MIN_EFFECT);
  const flat = steps.map((s, i) => (s > threshold ? -1 : i)).filter((i) => i >= 0);
  const verdict = flat.length === 0 ? 'effective' : flat.length === steps.length ? 'inert' : 'partial';
  return { verdict, flat, threshold };
}

const round = (x) => Math.round(x * 1e4) / 1e4;
const label = (v) => (typeof v === 'string' ? v : JSON.stringify(v));

/** One browser with the whole shelf loaded; each render gets a fresh page so nothing leaks. */
export async function openShelf(recipesDir) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: CONTEXT.viewport[0], height: CONTEXT.viewport[1] },
    reducedMotion: CONTEXT.reducedMotion,
  });
  const scripts = recipeFiles(recipesDir).map((f) => fs.readFileSync(path.join(recipesDir, f), 'utf8'));
  const three = threeBuildPath();

  async function newPage() {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setContent('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>sweep</title>'
      + '<style>body{margin:0;font-family:system-ui,sans-serif;color:#1a1a1a;background:#fff}'
      + '#stage{padding:16px;min-height:32px}</style></head>'
      + '<body><div id="stage"></div></body></html>');
    if (three) await page.addScriptTag({ path: three });
    for (const content of scripts) await page.addScriptTag({ content });
    return { page, errors };
  }

  /** Renders preview(props) and returns the stage screenshot. */
  async function render(id, props) {
    const { page, errors } = await newPage();
    try {
      await page.evaluate(({ cid, p }) => {
        const stage = document.getElementById('stage');
        window.UI.get(cid).preview(stage, p);
      }, { cid: id, p: props });
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await page.waitForTimeout(CONTEXT.settleMs);
      if (errors.length) throw new Error(`preview threw: ${errors.join('; ')}`);
      return await (await page.$('#stage')).screenshot();
    } finally {
      await page.close();
    }
  }

  let toolPage = null;
  async function tool() {
    if (!toolPage) toolPage = (await newPage()).page;
    return toolPage;
  }

  /** Fraction of pixels (over the larger frame) whose largest channel delta exceeds DELTA. */
  async function diff(a, b) {
    return (await tool()).evaluate(async ({ x, y, delta }) => {
      const load = (src) => new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('frame failed to decode'));
        img.src = src;
      });
      const [ia, ib] = await Promise.all([load(x), load(y)]);
      const w = Math.max(ia.width, ib.width);
      const h = Math.max(ia.height, ib.height);
      const pixels = (img) => {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, w, h).data;
      };
      const da = pixels(ia);
      const db = pixels(ib);
      let changed = 0;
      for (let i = 0; i < da.length; i += 4) {
        if (Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2])) > delta) changed++;
      }
      return changed / (w * h);
    }, { x: `data:image/png;base64,${a.toString('base64')}`, y: `data:image/png;base64,${b.toString('base64')}`, delta: DELTA });
  }

  /**
   * The frames side by side at a common height, each captioned with its value. Every frame is
   * cropped to the same box — the union of what any of them painted — so the strip shows the
   * construction rather than the stage's empty margin, and the frames stay comparable.
   */
  async function strip(frames, captions) {
    const dataUrl = await (await tool()).evaluate(async ({ srcs, caps }) => {
      const H = 120;
      const PAD = 6;
      const imgs = await Promise.all(srcs.map((src) => new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.src = src;
      })));
      // Union of painted pixels: anything that differs from the frame's top-left (background).
      let x0 = Infinity; let y0 = Infinity; let x1 = -1; let y1 = -1;
      for (const img of imgs) {
        const k = document.createElement('canvas');
        k.width = img.width; k.height = img.height;
        const g = k.getContext('2d');
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, img.width, img.height).data;
        const [br, bg, bb] = [d[0], d[1], d[2]];
        for (let y = 0; y < img.height; y++) {
          for (let x = 0; x < img.width; x++) {
            const i = (y * img.width + x) * 4;
            if (Math.abs(d[i] - br) + Math.abs(d[i + 1] - bg) + Math.abs(d[i + 2] - bb) > 12) {
              if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
            }
          }
        }
      }
      if (x1 < 0) { x0 = 0; y0 = 0; x1 = imgs[0].width - 1; y1 = imgs[0].height - 1; }
      const box = { x: Math.max(0, x0 - PAD), y: Math.max(0, y0 - PAD) };
      box.w = Math.min(Math.max(...imgs.map((i) => i.width)), x1 + PAD + 1) - box.x;
      box.h = Math.min(Math.max(...imgs.map((i) => i.height)), y1 + PAD + 1) - box.y;
      const widths = imgs.map(() => Math.max(1, Math.round((box.w / box.h) * H)));
      const c = document.createElement('canvas');
      c.width = widths.reduce((s, w) => s + w + 8, 8);
      c.height = H + 30;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#f4f4f2';
      ctx.fillRect(0, 0, c.width, c.height);
      let x = 8;
      imgs.forEach((img, i) => {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x, 4, widths[i], H);
        ctx.drawImage(img, box.x, box.y, box.w, box.h, x, 4, widths[i], H);
        ctx.fillStyle = '#1a1a1a';
        ctx.font = '12px system-ui, sans-serif';
        ctx.fillText(caps[i].slice(0, 24), x, H + 22);
        x += widths[i] + 8;
      });
      return c.toDataURL('image/png');
    }, { srcs: frames.map((f) => `data:image/png;base64,${f.toString('base64')}`), caps: captions });
    return Buffer.from(dataUrl.split(',')[1], 'base64');
  }

  return { render, diff, strip, close: () => browser.close() };
}

/** The recipe's noise floor: its defaults rendered `repeats` times, worst pairwise diff. */
export async function measureFloor(shelf, recipe) {
  const base = defaultsOf(recipe.props);
  const frames = [];
  for (let i = 0; i < CONTEXT.repeats; i++) frames.push(await shelf.render(recipe.id, base));
  let floor = 0;
  for (let i = 0; i < frames.length; i++) {
    for (let j = i + 1; j < frames.length; j++) floor = Math.max(floor, await shelf.diff(frames[i], frames[j]));
  }
  return { floor: round(floor), frame: frames[0] };
}

/**
 * Sweeps every mapped prop of one recipe and writes its evidence.
 * @returns {object} the report also written to <sweepsDir>/<id>.json
 */
export async function sweepRecipe(shelf, recipe, sweepsDir) {
  const { floor } = await measureFloor(shelf, recipe);
  const report = {
    id: recipe.id,
    generatedBy: 'recipes sweep',
    context: CONTEXT,
    thresholds: THRESHOLDS,
    declared: declarationHash(recipe.props),
    noiseFloor: floor,
    status: 'swept',
    params: {},
  };
  if (floor >= THRESHOLDS.MIN_EFFECT) {
    report.status = 'unsweepable';
    report.reason = `its defaults rendered ${CONTEXT.repeats} times differ by ${(floor * 100).toFixed(2)}% of pixels, `
      + `above the ${(THRESHOLDS.MIN_EFFECT * 100).toFixed(0)}% effect threshold: the output is not deterministic `
      + 'under the sweep context, so no effect can be told from noise (a missing seed)';
  }
  const base = defaultsOf(recipe.props);
  const outDir = path.join(sweepsDir, recipe.id);
  fs.rmSync(outDir, { recursive: true, force: true });

  for (const [name, prop] of Object.entries(recipe.props ?? {})) {
    if (prop.unswept) {
      report.params[name] = { verdict: 'unswept', reason: prop.unswept };
      continue;
    }
    if (!Array.isArray(prop.sweep)) {
      report.params[name] = { verdict: 'unmapped', reason: 'no `sweep` and no `unswept` reason declared' };
      continue;
    }
    if (report.status === 'unsweepable') {
      report.params[name] = { verdict: 'unsweepable', values: prop.sweep };
      continue;
    }
    // `sweepWith` moves the base point for this prop only, when its effect shows only away from
    // the defaults (three-points' sizeAttenuation needs points larger than the 1px minimum).
    const at = { ...base, ...(prop.sweepWith ?? {}) };
    const frames = [];
    for (const value of prop.sweep) frames.push(await shelf.render(recipe.id, { ...at, [name]: value }));
    const steps = [];
    for (let i = 0; i + 1 < frames.length; i++) steps.push(round(await shelf.diff(frames[i], frames[i + 1])));
    const { verdict, flat, threshold } = judge(steps, floor);
    const entry = {
      verdict,
      values: prop.sweep,
      steps,
      meanEffect: round(steps.reduce((s, x) => s + x, 0) / Math.max(1, steps.length)),
      minStep: steps.length ? Math.min(...steps) : 0,
      threshold: round(threshold),
    };
    if (verdict === 'partial') {
      entry.flatSegments = flat.map((i) => [prop.sweep[i], prop.sweep[i + 1]]);
    }
    if (verdict === 'inert') {
      entry.reason = `every adjacent step is at or below the threshold (${(threshold * 100).toFixed(2)}%)`;
    }
    for (const [a, b] of prop.identical ?? []) {
      const d = round(await shelf.diff(await shelf.render(recipe.id, { ...at, [name]: a }),
        await shelf.render(recipe.id, { ...at, [name]: b })));
      // A symmetry holds when the pair differs far less than one step of the parameter: rotated
      // lattices differ by faint antialiasing at edges, a wrong claim by a whole step.
      const holds = d <= Math.max(floor, THRESHOLDS.IDENTICAL_TOLERANCE, THRESHOLDS.IDENTICAL_RATIO * entry.meanEffect);
      (entry.identical ??= []).push({ values: [a, b], diff: d, holds });
    }
    fs.mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, `${name}.png`);
    fs.writeFileSync(file, await shelf.strip(frames, prop.sweep.map((v) => `${name} ${label(v)}`)));
    entry.strip = path.relative(path.dirname(sweepsDir), file);
    report.params[name] = entry;
  }
  fs.mkdirSync(sweepsDir, { recursive: true });
  fs.writeFileSync(path.join(sweepsDir, `${recipe.id}.json`), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

/** What makes a sweep report a failure: an inert claim, a broken symmetry claim, an unmapped prop. */
export function failuresOf(report) {
  const out = [];
  for (const [name, p] of Object.entries(report.params)) {
    if (p.verdict === 'inert') out.push(`${report.id}.${name}: inert — ${p.reason}`);
    if (p.verdict === 'unmapped') out.push(`${report.id}.${name}: ${p.reason}`);
    for (const pair of p.identical ?? []) {
      if (!pair.holds) out.push(`${report.id}.${name}: declared identical ${label(pair.values[0])} and ${label(pair.values[1])} differ by ${(pair.diff * 100).toFixed(2)}%`);
    }
  }
  return out;
}

/**
 * The staleness gate, with no browser: every recipe needs a map (every prop a `sweep` or an
 * `unswept` reason, every prop a `controls` sentence) and committed evidence swept from the
 * props as they are declared now.
 * @returns {string[]} problems; empty means current
 */
export function checkEvidence(recipesDir, sweepsDir = path.join(recipesDir, 'sweeps')) {
  const problems = [];
  for (const recipe of readManifest(recipesDir)?.components ?? []) {
    for (const [name, p] of Object.entries(recipe.props ?? {})) {
      if (!p.controls) problems.push(`${recipe.id}.${name}: no \`controls\` sentence`);
      if (!Array.isArray(p.sweep) && !p.unswept) problems.push(`${recipe.id}.${name}: no \`sweep\` and no \`unswept\` reason`);
    }
    const file = path.join(sweepsDir, `${recipe.id}.json`);
    if (!fs.existsSync(file)) {
      problems.push(`${recipe.id}: no sweep evidence — run \`npm run sweep -- ${recipe.id}\``);
      continue;
    }
    const report = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (report.declared !== declarationHash(recipe.props)) {
      problems.push(`${recipe.id}: sweep evidence is stale (props changed since it was swept) — run \`npm run sweep -- ${recipe.id}\``);
    }
    for (const failure of failuresOf(report)) problems.push(failure);
  }
  return problems;
}
