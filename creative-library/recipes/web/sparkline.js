/**
 * Sparkline — a word-sized trend line with no axes, no grid and no legend.
 *
 * Tufte's point, and the reason this is a distinct recipe rather than a small chart: a
 * sparkline is typography, not a figure. It sits inline beside the number it qualifies, so it
 * must carry no chrome at all. Everything a chart would add — ticks, labels, a frame — makes
 * it a bad chart instead of a good sparkline.
 *
 * The technique is a linear map from data space to a viewBox, then a single <polyline>. The
 * viewBox does the scaling, so the same markup renders at 60px or 600px without recomputing
 * anything, and `vector-effect="non-scaling-stroke"` keeps the line one weight while it does.
 * That attribute is the part people miss when they retype this: without it a stretched
 * sparkline gets a stretched stroke and looks like a different chart at every size.
 *
 * Accessibility: a bare polyline announces nothing. This renders role="img" with an aria-label
 * stating the trend in words — first value, last value, direction — because a screen-reader
 * user needs the conclusion, not the pixels. If you have a real caption, pass `label` and say
 * something better than the default.
 *
 * Usage: container.innerHTML = UISparkline.render([3, 5, 4, 9, 7, 12], { width: 120 });
 * Requires recipes/web/registry.js loaded first.
 */
