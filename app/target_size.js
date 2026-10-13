// Evaluated in the page by app/preview.py for the rulebook's `target-size` measure
// (design-guide's target-size-minimum and target-size-enhanced). Returns interactive
// targets smaller than `min` CSS px in either dimension, except:
// - links inside a sentence (WCAG 2.5.8's inline exception);
// - with `spacing_exemption`, an undersized target whose `min`-diameter circle, centred on
//   it, reaches no other target and no other target's circle (WCAG 2.5.8's spacing rule).
// Inactive and invisible targets are skipped. The shared fixtures in
// tests/fixtures/measures/ (from `design-guide export fixtures`) hold it to design-guide's verdicts.
(opts) => {
  const min = opts.min;
  const selector = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, ' +
    '[role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"], ' +
    '[role="tab"], [role="menuitem"], [tabindex]:not([tabindex="-1"])';
  const targets = [...document.querySelectorAll(selector)].filter((el) =>
    !el.closest(':disabled, [aria-disabled="true"]')
    && el.checkVisibility({ opacityProperty: true, visibilityProperty: true }));
  const rects = targets.map((el) => el.getBoundingClientRect());
  const centre = (r) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
  const small = [];
  targets.forEach((el, i) => {
    const r = rects[i];
    if (r.width < 1 || r.height < 1) return;
    if (r.width >= min - 0.5 && r.height >= min - 0.5) return;
    if (el.tagName === "A" && getComputedStyle(el).display === "inline"
        && el.parentElement && el.parentElement.textContent.trim().length > el.textContent.trim().length) return;
    if (opts.spacing_exemption) {
      const c = centre(r);
      const clear = rects.every((o, j) => {
        if (j === i || o.width < 1 || o.height < 1) return true;
        const oc = centre(o);
        const dx = Math.max(o.x - c.x, 0, c.x - (o.x + o.width));
        const dy = Math.max(o.y - c.y, 0, c.y - (o.y + o.height));
        return Math.hypot(c.x - oc.x, c.y - oc.y) >= min && Math.hypot(dx, dy) >= min / 2;
      });
      if (clear) return;
    }
    const label = (el.getAttribute("aria-label") || el.textContent || el.tagName.toLowerCase()).trim();
    small.push({ label: label.slice(0, 40), width: Math.round(r.width), height: Math.round(r.height) });
  });
  return small;
}
