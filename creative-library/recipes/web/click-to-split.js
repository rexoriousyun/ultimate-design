/**
 * Click to split — falling balls under gravity and friction that divide into two smaller ones
 * where they are clicked.
 *
 * Two techniques, and the second is the reason this is a recipe.
 *
 * The physics is the ordinary Euler integration everyone writes: velocity accumulates gravity,
 * a bounce inverts and scales it by `restitution`, and horizontal motion decays by `friction`.
 * The detail that matters is that the floor test is `y + r + vy > h` rather than `y + r > h`.
 * Testing the current position lets a fast ball tunnel a few pixels into the floor and then
 * bounce out from inside it, which reads as a stutter at exactly the moment the eye is on it.
 *
 * The split is the interesting half. A clicked ball is replaced by two children that inherit
 * its colour and position, take `splitRatio` and `1 - splitRatio` of its radius, and are pushed
 * apart horizontally. Conserving nothing is deliberate: this is a visual device, not a
 * simulation, and children sized to conserve area come out so close in size that the split does
 * not read. Below `minRadius` a ball is removed instead of split, which is what stops a
 * determined clicker from growing the array without bound.
 *
 * Splitting while iterating is the trap here. The pen mutated the array inside its own forEach,
 * so a child could be visited in the same pass that created it. This collects survivors into a
 * new array instead.
 *
 * prefers-reduced-motion is honoured by not starting the loop: the balls paint where they were
 * seeded, and clicking still splits them. Falling is decoration; splitting is the answer to a
 * deliberate action, and removing that would make the recipe unusable rather than calmer.
 *
 * Ported from https://codepen.io/rexoriousyun/pen/zRRvjZ
 *
 * Usage: const balls = UIClickToSplit.mount(canvasEl, { count: 40, gravity: 0.4 });
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

  const PALETTE = ['#2f9e4f', '#4ade80', '#14532d', '#86efac', '#166534'];

  function mount(canvas, opts) {
    const o = opts || {};
    const random = seeded(o.seed == null ? 1 : o.seed);
    const count = o.count == null ? 40 : o.count;
    const gravity = o.gravity == null ? 0.4 : o.gravity;
    const friction = o.friction == null ? 0.99 : o.friction;
    const restitution = o.restitution == null ? 0.82 : o.restitution;
    const splitRatio = o.splitRatio == null ? 0.6 : o.splitRatio;
    const minRadius = o.minRadius == null ? 5 : o.minRadius;
    const maxRadius = o.maxRadius == null ? 26 : o.maxRadius;
    const palette = o.palette || PALETTE;

    const ctx = canvas.getContext('2d');
    let balls = [];
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

    function makeBall(x, y, vx, vy, r, color) {
      return { x: x, y: y, vx: vx, vy: vy, r: r, color: color };
    }

    function seed() {
      balls = [];
      for (let i = 0; i < count; i++) {
        const r = minRadius + random() * (maxRadius - minRadius);
        balls.push(makeBall(
          r + random() * Math.max(1, w - r * 2),
          random() * h * 0.5,
          (random() - 0.5) * 4,
          random() * 2,
          r,
          palette[Math.floor(random() * palette.length)],
        ));
      }
    }

    function advance() {
      for (let i = 0; i < balls.length; i++) {
        const b = balls[i];

        // Predictive floor test — comparing the *next* position is what stops a fast ball
        // sinking into the floor and bouncing back out of it.
        if (b.y + b.r + b.vy > h) {
          b.vy = -b.vy * restitution;
          b.y = h - b.r;
        } else {
          b.vy += gravity;
        }

        if (b.x + b.r + b.vx > w || b.x - b.r + b.vx < 0) b.vx = -b.vx;

        b.vx *= friction;
        b.x += b.vx;
        b.y += b.vy;
      }
    }

    function draw() {
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < balls.length; i++) {
        const b = balls[i];
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fillStyle = b.color;
        ctx.fill();
      }
    }

    function tick() {
      advance();
      draw();
      raf = requestAnimationFrame(tick);
    }

    function splitAt(px, py) {
      const next = [];
      for (let i = 0; i < balls.length; i++) {
        const b = balls[i];
        const dx = px - b.x;
        const dy = py - b.y;
        const hit = dx * dx + dy * dy <= b.r * b.r;

        if (!hit) { next.push(b); continue; }
        // Too small to divide again — remove it, or a persistent clicker grows the array
        // without bound and the frame budget goes with it.
        if (b.r <= minRadius) continue;

        const rA = b.r * splitRatio;
        const rB = b.r * (1 - splitRatio);
        next.push(makeBall(b.x - rA * 0.5, b.y, -Math.abs(b.vx) - 1, b.vy, rA, b.color));
        next.push(makeBall(b.x + rB * 0.5, b.y, Math.abs(b.vx) + 1, b.vy, rB, b.color));
      }
      balls = next;
      if (raf === null) draw();
    }

    function onClick(e) {
      const rect = canvas.getBoundingClientRect();
      splitAt(e.clientX - rect.left, e.clientY - rect.top);
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

    canvas.addEventListener('click', onClick);

    if (window.ResizeObserver) {
      ro = new ResizeObserver(onResize);
      ro.observe(canvas);
    } else {
      window.addEventListener('resize', onResize);
    }

    return {
      reset: function () { seed(); if (raf === null) draw(); },
      destroy: function () {
        if (raf !== null) cancelAnimationFrame(raf);
        raf = null;
        canvas.removeEventListener('click', onClick);
        if (ro) ro.disconnect();
        else window.removeEventListener('resize', onResize);
      },
    };
  }

  global.UIClickToSplit = { mount };

  if (global.UI) {
    global.UI.define({
      id: 'click-to-split',
      primitive: 'canvas',
      label: 'Click to split',
      source: 'recipes/web/click-to-split.js',
      export: 'UIClickToSplit',
      description:
        'Gravity-and-friction balls that divide into two smaller ones where clicked, with a predictive floor test so fast bounces do not stutter.',
      harvested_from: 'https://codepen.io/rexoriousyun/pen/zRRvjZ',
      props: {
        seed: {
          type: 'number', default: 1,
          controls: 'Where the balls start and their sizes and colours. A different seed is a different opening frame.',
          sweep: [1, 2, 3, 4],
          cost: 'none',
        },
        count: {
          type: 'number', default: 40,
          controls: 'How many balls start on screen: a few toys or a crowd.',
          range: [5, 80], sweep: [5, 20, 40, 80],
          cost: 'linear per frame',
        },
        gravity: {
          type: 'number', default: 0.4,
          controls: 'Downward pull per frame: floaty at low values, heavy at high.',
          range: [0.05, 1.2],
          unswept: 'acts over time as balls fall; under reduced motion the loop never starts, so no still frame shows it',
        },
        friction: {
          type: 'number', default: 0.99,
          controls: 'Horizontal damping per frame: how long balls keep drifting sideways.',
          range: [0.9, 1],
          unswept: 'acts over time; under reduced motion the loop never starts, so no still frame shows it',
        },
        restitution: {
          type: 'number', default: 0.82,
          controls: 'Bounce: the share of speed kept off the floor. Low is a thud, near 1 is a rubber ball.',
          range: [0.3, 0.95],
          unswept: 'acts only on a bounce, over time; no still frame shows it',
        },
        splitRatio: {
          type: 'number', default: 0.6,
          controls: 'How unevenly a clicked ball divides: 0.5 is two equal halves, higher gives one clearly bigger child.',
          range: [0.5, 0.8],
          unswept: 'acts only when a ball is clicked; the sweep has no pointer',
        },
        minRadius: {
          type: 'number', default: 5, unit: 'px',
          controls: 'Smallest ball. Sets the size range at the start, and below it a clicked ball vanishes instead of splitting.',
          range: [2, 12], sweep: [2, 5, 8, 12],
          cost: 'none',
        },
      },
      snippet:
        "const balls = UIClickToSplit.mount(canvasEl, {\n  count: 40,\n  gravity: 0.4,\n  restitution: 0.82,\n});\n\nballs.reset();\nballs.destroy();",
      preview(container, props) {
        const p = props || {};
        const canvas = document.createElement('canvas');
        canvas.setAttribute('aria-hidden', 'true');
        canvas.style.cssText = 'width:100%;height:240px;display:block;background:#0d1b12;border-radius:8px';
        container.appendChild(canvas);
        const balls = mount(canvas, {
          seed: p.seed,
          count: p.count, gravity: p.gravity, friction: p.friction,
          restitution: p.restitution, splitRatio: p.splitRatio, minRadius: p.minRadius,
        });
        return { destroy: balls.destroy };
      },
      demo(container) {
        const controls = document.createElement('div');
        controls.className = 'ui-demo-controls';
        controls.innerHTML =
          '<button class="ui-demo-ctl" data-g="0.15">Low gravity</button>' +
          '<button class="ui-demo-ctl" data-g="0.4" aria-pressed="true">Default</button>' +
          '<button class="ui-demo-ctl" data-g="1">Heavy</button>' +
          '<button class="ui-demo-ctl" data-act="reset">Reset</button>';

        const canvas = document.createElement('canvas');
        canvas.setAttribute('aria-hidden', 'true');
        canvas.style.cssText = 'width:100%;height:240px;display:block;background:#0d1b12;border-radius:8px';

        container.appendChild(controls);
        container.appendChild(canvas);

        let gravity = 0.4;
        let balls = mount(canvas, { gravity: gravity });
        controls.addEventListener('click', function (e) {
          const data = e.target.dataset || {};
          if (data.act === 'reset') { balls.reset(); return; }
          if (!data.g) return;
          gravity = Number(data.g);
          balls.destroy();
          balls = mount(canvas, { gravity: gravity });
          controls.querySelectorAll('[data-g]').forEach(function (b) {
            b.setAttribute('aria-pressed', b.dataset.g === data.g ? 'true' : 'false');
          });
        });

        return { destroy: function () { balls.destroy(); } };
      },
    });
  }
})(window);
