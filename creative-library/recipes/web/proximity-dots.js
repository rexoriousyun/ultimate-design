/**
 * Proximity dots — a drifting field where each dot's radius is driven by its distance to
 * the pointer.
 *
 * The technique is the modulation, not the drift. Every dot carries a rest radius and grows
 * toward `maxRadius` while the pointer is within `range`, then relaxes back. What makes it
 * read as a material rather than as a hover state is that the growth is *rate-limited* — a
 * dot moves one `step` per frame toward its target — so a pointer flicked across the field
 * leaves a wake that catches up rather than a hard on/off ring. Setting the radius directly
 * from distance is the version people write first, and it snaps.
 *
 * Two things this fixes from the original pen, both of which are why a copied canvas effect
 * usually looks wrong in a real layout:
 *   - Sizing is per-container, not `window.innerWidth`. A recipe that measures the viewport
 *     cannot be put in a card.
 *   - The pointer is read in canvas space via getBoundingClientRect, not as a page coordinate,
 *     so the effect tracks correctly when the canvas is scrolled or offset.
 *
 * It is DPR-aware: the backing store is sized in device pixels while the CSS box stays in CSS
 * pixels, which is what keeps the dots crisp on a retina display.
 *
 * prefers-reduced-motion is honoured by not starting the loop. The composition still paints and
 * the pointer still works — a proximity response is a direct answer to input, not an ambient
 * animation — but nothing drifts on its own.
 *
 * Ported from https://codepen.io/rexoriousyun/pen/YezEyN
 *
 * Usage: const dots = UIProximityDots.mount(canvasEl, { count: 220, range: 80 });
 * Requires recipes/web/registry.js loaded first.
 */
