/**
 * Flow field — particles steered by a smooth noise-derived angle grid.
 *
 * The technique: precompute a grid of angles from value noise, then each particle reads the
 * angle at its cell and moves along it. Sampling noise per particle per frame instead is the
 * naive version and costs an order of magnitude more for a visually identical result — the
 * grid is the optimisation and the reason this is a recipe.
 *
 * Trails come from painting a translucent rectangle over the previous frame rather than
 * clearing it. `globalAlpha` on a clear does not work (clearRect ignores alpha); it has to be
 * a fill with a low-alpha colour, and that colour must match the background or the field
 * slowly tints.
 *
 * Under prefers-reduced-motion it renders a fixed number of steps in one pass and stops, so
 * the composition — which is the content — survives without any movement.
 *
 * Usage: const f = UIFlowField.mount(canvasEl, { particles: 900 });
 * Requires recipes/web/registry.js loaded first.
 */
(function (global) {
  const REDUCED = function () {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  };

  function rng(seed) {
    let s = (seed | 0) || 1;
    return function () { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  }

  /** Value noise: a coarse random lattice, smoothly interpolated. Cheap and good enough. */
  function noiseGrid(cols, rows, seed, scale) {
    const rand = rng(seed);
    const lattice = [];
    for (let i = 0; i < (cols + 2) * (rows + 2); i++) lattice.push(rand());
    const at = (x, y) => lattice[(y + 1) * (cols + 2) + (x + 1)];
    const smooth = (t) => t * t * (3 - 2 * t);

    const angles = new Float32Array(cols * rows);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const fx = (x / scale) % 1;
        const fy = (y / scale) % 1;
        const gx = Math.floor(x / scale);
        const gy = Math.floor(y / scale);
        const v =
          at(gx, gy) * (1 - smooth(fx)) * (1 - smooth(fy)) +
          at(gx + 1, gy) * smooth(fx) * (1 - smooth(fy)) +
          at(gx, gy + 1) * (1 - smooth(fx)) * smooth(fy) +
          at(gx + 1, gy + 1) * smooth(fx) * smooth(fy);
        angles[y * cols + x] = v * Math.PI * 4;
      }
    }
    return angles;
  }

  function mount(canvas, opts) {
    const o = opts || {};
    const count = o.particles == null ? 900 : o.particles;
    const speed = o.speed == null ? 0.9 : o.speed;
    const scale = o.scale == null ? 9 : o.scale;
    const seed = o.seed == null ? 11 : o.seed;
    const color = o.color || 'rgba(80, 200, 140, 0.5)';
    const background = o.background || '#07130c';

    const ctx = canvas.getContext('2d');
    let w = 1, h = 1, cols = 1, rows = 1, angles = null, raf = null;
    const cell = 8;
    const rand = rng(seed + 99);
    const parts = [];

    function size() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      w = Math.max(1, rect.width);
      h = Math.max(1, rect.height);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(w / cell) + 1;
      rows = Math.ceil(h / cell) + 1;
      angles = noiseGrid(cols, rows, seed, scale);
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, w, h);
    }

    function seedParticles() {
      parts.length = 0;
      for (let i = 0; i < count; i++) parts.push({ x: rand() * w, y: rand() * h, life: rand() * 120 });
    }

    function step() {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        const gx = Math.min(cols - 1, Math.max(0, Math.floor(p.x / cell)));
        const gy = Math.min(rows - 1, Math.max(0, Math.floor(p.y / cell)));
        const a = angles[gy * cols + gx];
        const nx = p.x + Math.cos(a) * speed;
        const ny = p.y + Math.sin(a) * speed;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(nx, ny);
        ctx.stroke();
        p.x = nx; p.y = ny; p.life--;
        if (p.life <= 0 || p.x < 0 || p.x > w || p.y < 0 || p.y > h) {
          p.x = rand() * w; p.y = rand() * h; p.life = 60 + rand() * 120;
        }
      }
    }

    function fade() {
      // A fill, not clearRect — clearRect ignores alpha, so trails need a translucent paint
      // in the background colour.
      ctx.fillStyle = background + '';
      ctx.globalAlpha = 0.04;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }

    function tick() { fade(); step(); raf = requestAnimationFrame(tick); }

    size();
    seedParticles();

    // Prime the field before the first frame is ever shown. A flow field builds its image out
    // of accumulated trails, so an unprimed one starts as a scatter of 1px dashes and takes
    // seconds to become legible — which is what a viewer sees on arrival, and what a
    // screenshot catches. Priming is also the whole of the reduced-motion path: the drawing
    // is the content, the drifting is not.
    const prime = o.prime == null ? 260 : o.prime;
    for (let i = 0; i < prime; i++) step();

    if (!REDUCED()) tick();

    let ro;
    function onResize() { size(); seedParticles(); for (let i = 0; i < prime; i++) step(); }
    if (window.ResizeObserver) { ro = new ResizeObserver(onResize); ro.observe(canvas); }
    else window.addEventListener('resize', onResize);

    return {
      destroy() {
        if (raf !== null) cancelAnimationFrame(raf);
        raf = null;
        if (ro) ro.disconnect(); else window.removeEventListener('resize', onResize);
      },
    };
  }

  global.UIFlowField = { mount };

  if (global.UI) {
    global.UI.define({
      id: 'flow-field',
      primitive: 'canvas',
      label: 'Flow field',
      source: 'recipes/web/flow-field.js',
      export: 'UIFlowField',
      description: 'Particles steered by a precomputed noise angle grid, painting trails. One static pass under reduced motion.',
      props: {
        particles: {
          type: 'number',
          default: 900,
          controls: 'How many trails are drawn. Sets the density of the texture: sparse reads as strokes, dense as a woven surface.',
          range: [100, 3000],
          sweep: [100, 300, 900, 1800, 3000],
          cost: 'linear — every particle steps every frame (and 260 times when primed)',
        },
        speed: {
          type: 'number',
          default: 0.9,
          controls: 'Step length per frame. In the primed (and reduced-motion) image it sets how long each trail runs: short reads as hair, long as flowing lines.',
          range: [0.3, 3],
          sweep: [0.3, 0.6, 0.9, 1.5, 3],
          cost: 'none',
        },
        scale: {
          type: 'number',
          default: 9,
          controls: 'Noise cell size: how far the flow curves before it turns. Small scale is turbulent, large is calm and sweeping.',
          range: [3, 30],
          sweep: [3, 6, 9, 15, 30],
          cost: 'none — the angle grid is precomputed once',
        },
        seed: {
          type: 'number',
          default: 11,
          controls: 'Which field is drawn. A different seed is a different composition with the same character.',
          sweep: [1, 11, 42, 99],
          cost: 'none',
        },
      },
      snippet:
        "const field = UIFlowField.mount(canvasEl, {\n  particles: 900,\n  scale: 9,\n  seed: 11,\n});\n\nfield.destroy();",
      preview(container, props) {
        const p = props || {};
        const canvas = document.createElement('canvas');
        canvas.setAttribute('aria-hidden', 'true');
        canvas.style.cssText = 'width:100%;height:260px;display:block;border-radius:8px';
        container.appendChild(canvas);
        const f = mount(canvas, { particles: p.particles, speed: p.speed, scale: p.scale, seed: p.seed });
        return { destroy: f.destroy };
      },
      demo(container) {
        const canvas = document.createElement('canvas');
        canvas.setAttribute('aria-hidden', 'true');
        canvas.style.cssText = 'width:100%;height:250px;display:block;border-radius:8px';
        container.appendChild(canvas);
        const f = mount(canvas, {});
        return { destroy: f.destroy };
      },
    });
  }
})(window);
