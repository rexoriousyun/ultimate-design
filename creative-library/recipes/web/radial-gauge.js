/**
 * Radial gauge — a partial arc, unlike progress-ring's full circle.
 *
 * This one genuinely needs arc paths, because the track is a 270-degree sweep rather than a
 * closed circle, and that is where the bug lives: the large-arc-flag must be 1 once the sweep
 * exceeds 180 degrees. Getting it wrong produces a gauge that looks perfect up to half and
 * then inverts. `arcPath` below computes the flag rather than hardcoding it.
 *
 * Usage: container.innerHTML = UIRadialGauge.render({ value: 0.62 });
 * Requires recipes/web/registry.js loaded first.
 */
(function (global) {
  function polar(cx, cy, r, deg) {
    const rad = ((deg - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  function arcPath(cx, cy, r, startDeg, endDeg) {
    const a = polar(cx, cy, r, startDeg);
    const b = polar(cx, cy, r, endDeg);
    // The flag that hardcoding gets wrong: 1 once the sweep passes a half turn.
    const largeArc = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
    const sweep = endDeg > startDeg ? 1 : 0;
    return 'M ' + rnd(a.x) + ' ' + rnd(a.y) + ' A ' + r + ' ' + r + ' 0 ' + largeArc + ' ' + sweep + ' ' + rnd(b.x) + ' ' + rnd(b.y);
  }

  function rnd(n) { return Math.round(n * 100) / 100; }

  function render(opts) {
    const o = opts || {};
    const value = Math.max(0, Math.min(1, o.value == null ? 0.62 : o.value));
    const size = o.size == null ? 180 : o.size;
    const thickness = o.thickness == null ? 14 : o.thickness;
    const sweep = o.sweep == null ? 270 : o.sweep;
    const color = o.color || 'currentColor';
    const track = o.track || 'rgba(0,0,0,0.12)';

    const r = (size - thickness) / 2;
    const mid = size / 2;
    const start = -sweep / 2;
    const end = start + sweep * value;

    return (
      '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '"' +
      ' role="progressbar" aria-valuenow="' + Math.round(value * 100) + '" aria-valuemin="0"' +
      ' aria-valuemax="100" aria-label="' + (o.label || 'Gauge') + '">' +
      '<path d="' + arcPath(mid, mid, r, start, start + sweep) + '" fill="none" stroke="' + track + '"' +
        ' stroke-width="' + thickness + '" stroke-linecap="round"/>' +
      (value > 0
        ? '<path d="' + arcPath(mid, mid, r, start, end) + '" fill="none" stroke="' + color + '"' +
          ' stroke-width="' + thickness + '" stroke-linecap="round"/>'
        : '') +
      '<text x="' + mid + '" y="' + mid + '" text-anchor="middle" dominant-baseline="central"' +
        ' font-size="' + Math.round(size * 0.2) + '" font-weight="700" fill="currentColor"' +
        ' aria-hidden="true">' + Math.round(value * 100) + '</text>' +
      '</svg>'
    );
  }

  global.UIRadialGauge = { render, arcPath };

  if (global.UI) {
    global.UI.define({
      id: 'radial-gauge',
      primitive: 'svg',
      label: 'Radial gauge',
      source: 'recipes/web/radial-gauge.js',
      export: 'UIRadialGauge',
      description: 'Partial-sweep gauge from a real arc path, with the large-arc flag computed rather than guessed.',
      props: {
        value: {
          type: 'number', default: 0.62,
          controls: 'The reading, 0 to 1, as a share of the arc.',
          range: [0, 1], sweep: [0, 0.25, 0.5, 0.62, 1],
          cost: 'none',
        },
        size: {
          type: 'number', default: 180, unit: 'px',
          controls: 'Diameter of the gauge.',
          range: [100, 280], sweep: [100, 140, 180, 220, 280],
          cost: 'none',
        },
        thickness: {
          type: 'number', default: 14, unit: 'px',
          controls: 'Arc width.',
          range: [4, 32], sweep: [4, 8, 14, 22, 32],
          cost: 'none',
        },
        sweep: {
          type: 'number', default: 270, unit: 'deg',
          controls: 'How much of a circle the dial spans: 180 is a speedometer half, 270 the classic meter, near 360 a ring.',
          range: [120, 340], sweep: [120, 180, 220, 270, 340],
          cost: 'none',
        },
      },
      snippet:
        "container.innerHTML = UIRadialGauge.render({\n  value: 0.62,\n  sweep: 270,\n  label: 'Disk usage',\n});",
      preview(container, props) {
        const p = props || {};
        container.innerHTML = render({ value: p.value, size: p.size, thickness: p.thickness, sweep: p.sweep });
        return { destroy() { container.innerHTML = ''; } };
      },
      demo(container) {
        container.innerHTML =
          '<div style="display:flex;gap:1.25rem;align-items:center;flex-wrap:wrap">' +
          render({ value: 0.28, sweep: 270 }) +
          // Past a half turn — the case a hardcoded large-arc flag inverts.
          render({ value: 0.85, sweep: 270 }) +
          render({ value: 0.5, sweep: 180, size: 150 }) +
          '</div>';
        return { destroy() { container.innerHTML = ''; } };
      },
    });
  }
})(window);
