import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Every path SKILL.md names must exist, relative to the library root it says paths are
// relative to. A session elsewhere follows these literally: when the shelves were listed as
// `references/...` instead of `skill/references/...`, it got "No such file" and hand-rolled
// the technique the shelf already had (found 2026-10-08).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skill = fs.readFileSync(path.join(ROOT, 'skill', 'SKILL.md'), 'utf8');

describe('SKILL.md', () => {
  const named = [...skill.matchAll(/`([\w./-]+\.(?:md|json|js|py|png))`/g)].map((m) => m[1]);

  it('names the shelves', () => {
    expect(named).toContain('skill/references/recipe-library-web.md');
  });

  it.each(named)('%s exists under the library root', (rel) => {
    expect(fs.existsSync(path.join(ROOT, rel)), `${rel} is named in SKILL.md but missing`).toBe(true);
  });
});

// The description is what makes a session load the skill: it names UI files, not only techniques,
// so a plain UI edit checks the shelves before hand-rolling (Iris redesign, reach item 2).
describe('SKILL.md description', () => {
  const description = skill.match(/^description: (.*)$/m)[1];
  it.each(['.qml', 'PyQt', 'PySide', '.html', '.css', '.jsx', '.tsx'])('names %s', (term) => {
    expect(description).toContain(term);
  });
  it('fits the 1024-character limit on skill descriptions', () => {
    expect(description.length).toBeLessThanOrEqual(1024);
  });
});
