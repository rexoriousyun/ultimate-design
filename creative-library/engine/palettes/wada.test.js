import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contrast, describe as tags, indexMarkdown, readWada } from './wada.js';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'palettes', 'wada');
const wada = readWada(DIR);
const byId = (id) => wada.combinations.find((c) => c.id === id);
const names = (id) => byId(id).colors.map((c) => c.name).sort();

describe('Wada colour combinations', () => {
  it('has the book\'s 159 colours and 348 combinations: 120 of two, 120 of three, 108 of four', () => {
    expect(wada.colors).toHaveLength(159);
    expect(wada.combinations.map((c) => c.id)).toEqual(Array.from({ length: 348 }, (_, i) => i + 1));
    const sizes = { 2: 0, 3: 0, 4: 0 };
    for (const c of wada.combinations) sizes[c.colors.length] += 1;
    expect(sizes).toEqual({ 2: 120, 3: 120, 4: 108 });
  });

  it('matches combinations read off the printed book (Seigensha edition, pp.26-28)', () => {
    expect(names(1)).toEqual(['Cerulian Blue', 'English Red']);
    expect(names(2)).toEqual(['Dark Tyrian Blue', 'Yellow Orange']);
    expect(names(6)).toEqual(['Deep Indigo', 'Grenadine Pink']);
  });

  it('tags harmony, value and strength, and finds the best text pair', () => {
    expect(tags(byId(7))).toMatchObject({ harmony: 'contrast-tone', value: 'light' }); // greyed green still a hue
    const deep = tags(byId(6));
    expect(deep.value).toBe('light-and-dark');
    expect(deep.best.pair.map((c) => c.name)).toEqual(['Deep Indigo', 'Grenadine Pink']);
    expect(deep.best.ratio).toBeCloseTo(7.2, 1);
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
  });

  it('the committed index matches colors.json — run `npm run sync` if this fails', () => {
    expect(fs.readFileSync(path.join(DIR, 'combinations.md'), 'utf8')).toBe(indexMarkdown(wada));
  });
});
