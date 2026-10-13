// Evaluated in the page by app/preview.py. Returns text that fails WCAG 2 contrast
// (4.5:1, or 3:1 for large text: >= 24px, or >= 18.66px bold), grouped by colour pair.
// Inactive components (:disabled, aria-disabled="true") are exempt, as in WCAG 1.4.3.
// Backgrounds are composited from the root down; text over a background image or
// gradient is skipped because its background cannot be known from styles.
// `opts` ({min, large}) comes from the rulebook's contrast measure; the defaults are WCAG's.
(opts) => {
  const minimum = opts?.min ?? 4.5;
  const largeMinimum = opts?.large ?? 3;
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (top, bottom) => ({
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1,
  });
  const luminance = ({ r, g, b }) => {
    const lin = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };
  const hex = ({ r, g, b }) => "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

  function background(el) {
    const chain = [];
    for (let n = el; n; n = n.parentElement) chain.push(n);
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    for (const n of chain.reverse()) {
      const s = getComputedStyle(n);
      if (s.backgroundImage !== "none") return null;
      const c = parse(s.backgroundColor);
      if (c && c.a > 0) bg = over(c, bg);
    }
    return bg;
  }

  const groups = new Map();
  for (const el of document.body ? document.body.querySelectorAll("*") : []) {
    const ownText = [...el.childNodes]
      .filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join("").trim();
    if (!ownText || ["SCRIPT", "STYLE", "NOSCRIPT"].includes(el.tagName)) continue;
    if (el.closest(':disabled, [aria-disabled="true"]') || !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1) continue; // visually hidden
    const s = getComputedStyle(el);
    const bg = background(el);
    const color = parse(s.color);
    if (!bg || !color) continue;
    const fg = color.a < 1 ? over(color, bg) : color;
    const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
    const ratio = (hi + 0.05) / (lo + 0.05);
    const size = parseFloat(s.fontSize);
    const large = size >= 24 || (size >= 18.66 && parseInt(s.fontWeight, 10) >= 700);
    const needed = large ? largeMinimum : minimum;
    if (ratio >= needed) continue;
    const key = `${hex(fg)} on ${hex(bg)}`;
    const group = groups.get(key) || { pair: key, ratio: Math.floor(ratio * 100) / 100, needed, count: 0, example: ownText.slice(0, 40) };
    group.count += 1;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a.ratio - b.ratio);
}
