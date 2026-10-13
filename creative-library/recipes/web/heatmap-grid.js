/**
 * Contribution-graph heatmap — a grid of cells shaded by magnitude.
 *
 * The part worth copying is the colour step, not the grid. A continuous scale looks precise
 * and cannot be read: nobody distinguishes 40% green from 45% green by eye. Quantising to a
 * small number of steps (five here) makes the legend finite and the cells comparable, which is
 * the entire job of the chart.
 *
 * Each cell carries a <title>, so hovering names the value, and the whole grid announces as
 * one image with a summary. Per-cell announcement of a 365-cell grid is not navigation, it is
 * a hostage situation — so the detail lives in the tooltip and the summary carries the shape.
 *
 * Static, so no reduced-motion branch.
 *
 * Usage: container.innerHTML = UIHeatmapGrid.render(values, { columns: 26 });
 * Requires recipes/web/registry.js loaded first.
 */
(function (global) {
  const STEPS = ['#ebedf0', '#c6e5cd', '#7cc496', '#3f9b5f', '#14532d'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  }

  /**
   * @param {number[]} values
   * @param {object} [opts] columns, cell, gap, radius, steps, label
   */
  function render(values, opts) {
    const o = opts || {};
    const data = (values || []).map((v) => (typeof v === 'number' && isFinite(v) ? v : 0));
    if (data.length === 0) return '<p>No data.</p>';

    const columns = Math.max(1, o.columns == null ? 26 : o.columns);
    const cell = o.cell == null ? 13 : o.cell;
    const gap = o.gap == null ? 3 : o.gap;
    const radius = o.radius == null ? 2 : o.radius;
    const steps = o.steps || STEPS;
    const max = Math.max(...data) || 1;

    const rows = Math.ceil(data.length / columns);
    const width = columns * (cell + gap) - gap;
    const height = rows * (cell + gap) - gap;

    const cells = data
      .map((v, i) => {
        const col = i % columns;
        const row = Math.floor(i / columns);
        // Quantised, not continuous. A finite legend is the point.
        const band = v === 0 ? 0 : Math.min(steps.length - 1, Math.ceil((v / max) * (steps.length - 1)));
        return (
          `<rect x="${col * (cell + gap)}" y="${row * (cell + gap)}" width="${cell}" height="${cell}"` +
          ` rx="${radius}" fill="${steps[band]}"><title>${v}</title></rect>`
        );
      })
      .join('');

    const total = data.reduce((a, b) => a + b, 0);
    const label = o.label || `Activity heatmap, ${data.length} cells, ${total} total, peak ${max}`;

    return (
      `<svg width="100%" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}"` +
      ` style="max-width:${width}px;display:block">${cells}</svg>`
    );
  }

  /** The legend that makes a quantised scale readable. */
  function legend(opts) {
    const o = opts || {};
    const steps = o.steps || STEPS;
    const cell = o.cell == null ? 13 : o.cell;
    const swatches = steps
      .map((c, i) => `<rect x="${i * (cell + 3)}" y="0" width="${cell}" height="${cell}" rx="2" fill="${c}"/>`)
      .join('');
    const w = steps.length * (cell + 3) - 3;
    return (
      '<span style="display:inline-flex;align-items:center;gap:6px;font-size:0.8rem;color:#4b5563">' +
      'Less' +
      `<svg width="${w}" height="${cell}" viewBox="0 0 ${w} ${cell}" aria-hidden="true">${swatches}</svg>` +
      'More</span>'
    );
  }

  global.UIHeatmapGrid = { render, legend, STEPS: STEPS };

  if (global.UI) {
    function sample(n, seed) {
      let s = seed || 5;
      const out = [];
      for (let i = 0; i < n; i++) {
        s = (s * 1664525 + 1013904223) % 4294967296;
        const r = s / 4294967296;
        out.push(r < 0.28 ? 0 : Math.round(r * 11));
      }
      return out;
    }

    global.UI.define({
      id: 'heatmap-grid',
      primitive: 'svg',
      label: 'Heatmap grid',
      source: 'recipes/web/heatmap-grid.js',
      export: 'UIHeatmapGrid',
      description: 'Contribution-style grid with a quantised colour scale and a matching legend — five readable steps, not a continuous ramp.',
      props: {
        columns: {
          type: 'number', default: 26,
          controls: 'Columns of the grid (weeks, in a contribution graph): the time span shown.',
          range: [8, 52], sweep: [8, 16, 26, 40, 52],
          cost: 'linear in cells',
        },
        cell: {
          type: 'number', default: 13, unit: 'px',
          controls: 'Cell size: how much each value reads as a tile versus a dot.',
          range: [6, 20], sweep: [6, 9, 13, 16, 20],
          cost: 'none',
        },
        gap: {
          type: 'number', default: 3, unit: 'px',
          controls: 'Space between cells. Tight reads as a texture, wide as separate days.',
          range: [0, 6], sweep: [0, 1, 3, 4, 6],
          cost: 'none',
        },
        radius: {
          type: 'number', default: 2, unit: 'px',
          controls: 'Cell corner rounding: square and technical at 0, soft and friendly near half the cell.',
          range: [0, 6], sweep: [0, 2, 4, 6],
          cost: 'none',
        },
      },
      snippet:
        "container.innerHTML =\n  UIHeatmapGrid.render(dailyCounts, { columns: 26 }) +\n  UIHeatmapGrid.legend();",
      preview(container, props) {
        const p = props || {};
        container.innerHTML =
          render(sample(182), { columns: p.columns, cell: p.cell, gap: p.gap, radius: p.radius }) +
          '<div style="margin-top:0.6rem">' + legend({ cell: p.cell }) + '</div>';
        return { destroy() { container.innerHTML = ''; } };
      },
      demo(container) {
        container.innerHTML =
          render(sample(182), { columns: 26 }) +
          '<div style="margin-top:0.6rem">' + legend() + '</div>';
        return { destroy() { container.innerHTML = ''; } };
      },
    });
  }
})(window);
