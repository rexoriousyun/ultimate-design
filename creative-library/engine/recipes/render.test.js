import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderRecipes } from './render.js';
import { recipeFiles, readManifest } from './manifest.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RECIPES_DIR = path.join(REPO_ROOT, 'recipes', 'web');
const SHOTS_DIR = path.join(RECIPES_DIR, 'screenshots');

/** Copies the real library into a temp dir so a test can add a broken module to it. */
function cloneLibrary(extra = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'substrate-render-'));
  for (const file of recipeFiles(RECIPES_DIR)) {
    fs.copyFileSync(path.join(RECIPES_DIR, file), path.join(tmp, file));
  }
  for (const [name, content] of Object.entries(extra)) {
    fs.writeFileSync(path.join(tmp, name), content);
  }
  return tmp;
}

describe('renderRecipes', () => {
  it('every recipe either renders or skips for a stated unmet dependency — none fail', async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'substrate-shots-'));
    const results = await renderRecipes(RECIPES_DIR, { outDir: out });

    const failed = results.filter((r) => r.status === 'failed').map((r) => `${r.id}: ${r.reason}`);
    expect(failed).toEqual([]);
    for (const skipped of results.filter((r) => r.status === 'skipped')) {
      expect(skipped.reason).toMatch(/unmet dependency/);
    }
    fs.rmSync(out, { recursive: true, force: true });
  }, 120_000);

  it('fails a recipe whose demo throws, rather than reporting it rendered', async () => {
    const tmp = cloneLibrary({
      'exploding.js':
        // preview is part of the registry contract now, so a fixture must supply one to get
        // far enough to test what it is actually about — the demo throwing.
        "(function (g) { g.UI.define({ id: 'exploding', primitive: 'svg', preview() {}, demo() { throw new Error('nope'); } }); })(window);",
    });
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'substrate-shots-'));

    const results = await renderRecipes(tmp, { outDir: out });
    const exploding = results.find((r) => r.id === 'exploding');

    expect(exploding.status).toBe('failed');
    expect(exploding.reason).toContain('nope');
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }, 120_000);

  it('fails a recipe that appends a real element and still paints nothing', async () => {
    // The case the previous gate waved through. It tested `childElementCount > 0`, so a canvas
    // that is never drawn into — or an <svg> whose filter references a missing id, which is
    // how these actually rot — counted as painted. Only looking at pixels catches it.
    const tmp = cloneLibrary({
      'empty-canvas.js':
        "(function (g) { g.UI.define({ id: 'empty-canvas', primitive: 'canvas', preview() {}, " +
        "demo(c) { const el = document.createElement('canvas'); el.width = 200; el.height = 120; " +
        "el.style.cssText = 'width:200px;height:120px'; c.appendChild(el); } }); })(window);",
    });
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'substrate-shots-'));

    const results = await renderRecipes(tmp, { outDir: out });
    const empty = results.find((r) => r.id === 'empty-canvas');

    expect(empty.status).toBe('failed');
    expect(empty.reason).toContain('painted nothing');
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }, 120_000);

  it('fails a recipe that runs but paints nothing — the way a copied construction usually rots', async () => {
    const tmp = cloneLibrary({
      'silent-render.js':
        "(function (g) { g.UI.define({ id: 'silent-render', primitive: 'svg', preview() {}, demo() { /* paints nothing */ } }); })(window);",
    });
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'substrate-shots-'));

    const results = await renderRecipes(tmp, { outDir: out });
    const silent = results.find((r) => r.id === 'silent-render');

    expect(silent.status).toBe('failed');
    expect(silent.reason).toContain('painted nothing');
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }, 120_000);
});

describe('the committed screenshots', () => {
  it('exist for every recipe that is not skipped for a missing dependency', () => {
    const needsShot = readManifest(RECIPES_DIR).components.filter((c) => (c.requires ?? []).length === 0);
    const missing = needsShot
      .filter((c) => !fs.existsSync(path.join(SHOTS_DIR, `${c.id}.png`)))
      .map((c) => c.id);
    expect(missing).toEqual([]);
  });

  it('are non-empty PNGs', () => {
    const tooSmall = fs
      .readdirSync(SHOTS_DIR)
      .filter((f) => f.endsWith('.png'))
      .filter((f) => fs.statSync(path.join(SHOTS_DIR, f)).size < 1000);
    expect(tooSmall).toEqual([]);
  });
});
