/**
 * Self-drawing stroke — a path that paints itself on, from dasharray/dashoffset.
 *
 * The trick: set stroke-dasharray to the path's own total length so the whole stroke is one
 * dash, then animate stroke-dashoffset from that length down to zero. The dash slides into
 * view and the line appears to be drawn. It works on any path, polyline or shape, and needs no
 * library.
 *
 * The measurement is the part that is actually hard, and the reason to copy this rather than
 * retype it: the length must come from `getTotalLength()` on the live element, because a
 * guessed dasharray leaves either a gap that never closes or a stroke that finishes early. But
 * getTotalLength() only answers correctly once the element is in the document and laid out —
 * calling it on a detached node returns 0 in some engines, which silently produces no
 * animation at all. So this mounts first, measures second, animates third.
 *
 * Under prefers-reduced-motion the path is rendered complete and static — dasharray never
 * applied. The information (the shape) is fully preserved; only the reveal is dropped, which
 * is the correct degradation for a purely decorative reveal and what
 * `reduced-motion-respected` requires.
 *
 * Usage: const drawing = UIPathDraw.mount(container, { d: 'M10 80 Q 95 10 180 80' });
 * Requires recipes/web/registry.js loaded first.
 */
(function (global) {
  const REDUCED = function () {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  };

  const SVG_NS = 'http://www.w3.org/2000/svg';

  /**
   * @param {Element} container
   * @param {object} [opts] d, viewBox, duration, strokeWidth, easing, loop, label
   */
  function mount(container, opts) {
    const o = opts || {};
    const d = o.d || 'M12 96 C 46 8, 110 8, 148 96 S 240 180, 292 96';
    const viewBox = o.viewBox || '0 0 300 190';
    const duration = o.duration == null ? 1600 : o.duration;
    const strokeWidth = o.strokeWidth == null ? 4 : o.strokeWidth;
    const easing = o.easing || 'cubic-bezier(0.65, 0, 0.35, 1)';
    const loop = o.loop == null ? true : o.loop;

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', viewBox);
    svg.setAttribute('width', '100%');
    // A decorative flourish. If the shape carries meaning, drop aria-hidden and give the svg
    // role="img" plus an aria-label saying what it depicts.
    svg.setAttribute('aria-hidden', 'true');
    svg.style.display = 'block';

    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', o.color || 'currentColor');
    path.setAttribute('stroke-width', String(strokeWidth));
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
    container.appendChild(svg);

    let timer = null;

    // Must run AFTER the append above — getTotalLength() on a detached path is unreliable.
    const length = path.getTotalLength();

    function play() {
      path.style.transition = 'none';
      path.style.strokeDasharray = length + ' ' + length;
      path.style.strokeDashoffset = String(length);
      // Read a layout property to force the browser to commit the offset above before the
      // transition is attached; without this the two style writes coalesce and nothing moves.
      void path.getBoundingClientRect();
      path.style.transition = 'stroke-dashoffset ' + duration + 'ms ' + easing;
      path.style.strokeDashoffset = '0';
    }

    if (REDUCED()) {
      // Complete and still. No dasharray at all, so there is nothing to animate.
      path.style.strokeDasharray = 'none';
    } else {
      play();
      if (loop) timer = setInterval(play, duration + 700);
    }

    return {
      replay: function () { if (!REDUCED()) play(); },
      destroy: function () {
        if (timer !== null) clearInterval(timer);
        timer = null;
        if (svg.parentNode) svg.parentNode.removeChild(svg);
      },
    };
  }

  global.UIPathDraw = { mount };

  if (global.UI) {
    const SHAPES = {
      wave: 'M12 96 C 46 8, 110 8, 148 96 S 240 180, 292 96',
      check: 'M40 100 L 120 165 L 262 30',
      signature: 'M20 130 C 60 40, 90 170, 130 90 S 190 20, 220 110 S 262 150, 288 60',
    };

    global.UI.define({
      id: 'path-draw',
      primitive: 'svg',
      label: 'Path draw-on',
      source: 'recipes/web/path-draw.js',
      export: 'UIPathDraw',
      description:
        'A stroke that paints itself on, measured with getTotalLength(). Renders complete and static under reduced motion.',
      props: {
        shape: {
          type: 'enum', values: ['wave', 'check', 'signature'], default: 'wave',
          controls: 'Which path draws itself. Any path works; these show a flourish, a confirmation tick and a signature.',
          sweep: ['wave', 'check', 'signature'],
          cost: 'none',
        },
        duration: {
          type: 'number', default: 1600, unit: 'ms',
          controls: 'How long the stroke takes to draw: quick reads as a flourish, slow as handwriting.',
          range: [400, 4000],
          unswept: 'motion: under reduced motion the path is drawn complete at once, as designed, so no still frame shows it',
        },
        strokeWidth: {
          type: 'number', default: 4, unit: 'px',
          controls: 'Line weight of the drawn stroke.',
          range: [1, 10], sweep: [1, 2, 4, 6, 10],
          cost: 'none',
        },
        loop: {
          type: 'boolean', default: true,
          controls: 'Whether the drawing repeats or draws once and stays.',
          unswept: 'motion: under reduced motion nothing animates, so no still frame shows it',
        },
      },
      signature: {
        within: 'svg',
        requires: ['path[stroke-dasharray][stroke-dashoffset]'],
        why: 'a path whose dasharray equals its own length is the draw-on recipe',
      },
      snippet:
        "const drawing = UIPathDraw.mount(container, {\n  d: 'M40 100 L 120 165 L 262 30',\n  duration: 1600,\n  loop: false,\n});\n\ndrawing.replay();\ndrawing.destroy();",
      preview(container, props) {
        const p = props || {};
        const drawing = mount(container, {
          d: SHAPES[p.shape] || SHAPES.wave,
          duration: p.duration,
          strokeWidth: p.strokeWidth,
          loop: p.loop,
        });
        return { destroy: drawing.destroy };
      },
      demo(container) {
        const controls = document.createElement('div');
        controls.className = 'ui-demo-controls';
        controls.innerHTML = Object.keys(SHAPES)
          .map(function (k, i) {
            return '<button class="ui-demo-ctl" data-shape="' + k + '" aria-pressed="' + (i === 0) + '">' + k + '</button>';
          })
          .join('');

        const stage = document.createElement('div');
        container.appendChild(controls);
        container.appendChild(stage);

        let drawing = mount(stage, { d: SHAPES.wave });
        controls.addEventListener('click', function (e) {
          const shape = e.target.dataset && e.target.dataset.shape;
          if (!shape) return;
          drawing.destroy();
          drawing = mount(stage, { d: SHAPES[shape] });
          controls.querySelectorAll('.ui-demo-ctl').forEach(function (b) {
            b.setAttribute('aria-pressed', b.dataset.shape === shape ? 'true' : 'false');
          });
        });

        return { destroy: function () { drawing.destroy(); } };
      },
    });
  }
})(window);
