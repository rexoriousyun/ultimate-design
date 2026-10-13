/**
 * Gooey blob-merge filter — the classic CSS-Tricks recipe: blur the source heavily, then
 * run feColorMatrix over just the alpha channel with a large contrast multiplier so soft
 * blurred edges snap back to a hard edge only where two shapes' blur halos overlap. Any
 * children placed inside get the merge-on-approach look for free.
 *
 * Ported from ui-master's React GooeyBlobs.jsx. The filter itself is unchanged — it is
 * declarative SVG and carries over exactly; only the React wrapper and useId are gone.
 *
 * Usage: const goo = UIGooeyBlobs.mount(el, { blur: 10 }); goo.destroy();
 * Requires recipes/web/registry.js loaded first.
 */
(function (global) {
  let seq = 0;

  /**
   * Wraps an existing element's children in the gooey filter.
   * @param {HTMLElement} el   The container whose children should merge.
   * @param {object} [opts]    blur, contrast, offset
   */
  function mount(el, opts) {
    const o = opts || {};
    const blur = o.blur == null ? 10 : o.blur;
    const contrast = o.contrast == null ? 18 : o.contrast;
    const offset = o.offset == null ? -8 : o.offset;
    const id = 'goo-' + ++seq;

    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    defs.setAttribute('width', '0');
    defs.setAttribute('height', '0');
    defs.setAttribute('aria-hidden', 'true');
    defs.style.position = 'absolute';
    defs.innerHTML =
      '<filter id="' + id + '">' +
        '<feGaussianBlur in="SourceGraphic" stdDeviation="' + blur + '" result="blur"/>' +
        '<feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ' + contrast + ' ' + offset + '" result="goo"/>' +
      '</filter>';

    el.parentNode.insertBefore(defs, el);
    const previousFilter = el.style.filter;
    el.style.filter = 'url(#' + id + ')';

    return {
      destroy() {
        el.style.filter = previousFilter;
        if (defs.parentNode) defs.parentNode.removeChild(defs);
      },
    };
  }

  global.UIGooeyBlobs = { mount };

  if (global.UI) {
    global.UI.define({
      id: 'gooey-blobs',
      primitive: 'svg',
      label: 'Gooey blobs',
      source: 'recipes/web/gooey-blobs.js',
      export: 'UIGooeyBlobs',
      description: 'Blur-plus-alpha-contrast filter that merges nearby shapes into one gooey mass.',
      props: {
        blur: {
          type: 'number', default: 10,
          controls: 'How far apart shapes start to merge: the blur radius sets the reach of each halo, and so the size of the bridge between them.',
          range: [4, 20], sweep: [4, 7, 10, 14, 20],
          breaks: { above: 'Past ~20 the halos swamp the shapes and everything melts into one round mass.' },
          cost: 'grows with blur radius',
        },
        contrast: {
          type: 'number', default: 18,
          controls: 'Alpha contrast: how hard the edge snaps back after blurring. Low is soft and smoky, high is crisp liquid.',
          range: [6, 40], sweep: [6, 12, 18, 28, 40],
          cost: 'none',
        },
        offset: {
          type: 'number', default: -8,
          controls: 'Alpha offset: where the edge is cut. More negative shrinks the shapes and thins the bridge; nearer 0 fattens both.',
          range: [-16, -2], sweep: [-16, -12, -8, -4, -2],
          cost: 'none',
        },
      },
      signature: {
        within: 'filter',
        requires: ['feGaussianBlur', 'feColorMatrix'],
        why: 'a heavy blur feeding an alpha-contrast colour matrix is the gooey recipe itself',
      },
      snippet:
        "const goo = UIGooeyBlobs.mount(blobContainer, { blur: 10 });\n// …later\ngoo.destroy();",
      /** Props-driven render, no scripted controls — the app supplies the props. */
      preview(container, props) {
        const p = props || {};
        const stage = document.createElement('div');
        stage.style.cssText = 'position:relative;height:180px';
        const blobs = document.createElement('div');
        blobs.style.cssText = 'position:absolute;inset:0';
        // Overlapping at rest: the whole point of the filter is what happens in the gap, so a
        // preview that starts them apart shows nothing about the props being tuned.
        blobs.innerHTML =
          '<span style="position:absolute;left:52px;top:50px;width:80px;height:80px;border-radius:50%;background:currentColor;display:block"></span>' +
          '<span style="position:absolute;left:108px;top:50px;width:80px;height:80px;border-radius:50%;background:currentColor;display:block"></span>';
        stage.appendChild(blobs);
        container.appendChild(stage);
        const goo = mount(blobs, { blur: p.blur, contrast: p.contrast, offset: p.offset });
        return { destroy: goo.destroy };
      },
      demo(container) {
        const controls = document.createElement('div');
        controls.className = 'ui-demo-controls';
        controls.innerHTML = '<button class="ui-demo-ctl" data-act="toggle" aria-pressed="false">Merge</button>';

        const stage = document.createElement('div');
        stage.style.position = 'relative';
        stage.style.height = '180px';

        const blobs = document.createElement('div');
        blobs.style.position = 'absolute';
        blobs.style.inset = '0';
        blobs.innerHTML =
          '<span class="ui-demo-blob" style="position:absolute;left:30px;top:50px;width:80px;height:80px;border-radius:50%;background:currentColor;display:block"></span>' +
          '<span class="ui-demo-blob" style="position:absolute;left:130px;top:50px;width:80px;height:80px;border-radius:50%;background:currentColor;display:block"></span>';

        // The move is decorative, so it honours prefers-reduced-motion — the blobs still
        // merge, they just arrive rather than travel. Caught by gating this recipe's own
        // demo page: the transition was declared unconditionally, which is precisely what
        // reduced-motion-respected exists to find.
        const motionOk = !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
        stage.appendChild(blobs);

        const goo = mount(blobs, { blur: 10 });
        const second = blobs.querySelectorAll('.ui-demo-blob')[1];
        let merged = false;

        controls.addEventListener('click', function (e) {
          if (!e.target.dataset || e.target.dataset.act !== 'toggle') return;
          merged = !merged;
          second.style.transition = motionOk ? 'transform 400ms ease' : 'none';
          second.style.transform = merged ? 'translateX(-58px)' : 'translateX(0)';
          e.target.setAttribute('aria-pressed', String(merged));
        });

        container.appendChild(controls);
        container.appendChild(stage);
        return { destroy: goo.destroy };
      },
    });
  }
})(window);
