import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { shelfMarkdown } from './shelf.js';
import { readManifest } from './manifest.js';
import { readQtManifest } from './qtManifest.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const committed = (shelf) =>
  fs.readFileSync(path.join(ROOT, 'skill', 'references', `recipe-library-${shelf}.md`), 'utf8');

describe('skill shelves', () => {
  it('the web shelf lists every recipe in the web manifest — run `npm run sync` if this fails', () => {
    expect(committed('web')).toBe(shelfMarkdown('web', readManifest(path.join(ROOT, 'recipes', 'web'))));
  });

  it('the qt shelf lists every recipe in the qt manifest — run `npm run sync` if this fails', () => {
    expect(committed('qt')).toBe(shelfMarkdown('qt', readQtManifest(path.join(ROOT, 'recipes', 'qt'))));
  });
});

// design-guide carries its own copy of both shelves, which its suite regenerates from here.
// Checked here too, so a recipe change shows the drift where it happens. Skipped when no
// design-guide checkout is found (DESIGN_GUIDE_DIR, a sibling of ultimate-design, or ~/Documents/Github).
const designGuide = [process.env.DESIGN_GUIDE_DIR, path.resolve(ROOT, '..', '..', 'design-guide'),
  path.join(os.homedir(), 'Documents', 'Github', 'design-guide')]
  .find((dir) => dir && fs.existsSync(path.join(dir, 'skill', 'references')));

describe.skipIf(!designGuide)("design-guide's copies of the shelves", () => {
  for (const [shelf, read] of [['web', readManifest], ['qt', readQtManifest]]) {
    it(`${shelf} matches \`npm run sync\` — re-export design-guide's skill index if this fails`, () => {
      const theirs = fs.readFileSync(path.join(designGuide, 'skill', 'references', `recipe-library-${shelf}.md`), 'utf8');
      expect(theirs).toBe(shelfMarkdown(shelf, read(path.join(ROOT, 'recipes', shelf))));
    });
  }
});
