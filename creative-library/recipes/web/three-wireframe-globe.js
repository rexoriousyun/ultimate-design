/**
 * Wireframe globe with plotted points — the "our customers are everywhere" object.
 *
 * The technique worth having is the coordinate conversion, not the sphere. Latitude and
 * longitude map to a 3D position through spherical coordinates, and the two mistakes are
 * always the same:
 *
 *   - Latitude is measured from the equator; the polar angle three.js wants is measured from
 *     the north pole. Using latitude directly puts everything on the wrong hemisphere, which
 *     looks plausible on a featureless sphere and is completely wrong.
 *   - Longitude needs a sign flip relative to the naive mapping, or the globe reads mirrored.
 *
 * `latLonToVector3` below is the whole payload. The rest is scaffolding.
 *
 * Markers are one InstancedMesh, so a thousand cities cost one draw call — same reasoning as
 * three-instanced-grid.
 *
 * Under prefers-reduced-motion the globe renders once, oriented, and does not spin.
 *
 * Usage: const g = UIThreeWireframeGlobe.mount(containerEl, { points: [{lat, lon}] });
 * Requires global THREE (pinned three@0.128.0 UMD build) and registry.js loaded first.
 */
(function (global) {
  const REDUCED = function () {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  };

  /**
   * @param {number} lat degrees, -90 (south) to 90 (north)
   * @param {number} lon degrees, -180 to 180
   * @param {number} radius
   */
  function latLonToVector3(THREE, lat, lon, radius) {
    // Polar angle from the north pole, not from the equator — the one that is always wrong.
    const phi = (90 - lat) * (Math.PI / 180);
    // Sign flip, or the globe comes out mirrored.
    const theta = (lon + 180) * (Math.PI / 180);
    return new THREE.Vector3(
      -radius * Math.sin(phi) * Math.cos(theta),
      radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.sin(theta),
    );
  }

  function mount(container, opts) {
    const THREE = global.THREE;
    if (!THREE) throw new Error('UIThreeWireframeGlobe.mount requires global THREE to be loaded first');
    const o = opts || {};
    const radius = o.radius == null ? 1.5 : o.radius;
    const segments = o.segments == null ? 24 : o.segments;
    const markerSize = o.markerSize == null ? 0.035 : o.markerSize;
    const wireColor = o.wireColor || 0x2f9e4f;
    const markerColor = o.markerColor || 0xffd166;
    const points = o.points || [];

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(0, 0.9, 4.3);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(renderer.domElement);

    const globe = new THREE.Group();
    scene.add(globe);

    const wire = new THREE.Mesh(
      new THREE.SphereGeometry(radius, segments, Math.round(segments / 2)),
      new THREE.MeshBasicMaterial({ color: wireColor, wireframe: true, transparent: true, opacity: 0.45 }),
    );
    globe.add(wire);

    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 0.985, 32, 24),
      new THREE.MeshBasicMaterial({ color: 0x06180f, transparent: true, opacity: 0.85 }),
    );
    globe.add(shell);

    let markers = null;
    if (points.length > 0) {
      markers = new THREE.InstancedMesh(
        new THREE.SphereGeometry(markerSize, 8, 8),
        new THREE.MeshBasicMaterial({ color: markerColor }),
        points.length,
      );
      const scratch = new THREE.Matrix4();
      points.forEach((p, i) => {
        const v = latLonToVector3(THREE, p.lat, p.lon, radius * 1.01);
        scratch.makeTranslation(v.x, v.y, v.z);
        markers.setMatrixAt(i, scratch);
      });
      markers.instanceMatrix.needsUpdate = true;
      globe.add(markers);
    }

    function resize() {
      const w = container.clientWidth || 1;
      const h = container.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    resize();

    globe.rotation.y = o.rotation == null ? 0.6 : o.rotation;

    let raf = null;
    function tick() {
      globe.rotation.y += 0.0022;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    }

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
        wire.geometry.dispose(); wire.material.dispose();
        shell.geometry.dispose(); shell.material.dispose();
        if (markers) { markers.geometry.dispose(); markers.material.dispose(); }
        renderer.dispose();
        if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      },
    };
  }

  global.UIThreeWireframeGlobe = { mount, latLonToVector3 };

  if (global.UI) {
    const CITIES = [
      { lat: 37.57, lon: 126.98 }, { lat: 35.68, lon: 139.69 }, { lat: 1.35, lon: 103.82 },
      { lat: 51.51, lon: -0.13 }, { lat: 40.71, lon: -74.01 }, { lat: -33.87, lon: 151.21 },
      { lat: 52.52, lon: 13.40 }, { lat: -23.55, lon: -46.63 }, { lat: 19.08, lon: 72.88 },
      { lat: 30.04, lon: 31.24 }, { lat: 55.75, lon: 37.62 }, { lat: -1.29, lon: 36.82 },
      { lat: 34.05, lon: -118.24 }, { lat: 43.65, lon: -79.38 }, { lat: 25.20, lon: 55.27 },
    ];

    global.UI.define({
      id: 'three-wireframe-globe',
      primitive: 'three',
      label: 'Three wireframe globe',
      source: 'recipes/web/three-wireframe-globe.js',
      export: 'UIThreeWireframeGlobe',
      description: 'Wireframe sphere with lat/lon markers in one InstancedMesh — including the polar-angle conversion everyone gets wrong.',
      requires: ['three@0.128.0 UMD build, exposed as the global THREE'],
      props: {
        segments: {
          type: 'number', default: 24,
          controls: 'Wireframe density: few segments read as a lattice, many as a fine globe.',
          range: [8, 48], sweep: [8, 16, 24, 36, 48],
          cost: 'line count grows with segments²',
        },
        radius: {
          type: 'number', default: 1.5,
          controls: 'Globe size in the frame.',
          range: [0.8, 2.2], sweep: [0.8, 1.2, 1.5, 1.9, 2.2],
          cost: 'none',
        },
        markerSize: {
          type: 'number', default: 0.035,
          controls: 'Size of the location markers: subtle dots or bold pins.',
          range: [0.02, 0.12], sweep: [0.02, 0.035, 0.06, 0.09, 0.12],
          cost: 'one draw call for all markers',
        },
        rotation: {
          type: 'number', default: 0.6, unit: 'rad',
          controls: 'Which side of the globe faces the viewer (the resting longitude).',
          range: [0, 6.28], sweep: [0, 0.6, 1.5, 3, 4.5],
          cost: 'none',
        },
      },
      snippet:
        "const globe = UIThreeWireframeGlobe.mount(containerEl, {\n  points: [{ lat: 37.57, lon: 126.98 }, { lat: 51.51, lon: -0.13 }],\n});\n\n// Just the conversion, if that is all you need:\nconst v = UIThreeWireframeGlobe.latLonToVector3(THREE, 37.57, 126.98, 1.5);",
      preview(container, props) {
        const p = props || {};
        const stage = document.createElement('div');
        stage.setAttribute('aria-hidden', 'true');
        stage.style.cssText = 'width:100%;height:260px';
        container.appendChild(stage);
        const g = mount(stage, {
          points: CITIES, segments: p.segments, radius: p.radius,
          markerSize: p.markerSize, rotation: p.rotation,
        });
        return { destroy: g.destroy };
      },
      demo(container) {
        const stage = document.createElement('div');
        stage.setAttribute('aria-hidden', 'true');
        stage.style.cssText = 'width:100%;height:250px';
        container.appendChild(stage);
        const g = mount(stage, { points: CITIES });
        return { destroy: g.destroy };
      },
    });
  }
})(window);
