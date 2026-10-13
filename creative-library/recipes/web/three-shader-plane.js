/**
 * Full-screen shader plane — raw GLSL on a quad, the escape hatch from the material system.
 *
 * When an effect is per-pixel (gradients, noise fields, ray-marched shapes, transitions), no
 * arrangement of meshes and lights expresses it and a ShaderMaterial does. This is the minimal
 * correct scaffold for that: an orthographic camera, a 2x2 plane that exactly fills clip space,
 * and uniforms for time and resolution.
 *
 * The scaffold is the value. Two things are wrong in most copied versions:
 *   - A PerspectiveCamera, which makes "fill the screen" depend on distance and FOV. An
 *     OrthographicCamera(-1, 1, 1, -1) makes the 2x2 plane exactly the viewport, always.
 *   - A `resolution` uniform set once. It must be updated on resize, or every aspect-corrected
 *     shader stretches the moment the container changes size.
 *
 * Under prefers-reduced-motion the time uniform is frozen at zero and one frame is drawn — a
 * per-pixel animation is exactly the kind of continuous movement the preference is about.
 *
 * Usage: const p = UIThreeShaderPlane.mount(containerEl, { fragment: glslString });
 * Requires global THREE (pinned three@0.128.0 UMD build) and registry.js loaded first.
 */
(function (global) {
  const REDUCED = function () {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  };

  const VERTEX = [
    'varying vec2 vUv;',
    'void main() {',
    '  vUv = uv;',
    '  gl_Position = vec4(position, 1.0);',
    '}',
  ].join('\n');

  const DEFAULT_FRAGMENT = [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform float uTime;',
    'uniform vec2 uResolution;',
    'uniform vec3 uColorA;',
    'uniform vec3 uColorB;',
    'uniform float uScale;',
    '',
    'float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
    '',
    'float noise(vec2 p) {',
    '  vec2 i = floor(p);',
    '  vec2 f = fract(p);',
    '  vec2 u = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),',
    '             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);',
    '}',
    '',
    'void main() {',
    // Aspect correction is why uResolution has to stay current on resize.
    '  vec2 uv = vUv;',
    '  uv.x *= uResolution.x / max(uResolution.y, 1.0);',
    '  float n = noise(uv * uScale + uTime * 0.15);',
    '  n += 0.5 * noise(uv * uScale * 2.0 - uTime * 0.1);',
    '  vec3 col = mix(uColorA, uColorB, clamp(n * 0.8, 0.0, 1.0));',
    '  gl_FragColor = vec4(col, 1.0);',
    '}',
  ].join('\n');

  function toVec3(THREE, value, fallback) {
    const c = new THREE.Color(value == null ? fallback : value);
    return new THREE.Vector3(c.r, c.g, c.b);
  }

  function mount(container, opts) {
    const THREE = global.THREE;
    if (!THREE) throw new Error('UIThreeShaderPlane.mount requires global THREE to be loaded first');
    const o = opts || {};

    const scene = new THREE.Scene();
    // Exactly the viewport, independent of distance and FOV.
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(renderer.domElement);

    const uniforms = {
      uTime: { value: 0 },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uColorA: { value: toVec3(THREE, o.colorA, '#07130c') },
      uColorB: { value: toVec3(THREE, o.colorB, '#4ade80') },
      uScale: { value: o.scale == null ? 3.0 : o.scale },
    };

    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: o.fragment || DEFAULT_FRAGMENT,
      uniforms: uniforms,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    scene.add(quad);

    function resize() {
      const w = container.clientWidth || 1;
      const h = container.clientHeight || 1;
      renderer.setSize(w, h, false);
      // Kept current, not set once — otherwise every aspect-corrected shader stretches.
      uniforms.uResolution.value.set(w, h);
    }
    resize();

    let raf = null;
    const speed = o.speed == null ? 1 : o.speed;
    function tick() {
      uniforms.uTime.value += 0.016 * speed;
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
      uniforms: uniforms,
      destroy() {
        if (raf !== null) cancelAnimationFrame(raf);
        raf = null;
        if (ro) ro.disconnect(); else window.removeEventListener('resize', resize);
        quad.geometry.dispose();
        material.dispose();
        renderer.dispose();
        if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      },
    };
  }

  global.UIThreeShaderPlane = { mount, VERTEX: VERTEX, DEFAULT_FRAGMENT: DEFAULT_FRAGMENT };

  if (global.UI) {
    global.UI.define({
      id: 'three-shader-plane',
      primitive: 'three',
      label: 'Three shader plane',
      source: 'recipes/web/three-shader-plane.js',
      export: 'UIThreeShaderPlane',
      description: 'Minimal correct scaffold for raw GLSL: orthographic camera, clip-space quad, live time and resolution uniforms.',
      requires: ['three@0.128.0 UMD build, exposed as the global THREE'],
      props: {
        scale: {
          type: 'number', default: 3,
          controls: 'Pattern scale of the shader: large, slow forms at low values, busy detail at high.',
          range: [1, 8], sweep: [1, 2, 3, 5, 8],
          cost: 'per pixel, on the GPU',
        },
        speed: {
          type: 'number', default: 1,
          controls: 'How fast the pattern moves (time multiplier).',
          range: [0, 3],
          unswept: 'motion: under reduced motion time is frozen at zero, as designed, so no still frame shows it',
        },
        colorA: {
          type: 'color', default: '#07130c',
          controls: 'The darker of the two colours the pattern blends between.',
          sweep: ['#07130c', '#1e1b4b', '#3b0a0a'],
          cost: 'none',
        },
        colorB: {
          type: 'color', default: '#4ade80',
          controls: 'The lighter colour: what the pattern\'s highlights become.',
          sweep: ['#4ade80', '#f472b6', '#facc15'],
          cost: 'none',
        },
      },
      snippet:
        "const plane = UIThreeShaderPlane.mount(containerEl, {\n  fragment: myGlslString,   // omit to use the built-in noise shader\n  scale: 3,\n});\n\nplane.uniforms.uScale.value = 6;\nplane.destroy();",
      preview(container, props) {
        const p = props || {};
        const stage = document.createElement('div');
        stage.setAttribute('aria-hidden', 'true');
        stage.style.cssText = 'width:100%;height:260px;border-radius:8px;overflow:hidden';
        container.appendChild(stage);
        const plane = mount(stage, { scale: p.scale, speed: p.speed, colorA: p.colorA, colorB: p.colorB });
        return { destroy: plane.destroy };
      },
      demo(container) {
        const stage = document.createElement('div');
        stage.setAttribute('aria-hidden', 'true');
        stage.style.cssText = 'width:100%;height:250px;border-radius:8px;overflow:hidden';
        container.appendChild(stage);
        const plane = mount(stage, {});
        return { destroy: plane.destroy };
      },
    });
  }
})(window);
