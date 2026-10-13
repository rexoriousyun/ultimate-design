// Injected into designs shown in the studio canvas (never into the agent's own previews
// or "Open in new tab"). The canvas iframe is sandboxed without same-origin, so the studio
// and the design talk only through postMessage. Protocol: docs/architecture.md.
(() => {
  if (window.__pmBridge) return;
  window.__pmBridge = true;

  const send = (msg) => window.parent.postMessage({ source: "pm-bridge", ...msg }, "*");
  let commentMode = false;
  let presenting = false; // present mode: pass the stepping keys to the studio
  let editMode = false;
  let hovered = null;
  let selected = null; // the primary selection: the one the inspector shows
  let selection = []; // everything selected (shift-click adds), primary last
  let editingText = null;

  // Overlay colours are fixed on purpose: they sit on unknown designs. Near-black with a
  // white halo reads on light, dark and busy backgrounds (docs/design/paper-handoff.md).
  const style = document.createElement("style");
  style.textContent = `
    .pm-hover { outline: 2px dashed #111214 !important; outline-offset: 3px !important;
      box-shadow: 0 0 0 3px #fff !important; cursor: crosshair !important; }
    .pm-pinned { outline: 2px solid #111214 !important; outline-offset: 3px !important;
      box-shadow: 0 0 0 3px #fff !important; }
    .pm-pin { position: absolute; z-index: 2147483647; min-width: 20px; height: 20px; padding: 0 4px;
      box-sizing: border-box; border-radius: 10px; background: #111214; color: #fff; border: 2px solid #fff;
      box-shadow: 0 0 0 1px rgb(0 0 0 / .45), 0 2px 6px rgb(0 0 0 / .3);
      font: 600 10px/16px system-ui, sans-serif; text-align: center; pointer-events: none; }
    .pm-selected { outline: 2px solid #111214 !important; outline-offset: 2px !important;
      box-shadow: 0 0 0 4px #fff !important; }
    .pm-editing-text { outline: 2px dashed #111214 !important; outline-offset: 2px !important;
      cursor: text !important; }
    .pm-selected-extra { outline: 2px dashed #111214 !important; outline-offset: 2px !important;
      box-shadow: 0 0 0 4px #fff !important; }
    .pm-dragging { cursor: grabbing !important; opacity: .85 !important; }
    .pm-handle { position: absolute; z-index: 2147483647; width: 12px; height: 12px; box-sizing: border-box;
      background: #fff; border: 2px solid #111214; border-radius: 3px; cursor: nwse-resize; touch-action: none; }
    .pm-priority { position: absolute; z-index: 2147483646; box-sizing: border-box; pointer-events: none;
      outline: 2px dashed #111214; outline-offset: 2px; box-shadow: 0 0 0 4px rgb(255 255 255 / .8); }
    .pm-priority-badge { position: absolute; left: -12px; top: -12px; min-width: 22px; height: 22px; padding: 0 6px;
      box-sizing: border-box; border-radius: 11px; background: #111214; color: #fff; border: 2px solid #fff;
      font: 700 11px/18px system-ui, sans-serif; text-align: center; }`;
  document.head.append(style);

  // A selector that finds this element again after a reload: nearest unique id, then
  // tag:nth-of-type steps down to the element.
  function selectorFor(el) {
    const steps = [];
    for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
      if (node.id && document.querySelectorAll(`#${CSS.escape(node.id)}`).length === 1) {
        steps.unshift(`#${CSS.escape(node.id)}`);
        return steps.join(" > ");
      }
      if (node === document.body) {
        steps.unshift("body");
        break;
      }
      const tag = node.tagName.toLowerCase();
      const siblings = [...node.parentElement.children].filter((c) => c.tagName === node.tagName);
      steps.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(node) + 1})` : tag);
    }
    return steps.join(" > ");
  }

  // ---- Tweaks ----
  function readTweaks() {
    const block = document.getElementById("tweaks");
    if (!block) return [];
    try {
      const tweaks = JSON.parse(block.textContent);
      return Array.isArray(tweaks) ? tweaks : [];
    } catch (err) {
      console.error("tweaks block is not valid JSON:", err.message);
      return [];
    }
  }

  function applyTweak(name, value) {
    const tweak = readTweaks().find((t) => t.name === name);
    if (!tweak) return;
    const root = document.documentElement;
    if (name.startsWith("--")) {
      root.style.setProperty(name, `${value}${tweak.unit || ""}`);
    } else {
      root.setAttribute(`data-${name}`, String(value));
    }
    for (const el of document.querySelectorAll(`[data-tweak="${CSS.escape(name)}"]`)) {
      el.textContent = String(value);
    }
    window.dispatchEvent(new CustomEvent("tweak", { detail: { name, value } }));
  }

  // ---- Options ----
  function readOptions() {
    return [...document.querySelectorAll("[data-option]")].map((el) => ({
      id: el.dataset.option,
      label: el.dataset.optionLabel || "",
    }));
  }

  // ---- Comment pins ----
  function showPins(pins) {
    document.querySelectorAll(".pm-pin").forEach((p) => p.remove());
    document.querySelectorAll(".pm-pinned").forEach((el) => el.classList.remove("pm-pinned"));
    for (const { selector, label } of pins) {
      let el = null;
      try {
        el = document.querySelector(selector);
      } catch {
        continue;
      }
      if (!el) continue;
      el.classList.add("pm-pinned");
      const rect = el.getBoundingClientRect();
      const pin = document.createElement("div");
      pin.className = "pm-pin";
      pin.textContent = label;
      pin.style.left = `${rect.left + window.scrollX - 8}px`;
      pin.style.top = `${rect.top + window.scrollY - 8}px`;
      document.body.append(pin);
    }
  }
  let lastPins = [];

  // ---- Priority marks: the design's data-priority order, drawn over it on request ----
  let prioritiesOn = false;
  function showPriorities() {
    document.querySelectorAll(".pm-priority").forEach((p) => p.remove());
    if (!prioritiesOn) return;
    for (const el of document.querySelectorAll("[data-priority]")) {
      if (!el.checkVisibility()) continue;
      const rect = el.getBoundingClientRect();
      const mark = document.createElement("div");
      mark.className = "pm-priority";
      mark.style.cssText = `left:${rect.left + window.scrollX}px;top:${rect.top + window.scrollY}px;`
        + `width:${rect.width}px;height:${rect.height}px`;
      const badge = document.createElement("span");
      badge.className = "pm-priority-badge";
      badge.textContent = el.dataset.priority;
      mark.append(badge);
      document.body.append(mark);
    }
  }

  window.addEventListener("resize", () => { showPins(lastPins); showPriorities(); placeHandle(); });
  window.addEventListener("load", () => { showPins(lastPins); showPriorities(); }); // fonts and images move things
  // Where the page is scrolled, so a drawing over the canvas can be matched to it.
  let scrollTimer = null;
  window.addEventListener("scroll", () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => send({ type: "scroll", y: Math.round(window.scrollY) }), 80);
  }, { passive: true });

  // ---- Comment mode ----
  function setHover(el) {
    if (hovered) hovered.classList.remove("pm-hover");
    hovered = el;
    if (hovered) hovered.classList.add("pm-hover");
  }

  document.addEventListener("mouseover", (e) => {
    if ((commentMode || editMode) && e.target instanceof Element && !isOverlay(e.target)) setHover(e.target);
  }, true);

  const isOverlay = (el) => el.classList.contains("pm-pin") || el.classList.contains("pm-handle")
    || el.closest(".pm-priority") !== null;

  // ---- Edit mode: select, resize, edit text in place ----
  const handle = document.createElement("div");
  handle.className = "pm-handle";
  handle.setAttribute("aria-hidden", "true");

  const px = (v) => Math.round(parseFloat(v) || 0);
  const hex = (c) => {
    const n = (c.match(/[\d.]+/g) || []).map(Number);
    if (n.length < 3 || (n.length > 3 && n[3] === 0)) return ""; // transparent
    return "#" + n.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  };
  // `translate` as [x, y] px ("none", "10px" or "10px 20px").
  const translateOf = (el) => {
    const t = getComputedStyle(el).translate;
    if (!t || t === "none") return [0, 0];
    const [x = 0, y = 0] = t.split(" ").map((v) => parseFloat(v) || 0);
    return [x, y];
  };
  const isFlow = (el) => /^(inline-)?(flex|grid)$/.test(getComputedStyle(el).display);
  const isTextLeaf = (el) => el.childNodes.length > 0 && el.textContent.trim() !== ""
    && [...el.childNodes].every((n) => n.nodeType === Node.TEXT_NODE);

  // Motion presets from the inspector, previewed with the same CSS the app saves
  // (`motion_css` in app/edits.py; a test holds the two to one output).
  const SPEED_MS = { quick: 150, normal: 300, slow: 600 };
  const MOTION_EASE = "cubic-bezier(0.2, 0.7, 0.2, 1)";
  const ENTER_FROM = { fade: "opacity: 0;", rise: "opacity: 0; transform: translateY(16px);",
    scale: "opacity: 0; transform: scale(0.96);" };
  const HOVER_TO = { lift: "transform: translateY(-4px)", grow: "transform: scale(1.03)", dim: "opacity: 0.8" };
  function motionCss(styles) {
    const moving = Object.entries(styles).filter(([, p]) => Object.keys(p).some((k) => k.startsWith("motion-")));
    if (!moving.length) return "";
    const marks = [], rules = [], used = [];
    for (const [selector, props] of moving) {
      const enter = props["motion-enter"] || "none";
      const hover = props["motion-hover"] || "none";
      const speed = props["motion-speed"] || "normal";
      const ms = SPEED_MS[speed];
      marks.push(`${selector} { --pm-motion-enter: ${enter}; --pm-motion-hover: ${hover}; --pm-motion-speed: ${speed}; }`);
      if (enter !== "none") {
        rules.push(`  ${selector} { animation: pm-motion-${enter} ${ms}ms ${MOTION_EASE} backwards !important; }`);
        if (!used.includes(enter)) used.push(enter);
      }
      if (hover !== "none") {
        rules.push(`  ${selector} { transition: transform ${ms}ms ${MOTION_EASE}, opacity ${ms}ms ${MOTION_EASE} !important; }`);
        rules.push(`  ${selector}:hover { ${HOVER_TO[hover]} !important; }`);
      }
    }
    const frames = used.map((kind) => `  @keyframes pm-motion-${kind} { from { ${ENTER_FROM[kind]} } }`);
    return [...marks, "@media (prefers-reduced-motion: no-preference) {", ...frames, ...rules, "}"].join("\n") + "\n";
  }
  window.__pmMotionCss = motionCss; // for the test that compares it with app/edits.py
  const motionPreview = {}; // selector: the motion presets changed in this Edit session
  const motionStyle = document.createElement("style");
  function previewMotion(el, selector, prop, value) {
    if (!motionPreview[selector]) {
      const s = getComputedStyle(el);
      motionPreview[selector] = Object.fromEntries(["motion-enter", "motion-hover", "motion-speed"]
        .map((p) => [p, s.getPropertyValue(`--pm-${p}`).trim() || (p === "motion-speed" ? "normal" : "none")]));
    }
    motionPreview[selector][prop] = value;
    motionStyle.textContent = motionCss(motionPreview);
    if (!motionStyle.isConnected) document.head.append(motionStyle);
    replayMotion(el);
  }
  // Plays an element's entrance again, so a change to it is seen at once.
  function replayMotion(el) {
    for (const a of el.getAnimations()) { if (a.animationName?.startsWith("pm-motion-")) { a.cancel(); a.play(); } }
  }

  function measure(el) {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      width: Math.round(r.width), height: Math.round(r.height),
      paddingY: px(s.paddingTop), paddingX: px(s.paddingLeft),
      marginY: px(s.marginTop), marginX: px(s.marginLeft),
      gap: px(s.rowGap), fontSize: px(s.fontSize), radius: px(s.borderTopLeftRadius),
      textAlign: s.textAlign === "start" ? "left" : s.textAlign === "end" ? "right" : s.textAlign,
      color: hex(s.color), background: hex(s.backgroundColor),
      x: Math.round(translateOf(el)[0]), y: Math.round(translateOf(el)[1]),
      fontFamily: s.fontFamily, fontWeight: String(parseInt(s.fontWeight, 10) || 400),
      letterSpacing: s.letterSpacing === "normal" ? 0 : Math.round(parseFloat(s.letterSpacing) * 10) / 10,
      lineHeight: s.lineHeight === "normal" ? "" : Math.round((parseFloat(s.lineHeight) / parseFloat(s.fontSize)) * 100) / 100,
      hasText: (el.innerText || "").trim() !== "",
      layout: /flex/.test(s.display) ? "flex" : /grid/.test(s.display) ? "grid" : "",
      motionEnter: s.getPropertyValue("--pm-motion-enter").trim() || "none",
      motionHover: s.getPropertyValue("--pm-motion-hover").trim() || "none",
      motionSpeed: s.getPropertyValue("--pm-motion-speed").trim() || "normal",
    };
  }

  // Type tokens of the attached design system: font families and sizes, by name.
  function typeTokens(names) {
    const root = getComputedStyle(document.documentElement);
    const fonts = [], sizes = [];
    for (const name of names) {
      const value = root.getPropertyValue(name).trim();
      if (!value) continue;
      if (/font|family/i.test(name) && !/size|weight|leading|height|spacing/i.test(name)) fonts.push({ name, value });
      else if (/(text|font-size|fs|type)/i.test(name) && /^[\d.]+(px|rem|em)$/.test(value)) sizes.push({ name, value });
    }
    return { fonts, sizes };
  }

  // Font families the page already uses, most used first.
  function pageFonts() {
    const counts = new Map();
    for (const el of document.body.querySelectorAll("*")) {
      if (![...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim())) continue;
      const family = getComputedStyle(el).fontFamily;
      counts.set(family, (counts.get(family) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => f).slice(0, 6);
  }

  // Colour tokens of the attached design system, for the inspector's colour pickers. The
  // canvas has an opaque origin, so a linked sheet's cssRules can't be read; the files are
  // fetched again (the server allows CORS) and parsed.
  async function readTokens() {
    const root = getComputedStyle(document.documentElement);
    const names = new Set();
    const collect = (rules) => {
      for (const rule of rules) {
        if (rule.cssRules) collect(rule.cssRules);
        if (!rule.style) continue;
        for (const prop of rule.style) if (prop.startsWith("--")) names.add(prop);
      }
    };
    const hrefs = [...document.styleSheets].map((s) => s.href || "").filter((h) => h.includes("/design-system/"));
    for (const href of hrefs) {
      try {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(await (await fetch(href)).text());
        collect(sheet.cssRules);
      } catch { /* unreachable or unparsable sheet */ }
    }
    const colors = [...names].map((name) => ({ name, value: root.getPropertyValue(name).trim() }))
      .filter((t) => t.value && CSS.supports("color", t.value) && !/^-?\d/.test(t.value));
    return { colors, ...typeTokens(names) };
  }

  function placeHandle() {
    if (!selected || selection.length > 1) return handle.remove();
    const r = selected.getBoundingClientRect();
    handle.style.left = `${r.right + window.scrollX - 6}px`;
    handle.style.top = `${r.bottom + window.scrollY - 6}px`;
    if (!handle.isConnected) document.body.append(handle);
  }

  function reportSelection() {
    if (!selected) return send({ type: "selected", selector: null, count: 0 });
    send({
      type: "selected",
      count: selection.length,
      selector: selectorFor(selected),
      tag: selected.tagName.toLowerCase(),
      text: (selected.innerText || "").trim().slice(0, 120),
      textLeaf: isTextLeaf(selected),
      box: measure(selected),
    });
  }

  // add: toggle `el` in a multi-selection (shift-click) instead of replacing it.
  function select(el, add = false) {
    for (const s of selection) s.classList.remove("pm-selected", "pm-selected-extra");
    if (!el) selection = [];
    else if (!add) selection = [el];
    else if (selection.includes(el)) selection = selection.filter((s) => s !== el);
    else selection = [...selection, el];
    selected = selection[selection.length - 1] || null;
    for (const s of selection) s.classList.add(s === selected ? "pm-selected" : "pm-selected-extra");
    placeHandle();
    reportSelection();
  }

  // The value a property had before Edit mode first changed it on an element, reported once
  // so the studio can log the user's override with its `from` (docs/gate-rulebook.md, section 11).
  const before = new Set();
  const remember = (el, prop) => {
    const selector = selectorFor(el);
    if (before.has(selector + "\u0000" + prop)) return;
    before.add(selector + "\u0000" + prop);
    send({ type: "style-before", selector, prop, value: getComputedStyle(el).getPropertyValue(prop) });
  };

  const setTranslate = (el, x, y) => {
    remember(el, "translate");
    el.style.setProperty("translate", `${Math.round(x)}px ${Math.round(y)}px`, "important");
  };
  const reportTranslate = (el) => {
    const [x, y] = translateOf(el);
    send({ type: "style-changed", selector: selectorFor(el),
           props: { translate: `${Math.round(x)}px ${Math.round(y)}px` } });
  };

  // Align the selected elements' boxes to the selection's edge or centre, by translate.
  function align(edge) {
    if (selection.length < 2) return;
    const rects = selection.map((el) => el.getBoundingClientRect());
    const left = Math.min(...rects.map((r) => r.left));
    const right = Math.max(...rects.map((r) => r.right));
    const top = Math.min(...rects.map((r) => r.top));
    const bottom = Math.max(...rects.map((r) => r.bottom));
    selection.forEach((el, i) => {
      const r = rects[i];
      const dx = { left: left - r.left, right: right - r.right,
                   center: (left + right) / 2 - (r.left + r.right) / 2 }[edge] ?? 0;
      const dy = { top: top - r.top, bottom: bottom - r.bottom,
                   middle: (top + bottom) / 2 - (r.top + r.bottom) / 2 }[edge] ?? 0;
      const [x, y] = translateOf(el);
      setTranslate(el, x + dx, y + dy);
      reportTranslate(el);
    });
    placeHandle();
    reportSelection();
  }

  // Shift-click adds to the selection; without this it would also extend the page's text
  // selection.
  document.addEventListener("mousedown", (e) => {
    if (editMode && !editingText && e.shiftKey) e.preventDefault();
  }, true);

  // Drag a selected element. In a flex or grid parent it moves among its siblings (CSS
  // `order`); anywhere else, and for a multi-selection, it moves freely (`translate`).
  const DRAG_THRESHOLD = 4;
  let justDragged = false;
  document.addEventListener("pointerdown", (e) => {
    if (!editMode || editingText || e.button !== 0 || !(e.target instanceof Element) || isOverlay(e.target)) return;
    // Dragging an unselected element selects it; dragging inside a selection moves it.
    const inSelection = selection.find((s) => s === e.target || s.contains(e.target));
    const target = inSelection || e.target;
    const start = { x: e.clientX, y: e.clientY };
    const group = inSelection && selection.length > 1 ? [...selection] : [target];
    const bases = group.map(translateOf);
    const reorder = group.length === 1 && target.parentElement && isFlow(target.parentElement);
    let dragging = false;
    const move = (ev) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (!dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      if (!dragging) {
        dragging = true;
        if (!inSelection) select(target);
        target.classList.add("pm-dragging");
        setHover(null);
      }
      ev.preventDefault();
      if (reorder) reorderTo(target, ev.clientX, ev.clientY);
      else group.forEach((el, i) => setTranslate(el, bases[i][0] + dx, bases[i][1] + dy));
      placeHandle();
    };
    const up = () => {
      document.removeEventListener("pointermove", move, true);
      if (!dragging) return;
      target.classList.remove("pm-dragging");
      justDragged = true; // the click that ends a drag is not a new selection
      setTimeout(() => { justDragged = false; }, 0);
      if (reorder) {
        for (const sib of target.parentElement.children) {
          send({ type: "style-changed", selector: selectorFor(sib),
                 props: { order: getComputedStyle(sib).order } });
        }
      } else {
        group.forEach(reportTranslate);
      }
      reportSelection();
    };
    document.addEventListener("pointermove", move, true);
    document.addEventListener("pointerup", up, { capture: true, once: true });
  }, true);

  // Give the parent's children consecutive `order` values with `el` placed before the
  // sibling under the pointer (or after it, past its middle).
  function reorderTo(el, x, y) {
    const parent = el.parentElement;
    const items = [...parent.children].filter((c) => !isOverlay(c))
      .sort((a, b) => (parseInt(getComputedStyle(a).order) || 0) - (parseInt(getComputedStyle(b).order) || 0)
        || [...parent.children].indexOf(a) - [...parent.children].indexOf(b));
    const over = items.find((c) => {
      if (c === el) return false;
      const r = c.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    });
    if (!over) return;
    const rest = items.filter((c) => c !== el);
    const r = over.getBoundingClientRect();
    const row = getComputedStyle(parent).flexDirection.startsWith("row") && getComputedStyle(parent).display.includes("flex");
    const after = row ? x > r.left + r.width / 2 : y > r.top + r.height / 2;
    rest.splice(rest.indexOf(over) + (after ? 1 : 0), 0, el);
    rest.forEach((c, i) => { remember(c, "order"); c.style.setProperty("order", String(i), "important"); });
  }

  function startTextEdit(el) {
    if (!isTextLeaf(el) || editingText) return;
    editingText = el;
    const before = el.textContent;
    const selector = selectorFor(el);
    el.classList.add("pm-editing-text");
    el.setAttribute("contenteditable", "plaintext-only");
    el.focus();
    const finish = (keep) => {
      el.removeEventListener("keydown", onKey);
      el.removeEventListener("blur", onBlur);
      el.removeAttribute("contenteditable");
      el.classList.remove("pm-editing-text");
      editingText = null;
      if (!keep) el.textContent = before;
      else if (el.textContent !== before) send({ type: "text-edited", selector, before, after: el.textContent });
      placeHandle();
    };
    const onKey = (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); el.blur(); }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); }
    };
    const onBlur = () => finish(true);
    el.addEventListener("keydown", onKey);
    el.addEventListener("blur", onBlur);
  }

  document.addEventListener("dblclick", (e) => {
    if (editMode && e.target instanceof Element && !isOverlay(e.target)) {
      e.preventDefault();
      select(e.target);
      startTextEdit(e.target);
    }
  }, true);

  handle.addEventListener("pointerdown", (e) => {
    if (!selected) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const { width, height } = measure(selected);
    const start = { x: e.clientX, y: e.clientY, width, height };
    const target = selected;
    remember(target, "width");
    remember(target, "height");
    const move = (ev) => {
      target.style.setProperty("width", `${Math.max(1, Math.round(start.width + ev.clientX - start.x))}px`, "important");
      target.style.setProperty("height", `${Math.max(1, Math.round(start.height + ev.clientY - start.y))}px`, "important");
      placeHandle();
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      const box = measure(target);
      send({ type: "style-changed", selector: selectorFor(target),
             props: { width: `${box.width}px`, height: `${box.height}px` } });
      reportSelection();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up, { once: true });
  });

  document.addEventListener("click", (e) => {
    if (editMode && e.target instanceof Element) {
      if (editingText && editingText.contains(e.target)) return; // placing the caret
      if (isOverlay(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      if (justDragged) return;
      setHover(null);
      select(e.target, e.shiftKey);
      return;
    }
    if (!commentMode || !(e.target instanceof Element)) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.target;
    setHover(null);
    send({
      type: "picked",
      selector: selectorFor(el),
      tag: el.tagName.toLowerCase(),
      text: (el.innerText || el.getAttribute("aria-label") || el.getAttribute("alt") || "").trim().slice(0, 120),
    });
  }, true);

  // After a click in comment mode, keyboard focus is inside this frame, so the studio
  // never sees Esc; pass it on.
  document.addEventListener("keydown", (e) => {
    if ((commentMode || (editMode && !editingText)) && e.key === "Escape") send({ type: "escape" });
    // While presenting, stepping keys go to the studio unless the user is typing.
    const typing = e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable]");
    if (presenting && !typing && ["ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Escape"].includes(e.key)) {
      send({ type: "present-key", key: e.key });
    }
  });

  window.addEventListener("message", (e) => {
    if (e.source !== window.parent || !e.data || e.data.source !== "pm-studio") return;
    const msg = e.data;
    if (msg.type === "comment-mode") {
      commentMode = Boolean(msg.on);
      if (!commentMode) setHover(null);
    } else if (msg.type === "present") {
      presenting = Boolean(msg.on);
    } else if (msg.type === "edit-mode") {
      editMode = Boolean(msg.on);
      if (!editMode) {
        if (editingText) editingText.blur();
        setHover(null);
        select(null);
      }
    } else if (msg.type === "set-style") {
      const el = document.querySelector(msg.selector);
      if (el && msg.prop.startsWith("motion-")) {
        previewMotion(el, msg.selector, msg.prop, msg.value);
      } else if (el) {
        remember(el, msg.prop);
        el.style.setProperty(msg.prop, msg.value, "important");
        if (el === selected) { placeHandle(); reportSelection(); }
      }
    } else if (msg.type === "replay-motion") {
      if (selected) replayMotion(selected);
    } else if (msg.type === "set-text") {
      const el = document.querySelector(msg.selector);
      if (el && isTextLeaf(el)) el.textContent = msg.text;
    } else if (msg.type === "edit-text") {
      if (selected) startTextEdit(selected);
    } else if (msg.type === "align") {
      align(msg.edge);
    } else if (msg.type === "duplicate") {
      // A preview only: the agent makes it real (the studio sends it the instruction).
      if (!selected) return;
      const selector = selectorFor(selected); // before the copy, which shares its id
      const copy = selected.cloneNode(true);
      copy.classList.remove("pm-selected", "pm-selected-extra");
      copy.dataset.pmPreview = "duplicate";
      selected.after(copy);
      send({ type: "structural", ok: true, kind: "duplicate", selector,
             tag: selected.tagName.toLowerCase(), text: (selected.innerText || "").trim().slice(0, 60) });
    } else if (msg.type === "wrap") {
      const parent = selection[0] && selection[0].parentElement;
      if (!parent || selection.some((el) => el.parentElement !== parent)) {
        send({ type: "structural", ok: false, kind: "wrap", reason: "Select elements that sit side by side in the same container." });
        return;
      }
      const items = [...parent.children].filter((c) => selection.includes(c));
      const selectors = items.map(selectorFor); // before the DOM changes
      const box = document.createElement("div");
      box.dataset.pmPreview = "wrap";
      box.style.cssText = msg.layout === "grid"
        ? `display:grid;grid-template-columns:repeat(${items.length},minmax(0,1fr));gap:16px`
        : "display:flex;gap:16px;align-items:flex-start";
      items[0].before(box);
      for (const el of items) box.append(el);
      select(null);
      send({ type: "structural", ok: true, kind: "wrap", layout: msg.layout === "grid" ? "grid" : "flex",
             selectors, labels: items.map((el) => (el.innerText || el.tagName.toLowerCase()).trim().slice(0, 30)) });
    } else if (msg.type === "pins") {
      lastPins = msg.pins;
      showPins(lastPins);
    } else if (msg.type === "priorities") {
      prioritiesOn = Boolean(msg.on);
      showPriorities();
    } else if (msg.type === "set-tweak") {
      applyTweak(msg.name, msg.value);
    } else if (msg.type === "scroll-to") {
      document.querySelector(`[data-option="${CSS.escape(msg.option)}"]`)?.scrollIntoView({ block: "start" });
    }
  });

  for (const t of readTweaks()) applyTweak(t.name, t.value);
  // A page made at one width (a letter sheet says <meta name="viewport" content="width=816">):
  // the studio shows it at that width instead of the chosen device width.
  function fixedWidth() {
    const content = document.querySelector('meta[name="viewport"]')?.content || "";
    const m = content.match(/(?:^|[,;\s])width\s*=\s*(\d+)/);
    const width = m ? Number(m[1]) : null;
    return width >= 200 && width <= 4000 ? width : null;
  }

  // `path`: which page this is, so the studio can follow links between pages.
  readTokens().then(({ colors, fonts, sizes }) => send({
    type: "ready", tweaks: readTweaks(), options: readOptions(), path: location.pathname,
    tokens: colors, fontTokens: fonts, sizeTokens: sizes, pageFonts: pageFonts(),
    // The page's Wada palette (<meta name="palette" content="wada:006">), shown in the studio.
    palette: document.querySelector('meta[name="palette"]')?.content || null,
    priorities: document.querySelectorAll("[data-priority]").length,
    fixedWidth: fixedWidth(),
  }));

  // Expose pure helpers for tests.
  window.__pmBridgeTest = { selectorFor, readTweaks, readOptions, isTextLeaf, readTokens };
})();
