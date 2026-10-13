import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { buildQtManifest, readQtManifest, qtRecipeFiles } from './qtManifest.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const QT_DIR = path.join(REPO_ROOT, 'recipes', 'qt');

function python3Available() {
  try {
    execFileSync('python3', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const skip = !python3Available();

describe('buildQtManifest', () => {
  it.skipIf(skip)('matches the committed manifest — run `npm run sync` if this fails', () => {
    expect(buildQtManifest(QT_DIR)).toEqual(readQtManifest(QT_DIR));
  });

  it.skipIf(skip)('reads a spec computed from module state, which static parsing could not', () => {
    // icon.py builds props.name.values from ICONS.keys() at import time.
    const icon = buildQtManifest(QT_DIR).components.find((c) => c.id === 'icon');
    expect(icon.props.name.values.length).toBe(Object.keys(iconPathsFrom('qt')).length);
  });

  it.skipIf(skip)('refuses a module that imports but defines no RECIPE, rather than listing it', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'substrate-qt-'));
    fs.writeFileSync(path.join(tmp, 'silent.py'), '# a module, but not a recipe\n');
    expect(() => buildQtManifest(tmp)).toThrow(/defines no RECIPE/);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it.skipIf(skip)('surfaces a module that fails to import instead of dropping it silently', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'substrate-qt-'));
    fs.writeFileSync(path.join(tmp, 'broken.py'), 'raise RuntimeError("boom")\n');
    expect(() => buildQtManifest(tmp)).toThrow(/failed to import.*boom/s);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('returns an empty shelf rather than throwing when there are no Qt recipes yet', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'substrate-qt-'));
    expect(buildQtManifest(tmp).components).toEqual([]);
    expect(qtRecipeFiles(tmp)).toEqual([]);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

/** Parses the icon path table out of whichever platform's recipe file. */
function iconPathsFrom(platform) {
  if (platform === 'web') {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'recipes', 'web', 'icon.js'), 'utf8');
    const body = src.match(/const ICONS = \{([\s\S]*?)\n  \};/)[1];
    return Object.fromEntries([...body.matchAll(/^\s*(\w+):\s*'([^']*)',?$/gm)].map((m) => [m[1], m[2]]));
  }
  const src = fs.readFileSync(path.join(QT_DIR, 'icon.py'), 'utf8');
  const body = src.match(/^ICONS = \{([\s\S]*?)\n\}/m)[1];
  return Object.fromEntries([...body.matchAll(/^\s*'(\w+)':\s*'([^']*)',?$/gm)].map((m) => [m[1], m[2]]));
}

describe('the web and Qt icon sets are the same artwork', () => {
  // recipes are copied, not imported, so the path data is duplicated across the language
  // boundary on purpose — a Qt project takes icon.py and nothing else. Duplication without a
  // guard is just drift waiting to happen; this is the guard.
  it('defines the same icon names in both files', () => {
    expect(Object.keys(iconPathsFrom('qt')).sort()).toEqual(Object.keys(iconPathsFrom('web')).sort());
  });

  it('defines byte-identical path data for every icon', () => {
    const web = iconPathsFrom('web');
    const qt = iconPathsFrom('qt');
    const drifted = Object.keys(web).filter((k) => web[k] !== qt[k]);
    expect(drifted).toEqual([]);
  });

  it('uses the same stroke width', () => {
    const webStroke = fs.readFileSync(path.join(REPO_ROOT, 'recipes', 'web', 'icon.js'), 'utf8').match(/const STROKE = ([\d.]+)/)[1];
    const qtStroke = fs.readFileSync(path.join(QT_DIR, 'icon.py'), 'utf8').match(/^STROKE = ([\d.]+)/m)[1];
    expect(qtStroke).toBe(webStroke);
  });
});
