/**
 * Quantity as a pile — render a count as stacked objects, with a character standing on it.
 *
 * Ported from Dotori's squirrel companion doc (`paintHoard`), and split out from pixel-sprite
 * because it is a different idea: pixel-sprite is how a character is drawn, this is how a
 * *number* is drawn. A hoard of 14 acorns is a bar chart with one bar, rendered as a thing
 * instead of a rectangle.
 *
 * ## Why this is worth keeping as code
 *
 * The pile is generated from the count, so it is honest at every value — 3 acorns is visibly
 * a third of 9, and the character rises as the hoard grows because its feet are computed from
 * the pile height rather than positioned by hand. Draw this as artwork instead and you get
 * three states (empty / some / lots) that lie about everything in between.
 *
 * ## The row structure, which is the whole trick
 *
 * Rows fill bottom-up with a fixed capacity each — 7, 6, 5, 4, 2 — so the pile tapers like a
 * real heap rather than growing as a rectangle. Each row is centred on the widest row's span,
 * not on its own, or the stack wobbles left and right as it fills. That centring is the detail
 * people get wrong.
 *
 * Beyond the last row's capacity the pile is full and further count is not drawn, so the
 * caller must say what the number is in text. A pile that silently stops counting is a chart
 * that lies; `capacity` is exported so you can check before you render.
 *
 * Accessibility: a canvas holds no text, so the count goes in an aria-label and the sprite is
 * not the only place the number exists.
 *
 * Usage: const h = UIAcornHoard.mount(canvasEl, { count: 14 });
 * Requires recipes/web/registry.js and recipes/web/pixel-sprite.js loaded first.
 */
