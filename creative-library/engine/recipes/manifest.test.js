import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildManifest, readManifest, recipeFiles } from './manifest.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RECIPES_DIR = path.join(REPO_ROOT, 'recipes', 'web');

describe('recipeFiles', () => {
  it('puts registry.js first, since nothing can call UI.define before it exists', () => {
    expect(recipeFiles(RECIPES_DIR)[0]).toBe('registry.js');
  });

  it('throws when there is no registry to register into', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'substrate-recipes-'));
    fs.writeFileSync(path.join(empty, 'thing.js'), '// no registry here');
    expect(() => recipeFiles(empty)).toThrow(/no registry\.js/);
    fs.rmSync(empty, { recursive: true, force: true });
  });
});

describe('buildManifest', () => {
  it('matches the committed manifest — run `npm run sync` if this fails', async () => {
    const built = await buildManifest(RECIPES_DIR);
    expect(built).toEqual(readManifest(RECIPES_DIR));
  }, 60_000);

  it('a deleted component disappears from a regenerated manifest', async () => {
    // PLAN.md 5.3's verify, run for real: copy the library, delete one file, regenerate.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'substrate-recipes-'));
    for (const file of recipeFiles(RECIPES_DIR)) {
      fs.copyFileSync(path.join(RECIPES_DIR, file), path.join(tmp, file));
    }
    fs.unlinkSync(path.join(tmp, 'gooey-blobs.js'));

    const built = await buildManifest(tmp);
    const ids = built.components.map((c) => c.id);

    expect(ids).not.toContain('gooey-blobs');
    expect(ids).toContain('squiggle-wobble');
    fs.rmSync(tmp, { recursive: true, force: true });
  }, 60_000);

  it('refuses a module that loads but never registers, rather than listing it as present', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'substrate-recipes-'));
    fs.copyFileSync(path.join(RECIPES_DIR, 'registry.js'), path.join(tmp, 'registry.js'));
    fs.writeFileSync(path.join(tmp, 'silent.js'), '// looks like a component, registers nothing\n');

    await expect(buildManifest(tmp)).rejects.toThrow(/never called UI\.define\(\): silent/);
    fs.rmSync(tmp, { recursive: true, force: true });
  }, 60_000);

  it('surfaces a module that throws instead of silently dropping it', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'substrate-recipes-'));
    fs.copyFileSync(path.join(RECIPES_DIR, 'registry.js'), path.join(tmp, 'registry.js'));
    fs.writeFileSync(path.join(tmp, 'broken.js'), 'throw new Error("boom");\n');

    await expect(buildManifest(tmp)).rejects.toThrow(/threw while loading|boom/);
    fs.rmSync(tmp, { recursive: true, force: true });
  }, 60_000);
});

describe('the committed manifest', () => {
  it('carries every recipe file on disk', () => {
    const onDisk = recipeFiles(RECIPES_DIR)
      .filter((f) => f !== 'registry.js')
      .map((f) => f.replace(/\.js$/, ''))
      .sort();
    expect(readManifest(RECIPES_DIR).components.map((c) => c.id)).toEqual(onDisk);
  });

  it('gives every component a source path that exists', () => {
    const missing = readManifest(RECIPES_DIR)
      .components.filter((c) => !fs.existsSync(path.join(REPO_ROOT, c.source)))
      .map((c) => `${c.id} -> ${c.source}`);
    expect(missing).toEqual([]);
  });
});

describe('every recipe exposes both renderers', () => {
  // demo(container) is the scripted showcase the screenshot is taken of; preview(container,
  // props) renders exactly the props it is handed, which is what makes the app's generated
  // controls mean anything. registry.js refuses a spec missing either, so a recipe that
  // forgot one cannot reach the manifest at all — this asserts the contract holds in the
  // committed shelf rather than only in the registry's throw.
  it('reports hasPreview for all of them', () => {
    const missing = readManifest(RECIPES_DIR).components.filter((c) => !c.hasPreview).map((c) => c.id);
    expect(missing).toEqual([]);
  });

  it('declares at least one adjustable prop per recipe, so the playground is never empty', () => {
    const propless = readManifest(RECIPES_DIR)
      .components.filter((c) => Object.keys(c.props ?? {}).length === 0)
      .map((c) => c.id);
    expect(propless).toEqual([]);
  });
});
