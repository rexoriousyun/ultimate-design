/**
 * Constellation field — drifting points with a line drawn between any two that come close.
 *
 * The technique worth copying is the linking rule, not the drift. Every pair within `linkDist`
 * gets a segment whose alpha falls off with distance, so the mesh appears and dissolves on its
 * own as points wander. That single falloff is what makes it read as a field rather than as a
 * static graph, and it is the part people get wrong by using a hard on/off threshold, which
 * pops.
 *
 * Two costs are paid deliberately:
 *   - The pair loop is O(n²). At the counts this is good for (≤120) that is trivial, and a
 *     spatial grid would be more code than the effect is worth. Above ~300 points, do not
 *     scale this — reach for a different technique.
 *   - It is DPR-aware. Skipping that is why hand-rolled canvas effects look soft on a retina
 *     display: the backing store must be sized in device pixels while the CSS box stays in
 *     CSS pixels.
 *
 * prefers-reduced-motion is honoured by *not starting the loop* and painting one frame. That
 * is the right degradation for an ambient effect — the composition survives, the movement does
 * not. Freezing at a blank canvas, or ignoring the query, both fail this repo's own
 * `reduced-motion-respected` invariant, and a recipe that cannot pass the gate is not one
 * anybody should copy.
 *
 * Usage: const field = UIParticleField.mount(canvasEl, { count: 70 });
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
    const count = o.count == null ? 70 : o.count;
    const linkDist = o.linkDist == null ? 110 : o.linkDist;
    const speed = o.speed == null ? 0.35 : o.speed;
    const dotRadius = o.dotRadius == null ? 2 : o.dotRadius;
    const color = o.color || '#2f9e4f';

    const ctx = canvas.getContext('2d');
    const points = [];
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
      points.length = 0;
      for (let i = 0; i < count; i++) {
        points.push({
          x: random() * w,
          y: random() * h,
          vx: (random() - 0.5) * speed,
          vy: (random() - 0.5) * speed,
        });
      }
    }

    function step() {
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        p.x += p.vx;
        p.y += p.vy;
        // Bounce rather than wrap: a point teleporting across the canvas snaps every link it
        // was part of, which reads as a glitch.
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;
      }
    }

    function draw() {
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = color;
      ctx.fillStyle = color;

      for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
          const dx = points[i].x - points[j].x;
          const dy = points[i].y - points[j].y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d >= linkDist) continue;
          // Linear falloff — the whole effect. A hard threshold pops instead of dissolving.
          ctx.globalAlpha = (1 - d / linkDist) * 0.5;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(points[i].x, points[i].y);
          ctx.lineTo(points[j].x, points[j].y);
          ctx.stroke();
        }
      }

      ctx.globalAlpha = 0.9;
      for (let i = 0; i < points.length; i++) {
        ctx.beginPath();
        ctx.arc(points[i].x, points[i].y, dotRadius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    function tick() {
      step();
      draw();
      raf = requestAnimationFrame(tick);
    }

    size();
    seed();

    if (REDUCED()) {
      draw();
    } else {
      tick();
    }

    function onResize() {
      size();
      seed();
      if (raf === null) draw();
    }

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
        if (ro) ro.disconnect();
        else window.removeEventListener('resize', onResize);
      },
    };
  }

  global.UIParticleField = { mount };

  if (global.UI) {
    global.UI.define({
      id: 'particle-field',
      primitive: 'canvas',
      label: 'Particle field',
      source: 'recipes/web/particle-field.js',
      export: 'UIParticleField',
      description:
        'Drifting points linked by distance-faded lines. DPR-aware; paints one static frame under reduced motion.',
      props: {
        seed: {
          type: 'number', default: 1,
          controls: 'Where the points start. A different seed is a different constellation with the same density.',
          sweep: [1, 2, 3, 4],
          cost: 'none',
        },
        count: {
          type: 'number', default: 70,
          controls: 'How many points. The mesh gets denser fast, because links grow with the square of the count.',
          range: [20, 150], sweep: [20, 40, 70, 110, 150],
          breaks: { above: 'Above ~300 the pair loop (O(n²)) costs too much per frame; use another technique.' },
          cost: 'quadratic: every pair is tested each frame',
        },
        linkDist: {
          type: 'number', default: 110, unit: 'px',
          controls: 'How close two points must be to be linked: sparse dots at low values, a web at high.',
          range: [40, 200], sweep: [40, 70, 110, 150, 200],
          cost: 'none',
        },
        speed: {
          type: 'number', default: 0.35,
          controls: 'Drift speed: how restless the field feels.',
          range: [0.05, 1.5],
          unswept: 'motion: sets velocities only; under reduced motion one frame is painted, so no still frame shows it',
        },
        dotRadius: {
          type: 'number', default: 2, unit: 'px',
          controls: 'Point size: whether the points or the lines carry the image.',
          range: [1, 5], sweep: [1, 2, 3, 5],
          cost: 'none',
        },
      },
      snippet:
        "const field = UIParticleField.mount(canvasEl, {\n  count: 70,\n  linkDist: 110,\n  color: 'var(--accent)',\n});\n\nfield.destroy();",
      preview(container, props) {
        const p = props || {};
        const canvas = document.createElement('canvas');
        // Decorative: the field carries no information a reader could be missing.
        canvas.setAttribute('aria-hidden', 'true');
        canvas.style.cssText = 'width:100%;height:240px;display:block;background:#0d1b12;border-radius:8px';
        container.appendChild(canvas);
        const field = mount(canvas, {
          seed: p.seed,
          count: p.count, linkDist: p.linkDist, speed: p.speed, dotRadius: p.dotRadius,
        });
        return { destroy: field.destroy };
      },
      demo(container) {
        const controls = document.createElement('div');
        controls.className = 'ui-demo-controls';
        controls.innerHTML =
          '<button class="ui-demo-ctl" data-n="30">Sparse</button>' +
          '<button class="ui-demo-ctl" data-n="70" aria-pressed="true">Default</button>' +
          '<button class="ui-demo-ctl" data-n="120">Dense</button>';

        const canvas = document.createElement('canvas');
        canvas.setAttribute('aria-hidden', 'true');
        canvas.style.cssText = 'width:100%;height:240px;display:block;background:#0d1b12;border-radius:8px';

        container.appendChild(controls);
        container.appendChild(canvas);

        let field = mount(canvas, { count: 70 });
        controls.addEventListener('click', function (e) {
          const n = e.target.dataset && e.target.dataset.n;
          if (!n) return;
          field.destroy();
          field = mount(canvas, { count: Number(n) });
          controls.querySelectorAll('.ui-demo-ctl').forEach(function (b) {
            b.setAttribute('aria-pressed', b.dataset.n === n ? 'true' : 'false');
          });
        });

        return { destroy: function () { field.destroy(); } };
      },
    });
  }
})(window);
