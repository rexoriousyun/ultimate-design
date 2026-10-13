/**
 * Circular determinate progress — a stroked SVG circle whose dash pattern is the value.
 *
 * The whole technique is two lines of arithmetic: set stroke-dasharray to the full
 * circumference, then set stroke-dashoffset to the part that should stay unpainted. There is
 * no arc maths and no path building, which is why this beats hand-rolling an arc with
 * A-commands every time — a stroked circle also gets round caps and animates for free.
 *
 * Accessibility is not optional here and is the reason this exists as a recipe rather than as
 * five lines someone retypes: an unlabelled ring is a decorative doughnut to a screen reader.
 * It renders as role="progressbar" carrying aria-valuenow/min/max, so the value is available
 * without reading the drawing. The visible centre label is aria-hidden — the role already
 * announces the number, and letting both through reads it twice.
 *
 * Usage: container.innerHTML = UIProgressRing.render({ value: 62 });
 * Requires recipes/web/registry.js loaded first.
 */
(function (global) {
  /**
   * @param {object} [opts] value (0-100), size, thickness, label, showValue, color, track
   * @returns {string} a complete <svg> string.
   */
  function render(opts) {
    const o = opts || {};
    const value = Math.max(0, Math.min(100, o.value == null ? 0 : o.value));
    const size = o.size == null ? 120 : o.size;
    const thickness = o.thickness == null ? 10 : o.thickness;
    const color = o.color || 'currentColor';
    const track = o.track || 'rgba(0,0,0,0.12)';
    const showValue = o.showValue == null ? true : o.showValue;
    const label = o.label || 'Progress';

    const r = (size - thickness) / 2;
    const c = 2 * Math.PI * r;
    // The unpainted remainder. Rounded so the attribute is stable across re-renders rather
    // than churning through 14 decimal places.
    const offset = Math.round((c * (1 - value / 100)) * 100) / 100;
    const mid = size / 2;

    return (
      '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '"' +
        ' role="progressbar" aria-valuenow="' + value + '" aria-valuemin="0" aria-valuemax="100"' +
        ' aria-label="' + label + '">' +
        '<circle cx="' + mid + '" cy="' + mid + '" r="' + r + '" fill="none"' +
          ' stroke="' + track + '" stroke-width="' + thickness + '"/>' +
        // -90deg so 0% starts at twelve o'clock, which is the only place a reader looks for it.
        '<circle cx="' + mid + '" cy="' + mid + '" r="' + r + '" fill="none"' +
          ' stroke="' + color + '" stroke-width="' + thickness + '" stroke-linecap="round"' +
          ' stroke-dasharray="' + Math.round(c * 100) / 100 + '"' +
          ' stroke-dashoffset="' + offset + '"' +
          ' transform="rotate(-90 ' + mid + ' ' + mid + ')"/>' +
        (showValue
          ? '<text x="' + mid + '" y="' + mid + '" text-anchor="middle" dominant-baseline="central"' +
              ' font-size="' + Math.round(size * 0.22) + '" font-weight="600" fill="currentColor"' +
              ' aria-hidden="true">' + value + '%</text>'
          : '') +
      '</svg>'
    );
  }

  global.UIProgressRing = { render };

  if (global.UI) {
    global.UI.define({
      id: 'progress-ring',
      primitive: 'svg',
      label: 'Progress ring',
      source: 'recipes/web/progress-ring.js',
      export: 'UIProgressRing',
      description:
        'Determinate circular progress from one stroked circle and a dash offset. Announces as a progressbar.',
      props: {
        value: {
          type: 'number', default: 62, unit: '%',
          controls: 'The progress, 0 to 100: how much of the ring is filled.',
          range: [0, 100], sweep: [0, 25, 62, 90, 100],
          cost: 'none',
        },
        size: {
          type: 'number', default: 120, unit: 'px',
          controls: 'Diameter of the ring.',
          range: [48, 200], sweep: [48, 80, 120, 160, 200],
          cost: 'none',
        },
        thickness: {
          type: 'number', default: 10, unit: 'px',
          controls: 'Stroke width: thin is a delicate indicator, thick a bold status.',
          range: [3, 24], sweep: [3, 6, 10, 16, 24],
          cost: 'none',
        },
        showValue: {
          type: 'boolean', default: true,
          controls: 'Whether the number sits in the middle. The value is announced either way.',
          sweep: [false, true],
          cost: 'none',
        },
      },
      signature: {
        within: 'svg',
        requires: ['circle[stroke-dasharray][stroke-dashoffset]'],
        why: 'a dash-offset circle is the ring recipe itself, however the arc got there',
      },
      snippet:
        "container.innerHTML = UIProgressRing.render({\n  value: 62,\n  size: 120,\n  label: 'Upload progress',\n});",
      preview(container, props) {
        const p = props || {};
        container.innerHTML = render({
          value: p.value, size: p.size, thickness: p.thickness, showValue: p.showValue,
        });
        return { destroy() { container.innerHTML = ''; } };
      },
      demo(container) {
        const stage = document.createElement('div');
        const controls = document.createElement('div');
        controls.className = 'ui-demo-controls';
        controls.innerHTML =
          '<button class="ui-demo-ctl" data-v="0">0%</button>' +
          '<button class="ui-demo-ctl" data-v="35">35%</button>' +
          '<button class="ui-demo-ctl" data-v="62" aria-pressed="true">62%</button>' +
          '<button class="ui-demo-ctl" data-v="100">100%</button>';

        function draw(v) {
          stage.innerHTML = render({ value: v, label: 'Upload progress' });
        }

        controls.addEventListener('click', function (e) {
          const v = e.target.dataset && e.target.dataset.v;
          if (!v) return;
          draw(Number(v));
          controls.querySelectorAll('.ui-demo-ctl').forEach(function (b) {
            b.setAttribute('aria-pressed', b.dataset.v === v ? 'true' : 'false');
          });
        });

        container.appendChild(controls);
        container.appendChild(stage);
        draw(62);
        return { destroy() { stage.innerHTML = ''; } };
      },
    });
  }
})(window);
