/**
 * InstancedMesh grid — thousands of solid objects in one draw call.
 *
 * three-points solves the many-particles case; this solves the many-*objects* case, where each
 * one needs real geometry, lighting and its own transform. The naive version is a loop calling
 * scene.add(new Mesh(...)), which costs one draw call each and collapses in the low thousands.
 * InstancedMesh uploads one geometry and a per-instance matrix buffer, so 4,096 lit cubes cost
 * about what one does.
 *
 * The API detail that catches people: instance transforms are written through a scratch
 * Matrix4 with setMatrixAt, and `instanceMatrix.needsUpdate = true` must be set afterwards or
 * nothing moves. Reusing a single scratch matrix (rather than allocating per instance) is the
 * other half — allocating 4,096 Matrix4s per frame is its own performance bug.
 *
 * Under prefers-reduced-motion the grid renders once at rest.
 *
 * Usage: const g = UIThreeInstancedGrid.mount(containerEl, { side: 16 });
 * Requires global THREE (pinned three@0.128.0 UMD build) and registry.js loaded first.
 */
(function (global) {
  const REDUCED = function () {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  };

  function mount(container, opts) {
    const THREE = global.THREE;
    if (!THREE) throw new Error('UIThreeInstancedGrid.mount requires global THREE to be loaded first');
    const o = opts || {};
    const side = Math.max(2, o.side == null ? 16 : o.side);
    const spacing = o.spacing == null ? 0.34 : o.spacing;
    const cube = o.cubeSize == null ? 0.2 : o.cubeSize;
    const amplitude = o.amplitude == null ? 0.6 : o.amplitude;
    const color = o.color || 0x2f9e4f;
    const count = side * side;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(3.4, 3.2, 4.6);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(renderer.domElement);

    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(cube, cube, cube),
      new THREE.MeshStandardMaterial({ color: color, roughness: 0.4, metalness: 0.05 }),
      count,
    );
    scene.add(mesh);

    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const key = new THREE.DirectionalLight(0xffffff, 1.0);
    key.position.set(3, 5, 2);
    scene.add(key);

    // One scratch matrix, reused. Allocating per instance per frame is the other perf bug.
    const scratch = new THREE.Matrix4();
    const offset = ((side - 1) * spacing) / 2;

    function layout(t) {
      let i = 0;
      for (let x = 0; x < side; x++) {
        for (let z = 0; z < side; z++) {
          const px = x * spacing - offset;
          const pz = z * spacing - offset;
          const py = Math.sin(px * 2.2 + t) * Math.cos(pz * 2.2 + t) * amplitude * 0.5;
          scratch.makeTranslation(px, py, pz);
          mesh.setMatrixAt(i++, scratch);
        }
      }
      // Without this the buffer is never re-uploaded and nothing moves.
      mesh.instanceMatrix.needsUpdate = true;
    }

    function resize() {
      const w = container.clientWidth || 1;
      const h = container.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    resize();

    let raf = null;
    let t = 0;
    function tick() {
      t += 0.02;
      layout(t);
      mesh.rotation.y += 0.002;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    }

    layout(0);
    if (REDUCED()) renderer.render(scene, camera);
    else tick();

    let ro;
    if (window.ResizeObserver) {
      ro = new ResizeObserver(() => { resize(); if (raf === null) renderer.render(scene, camera); });
      ro.observe(container);
    } else {
      window.addEventListener('resize', resize);
    }

    return {
      destroy() {
        if (raf !== null) cancelAnimationFrame(raf);
        raf = null;
        if (ro) ro.disconnect(); else window.removeEventListener('resize', resize);
        mesh.geometry.dispose();
        mesh.material.dispose();
        renderer.dispose();
        if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      },
    };
  }

  global.UIThreeInstancedGrid = { mount };

  if (global.UI) {
    global.UI.define({
      id: 'three-instanced-grid',
      primitive: 'three',
      label: 'Three instanced grid',
      source: 'recipes/web/three-instanced-grid.js',
      export: 'UIThreeInstancedGrid',
      description: 'Thousands of lit, individually-transformed cubes in one draw call via InstancedMesh.',
      requires: ['three@0.128.0 UMD build, exposed as the global THREE'],
      props: {
        side: {
          type: 'number', default: 16,
          controls: 'Cubes per side of the grid (side² in total): a small block or a city.',
          range: [4, 40], sweep: [4, 8, 16, 24, 40],
          cost: 'one draw call at any count; per-instance matrices grow with side²',
        },
        spacing: {
          type: 'number', default: 0.34,
          controls: 'Distance between cube centres: packed into a surface, or separate blocks.',
          range: [0.2, 0.6], sweep: [0.2, 0.27, 0.34, 0.45, 0.6],
          cost: 'none',
        },
        cubeSize: {
          type: 'number', default: 0.2,
          controls: 'Size of each cube, against the spacing: gaps show when it is smaller, cubes touch when it matches.',
          range: [0.05, 0.34], sweep: [0.05, 0.1, 0.2, 0.27, 0.34],
          cost: 'none',
        },
        amplitude: {
          type: 'number', default: 0.6,
          controls: 'Height of the wave the cubes rise and fall on: flat at 0, a rolling landscape at high values.',
          range: [0, 1.2], sweep: [0, 0.3, 0.6, 0.9, 1.2],
          cost: 'none',
        },
      },
      snippet:
        "const grid = UIThreeInstancedGrid.mount(containerEl, {\n  side: 16,        // 16 x 16 = 256 instances, one draw call\n  spacing: 0.34,\n});\n\ngrid.destroy();",
      preview(container, props) {
        const p = props || {};
        const stage = document.createElement('div');
        stage.setAttribute('aria-hidden', 'true');
        stage.style.cssText = 'width:100%;height:260px';
        container.appendChild(stage);
        const g = mount(stage, { side: p.side, spacing: p.spacing, cubeSize: p.cubeSize, amplitude: p.amplitude });
        return { destroy: g.destroy };
      },
      demo(container) {
        const stage = document.createElement('div');
        stage.setAttribute('aria-hidden', 'true');
        stage.style.cssText = 'width:100%;height:250px';
        container.appendChild(stage);
        const g = mount(stage, { side: 20 });
        return { destroy: g.destroy };
      },
    });
  }
})(window);
