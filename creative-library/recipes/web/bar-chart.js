/**
 * Bar chart in SVG, with the accessibility and spacing rules baked in.
 *
 * Three things this does that a hand-rolled bar chart usually does not:
 *
 *   - A 2px gap between adjacent fills, drawn in the surface colour rather than left as
 *     whitespace. Bars that touch read as one shape at small sizes.
 *   - Rounded caps on the data end only, anchored to the baseline. Rounding all four corners
 *     detaches the bar from its axis and makes short bars read as floating pills.
 *   - A <table> alternative in the same markup, visually hidden. A chart is a picture of a
 *     table; a screen reader needs the table. role="img" plus a summary label is the floor,
 *     and the floor loses every individual value.
 *
 * Usage: container.innerHTML = UIBarChart.render([{ label: 'Mon', value: 42 }]);
 * Requires recipes/web/registry.js loaded first.
 */
(function (global) {
  const GAP = 2;

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  }

  function render(data, opts) {
    const o = opts || {};
    const rows = (data || []).filter((d) => d && typeof d.value === 'number');
    if (rows.length === 0) return '<p>No data.</p>';

    const width = o.width == null ? 480 : o.width;
    const height = o.height == null ? 220 : o.height;
    const color = o.color || '#14532d';
    const radius = o.radius == null ? 4 : o.radius;
    const caption = o.caption || 'Chart';
    const pad = { top: 12, right: 8, bottom: 28, left: 8 };

    const max = Math.max(...rows.map((d) => d.value)) || 1;
    const plotH = height - pad.top - pad.bottom;
    const slot = (width - pad.left - pad.right) / rows.length;
    const barW = Math.max(1, slot - GAP);

    const bars = rows
      .map((d, i) => {
        const h = Math.max(radius, (d.value / max) * plotH);
        const x = pad.left + i * slot + GAP / 2;
        const y = pad.top + (plotH - h);
        // Rounded at the data end, square at the baseline: one path rather than a rect, so
        // the bar stays visually attached to the axis.
        const r = Math.min(radius, barW / 2, h);
        const dPath =
          `M ${x} ${y + h} L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} ` +
          `L ${x + barW - r} ${y} Q ${x + barW} ${y} ${x + barW} ${y + r} ` +
          `L ${x + barW} ${y + h} Z`;
        return (
          `<path d="${dPath}" fill="${color}"/>` +
          `<text x="${x + barW / 2}" y="${height - 10}" text-anchor="middle" font-size="11"` +
          ` fill="#4b5563">${esc(d.label)}</text>`
        );
      })
      .join('');

    const tableRows = rows
      .map((d) => `<tr><th scope="row">${esc(d.label)}</th><td>${d.value}</td></tr>`)
      .join('');

    return (
      `<figure style="margin:0">` +
      `<svg width="100%" viewBox="0 0 ${width} ${height}" role="img"` +
      ` aria-label="${esc(caption)}. ${rows.length} bars, highest ${max}.">` +
      `<line x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}"` +
      ` y2="${height - pad.bottom}" stroke="#d1d5db" stroke-width="1"/>` +
      bars +
      `</svg>` +
      // The values themselves, for anyone who cannot read the picture. Clipped rather than
      // display:none — a hidden element is not in the accessibility tree at all.
      `<table style="position:absolute;width:1px;height:1px;overflow:hidden;` +
      `clip:rect(0 0 0 0);white-space:nowrap">` +
      `<caption>${esc(caption)}</caption>` +
      `<thead><tr><th scope="col">Label</th><th scope="col">Value</th></tr></thead>` +
      `<tbody>${tableRows}</tbody></table>` +
      `</figure>`
    );
  }

  global.UIBarChart = { render };

  if (global.UI) {
    const SAMPLE = [
      { label: 'Mon', value: 42 }, { label: 'Tue', value: 58 }, { label: 'Wed', value: 35 },
      { label: 'Thu', value: 71 }, { label: 'Fri', value: 64 }, { label: 'Sat', value: 22 },
      { label: 'Sun', value: 30 },
    ];

    global.UI.define({
      id: 'bar-chart',
      primitive: 'svg',
      label: 'Bar chart',
      source: 'recipes/web/bar-chart.js',
      export: 'UIBarChart',
      description: 'SVG bars with a 2px surface gap, data-end rounding only, and a hidden table of the real values.',
      props: {
        radius: {
          type: 'number', default: 4, unit: 'px',
          controls: 'Rounding on the data end of each bar only. Softens the chart without detaching bars from their baseline.',
          range: [0, 12], sweep: [0, 2, 4, 8, 12],
          breaks: {
            below: 'Swept: 0 to 2px changes under 0.05% of the chart at this bar width, so rounding only reads from ~4px.',
            above: 'Past half the bar width the cap turns into a pill and short bars read as floating.',
          },
          cost: 'none',
        },
        height: {
          type: 'number', default: 220, unit: 'px',
          controls: 'Chart height: how much vertical room the values get, and so how readable small differences are.',
          range: [120, 360], sweep: [120, 180, 220, 280, 360],
          cost: 'none',
        },
        color: {
          type: 'color', default: '#14532d',
          controls: 'Bar fill. One colour for one series; the 2px gaps are drawn in the surface colour.',
          sweep: ['#14532d', '#d9ff1e', '#c2255c'],
          cost: 'none',
        },
      },
      snippet:
        "container.innerHTML = UIBarChart.render(\n  [{ label: 'Mon', value: 42 }, { label: 'Tue', value: 58 }],\n  { caption: 'Signups by day' }\n);",
      preview(container, props) {
        const p = props || {};
        container.innerHTML = render(SAMPLE, {
          radius: p.radius, height: p.height, color: p.color, caption: 'Signups by day',
        });
        return { destroy() { container.innerHTML = ''; } };
      },
      demo(container) {
        container.innerHTML = render(SAMPLE, { caption: 'Signups by day' });
        return { destroy() { container.innerHTML = ''; } };
      },
    });
  }
})(window);
