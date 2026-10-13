/**
 * Wave section divider — a generated sine path, not a fixed asset.
 *
 * The reason to generate rather than paste a stock path: amplitude and frequency become props,
 * so the same divider adapts to a tight card and a full-bleed section without a second file.
 * `preserveAspectRatio="none"` is what lets it stretch to any width; without it the wave keeps
 * its aspect and leaves gaps at the edges, which is the usual complaint about copied dividers.
 *
 * Decorative by definition, so aria-hidden.
 *
 * Usage: container.innerHTML = UIWaveDivider.render({ amplitude: 18 });
 * Requires recipes/web/registry.js loaded first.
 */
(function (global) {
  function render(opts) {
    const o = opts || {};
    const width = o.width == null ? 1200 : o.width;
    const height = o.height == null ? 90 : o.height;
    const amplitude = o.amplitude == null ? 18 : o.amplitude;
    const cycles = o.cycles == null ? 2 : o.cycles;
    const phase = o.phase == null ? 0 : o.phase;
    const fill = o.fill || 'currentColor';
    const flip = !!o.flip;

    const mid = height / 2;
    const steps = Math.max(24, cycles * 24);
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = t * width;
      const y = mid + Math.sin(t * cycles * Math.PI * 2 + phase) * amplitude;
      pts.push(Math.round(x * 10) / 10 + ' ' + Math.round(y * 10) / 10);
    }

    const d =
      'M 0 ' + (flip ? 0 : height) + ' L ' + pts.join(' L ') +
      ' L ' + width + ' ' + (flip ? 0 : height) + ' Z';

    return (
      '<svg viewBox="0 0 ' + width + ' ' + height + '" width="100%" height="' + height + '"' +
      ' preserveAspectRatio="none" aria-hidden="true" focusable="false" style="display:block">' +
      '<path d="' + d + '" fill="' + fill + '"/>' +
      '</svg>'
    );
  }

  global.UIWaveDivider = { render };

  if (global.UI) {
    global.UI.define({
      id: 'wave-divider',
      primitive: 'svg',
      label: 'Wave divider',
      source: 'recipes/web/wave-divider.js',
      export: 'UIWaveDivider',
      description: 'Section divider from a generated sine path; stretches to any width via preserveAspectRatio="none".',
      props: {
        amplitude: {
          type: 'number', default: 18, unit: 'px',
          controls: 'Wave height: a gentle ripple or a bold swell between sections.',
          range: [0, 40], sweep: [0, 9, 18, 28, 40],
          cost: 'none',
        },
        cycles: {
          type: 'number', default: 2,
          controls: 'How many waves span the width: one lazy curve or a busy ripple.',
          range: [0.5, 6], sweep: [0.5, 1, 2, 3, 6],
          cost: 'none',
        },
        height: {
          type: 'number', default: 90, unit: 'px',
          controls: 'Height of the divider band.',
          range: [40, 160], sweep: [40, 70, 90, 120, 160],
          cost: 'none',
        },
        flip: {
          type: 'boolean', default: false,
          controls: 'Turn the wave upside down, for the bottom edge of a section rather than the top.',
          sweep: [false, true],
          cost: 'none',
        },
      },
      snippet:
        "container.innerHTML = UIWaveDivider.render({\n  amplitude: 18,\n  cycles: 2,\n  fill: 'var(--surface-alt)',\n});",
      preview(container, props) {
        const p = props || {};
        container.innerHTML =
          '<div style="color:#2f9e4f">' +
          render({ amplitude: p.amplitude, cycles: p.cycles, height: p.height, flip: p.flip }) +
          '</div>';
        return { destroy() { container.innerHTML = ''; } };
      },
      demo(container) {
        container.innerHTML =
          '<div style="background:#14532d;color:#ffffff;padding:1rem 1rem 0">' +
          '<p style="margin:0 0 0.5rem">Section above</p></div>' +
          '<div style="color:#14532d">' + render({ amplitude: 14, cycles: 2 }) + '</div>' +
          '<div style="color:#2f9e4f">' + render({ amplitude: 26, cycles: 4, height: 70, flip: true }) + '</div>';
        return { destroy() { container.innerHTML = ''; } };
      },
    });
  }
})(window);