(function (global) {
  // Seeded PRNG (mulberry32). The same seed paints the same image, so a composition can be
  // chosen, reproduced and checked; unseeded random() made every mount different, which
  // left nothing for a parameter sweep to measure against (PLAN.md phase 2).
  function seeded(seed) {
    let s = (seed | 0) || 1;
    return function () {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const REDUCED = function () {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  };

  function mount(canvas, opts) {
    const o = opts || {};
    const random = seeded(o.seed == null ? 1 : o.seed);
    const count = o.count == null ? 220 : o.count;
    const range = o.range == null ? 80 : o.range;
    const minRadius = o.minRadius == null ? 2 : o.minRadius;
    const maxRadius = o.maxRadius == null ? 22 : o.maxRadius;
    const speed = o.speed == null ? 0.5 : o.speed;
    const step = o.step == null ? 1 : o.step;
    const color = o.color || '#2f9e4f';

    const ctx = canvas.getContext('2d');
    const dots = [];
    const pointer = { x: null, y: null };
    let w = 1;
    let h = 1;
    let raf = null;
    let ro = null;

    function size() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      w = Math.max(1, rect.width);
      h = Math.max(1, rect.height);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function seed() {
      dots.length = 0;
      for (let i = 0; i < count; i++) {
        // Rest radius varies per dot so the field has texture before anything touches it.
        const rest = minRadius + random() * minRadius;
        dots.push({
          x: random() * w,
          y: random() * h,
          vx: (random() - 0.5) * speed * 2,
          vy: (random() - 0.5) * speed * 2,
          r: rest,
          rest: rest,
        });
      }
    }

    function advance() {
      for (let i = 0; i < dots.length; i++) {
        const d = dots[i];
        d.x += d.vx;
        d.y += d.vy;
        // Bounce off the edges. Wrapping would teleport a swollen dot across the field.
        if (d.x - d.r < 0 || d.x + d.r > w) d.vx *= -1;
        if (d.y - d.r < 0 || d.y + d.r > h) d.vy *= -1;
      }
    }

    /** The modulation, separated from the drift so it also runs under reduced motion. */
    function respond() {
      for (let i = 0; i < dots.length; i++) {
        const d = dots[i];
        const near =
          pointer.x !== null &&
          Math.abs(pointer.x - d.x) < range &&
          Math.abs(pointer.y - d.y) < range;
        // One step per frame toward the target, never a jump to it — this is the whole effect.
        if (near && d.r < maxRadius) d.r += step;
        else if (!near && d.r > d.rest) d.r -= step;
      }
    }

    function draw() {
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = color;
      for (let i = 0; i < dots.length; i++) {
        ctx.beginPath();
        ctx.arc(dots[i].x, dots[i].y, Math.max(0, dots[i].r), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function tick() {
      advance();
      respond();
      draw();
      raf = requestAnimationFrame(tick);
    }

    // Canvas space, not page space: the pen read event.x directly, which is only correct
    // when the canvas happens to start at the top-left of the document.
    function onPointerMove(e) {
      const rect = canvas.getBoundingClientRect();
      pointer.x = e.clientX - rect.left;
      pointer.y = e.clientY - rect.top;
      if (raf === null) { respond(); draw(); }
    }

    function onPointerLeave() {
      pointer.x = null;
      pointer.y = null;
      if (raf === null) { respond(); draw(); }
    }

    function onResize() {
      size();
      seed();
      if (raf === null) draw();
    }

    size();
    seed();

    if (REDUCED()) draw();
    else tick();

    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerleave', onPointerLeave);

    if (window.ResizeObserver) {
      ro = new ResizeObserver(onResize);
      ro.observe(canvas);
    } else {
      window.addEventListener('resize', onResize);
    }

    return {
      destroy: function () {
        if (raf !== null) cancelAnimationFrame(raf);
        raf = null;
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerleave', onPointerLeave);
        if (ro) ro.disconnect();
        else window.removeEventListener('resize', onResize);
      },
    };
  }

  global.UIProximityDots = { mount };

  if (global.UI) {
    global.UI.define({
      id: 'proximity-dots',
      primitive: 'canvas',
      label: 'Proximity dots',
      source: 'recipes/web/proximity-dots.js',
      export: 'UIProximityDots',
      description:
        'A drifting dot field where radius is driven by pointer distance, rate-limited so the response trails rather than snaps.',
      harvested_from: 'https://codepen.io/rexoriousyun/pen/YezEyN',
      props: {
        seed: {
          type: 'number', default: 1,
          controls: 'Where the dots start and their resting sizes. A different seed is a different field with the same density.',
          sweep: [1, 2, 3, 4],
          cost: 'none',
        },
        count: {
          type: 'number', default: 220,
          controls: 'How many dots: a sparse scatter or a dense surface.',
          range: [60, 400], sweep: [60, 120, 220, 320, 400],
          cost: 'linear per frame',
        },
        range: {
          type: 'number', default: 80, unit: 'px',
          controls: 'How far from the pointer dots respond: the size of the swell around the cursor.',
          range: [30, 200],
          unswept: 'responds only to a pointer; the sweep has none',
        },
        minRadius: {
          type: 'number', default: 2, unit: 'px',
          controls: 'Resting dot size, before the pointer comes near.',
          range: [1, 6], sweep: [1, 2, 3, 6],
          cost: 'none',
        },
        maxRadius: {
          type: 'number', default: 22, unit: 'px',
          controls: 'How big a dot grows under the pointer: a gentle swell or a bold bloom.',
          range: [6, 40],
          unswept: 'reached only near a pointer; the sweep has none',
        },
        speed: {
          type: 'number', default: 0.5,
          controls: 'Drift speed of the field.',
          range: [0, 2],
          unswept: 'motion: under reduced motion nothing drifts, as designed, so no still frame shows it',
        },
        step: {
          type: 'number', default: 1, unit: 'px/frame',
          controls: 'How fast a dot catches up with its target size: low leaves a slow wake behind the pointer, high snaps.',
          range: [0.2, 4],
          unswept: 'acts over frames while the pointer moves; the sweep has no pointer',
        },
      },
      snippet:
        "const dots = UIProximityDots.mount(canvasEl, {\n  count: 220,\n  range: 80,\n  maxRadius: 22,\n  color: 'var(--accent)',\n});\n\ndots.destroy();",
      preview(container, props) {
        const p = props || {};
        const canvas = document.createElement('canvas');
        // Decorative: carries no information a reader could be missing.
        canvas.setAttribute('aria-hidden', 'true');
        canvas.style.cssText = 'width:100%;height:240px;display:block;background:#0d1b12;border-radius:8px';
        container.appendChild(canvas);
        const dots = mount(canvas, {
          seed: p.seed,
          count: p.count, range: p.range, minRadius: p.minRadius,
          maxRadius: p.maxRadius, speed: p.speed, step: p.step,
        });
        return { destroy: dots.destroy };
      },
      demo(container) {
        const controls = document.createElement('div');
        controls.className = 'ui-demo-controls';
        controls.innerHTML =
          '<button class="ui-demo-ctl" data-range="40">Tight</button>' +
          '<button class="ui-demo-ctl" data-range="80" aria-pressed="true">Default</button>' +
          '<button class="ui-demo-ctl" data-range="160">Wide</button>';

        const canvas = document.createElement('canvas');
        canvas.setAttribute('aria-hidden', 'true');
        canvas.style.cssText = 'width:100%;height:240px;display:block;background:#0d1b12;border-radius:8px';

        container.appendChild(controls);
        container.appendChild(canvas);

        let dots = mount(canvas, { range: 80 });
        controls.addEventListener('click', function (e) {
          const range = e.target.dataset && e.target.dataset.range;
          if (!range) return;
          dots.destroy();
          dots = mount(canvas, { range: Number(range) });
          controls.querySelectorAll('.ui-demo-ctl').forEach(function (b) {
            b.setAttribute('aria-pressed', b.dataset.range === range ? 'true' : 'false');
          });
        });

        return { destroy: function () { dots.destroy(); } };
      },
    });
  }
})(window);
