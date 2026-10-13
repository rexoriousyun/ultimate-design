/**
 * Donut chart built from stroked circles, not arc paths.
 *
 * The load-bearing trick: each segment is a full circle whose stroke-dasharray is
 * [segmentLength, circumference - segmentLength], rotated into place with dashoffset. No
 * A-command arc maths, no large-arc-flag bugs, and segments animate by interpolating one
 * number. Arc paths are the usual approach and the usual source of a wrong sweep at exactly
 * 180 degrees.
 *
 * Usage: container.innerHTML = UIDonutChart.render([{label:'A',value:5,color:'#14532d'}]);
 * Requires recipes/web/registry.js loaded first.
 */
(function (global) {
  const PALETTE = ['#14532d', '#2f9e4f', '#7cc496', '#c9d8c5', '#6b7280'];

  function render(data, opts) {
    const o = opts || {};
    const size = o.size == null ? 180 : o.size;
    const thickness = o.thickness == null ? 26 : o.thickness;
    const rows = (data || []).filter((d) => d && d.value > 0);
    const total = rows.reduce((sum, d) => sum + d.value, 0);
    if (total <= 0) return '<svg width="0" height="0" aria-hidden="true"></svg>';

    const r = (size - thickness) / 2;
    const c = 2 * Math.PI * r;
    const mid = size / 2;

    let offset = 0;
    const segments = rows
      .map((d, i) => {
        const len = (d.value / total) * c;
        const seg =
          '<circle cx="' + mid + '" cy="' + mid + '" r="' + r + '" fill="none"' +
          ' stroke="' + (d.color || PALETTE[i % PALETTE.length]) + '"' +
          ' stroke-width="' + thickness + '"' +
          ' stroke-dasharray="' + round(len) + ' ' + round(c - len) + '"' +
          ' stroke-dashoffset="' + round(-offset) + '"' +
          ' transform="rotate(-90 ' + mid + ' ' + mid + ')"><title>' +
          esc(d.label) + ': ' + d.value + '</title></circle>';
        offset += len;
        return seg;
      })
      .join('');

    // role="img" with a summary label: the <title> elements above are per-segment detail, but
    // a reader needs the whole before the parts.
    const summary = rows
      .map((d) => d.label + ' ' + Math.round((d.value / total) * 100) + '%')
      .join(', ');

    return (
      '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '"' +
      ' role="img" aria-label="' + esc(o.label || 'Breakdown: ' + summary) + '">' +
      segments +
      (o.centerLabel
        ? '<text x="' + mid + '" y="' + mid + '" text-anchor="middle" dominant-baseline="central"' +
          ' font-size="' + Math.round(size * 0.16) + '" font-weight="700" fill="currentColor"' +
          ' aria-hidden="true">' + esc(o.centerLabel) + '</text>'
        : '') +
      '</svg>'
    );
  }

  function round(n) { return Math.round(n * 100) / 100; }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }

  global.UIDonutChart = { render };

  if (global.UI) {
    const SAMPLE = [
      { label: 'Direct', value: 42 }, { label: 'Search', value: 28 },
      { label: 'Social', value: 18 }, { label: 'Email', value: 12 },
    ];
    global.UI.define({
      id: 'donut-chart',
      primitive: 'svg',
      label: 'Donut chart',
      source: 'recipes/web/donut-chart.js',
      export: 'UIDonutChart',
      description: 'Proportion ring assembled from dash-offset circles — no arc-path maths, no large-arc bugs.',
      props: {
        size: {
          type: 'number', default: 180, unit: 'px',
          controls: 'Diameter of the ring.',
          range: [100, 280], sweep: [100, 140, 180, 220, 280],
          cost: 'none',
        },
        thickness: {
          type: 'number', default: 26, unit: 'px',
          controls: 'Ring width: thin reads as a delicate gauge, thick as a solid share chart.',
          range: [8, 60], sweep: [8, 16, 26, 40, 60],
          breaks: { above: 'Near half the size the hole closes and it becomes a pie.' },
          cost: 'none',
        },
        centerLabel: {
          type: 'string', default: '100',
          controls: 'The figure in the hole: usually the total.',
          sweep: ['100', '2,450', ''],
          cost: 'none',
        },
      },
      snippet:
        "container.innerHTML = UIDonutChart.render(\n  [{ label: 'Direct', value: 42 }, { label: 'Search', value: 28 }],\n  { size: 180, thickness: 26, centerLabel: '70' }\n);",
      preview(container, props) {
        const p = props || {};
        container.innerHTML = render(SAMPLE, { size: p.size, thickness: p.thickness, centerLabel: p.centerLabel });
        return { destroy() { container.innerHTML = ''; } };
      },
      demo(container) {
        container.innerHTML =
          '<div style="display:flex;gap:1.5rem;align-items:center;flex-wrap:wrap">' +
          render(SAMPLE, { centerLabel: '100' }) +
          render(SAMPLE, { size: 130, thickness: 44 }) +
          render([{ label: 'Used', value: 78 }, { label: 'Free', value: 22, color: '#e5e7eb' }], { size: 110, thickness: 12, centerLabel: '78%' }) +
          '</div>';
        return { destroy() { container.innerHTML = ''; } };
      },
    });
  }
})(window);
