import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { threeBuildPath, needsThree, THREE_VERSION } from './three.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);

describe('the pinned three build', () => {
  it('is installed, so three.js recipes are verified rather than skipped', () => {
    // The whole point of moving off the CDN: this is a fact about the repo, not about whether
    // the machine running the tests happens to have network.
    const build = threeBuildPath();
    expect(build).not.toBeNull();
    expect(fs.existsSync(build)).toBe(true);
  });

  it('is the exact version the recipes declare they need', () => {
    // A silent bump would change what every three.js recipe is validated against, while every
    // recipe's `requires` string kept naming the old one.
    expect(require('three/package.json').version).toBe(THREE_VERSION);
  });

  it('is pinned in package.json, not floated with a caret', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    const spec = pkg.devDependencies?.three ?? pkg.dependencies?.three;
    expect(spec).toBe(THREE_VERSION);
  });

  it("agrees with what the recipes' own requires strings say", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'recipes', 'web', 'manifest.json'), 'utf8'),
    );
    const declaring = manifest.components.filter((c) => needsThree(c.requires));
    expect(declaring.length).toBeGreaterThan(0);
    for (const c of declaring) {
      expect(c.requires.join(' ')).toContain(THREE_VERSION);
    }
  });
});
