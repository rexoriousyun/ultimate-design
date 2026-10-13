import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { renderQtRecipes } from './qtRender.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const QT_DIR = path.join(REPO_ROOT, 'recipes', 'qt');

function pyqtAvailable() {
  try {
    execFileSync('python3', ['-c', 'import PyQt6.QtWidgets'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const skip = !pyqtAvailable();

/** A minimal Qt shelf containing one deliberately broken recipe. */
function shelfWith(name, source) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'substrate-qtrender-'));
  fs.writeFileSync(path.join(tmp, name), source);
  return tmp;
}

describe('renderQtRecipes', () => {
  it.skipIf(skip)('renders the real Qt shelf and paints something', () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'substrate-qtshots-'));
    const { unavailable, results } = renderQtRecipes(QT_DIR, { outDir: out });

    expect(unavailable).toBeNull();
    const icon = results.find((r) => r.id === 'icon');
    expect(icon.status).toBe('rendered');
    expect(icon.painted).toBeGreaterThan(100);
    fs.rmSync(out, { recursive: true, force: true });
  }, 120_000);

  it.skipIf(skip)('fails a recipe that runs but paints nothing — the bug this gate exists for', () => {
    // A valid pixmap filled with one colour and nothing drawn on it. The first version of
    // icon.py's pixmap() effectively produced this: no error, ~blank output.
    const shelf = shelfWith('blank.py', `
from PyQt6.QtGui import QPixmap, QColor

def demo():
    pm = QPixmap(120, 80)
    pm.fill(QColor("#ffffff"))
    return pm

RECIPE = {"id": "blank", "primitive": "svg", "label": "Blank", "demo": True}
`);
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'substrate-qtshots-'));
    const { results } = renderQtRecipes(shelf, { outDir: out });

    expect(results[0].status).toBe('failed');
    expect(results[0].reason).toMatch(/painted nothing/);
    fs.rmSync(shelf, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }, 120_000);

  it.skipIf(skip)('fails a recipe whose demo raises, rather than reporting it rendered', () => {
    const shelf = shelfWith('boom.py', `
def demo():
    raise RuntimeError("nope")

RECIPE = {"id": "boom", "primitive": "svg", "label": "Boom"}
`);
    const { results } = renderQtRecipes(shelf, { outDir: fs.mkdtempSync(path.join(os.tmpdir(), 's-')) });
    expect(results[0].status).toBe('failed');
    expect(results[0].reason).toMatch(/nope/);
    fs.rmSync(shelf, { recursive: true, force: true });
  }, 120_000);

  it.skipIf(skip)('fails a recipe with no demo() at all', () => {
    const shelf = shelfWith('nodemo.py', 'RECIPE = {"id": "nodemo", "primitive": "svg", "label": "No demo"}\n');
    const { results } = renderQtRecipes(shelf, { outDir: fs.mkdtempSync(path.join(os.tmpdir(), 's-')) });
    expect(results[0].reason).toMatch(/no demo\(\)/);
    fs.rmSync(shelf, { recursive: true, force: true });
  }, 120_000);

  it('reports an absent shelf as empty rather than throwing', () => {
    expect(renderQtRecipes('/nonexistent/qt')).toEqual({ unavailable: null, results: [] });
  });
});

describe('the committed Qt screenshots', () => {
  it('exist for every Qt recipe', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(QT_DIR, 'manifest.json'), 'utf8'));
    const missing = manifest.components
      .filter((c) => !fs.existsSync(path.join(QT_DIR, 'screenshots', `${c.id}.png`)))
      .map((c) => c.id);
    expect(missing).toEqual([]);
  });
});
