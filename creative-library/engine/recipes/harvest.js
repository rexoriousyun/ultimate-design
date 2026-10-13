/**
 * Recipe intake — PLAN.md phase 5.4, "drop a link, get a verified recipe entry".
 *
 * What this does: opens the URL, extracts the markup and the computed styles of a chosen
 * element, and writes a `recipes/web/<id>.js` scaffold with the provenance, the extracted
 * construction, and a `UI.define()` spec already filled in as far as the page can fill it.
 *
 * What this deliberately does NOT do: claim the result is a finished recipe. Tier 2's whole
 * value is that its contents are *verified* — a scaffold auto-promoted to a recipe would
 * make the library exactly as trustworthy as an arbitrary URL, which is the failure this
 * design-guide exists to prevent one level up. So the scaffold lands with `label`, `description`
 * and `signature` marked TODO, and `npm run render` will fail it until a human has
 * made its `demo()` actually paint something. Harvesting proposes; a person finishes.
 *
 * The pipeline is therefore three steps, each verifiable on its own:
 *   1. npm run harvest -- <url> --id <id> [--selector <css>]
 *   2. edit the scaffold — make demo() render, write the description, decide the signature
 *   3. npm run sync && npm run render
 */

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Styles worth carrying over — the ones that usually *are* the construction. */
const STYLE_PROPS = [
  'filter', 'backdrop-filter', 'mix-blend-mode', 'transform', 'clip-path',
  'mask-image', 'background', 'box-shadow', 'border-radius', 'animation',
];

/**
 * @param {string} url
 * @param {{id: string, selector?: string}} opts
 * @returns {Promise<{id: string, url: string, title: string, selector: string, html: string, styles: object, svgDefs: string[]}>}
 */
export async function harvest(url, opts) {
  if (!ID_PATTERN.test(opts.id ?? '')) {
    throw new Error(`--id must be kebab-case (got ${JSON.stringify(opts.id)})`);
  }
  const selector = opts.selector ?? 'body';

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'load' });

    const found = await page.$(selector);
    if (!found) {
      throw new Error(`selector ${JSON.stringify(selector)} matched nothing at ${url}`);
    }

    const extracted = await page.evaluate(
      ({ sel, props }) => {
        const el = document.querySelector(sel);
        const cs = getComputedStyle(el);
        const styles = {};
        for (const p of props) {
          const v = cs.getPropertyValue(p);
          if (v && v !== 'none' && v !== 'normal' && v !== 'auto') styles[p] = v;
        }
        // SVG filters referenced by a `filter: url(#id)` live elsewhere in the document, so
        // grabbing only the element's own markup would lose the half that does the work.
        const defs = Array.from(document.querySelectorAll('filter, clipPath, mask')).map((d) => d.outerHTML);
        return { html: el.outerHTML, styles, title: document.title, defs };
      },
      { sel: selector, props: STYLE_PROPS },
    );

    return {
      id: opts.id,
      url,
      title: extracted.title,
      selector,
      html: extracted.html,
      styles: extracted.styles,
      svgDefs: extracted.defs,
    };
  } finally {
    await browser.close();
  }
}

function jsString(value) {
  return JSON.stringify(value);
}

/** Renders the harvested material as a recipe module scaffold. */
export function scaffoldSource(h, harvestedOn) {
  const styleLines = Object.entries(h.styles).map(([k, v]) => ` *   ${k}: ${v}`).join('\n');
  return `/**
 * ${h.title || h.id} — HARVESTED SCAFFOLD, NOT YET A RECIPE.
 *
 * Source: ${h.url}
 * Selector: ${h.selector}
 * Harvested: ${harvestedOn}
 *
 * Computed styles that looked load-bearing:
${styleLines || ' *   (none of the tracked properties were set)'}
 *
 * Before this counts as tier 2, a human has to:
 *   1. Reduce the captured markup below to the construction itself — harvesting keeps
 *      the whole subtree, which is almost never what should be copied.
 *   2. Make demo(container) paint something. \`npm run render\` fails until it does.
 *   3. Write label/description, and decide whether it earns a \`signature\` at all. Most do
 *      not: a signature that matches ordinary markup makes the gate noisy, which is worse
 *      than no signature.
 *   4. Confirm the licence of the source page permits reuse. Nothing here checks that.
 */
(function (global) {
  const HARVESTED_HTML = ${jsString(h.html)};
  const HARVESTED_DEFS = ${jsString(h.svgDefs.join('\\n'))};

  function mount(el) {
    el.innerHTML = HARVESTED_DEFS + HARVESTED_HTML;
    return { destroy() { el.innerHTML = ''; } };
  }

  global.UI${h.id.replace(/(^|-)([a-z])/g, (_, __, c) => c.toUpperCase())} = { mount };

  if (global.UI) {
    global.UI.define({
      id: ${jsString(h.id)},
      primitive: 'svg',
      label: 'TODO: name this component',
      source: ${jsString(`recipes/web/${h.id}.js`)},
      export: ${jsString('UI' + h.id.replace(/(^|-)([a-z])/g, (_, __, c) => c.toUpperCase()))},
      description: 'TODO: one line on what this does and when to reach for it.',
      harvested_from: ${jsString(h.url)},
      props: {},
      snippet: 'TODO: the two or three lines someone copies.',
      demo(container) {
        return mount(container);
      },
    });
  }
})(window);
`;
}

/**
 * @returns {{path: string, id: string}}
 */
export function writeScaffold(recipesDir, h, harvestedOn) {
  const file = path.join(recipesDir, `${h.id}.js`);
  if (fs.existsSync(file)) {
    throw new Error(`${file} already exists — pick another --id or delete it first`);
  }
  fs.writeFileSync(file, scaffoldSource(h, harvestedOn));
  return { path: file, id: h.id };
}
