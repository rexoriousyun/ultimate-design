import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkEvidence, declarationHash, failuresOf, judge, measureFloor, openShelf, sweepRecipe } from './sweep.js';
import { readManifest } from './manifest.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WEB = path.join(ROOT, 'recipes', 'web');
const recipe = (id) => readManifest(WEB).components.find((c) => c.id === id);

describe('judge', () => {
  it('compares adjacent steps against max(4 × floor, 0.05%) — the phase 2 calibration', () => {
    expect(judge([0.2, 0.15], 0).verdict).toBe('effective');
    expect(judge([0.002, 0.001], 0).verdict).toBe('effective'); // a star fill, an icon glyph
    expect(judge([0, 0.0004], 0).verdict).toBe('inert');
    expect(judge([0.2, 0.0], 0)).toMatchObject({ verdict: 'partial', flat: [1] });
    // A noisy floor raises the bar: 3% steps are noise when the floor is 1%.
    expect(judge([0.03, 0.03], 0.01).verdict).toBe('inert');
  });
});

describe('declarationHash', () => {
  it('ignores key order and changes when a sweep changes', () => {
    const a = { cell: { type: 'number', default: 8, sweep: [2, 4] } };
    const b = { cell: { sweep: [2, 4], default: 8, type: 'number' } };
    expect(declarationHash(a)).toBe(declarationHash(b));
    expect(declarationHash({ cell: { ...a.cell, sweep: [2, 4, 8] } })).not.toBe(declarationHash(a));
  });
});

describe('sweeps in Chromium', () => {
  let shelf;
  let tmp;
  beforeAll(async () => {
    shelf = await openShelf(WEB);
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sweeps-'));
  }, 60_000);
  afterAll(async () => {
    await shelf?.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('phase 0/2: halftone and the five recipes seeded in phase 2 render deterministically', async () => {
    // particle-field measured 21.5% before its seed (unseeded Math.random()); all five were
    // unsweepable until then (PLAN.md phase 2).
    for (const id of ['halftone', 'particle-field', 'click-to-split', 'absorb-drops', 'proximity-dots', 'three-points']) {
      expect((await measureFloor(shelf, recipe(id))).floor, id).toBe(0);
    }
  }, 120_000);

  it('phase 1: halftone cell, angle and invert are effective, and its 0/90 symmetry holds', async () => {
    const report = await sweepRecipe(shelf, recipe('halftone'), tmp);
    expect(report.params.cell.verdict).toBe('effective');
    expect(report.params.angle.verdict).toBe('effective');
    // invert was declared and dropped by preview() until the sweep caught it (PLAN phase 1).
    expect(report.params.invert.verdict).toBe('effective');
    expect(report.params.angle.identical).toEqual([expect.objectContaining({ values: [0, 90], holds: true })]);
    expect(failuresOf(report)).toEqual([]);
    expect(fs.existsSync(path.join(tmp, 'halftone', 'cell.png'))).toBe(true);
  }, 120_000);

  it('the negative control: a declared prop that preview() drops comes back inert and fails', async () => {
    const dropped = {
      ...recipe('halftone'),
      props: { ...recipe('halftone').props, ghost: { type: 'number', default: 1, controls: 'nothing', sweep: [1, 50] } },
    };
    const report = await sweepRecipe(shelf, dropped, tmp);
    expect(report.params.ghost.verdict).toBe('inert');
    expect(failuresOf(report)).toEqual([expect.stringContaining('halftone.ghost: inert')]);
  }, 120_000);

  it('a wrong symmetry claim fails: halftone at 0 and 45 degrees are not the same image', async () => {
    const base = recipe('halftone');
    const wrong = { ...base, props: { angle: { ...base.props.angle, identical: [[0, 45]] } } };
    const report = await sweepRecipe(shelf, wrong, tmp);
    expect(report.params.angle.identical[0].holds).toBe(false);
    expect(failuresOf(report)).toEqual([expect.stringContaining('declared identical 0 and 45 differ')]);
  }, 120_000);
});

describe('an unseeded recipe', () => {
  it('is unsweepable with the reason, not a pass and not a parameter failure', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'noisy-'));
    fs.copyFileSync(path.join(WEB, 'registry.js'), path.join(dir, 'registry.js'));
    fs.writeFileSync(path.join(dir, 'noisy.js'), `UI.define({ id: 'noisy', primitive: 'canvas',
      props: { size: { type: 'number', default: 40, controls: 'x', sweep: [20, 60] } },
      demo() {}, preview(c, p) {
        const k = document.createElement('canvas'); k.width = 200; k.height = 120; c.appendChild(k);
        const g = k.getContext('2d');
        for (let i = 0; i < 40; i++) { g.fillRect(Math.random() * 200, Math.random() * 120, p.size / 4, p.size / 4); }
      } });`);
    const noisyShelf = await openShelf(dir);
    try {
      const noisy = { id: 'noisy', props: { size: { type: 'number', default: 40, controls: 'x', sweep: [20, 60] } } };
      const report = await sweepRecipe(noisyShelf, noisy, path.join(dir, 'sweeps'));
      expect(report.noiseFloor).toBeGreaterThan(0.01);
      expect(report.status).toBe('unsweepable');
      expect(report.reason).toContain('missing seed');
      expect(report.params.size.verdict).toBe('unsweepable');
      expect(failuresOf(report)).toEqual([]);
    } finally {
      await noisyShelf.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe('checkEvidence (phase 3 gate)', () => {
  it('the committed shelf is mapped, swept from its current props, and passing', () => {
    // Fails the moment a recipe's props change without `npm run sweep -- <id>`.
    expect(checkEvidence(WEB)).toEqual([]);
  });

  it('fails when a sweep array changes without re-running the sweep', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-'));
    try {
      fs.cpSync(WEB, tmp, { recursive: true });
      const before = checkEvidence(tmp).filter((p) => p.startsWith('halftone'));
      expect(before).toEqual([]);
      const manifest = JSON.parse(fs.readFileSync(path.join(tmp, 'manifest.json'), 'utf8'));
      manifest.components.find((c) => c.id === 'halftone').props.cell.sweep.push(48);
      fs.writeFileSync(path.join(tmp, 'manifest.json'), JSON.stringify(manifest));
      expect(checkEvidence(tmp)).toContain(
        'halftone: sweep evidence is stale (props changed since it was swept) — run `npm run sweep -- halftone`');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
