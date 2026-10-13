/**
 * Three.js scene module — mounts an auto-rotating mesh into a container.
 * Requires global THREE (pinned three@0.128.0 UMD build) and
 * lib/core/registry.js loaded first.
 * Usage:
 *   const scene = UIThreeScene.mount(containerEl, {
 *     geometry: 'icosahedron' | 'torusKnot' | 'box',
 *     color: '#2f9e4f',
 *     background: null, // transparent
 *   });
 *   scene.destroy();
 */
(function (global) {
  function reducedMotion() {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function makeGeometry(kind) {
    const THREE = global.THREE;
    switch (kind) {
      case 'torusKnot':
        return new THREE.TorusKnotGeometry(0.85, 0.26, 120, 16);
      case 'box':
        return new THREE.BoxGeometry(1.3, 1.3, 1.3);
      default:
        return new THREE.IcosahedronGeometry(1.2, 0);
    }
  }

  function mount(container, opts) {
    const THREE = global.THREE;
    if (!THREE) throw new Error('UIThreeScene.mount requires global THREE to be loaded first');
    const o = opts || {};
    const color = o.color || 0x2f9e4f;

    const scene = new THREE.Scene();
    if (o.background) scene.background = new THREE.Color(o.background);

    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    camera.position.set(0, 0, 4.2);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: !o.background });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(renderer.domElement);

    const mesh = new THREE.Mesh(
      makeGeometry(o.geometry),
      new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.1, wireframe: !!o.wireframe })
    );
    scene.add(mesh);

    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(2, 3, 4);
    scene.add(key);
    scene.add(new THREE.AmbientLight(0xffffff, 0.45));

    function resize() {
      const w = container.clientWidth || 1;
      const h = container.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    resize();

    let raf;
    let paused = false;
    function tick() {
      raf = requestAnimationFrame(tick);
      if (!paused) {
        mesh.rotation.x += 0.0035;
        mesh.rotation.y += 0.0055;
      }
      renderer.render(scene, camera);
    }

    // Honours prefers-reduced-motion by not starting the loop — the mesh renders once and
    // stays. This was missing until a corpus guard measured it (36 frames per 600ms with the
    // preference set), which is precisely the gap the guard exists for: the gate's
    // reduced-motion check reads CSS animation and reports not-applicable for a WebGL canvas,
    // so nothing else here could have seen it. Same fix squiggle-wobble took during its port.
    if (reducedMotion()) renderer.render(scene, camera);
    else tick();

    let ro;
    if (window.ResizeObserver) {
      ro = new ResizeObserver(resize);
      ro.observe(container);
    } else {
      window.addEventListener('resize', resize);
    }

    return {
      setPaused(v) {
        paused = v;
      },
      destroy() {
        cancelAnimationFrame(raf);
        if (ro) ro.disconnect();
        else window.removeEventListener('resize', resize);
        renderer.dispose();
        mesh.geometry.dispose();
        mesh.material.dispose();
        if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      },
    };
  }

  global.UIThreeScene = { mount };

  if (global.UI) {
    global.UI.define({
      id: 'three-scene',
      primitive: 'three',
      label: 'Three scene',
      source: 'recipes/web/three-scene.js',
      export: 'UIThreeScene',
      description: 'Auto-rotating 3D mesh mounted into a container div.',
      // The only recipe here that is not self-contained. Declared rather than left as a
      // surprise ReferenceError: a copied recipe must state what it needs on the page.
      requires: ['three@0.128.0 UMD build, exposed as the global THREE'],
      props: {
        geometry: {
          type: 'enum', values: ['icosahedron', 'torusKnot', 'box'], default: 'icosahedron',
          controls: 'The object: a faceted gem, a knot, or a box.',
          sweep: ['icosahedron', 'torusKnot', 'box'],
          cost: 'torusKnot has the most triangles',
        },
        color: {
          type: 'color', default: '0x2f9e4f',
          controls: 'Material colour, lit by the scene.',
          sweep: ['#2f9e4f', '#c2255c', '#3b5bdb'],
          cost: 'none',
        },
        wireframe: {
          type: 'boolean', default: false,
          controls: 'Draw edges only: technical and light, instead of a solid lit object.',
          sweep: [false, true],
          cost: 'none',
        },
      },
      snippet:
        "const scene = UIThreeScene.mount(containerEl, {\n  geometry: 'icosahedron',\n  color: 0x2f9e4f,\n});\n\nscene.setPaused(true);\nscene.destroy();",
      preview(container, props) {
        const p = props || {};
        const stage = document.createElement('div');
        stage.style.cssText = 'width:100%;height:260px';
        container.appendChild(stage);
        const scene = mount(stage, {
          geometry: p.geometry, color: p.color, wireframe: p.wireframe,
        });
        return { destroy: scene.destroy };
      },
      demo(container) {
        const controls = document.createElement('div');
        controls.className = 'ui-demo-controls';
        controls.innerHTML = ['icosahedron', 'torusKnot', 'box']
          .map((k, i) => `<button class="ui-demo-ctl" data-geo="${k}" aria-pressed="${i === 0}">${k}</button>`)
          .join('');
        const mountEl = document.createElement('div');
        mountEl.style.width = '100%';
        mountEl.style.height = '240px';
        container.appendChild(controls);
        container.appendChild(mountEl);

        let scene = mount(mountEl, { geometry: 'icosahedron', color: 0x2f9e4f });
        controls.addEventListener('click', (e) => {
          const geo = e.target.dataset.geo;
          if (!geo) return;
          scene.destroy();
          scene = mount(mountEl, { geometry: geo, color: 0x2f9e4f });
          controls.querySelectorAll('.ui-demo-ctl').forEach((b) => b.setAttribute('aria-pressed', b.dataset.geo === geo ? 'true' : 'false'));
        });

        return { destroy: () => scene.destroy() };
      },
    });
  }
})(window);
