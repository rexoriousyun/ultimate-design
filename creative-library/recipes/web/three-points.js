/**
 * Point cloud — thousands of particles as a single THREE.Points object.
 *
 * The whole reason this is a distinct recipe from three-scene: the naive way to render N
 * particles is N meshes, which costs N draw calls and falls over somewhere around a thousand.
 * THREE.Points draws the entire cloud in one call from one flat Float32Array of xyz triples,
 * so 20,000 points is as cheap as 200. If you find yourself in a loop calling `scene.add()`,
 * you want this instead.
 *
 * Points are distributed on a sphere by the standard rejection-free method: sample z uniformly
 * in [-1, 1] and take the radius from sqrt(1 - z²). Sampling two angles instead is the common
 * mistake and it clumps everything at the poles.
 *
 * `sizeAttenuation` is what makes it read as depth — near points draw larger. Turning it off
 * gives a flat starfield, which is sometimes what you want, so it is a prop rather than a
 * decision baked in.
 *
 * Under prefers-reduced-motion the cloud renders one frame and stops rotating. The shape is
 * the content; the spin is decoration.
 *
 * Usage: const cloud = UIThreePoints.mount(containerEl, { count: 6000 });
 * Requires global THREE (pinned three@0.128.0 UMD build) and registry.js loaded first.
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

  function spherePositions(count, radius, random) {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // Uniform on the sphere: z flat in [-1,1], then the ring radius follows from it.
      // Sampling theta AND phi uniformly instead is what clumps points at the poles.
      const z = random() * 2 - 1;
      const t = random() * Math.PI * 2;
      const r = Math.sqrt(1 - z * z);
      // Jitter the shell so it reads as a cloud rather than as a hollow ball.
      const scale = radius * (0.82 + random() * 0.18);
      arr[i * 3] = r * Math.cos(t) * scale;
      arr[i * 3 + 1] = r * Math.sin(t) * scale;
      arr[i * 3 + 2] = z * scale;
    }
    return arr;
  }

  function mount(container, opts) {
    const THREE = global.THREE;
    if (!THREE) throw new Error('UIThreePoints.mount requires global THREE to be loaded first');
    const o = opts || {};
    const random = seeded(o.seed == null ? 1 : o.seed);
    const count = o.count == null ? 6000 : o.count;
    const size = o.size == null ? 0.022 : o.size;
    const radius = o.radius == null ? 1.5 : o.radius;
    const attenuate = o.sizeAttenuation == null ? true : o.sizeAttenuation;
    const color = o.color || 0x2f9e4f;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 4.4);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(renderer.domElement);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(spherePositions(count, radius, random), 3));

    const material = new THREE.PointsMaterial({
      color: color,
      size: size,
      sizeAttenuation: attenuate,
      transparent: true,
      opacity: 0.9,
    });

    // One object, one draw call — the entire point of the recipe.
    const cloud = new THREE.Points(geometry, material);
    scene.add(cloud);

    function resize() {
      const w = container.clientWidth || 1;
      const h = container.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    resize();

    let raf = null;
    function tick() {
      cloud.rotation.y += 0.0016;
      cloud.rotation.x += 0.0006;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    }

    if (REDUCED()) renderer.render(scene, camera);
    else tick();

    let ro;
    if (window.ResizeObserver) {
      ro = new ResizeObserver(function () {
        resize();
        if (raf === null) renderer.render(scene, camera);
      });
      ro.observe(container);
    } else {
      window.addEventListener('resize', resize);
    }

    return {
      destroy: function () {
        if (raf !== null) cancelAnimationFrame(raf);
        raf = null;
        if (ro) ro.disconnect();
        else window.removeEventListener('resize', resize);
        geometry.dispose();
        material.dispose();
        renderer.dispose();
        if (renderer.domElement.parentNode) {
          renderer.domElement.parentNode.removeChild(renderer.domElement);
        }
      },
    };
  }

  global.UIThreePoints = { mount };

  if (global.UI) {
    global.UI.define({
      id: 'three-points',
      primitive: 'three',
      label: 'Three point cloud',
      source: 'recipes/web/three-points.js',
      export: 'UIThreePoints',
      description:
        'Thousands of particles as one THREE.Points draw call, distributed uniformly on a sphere.',
      requires: ['three@0.128.0 UMD build, exposed as the global THREE'],
      props: {
        seed: {
          type: 'number', default: 1,
          controls: 'Which scatter of points. A different seed is a different cloud with the same shape.',
          sweep: [1, 2, 3, 4],
          cost: 'none',
        },
        count: {
          type: 'number', default: 6000,
          controls: 'How many points: a faint dusting or a dense shell.',
          range: [500, 20000], sweep: [500, 2000, 6000, 12000, 20000],
          cost: 'one draw call at any count; the buffer grows linearly',
        },
        size: {
          type: 'number', default: 0.022,
          controls: 'Point size, in scene units: dust at small values, beads at large.',
          range: [0.01, 0.1], sweep: [0.022, 0.035, 0.05, 0.075, 0.1],
          breaks: { below: 'Swept: at the preview\'s camera distance anything under ~0.03 draws at the 1px minimum, so 0.011 and 0.022 look the same.' },
          cost: 'none',
        },
        radius: {
          type: 'number', default: 1.5,
          controls: 'Radius of the sphere the points sit on.',
          range: [0.8, 2.2], sweep: [0.8, 1.2, 1.5, 1.9, 2.2],
          cost: 'none',
        },
        sizeAttenuation: {
          type: 'boolean', default: true,
          controls: 'Near points draw larger, which is what reads as depth. Off gives a flat starfield.',
          sweep: [false, true],
          // At the default size every point is at the 1px minimum either way (see size).
          sweepWith: { size: 0.06 },
          cost: 'none',
        },
      },
      snippet:
        "const cloud = UIThreePoints.mount(containerEl, {\n  count: 6000,\n  size: 0.022,\n  color: 0x2f9e4f,\n});\n\ncloud.destroy();",
      preview(container, props) {
        const p = props || {};
        const stage = document.createElement('div');
        stage.setAttribute('aria-hidden', 'true');
        stage.style.cssText = 'width:100%;height:260px';
        container.appendChild(stage);
        const cloud = mount(stage, {
          seed: p.seed,
          count: p.count, size: p.size, radius: p.radius, sizeAttenuation: p.sizeAttenuation,
        });
        return { destroy: cloud.destroy };
      },
      demo(container) {
        const controls = document.createElement('div');
        controls.className = 'ui-demo-controls';
        controls.innerHTML =
          '<button class="ui-demo-ctl" data-n="1500">1.5k</button>' +
          '<button class="ui-demo-ctl" data-n="6000" aria-pressed="true">6k</button>' +
          '<button class="ui-demo-ctl" data-n="20000">20k</button>';

        const stage = document.createElement('div');
        stage.setAttribute('aria-hidden', 'true');
        stage.style.cssText = 'width:100%;height:250px';
        container.appendChild(controls);
        container.appendChild(stage);

        let cloud = mount(stage, { count: 6000 });
        controls.addEventListener('click', function (e) {
          const n = e.target.dataset && e.target.dataset.n;
          if (!n) return;
          cloud.destroy();
          cloud = mount(stage, { count: Number(n) });
          controls.querySelectorAll('.ui-demo-ctl').forEach(function (b) {
            b.setAttribute('aria-pressed', b.dataset.n === n ? 'true' : 'false');
          });
        });

        return { destroy: function () { cloud.destroy(); } };
      },
    });
  }
})(window);