(function (global) {
  const ROW_CAPACITY = [7, 6, 5, 4, 2];

  /** Total the pile can show. Past this the drawing stops being proportional. */
  function capacity(rows) {
    return (rows || ROW_CAPACITY).reduce((a, b) => a + b, 0);
  }

  /**
   * Lay out `count` items into bottom-up rows of decreasing width.
   *
   * Pure and exported so the arrangement can be tested, and reused for any stacked-object
   * count — coins, bricks, jars.
   *
   * @returns {{items: Array<{x: number, y: number, row: number}>, rowsUsed: number,
   *   pileTop: number, overflow: number}} `x`/`y` are offsets from the pile's bottom-left.
   */
  function layout(count, opts) {
    const o = opts || {};
    const rowCap = o.rowCapacity || ROW_CAPACITY;
    const size = o.size == null ? 3 : o.size;
    const itemW = size * 4 + 2;
    const rowH = size * 3 - 1;
    const widest = Math.max(...rowCap) * itemW;

    const items = [];
    let placed = 0;
    let rowsUsed = 0;
    for (let r = 0; r < rowCap.length && placed < count; r++) {
      const n = Math.min(rowCap[r], count - placed);
      // Centred on the WIDEST row, not on this one — centring each row on itself makes the
      // stack shuffle sideways as it fills.
      const startX = (widest - rowCap[r] * itemW) / 2;
      for (let i = 0; i < n; i++) {
        // `-r * rowH` is -0 for the bottom row, which compares unequal to 0 under Object.is
        // and differs from the Qt port's plain 0. Caught by the cross-language layout guard.
        items.push({ x: startX + i * itemW, y: r === 0 ? 0 : -(r * rowH), row: r });
        placed++;
      }
      rowsUsed = r + 1;
    }

    return {
      items,
      rowsUsed,
      // Guard on > 1, not > 0: negating zero yields -0 in JS, which compares unequal to 0
      // under Object.is and differs from the Qt port. A single-row pile has zero height.
      pileTop: rowsUsed > 1 ? -((rowsUsed - 1) * rowH) : 0,
      overflow: Math.max(0, count - placed),
      width: widest,
    };
  }

  function mount(canvas, opts) {
    const o = opts || {};
    const sprite = global.UIPixelSprite;
    if (!sprite) throw new Error('UIAcornHoard.mount requires recipes/web/pixel-sprite.js to be loaded first');

    const size = o.size == null ? 3 : o.size;
    const spriteScale = o.spriteScale == null ? 3 : o.spriteScale;
    const pose = o.pose || 'smile';
    const name = o.name || 'The companion';
    const palette = o.palette || sprite.PALETTE;
    let count = o.count == null ? 14 : o.count;

    canvas.setAttribute('role', 'img');

    function paint() {
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const rows = sprite.POSES[pose];
      const spriteW = Math.max(...rows.map((r) => r.length)) * spriteScale;
      const spriteH = rows.length * spriteScale;
      const plan = layout(count, { size, rowCapacity: o.rowCapacity });

      const w = Math.max(spriteW, plan.width) + 16;
      const h = spriteH + Math.abs(plan.pileTop) + size * 3 + 18;

      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;

      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const baseY = h - size * 3 - 4;
      const baseX = (w - plan.width) / 2;
      plan.items.forEach((it) => {
        sprite.drawAcorn(ctx, baseX + it.x, baseY + it.y, size, palette);
      });

      // The character stands ON the pile — its feet follow the top row, so it rises as the
      // hoard grows. Positioning it at a fixed offset is what makes a hand-drawn version lie.
      const feet = baseY + plan.pileTop + 6;
      sprite.blit(ctx, rows, {
        palette,
        scale: spriteScale,
        ox: (w - spriteW) / 2,
        oy: feet - spriteH,
      });

      canvas.setAttribute(
        'aria-label',
        `${name} standing on a hoard of ${count} acorn${count === 1 ? '' : 's'}` +
          (plan.overflow > 0 ? `, of which ${plan.items.length} are shown` : ''),
      );
    }

    paint();

    return {
      set(next) {
        if (next != null && typeof next.count === 'number') count = next.count;
        paint();
      },
      get overflowing() { return layout(count, { size, rowCapacity: o.rowCapacity }).overflow > 0; },
      destroy() {},
    };
  }

  global.UIAcornHoard = { mount, layout, capacity, ROW_CAPACITY };

  if (global.UI) {
    global.UI.define({
      id: 'acorn-hoard',
      primitive: 'canvas',
      label: 'Acorn hoard',
      source: 'recipes/web/acorn-hoard.js',
      export: 'UIAcornHoard',
      dependsOn: ['pixel-sprite'],
      description:
        'A count drawn as a tapering pile of objects, with a character whose feet rise as the pile grows.',
      props: {
        count: {
          type: 'number', default: 14,
          controls: 'The number being shown, as acorns in a tapering pile; the character stands higher as it grows.',
          range: [0, 24], sweep: [0, 3, 7, 14, 24],
          breaks: { above: 'Past the rows\' total capacity (24) the pile is full and further count is not drawn: say the number in text.' },
          cost: 'none',
        },
        size: {
          type: 'number', default: 3,
          controls: 'Pixel scale of each acorn: how big the pile reads next to the character.',
          range: [1, 6], sweep: [1, 2, 3, 4, 6],
          cost: 'none',
        },
        spriteScale: {
          type: 'number', default: 3,
          controls: 'Pixel scale of the character on the pile.',
          range: [1, 6], sweep: [1, 2, 3, 4, 6],
          cost: 'none',
        },
        pose: {
          type: 'enum', values: ['smile', 'joy', 'neutral', 'worry'], default: 'smile',
          controls: 'The character\'s expression: how the count should feel (plenty, celebration, neutral, running low).',
          sweep: ['smile', 'joy', 'neutral', 'worry'],
          cost: 'none',
        },
      },
      snippet:
        "const hoard = UIAcornHoard.mount(canvasEl, {\n  count: 14,\n  pose: 'smile',\n  name: 'Peanut',\n});\n\nhoard.set({ count: 21 });\nif (hoard.overflowing) { /* say the number in text too */ }\n\n// Or just the arrangement, for any stacked-object count:\nconst plan = UIAcornHoard.layout(9, { size: 3 });",
      preview(container, props) {
        const p = props || {};
        const cv = document.createElement('canvas');
        cv.style.display = 'block';
        container.appendChild(cv);
        const h = mount(cv, {
          count: p.count, size: p.size, spriteScale: p.spriteScale, pose: p.pose, name: 'Peanut',
        });
        return { destroy() { h.destroy(); container.innerHTML = ''; } };
      },
      demo(container) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:20px;align-items:flex-end;flex-wrap:wrap';
        container.appendChild(row);
        const made = [];
        // The point of generating it: every value is honest, not three hand-drawn states.
        [0, 3, 9, 14, 24].forEach((count) => {
          const fig = document.createElement('figure');
          fig.style.cssText = 'margin:0;display:grid;justify-items:center;gap:4px';
          const cv = document.createElement('canvas');
          cv.style.display = 'block';
          fig.appendChild(cv);
          const cap = document.createElement('figcaption');
          cap.textContent = String(count);
          cap.style.cssText = 'font-size:0.78rem;color:#3d443d';
          fig.appendChild(cap);
          row.appendChild(fig);
          made.push(mount(cv, { count, name: 'Peanut' }));
        });
        return { destroy() { made.forEach((m) => m.destroy()); container.innerHTML = ''; } };
      },
    });
  }
})(window);
