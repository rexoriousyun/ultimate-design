/**
 * SVG icon module — monoline, 1.75px stroke, currentColor.
 * Usage: UIIcons.svg('cube', { size: 20, class: 'icon' })
 *        UIIcons.mountSprite(document.body) // once, injects <symbol> defs
 * Requires recipes/web/registry.js loaded first.
 */
(function (global) {
  const STROKE = 1.75;

  // id -> inner markup (viewBox 0 0 24 24)
  const ICONS = {
    cube: '<path d="M12 2 3 7v10l9 5 9-5V7l-9-5Z"/><path d="M3 7l9 5 9-5"/><path d="M12 12v10"/>',
    layers: '<path d="M12 3 2 8l10 5 10-5-10-5Z"/><path d="M2 13l10 5 10-5"/><path d="M2 18l10 5 10-5"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    chart: '<path d="M4 20V10"/><path d="M11 20V4"/><path d="M18 20v-7"/><path d="M2 20h20"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><circle cx="9" cy="10" r="1.75"/><path d="M21 16l-5.5-5.5L6 20"/>',
    terminal: '<rect x="2.5" y="4" width="19" height="16" rx="1.5"/><path d="M6.5 9.5 10 12l-3.5 2.5"/><path d="M12.5 15.5h5"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="1.5"/><path d="M6 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V6"/>',
    check: '<path d="M4 12.5 9.5 18 20 6"/>',
    chevronRight: '<path d="M9 5.5 16 12l-7 6.5"/>',
    externalLink: '<path d="M10 5H5.5A1.5 1.5 0 0 0 4 6.5v12A1.5 1.5 0 0 0 5.5 20h12a1.5 1.5 0 0 0 1.5-1.5V14"/><path d="M14 4h6v6"/><path d="M20 4 10.5 13.5"/>',
    github: '<path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.53 9.53 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .26.18.58.69.48A10 10 0 0 0 12 2Z"/>',
    box: '<path d="M21 8v8a1 1 0 0 1-.5.87l-8 4.5a1 1 0 0 1-1 0l-8-4.5A1 1 0 0 1 3 16V8a1 1 0 0 1 .5-.87l8-4.5a1 1 0 0 1 1 0l8 4.5A1 1 0 0 1 21 8Z"/><path d="M3.27 7.13 12 12l8.73-4.87"/><path d="M12 22V12"/>',
    sparkle: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3M6 6l2 2M16 16l2 2M6 18l2-2M16 8l2-2"/><circle cx="12" cy="12" r="3"/>',
    cursor: '<path d="M5 3l5.5 15.5 2-6.5 6.5-2L5 3Z"/>',
  };

  function svg(name, opts) {
    const o = opts || {};
    const size = o.size || 20;
    const cls = o.class ? ` class="${o.class}"` : '';
    const body = ICONS[name];
    if (!body) return '';
    return `<svg${cls} width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  }

  function mountSprite(root) {
    if (document.getElementById('ui-icon-sprite')) return;
    const wrap = document.createElement('div');
    wrap.id = 'ui-icon-sprite';
    wrap.style.display = 'none';
    wrap.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">${Object.keys(ICONS)
      .map((k) => `<symbol id="icon-${k}" viewBox="0 0 24 24">${ICONS[k]}</symbol>`)
      .join('')}</svg>`;
    (root || document.body).appendChild(wrap);
  }

  function use(name, opts) {
    const o = opts || {};
    const size = o.size || 20;
    const cls = o.class ? ` class="${o.class}"` : '';
    return `<svg${cls} width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="#icon-${name}"/></svg>`;
  }

  global.UIIcons = { list: Object.keys(ICONS), svg, use, mountSprite, STROKE };

  if (global.UI) {
    global.UI.define({
      id: 'icon',
      primitive: 'svg',
      label: 'Icon',
      source: 'recipes/web/icon.js',
      export: 'UIIcons',
      description: 'Monoline stroke icon set, 24×24 viewBox, currentColor.',
      props: {
        name: {
          type: 'enum', values: Object.keys(ICONS),
          controls: 'Which glyph from the set.',
          sweep: ['cube', 'chart', 'check', 'sparkle'],
          cost: 'none',
        },
        size: {
          type: 'number', default: 20, unit: 'px',
          controls: 'Icon size. The 1.75px stroke stays constant, so small icons read bolder than large ones.',
          range: [12, 48], sweep: [12, 16, 20, 32, 48],
          cost: 'none',
        },
        class: {
          type: 'string', optional: true,
          controls: 'A class on the <svg> for the caller\'s own CSS (colour, alignment).',
          unswept: 'a hook for the caller\'s stylesheet; the recipe styles nothing by it, so no frame of its own can show it',
        },
      },
      snippet:
        "UIIcons.svg('cube', { size: 20, class: 'icon' })\n// -> returns an <svg> string, ready to insert\n\n// for many repeats, mount the sprite once:\nUIIcons.mountSprite();\nUIIcons.use('cube', { size: 20 })",
      preview(container, props) {
        const p = props || {};
        // One icon at the chosen size, plus the set beneath it — the size prop is invisible
        // on a grid of uniform cells, and the name prop is meaningless without the set to
        // pick from.
        const one = document.createElement('div');
        one.style.cssText = 'display:flex;align-items:center;gap:0.75rem;margin-bottom:1rem';
        one.innerHTML = svg(p.name || 'cube', { size: p.size || 20 }) +
          '<code>' + (p.name || 'cube') + ' @ ' + (p.size || 20) + 'px</code>';
        container.appendChild(one);

        const grid = document.createElement('div');
        grid.className = 'ui-demo-icon-grid';
        Object.keys(ICONS).forEach(function (name) {
          const cell = document.createElement('div');
          cell.className = 'ui-demo-icon-cell';
          cell.innerHTML = '<span class="ui-demo-icon">' + svg(name, { size: 22 }) + '</span><code>' + name + '</code>';
          grid.appendChild(cell);
        });
        container.appendChild(grid);
        return { destroy() { container.innerHTML = ''; } };
      },
      demo(container) {
        const grid = document.createElement('div');
        grid.className = 'ui-demo-icon-grid';
        Object.keys(ICONS).forEach((name) => {
          const cell = document.createElement('div');
          cell.className = 'ui-demo-icon-cell';
          cell.innerHTML = '<span class="ui-demo-icon">' + svg(name, { size: 22 }) + '</span><code>' + name + '</code>';
          grid.appendChild(cell);
        });
        container.appendChild(grid);
        return { destroy() {} };
      },
    });
  }
})(window);