(function (global) {
  function extent(values) {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < values.length; i++) {
      if (values[i] < min) min = values[i];
      if (values[i] > max) max = values[i];
    }
    // A flat series has zero range; dividing by it would put every point at NaN. Give it a
    // band so it draws as the straight line it actually is.
    if (min === max) { min -= 1; max += 1; }
    return { min: min, max: max };
  }

  function describe(values) {
    const first = values[0];
    const last = values[values.length - 1];
    const dir = last > first ? 'rising' : last < first ? 'falling' : 'flat';
    return 'Trend, ' + dir + ': ' + first + ' to ' + last + ' over ' + values.length + ' points';
  }

  /**
   * @param {number[]} values
   * @param {object} [opts] width, height, strokeWidth, fill, showLast, label
   * @returns {string} a complete <svg> string.
   */
  function render(values, opts) {
    const o = opts || {};
    const data = (values || []).filter(function (v) { return typeof v === 'number' && isFinite(v); });
    if (data.length < 2) return '<svg width="0" height="0" aria-hidden="true"></svg>';

    const width = o.width == null ? 120 : o.width;
    const height = o.height == null ? 32 : o.height;
    const strokeWidth = o.strokeWidth == null ? 1.5 : o.strokeWidth;
    const fill = o.fill == null ? false : o.fill;
    const showLast = o.showLast == null ? true : o.showLast;
    const label = o.label || describe(data);

    // Inset by the stroke so the line's own width never clips at the edges of the viewBox.
    const pad = strokeWidth;
    const e = extent(data);
    const stepX = (width - pad * 2) / (data.length - 1);
    const scaleY = (height - pad * 2) / (e.max - e.min);

    const pts = data.map(function (v, i) {
      const x = pad + i * stepX;
      const y = height - pad - (v - e.min) * scaleY;
      return (Math.round(x * 100) / 100) + ',' + (Math.round(y * 100) / 100);
    });

    const last = pts[pts.length - 1].split(',');
    const area = fill
      ? '<polygon points="' + pad + ',' + (height - pad) + ' ' + pts.join(' ') + ' ' +
          (width - pad) + ',' + (height - pad) + '" fill="currentColor" opacity="0.14"/>'
      : '';

    return (
      '<svg width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '"' +
        ' role="img" aria-label="' + label + '" preserveAspectRatio="none"' +
        ' style="overflow:visible">' +
        area +
        '<polyline points="' + pts.join(' ') + '" fill="none" stroke="currentColor"' +
          ' stroke-width="' + strokeWidth + '" stroke-linecap="round" stroke-linejoin="round"' +
          ' vector-effect="non-scaling-stroke"/>' +
        (showLast
          ? '<circle cx="' + last[0] + '" cy="' + last[1] + '" r="' + (strokeWidth * 1.6) +
              '" fill="currentColor" vector-effect="non-scaling-stroke"/>'
          : '') +
      '</svg>'
    );
  }

  global.UISparkline = { render };

  if (global.UI) {
    const SAMPLE = [12, 15, 11, 18, 22, 19, 27, 24, 31, 29, 36, 41];

    global.UI.define({
      id: 'sparkline',
      primitive: 'svg',
      label: 'Sparkline',
      source: 'recipes/web/sparkline.js',
      export: 'UISparkline',
      description:
        'Word-sized trend line: no axes, no grid, no legend. Scales by viewBox with a non-scaling stroke.',
      props: {
        strokeWidth: {
          type: 'number', default: 1.5, unit: 'px',
          controls: 'Line weight. It stays the same at any size (non-scaling stroke).',
          range: [0.75, 3], sweep: [0.75, 1, 1.5, 2, 3],
          cost: 'none',
        },
        width: {
          type: 'number', default: 120, unit: 'px',
          controls: 'Length of the line: a word\'s worth beside the number it qualifies.',
          range: [60, 240], sweep: [60, 90, 120, 180, 240],
          cost: 'none',
        },
        height: {
          type: 'number', default: 32, unit: 'px',
          controls: 'Height: about one line of text, so it reads as typography rather than a chart.',
          range: [16, 64], sweep: [16, 24, 32, 48, 64],
          cost: 'none',
        },
        fill: {
          type: 'boolean', default: false,
          controls: 'Shades the area under the line, which reads as a quantity rather than a rate.',
          sweep: [false, true],
          cost: 'none',
        },
        showLast: {
          type: 'boolean', default: true,
          controls: 'A dot on the last value, which is usually the number the line sits next to.',
          sweep: [false, true],
          cost: 'none',
        },
      },
      signature: {
        within: 'svg',
        requires: ['polyline[vector-effect="non-scaling-stroke"]'],
        why: 'a non-scaling stroked polyline in a small viewBox is the sparkline construction',
      },
      snippet:
        "container.innerHTML = UISparkline.render(\n  [12, 15, 11, 18, 22, 19, 27],\n  { width: 120, height: 32, fill: true, label: 'Signups, rising 12 to 27' }\n);",
      preview(container, props) {
        const p = props || {};
        container.innerHTML =
          '<p style="display:flex;align-items:center;gap:0.6rem;margin:0;font-size:1.5rem;font-weight:600">' +
            '41' + render(SAMPLE, {
              width: p.width, height: p.height, strokeWidth: p.strokeWidth,
              fill: p.fill, showLast: p.showLast,
            }) +
          '</p>';
        return { destroy() { container.innerHTML = ''; } };
      },
      demo(container) {
        const stage = document.createElement('div');
        const controls = document.createElement('div');
        controls.className = 'ui-demo-controls';
        controls.innerHTML =
          '<button class="ui-demo-ctl" data-act="line" aria-pressed="true">Line</button>' +
          '<button class="ui-demo-ctl" data-act="area">Area</button>';

        function draw(mode) {
          // Inline beside the number it qualifies — the placement is half the recipe.
          stage.innerHTML =
            '<p style="display:flex;align-items:center;gap:0.6rem;margin:0;font-size:1.6rem;font-weight:600">' +
              '41' + render(SAMPLE, { width: 140, height: 36, fill: mode === 'area' }) +
            '</p>';
        }

        controls.addEventListener('click', function (e) {
          const act = e.target.dataset && e.target.dataset.act;
          if (!act) return;
          draw(act);
          controls.querySelectorAll('.ui-demo-ctl').forEach(function (b) {
            b.setAttribute('aria-pressed', b.dataset.act === act ? 'true' : 'false');
          });
        });

        container.appendChild(controls);
        container.appendChild(stage);
        draw('line');
        return { destroy() { stage.innerHTML = ''; } };
      },
    });
  }
})(window);
