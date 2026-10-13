const $ = (sel) => document.querySelector(sel);

// Tool names that change design files; keep in sync with WRITE_TOOLS in app/engine.py.
const WRITE_TOOLS = new Set(["Write", "Edit"]);

// viewing: sha of a past version shown in the canvas, or null for the live files.
// tweakValues: Tweaks panel values changed since the design loaded, by tweak name.
// picked: the element chosen in comment mode, waiting for its note.
// page: the design page on the canvas (links inside the design change it); pages: all of them.
// edits.styles: unsaved Edit-mode styles, {page: {selector: {prop: value}}}.
const state = {
  slug: null, entry: "index.html", page: "index.html", pages: [], tokens: [],
  width: 1440, steps: null, versions: [], viewing: null, styleBefore: {}, pendingAnswers: null, approved: null,
  comments: [], tweaks: [], tweakValues: {}, commentMode: false, picked: null, local: false,
  running: false, turnStart: 0, tweaksCollapsed: false, projects: [], attachments: [],
  settings: { default_design_system: null }, prefill: null,
  questionCard: null,
  commentHold: new Set(), // open comments the user unticked: not sent with the next message // the current turn's questions form, moved after the agent's text at "done"
  // Board view: all pages side by side (GET .../board). boardFrame: the selected frame.
  canvasView: "page", board: null, boardZoom: 0.25, boardPan: { x: 40, y: 40 }, boardFrame: null,
  editMode: false, selection: null, edits: { styles: {}, texts: [], structural: [] },
};

const narrow = window.matchMedia("(max-width: 800px)");

function icon(paths, size = 14) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  for (const [k, v] of Object.entries({ width: size, height: size, viewBox: "0 0 24 24", fill: "none",
    stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "aria-hidden": "true" })) {
    svg.setAttribute(k, v);
  }
  for (const d of paths) {
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

function numberBadge(n) {
  const span = document.createElement("span");
  span.className = "num";
  span.textContent = String(n);
  return span;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) throw new Error((await res.json()).detail || res.statusText);
  return res;
}

function timeAgo(seconds) {
  const diff = Date.now() / 1000 - seconds;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  return new Date(seconds * 1000).toLocaleDateString();
}

// ---------- Home ----------

// The model choices: the default Claude model, the other Claude models, local ones.
async function fillModelSelect(select, current) {
  const { default: fallback, claude, local } = await (await api("/api/models")).json();
  const options = [new Option(`Claude (${claude[fallback] || fallback}, default)`, "")];
  for (const [id, name] of Object.entries(claude)) if (id !== fallback) options.push(new Option(`Claude ${name}`, id));
  for (const m of local) options.push(new Option(`Local: ${m.replace(/^ollama:/, "")}`, m));
  if (current && !options.some((o) => o.value === current)) options.push(new Option(current, current));
  select.replaceChildren(...options);
  select.value = current || "";
}

async function loadModels() {
  const select = $("#new-model");
  const current = select.value;
  await fillModelSelect(select, "");
  select.value = [...select.options].some((o) => o.value === current) ? current : "";
}

// Plays the "enter" animation on an element that just appeared (style.css, Motion). The class
// is removed first, so the same element animates again on its next appearance.
function animateIn(el) {
  if (!el) return;
  el.classList.remove("enter");
  void el.offsetWidth; // restart the animation
  el.classList.add("enter");
}

// `section`: "projects" (#/), "systems" (#/systems), "library" (#/library) or "rules" (#/rules).
// Projects and Systems share the grid: designs in one, design systems in the other
// (docs/gate-studio-redesign.md, section 2).
async function showHome(section = "projects") {
  state.slug = null;
  state.section = section;
  loadModels();
  $("#studio").hidden = true;
  $("#home").hidden = false;
  const grid = section === "projects" || section === "systems";
  $(".home-body").hidden = !grid;
  $("#library").hidden = section !== "library";
  $("#rules").hidden = section !== "rules";
  for (const name of ["projects", "systems", "library", "rules"]) {
    const link = $(`#nav-${name}`);
    if (name === section) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  $("#projects-heading").textContent = section === "systems" ? "Design systems" : "Projects";
  animateIn({ library: $("#library"), rules: $("#rules") }[section] || $(".home-body"));
  document.title = { systems: "Design systems · Ultimate Design", library: "Library · Ultimate Design",
    rules: "Rules · Ultimate Design" }[section] || "Ultimate Design";
  if (section === "rules") showRules();
  [state.projects, state.settings] = await Promise.all([
    api("/api/projects").then((r) => r.json()), api("/api/settings").then((r) => r.json())]);
  state.filter = "";
  renderFilters();
  renderProjects();
  renderNewDesignSystems();
  renderStarters();
  loadConnectors();
  loadRulesCount();
  if (section === "library") await showLibrary();
}

// The rail's count of open proposals (Rules). Read in the background: design-guide's pass takes
// a moment, and Home must not wait for it. A workspace with built-in rules has no proposals,
// so it has no Rules section at all (app/workspace.py).
async function loadRulesCount() {
  try {
    const space = await (await api("/api/workspace")).json();
    $("#nav-rules").hidden = space.rules !== "design-guide";
    if (space.rules !== "design-guide") {
      if (state.section === "rules") location.hash = "#/";
      return;
    }
    const result = await (await api("/api/proposals")).json();
    const n = result.proposals.length;
    $("#rules-count").hidden = !n;
    $("#rules-count").textContent = String(n);
    $("#nav-rules").setAttribute("aria-label", n ? `Rules, ${n} proposed` : "Rules");
  } catch {
    $("#rules-count").hidden = true;
  }
}

// ---- "New…": the create forms in a sheet (section 4) ----
function openNew(which = "design") {
  for (const form of ["new-project", "new-ds"]) {
    const details = $(`#${form} > details.create`);
    details.open = (form === "new-project") === (which === "design");
  }
  $("#new-dialog").showModal();
  $(which === "design" ? "#new-name" : "#ds-name").focus();
}
$("#new-open").addEventListener("click", () => openNew(state.section === "systems" ? "system" : "design"));
$("#new-close").addEventListener("click", () => $("#new-dialog").close());

// "/" focuses the search from anywhere on Home, unless typing somewhere already.
document.addEventListener("keydown", (e) => {
  if (e.key !== "/" || $("#home").hidden || e.target.closest("input, textarea, select, [contenteditable]")) return;
  e.preventDefault();
  $("#project-search").focus();
});

// ---------- Rules: what design-guide proposes from the user's decisions ----------

const PROPOSAL_KINDS = { "new-rule": "New rule", "stance-change": "Change a stance", revision: "Revise a rule" };

async function showRules() {
  const status = $("#rules-status");
  status.textContent = "Reading your decisions…";
  $("#proposal-list").replaceChildren();
  let result;
  try {
    result = await (await api("/api/proposals")).json();
  } catch (err) {
    status.textContent = `design-guide could not read the decisions: ${err.message}`;
    return;
  }
  const t = result.threshold;
  const rule = `A rule is proposed when ${t.decisions} decisions from ${t.projects} projects go the same way.`;
  if (!result.logs) status.textContent = `No decision logs yet. Your picks, rejections and edits are logged as you design. ${rule}`;
  const from = `${result.counted.decisions} decision${result.counted.decisions === 1 ? "" : "s"} in ${result.logs} `
    + `log${result.logs === 1 ? "" : "s"}`;
  if (result.logs && !result.proposals.length) status.textContent = `Nothing proposed from ${from}. ${rule}`;
  else if (result.logs) status.textContent = `${result.proposals.length} proposed from ${from}.`;
  $("#proposal-list").replaceChildren(...result.proposals.map((p) => proposalCard(p, result.categories)));
  const held = [...result.withheld, ...result.problems.map((p) => ({ reason: `${p.file}:${p.line}: ${p.message || p.error || "unreadable"}` }))];
  $("#withheld").hidden = !held.length;
  $("#withheld-list").replaceChildren(...held.map((w) => Object.assign(document.createElement("li"), {
    textContent: w.id ? `${w.about?.question || w.about?.property || w.rule || w.id}: ${w.reason}` : w.reason })));
}

function decisionLine(d) {
  const li = document.createElement("li");
  const chose = Array.isArray(d.chose) ? d.chose.join(", ") : d.chose;
  li.textContent = `${chose}${d.over?.length ? ` over ${d.over.join(", ")}` : ""} · ${d.project} · `
    + `${new Date(d.at).toLocaleDateString()} · ${d.why ? `“${d.why}”` : "no reason given"}`;
  return li;
}

function proposalCard(p, categories) {
  const li = document.createElement("li");
  li.className = "card proposal";
  const about = [p.about.topic, p.about.property || p.about.question || p.rule].filter(Boolean).join(" · ");
  const heading = document.createElement("h3");
  heading.textContent = `${PROPOSAL_KINDS[p.kind] || p.kind}: ${about}`;
  const direction = document.createElement("p");
  direction.textContent = `${p.direction}, in ${p.projects.join(", ")}`
    + (p.current ? ` (now: ${p.current})` : "") + ` · ${p.decisions.length} decisions`;
  const list = document.createElement("ul");
  list.className = "proposal-decisions";
  list.append(...p.decisions.map(decisionLine));
  li.append(heading, direction, list);
  if (p.contrary?.length) {
    const contrary = document.createElement("ul");
    contrary.className = "proposal-decisions";
    contrary.append(...p.contrary.map(decisionLine));
    li.append(Object.assign(document.createElement("p"), { textContent: "Against it:" }), contrary);
  }
  if (p.suggested) {
    const when = p.suggested.applies_when.map((w) => Object.entries(w).map(([k, v]) => `${k.replace("_", " ")} ${v}`).join(", ")).join("; ");
    li.append(Object.assign(document.createElement("p"), { className: "help",
      textContent: `Confirming writes: applies when ${when}; alternatives ${p.suggested.alternatives.join(", ")}.` }));
  }
  const form = document.createElement("form");
  form.className = "proposal-answer";
  const field = (labelText, input) => {
    const label = document.createElement("label");
    label.textContent = labelText;
    label.append(input);
    return label;
  };
  const why = document.createElement("textarea");
  why.rows = 2;
  form.append(field(p.kind === "revision" ? "Your reason (optional)" : "Your reason, in your words (needed to confirm)", why));
  const extra = {};
  if (p.kind === "new-rule") {
    extra.rule_id = Object.assign(document.createElement("input"), { type: "text" });
    extra.title = Object.assign(document.createElement("input"), { type: "text" });
    extra.category = document.createElement("select");
    extra.category.append(new Option("Choose…", ""), ...categories.map((c) => new Option(c, c)));
    form.append(field("Rule id (kebab-case)", extra.rule_id), field("Title", extra.title), field("Category", extra.category));
  }
  const row = document.createElement("div");
  row.className = "row";
  const answer = async (action) => {
    const body = { why: why.value };
    for (const [k, el] of Object.entries(extra)) body[k] = el.value;
    try {
      await api(`/api/proposals/${p.id}/${action}`, { method: "POST", body: JSON.stringify(body) });
    } catch (err) {
      setStatus(err.message);
      form.querySelector(".proposal-error")?.remove();
      form.append(Object.assign(document.createElement("p"), { className: "proposal-error", textContent: err.message }));
      return;
    }
    answerBox.replaceWith(Object.assign(document.createElement("p"), { className: "help",
      textContent: action === "confirm" ? "Confirmed. design-guide wrote the rule." : "Rejected. It won't be proposed again from these decisions." }));
  };
  if (p.kind !== "revision") {
    const confirm = Object.assign(document.createElement("button"), { type: "submit", className: "btn btn-primary", textContent: "Confirm" });
    row.append(confirm);
  } else {
    form.append(Object.assign(document.createElement("p"), { className: "help",
      textContent: "A revision can't be confirmed yet: narrowing a rule needs its new wording, which nothing should invent. You can reject it." }));
  }
  const reject = Object.assign(document.createElement("button"), { type: "button", className: "btn btn-secondary", textContent: "Reject" });
  reject.addEventListener("click", () => answer("reject"));
  row.append(reject);
  form.append(row);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    answer("confirm");
  });
  // Folded until the user chooses to answer, so a list of proposals reads as a list.
  const answerBox = document.createElement("details");
  answerBox.className = "proposal-answer-box";
  const summary = document.createElement("summary");
  summary.textContent = p.kind === "revision" ? "Reject…" : "Confirm or reject…";
  answerBox.append(summary, form);
  li.append(answerBox);
  return li;
}

// New designs start with the default design system; the form can pick another or none.
function renderNewDesignSystems() {
  const select = $("#new-ds-select");
  const systems = state.projects.filter((p) => p.kind === "design-system");
  select.replaceChildren(new Option("None", ""), ...systems.map((p) => new Option(
    p.slug === state.settings.default_design_system ? `${p.name} (default)` : p.name, p.slug)));
  select.value = state.settings.default_design_system || "";
}

// Prompt starters: each creates a design and puts its prompt in the composer to edit.
const STARTERS = [
  { name: "Landing page", prompt: "A landing page for a product: hero with a clear headline and call to action, three benefit sections with real copy, social proof, pricing teaser and footer." },
  { name: "Dashboard", prompt: "An analytics dashboard: sidebar navigation, a row of key metrics with trends, a main chart, a sortable table of recent items and a filter bar." },
  { name: "Mobile app", prompt: "A mobile app home screen at 390 px: top bar, a personalised summary card, a list of recent activity and a bottom tab bar, with a detail screen on tap." },
  { name: "Pricing page", prompt: "A pricing page with three plans, a monthly/yearly toggle that updates prices, a feature comparison and an FAQ." },
  { name: "Sign-up flow", prompt: "A three-step sign-up flow as separate pages: account details, plan choice and confirmation, with validation and a progress indicator." },
  { name: "One-pager", prompt: "A one-page brief for a proposal: title, summary, the problem, the plan with a timeline, costs and a clear ask. Printable as a PDF." },
];

function renderStarters() {
  $("#starter-list").replaceChildren(...STARTERS.map((st) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-secondary btn-small";
    btn.textContent = st.name;
    btn.onclick = () => createDesign($("#new-name").value.trim() || st.name, st.prompt);
    li.append(btn);
    return li;
  }));
}

// `designSystem`: from the Library; otherwise the new-design form's choice.
async function createDesign(name, prefill = null, designSystem = undefined) {
  const project = await (await api("/api/projects", {
    method: "POST",
    body: JSON.stringify({ name, model: $("#new-model").value || null,
                           design_system: designSystem ?? ($("#new-ds-select").value || null) }),
  })).json();
  $("#new-name").value = "";
  state.prefill = prefill;
  location.hash = `#/p/${project.slug}`;
}

// ---------- Connectors (Home) ----------

async function loadConnectors() {
  const list = await (await api("/api/connectors")).json();
  $("#connector-list").hidden = list.length === 0;
  $("#connector-list").replaceChildren(...list.map((c) => {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.className = "connector-name";
    name.textContent = c.name;
    const target = document.createElement("span");
    target.className = "connector-target mono";
    target.textContent = c.target;
    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn-icon btn-icon-sm";
    del.setAttribute("aria-label", `Remove connector ${c.name}`);
    del.append(icon(["M6 6l12 12", "M18 6L6 18"], 12));
    del.onclick = async () => {
      await api(`/api/connectors/${encodeURIComponent(c.name)}`, { method: "DELETE" });
      loadConnectors();
    };
    li.append(name, target, del);
    return li;
  }));
}

$("#new-connector").addEventListener("submit", async (e) => {
  e.preventDefault();
  const error = $("#connector-error");
  error.textContent = "";
  $("#connector-config").removeAttribute("aria-invalid");
  let config;
  try {
    config = JSON.parse($("#connector-config").value);
  } catch {
    error.textContent = "The config is not valid JSON.";
    $("#connector-config").setAttribute("aria-invalid", "true");
    return;
  }
  try {
    await api(`/api/connectors/${encodeURIComponent($("#connector-name").value.trim())}`, {
      method: "PUT", body: JSON.stringify({ config }),
    });
  } catch (err) {
    error.textContent = err.message;
    return;
  }
  $("#connector-name").value = "";
  $("#connector-config").value = "";
  loadConnectors();
});

const isApproved = (p) => Boolean(p.approved && p.version && p.approved.sha === p.version);

// The grid's filters: by state, and by design system (section 4). Systems has none.
function renderFilters() {
  const designs = state.projects.filter((p) => p.kind === "design");
  const names = Object.fromEntries(state.projects.map((p) => [p.slug, p.name]));
  const counts = {};
  for (const p of designs) if (p.design_system) counts[p.design_system] = (counts[p.design_system] || 0) + 1;
  const options = state.section === "systems" ? [] : [
    ["", "All", designs.length],
    ["approval", "Needs approval", designs.filter((p) => p.version && !isApproved(p)).length],
    ["findings", "Has findings", designs.filter((p) => p.findings?.count).length],
    ...Object.entries(counts).map(([slug, n]) => [`system:${slug}`, names[slug] || slug, n]),
    ["system:", "No system", designs.filter((p) => !p.design_system).length],
  ];
  $("#project-tools").hidden = !options.length;
  $("#project-tools").replaceChildren(...options.map(([value, label, n]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-pressed", String(value === state.filter));
    const count = document.createElement("span");
    count.className = "n";
    count.textContent = String(n);
    b.append(label, " ", count);
    b.addEventListener("click", () => {
      state.filter = value;
      renderFilters();
      renderProjects();
    });
    return b;
  }));
}

function matchesFilter(p) {
  const f = state.filter || "";
  if (f === "approval") return Boolean(p.version) && !isApproved(p);
  if (f === "findings") return Boolean(p.findings?.count);
  if (f.startsWith("system:")) return (p.design_system || "") === f.slice(7);
  return true;
}

function renderProjects() {
  const kind = state.section === "systems" ? "design-system" : "design";
  const list = state.projects.filter((p) => p.kind === kind);
  const query = $("#project-search").value.trim().toLowerCase();
  const shown = list.filter((p) => matchesFilter(p) && (!query || p.name.toLowerCase().includes(query)));
  $("#no-projects").hidden = list.length > 0;
  $("#no-projects").textContent = kind === "design" ? "No designs yet. Start one with New."
    : "No design systems yet. Build one with New.";
  $("#no-matches").hidden = list.length === 0 || shown.length > 0;
  const names = Object.fromEntries(state.projects.map((p) => [p.slug, p.name]));
  $("#project-list").replaceChildren(...shown.map((p, i) => {
    const card = projectCard(p, names);
    card.style.setProperty("--i", String(Math.min(i, 12))); // a short stagger for the first rows
    return card;
  }));
  renderSearchMore(query);
}

// One search across the studio (section 3): beside the grid's own matches, the other kind of
// project, techniques by intent and Wada palettes by colour name, each a link to open.
let searchToken = 0;
async function renderSearchMore(query) {
  const box = $("#search-more");
  const token = ++searchToken;
  if (query.length < 2) {
    box.hidden = true;
    return;
  }
  const [techniques, wada] = await Promise.all([techniqueData(), wadaData()]);
  if (token !== searchToken) return;
  const otherKind = state.section === "systems" ? "design" : "design-system";
  const groups = [
    [otherKind === "design" ? "Projects" : "Design systems", state.projects
      .filter((p) => p.kind === otherKind && p.name.toLowerCase().includes(query))
      .map((p) => [p.name, `#/p/${p.slug}`, null])],
    ["Techniques", rank.rankByIntent(techniques, query).slice(0, 6)
      .map(({ technique: t }) => [t.label, null, () => openTechniques({ mode: "library", id: t.id })])],
    ["Wada palettes", Object.entries(wada)
      .filter(([, c]) => c.colors.some((col) => col.name.toLowerCase().includes(query))).slice(0, 6)
      .map(([n, c]) => [`Wada ${pad3(Number(n))} · ${c.colors.map((col) => col.name).join(", ")}`, null,
        () => createDesign(`Wada ${pad3(Number(n))}`, paletteMessage(Number(n)))])],
  ].filter(([, items]) => items.length);
  box.hidden = !groups.length;
  box.replaceChildren(...groups.map(([title, items]) => {
    const group = document.createElement("div");
    group.className = "search-group";
    const h = document.createElement("h3");
    h.textContent = title;
    const ul = document.createElement("ul");
    ul.append(...items.map(([label, href, onClick]) => {
      const li = document.createElement("li");
      const el = document.createElement(href ? "a" : "button");
      if (href) el.href = href;
      else { el.type = "button"; el.addEventListener("click", onClick); }
      el.textContent = label;
      li.append(el);
      return li;
    }));
    group.append(h, ul);
    return group;
  }));
}

$("#project-search").addEventListener("input", renderProjects);

// A small render of the project's latest version (GET .../thumbnail, cached per version on
// the server; `?v=` busts the browser cache when a new version lands). Loaded lazily, so
// only cards scrolled into view are rendered. The thumbnail opens the project too; it is
// hidden from assistive tech and the tab order, since the name link already does that.
function thumbnail(p) {
  const box = document.createElement("a");
  box.className = "thumb";
  box.href = `#/p/${p.slug}`;
  box.tabIndex = -1;
  box.setAttribute("aria-hidden", "true");
  const empty = () => {
    const note = document.createElement("span");
    note.textContent = "No design yet";
    box.replaceChildren(note);
    box.dataset.empty = "";
  };
  if (!p.version) {
    empty();
    return box;
  }
  const img = document.createElement("img");
  img.alt = "";
  img.loading = "lazy";
  img.decoding = "async";
  img.src = `/api/projects/${p.slug}/thumbnail?v=${p.version}`;
  img.onerror = empty;
  box.append(img);
  return box;
}

function projectCard(p, names) {
  const li = document.createElement("li");
  const titleRow = document.createElement("div");
  titleRow.className = "title-row";
  const open = document.createElement("a");
  open.className = "open";
  open.href = `#/p/${p.slug}`;
  open.textContent = p.name;
  titleRow.append(open);
  if (p.kind === "design-system") {
    const badge = document.createElement("span");
    badge.className = "badge tag";
    badge.textContent = p.slug === state.settings.default_design_system ? "Default system"
      : p.builtin ? "Built-in system" : "Design system";
    titleRow.append(badge);
  }
  const meta = document.createElement("p");
  meta.className = "meta";
  const parts = [!p.model ? "Claude" : p.model.startsWith("ollama:") ? `Local: ${p.model.replace(/^ollama:/, "")}`
    : `Claude ${p.model.replace(/^claude-/, "").replace(/-\d{8}$/, "")}`];
  if (p.design_system && names[p.design_system]) parts.push(names[p.design_system]);
  if (p.kind === "design-system") {
    parts.push(p.builtin ? "built in" : p.source ? `from ${p.source}` : "from attached files");
  }
  meta.textContent = parts.join(" · ");
  // Its state at a glance: approved for build, design-guide's findings, the palette.
  const status = document.createElement("p");
  status.className = "card-state";
  const states = [];
  if (isApproved(p)) states.push(["ok", "Approved for build"]);
  else if (p.approved) states.push(["", "Changed since approval"]);
  if (p.findings?.count) {
    states.push([p.findings.blocking ? "bad" : "", `${p.findings.count} finding${p.findings.count === 1 ? "" : "s"}`]);
  }
  if (p.palette) states.push(["", p.palette.replace(/^wada:\s*/i, "Wada ")]);
  status.append(...states.map(([cls, text]) => {
    const s = document.createElement("span");
    if (cls) s.className = cls;
    s.textContent = text;
    return s;
  }));
  const actions = document.createElement("div");
  actions.className = "actions";
  const when = document.createElement("span");
  when.className = "when";
  when.textContent = timeAgo(p.updated);
  const dup = document.createElement("button");
  dup.type = "button";
  dup.textContent = "Duplicate";
  dup.setAttribute("aria-label", `Duplicate ${p.name}`);
  dup.onclick = async () => {
    await api(`/api/projects/${p.slug}/duplicate`, { method: "POST" });
    showHome();
  };
  const del = document.createElement("button");
  del.type = "button";
  del.className = "danger";
  del.textContent = "Delete";
  del.setAttribute("aria-label", `Delete ${p.name}`);
  del.onclick = async () => {
    if (!confirm(`Delete "${p.name}" and all its files? This cannot be undone.`)) return;
    await api(`/api/projects/${p.slug}`, { method: "DELETE" });
    showHome();
  };
  actions.append(when);
  if (p.kind === "design-system") {
    // The default system is attached to every new design (Claude Design's "Published").
    const isDefault = p.slug === state.settings.default_design_system;
    const def = document.createElement("button");
    def.type = "button";
    def.textContent = "Default";
    def.setAttribute("aria-pressed", String(isDefault));
    def.setAttribute("aria-label", `Default for new designs: ${p.name}`);
    def.onclick = async () => {
      state.settings = await (await api("/api/settings/default-design-system", {
        method: "PUT", body: JSON.stringify({ design_system: isDefault ? null : p.slug }),
      })).json();
      renderProjects();
      renderNewDesignSystems();
    };
    actions.append(def);
    const use = document.createElement("button");
    use.type = "button";
    use.textContent = "New design";
    use.setAttribute("aria-label", `New design with ${p.name}`);
    use.onclick = () => createDesign(`${p.name} design`, null, p.slug);
    actions.append(use);
  }
  actions.append(dup);
  if (!p.builtin) actions.append(del); // a built-in system would come back on the next start
  const body = document.createElement("div");
  body.className = "card-body";
  body.append(titleRow, meta);
  if (status.childElementCount) body.append(status);
  body.append(actions);
  li.append(thumbnail(p), body);
  return li;
}

$("#new-project").addEventListener("submit", (e) => {
  e.preventDefault();
  createDesign($("#new-name").value);
});

// The native file input stays hidden; a Paper button opens it and the names show beside it.
$("#ds-files-pick").addEventListener("click", () => $("#ds-files").click());
function showChosenFiles() {
  const names = [...$("#ds-files").files].map((f) => f.name);
  $("#ds-files-names").textContent = names.length ? names.join(", ") : "None chosen";
}
$("#ds-files").addEventListener("change", showChosenFiles);

$("#new-ds").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#ds-error").textContent = "";
  $("#ds-source").removeAttribute("aria-invalid");
  const source = $("#ds-source").value.trim();
  const files = [...$("#ds-files").files];
  if (!source && !files.length) {
    $("#ds-error").textContent = "Give a source, attach files, or both.";
    $("#ds-source").setAttribute("aria-invalid", "true");
    return;
  }
  // A GitHub clone or Figma export can take a while.
  const create = $("#ds-create");
  create.disabled = true;
  create.textContent = /^https:/.test(source) ? "Fetching…" : "Creating…";
  let project;
  try {
    project = await (await api("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name: $("#ds-name").value, kind: "design-system", source }),
    })).json();
    // The files go with the first message, as attachments the extraction agent reads.
    for (const file of files) {
      const res = await fetch(`/api/projects/${project.slug}/attachments?name=${encodeURIComponent(file.name)}`,
        { method: "POST", body: file });
      if (!res.ok) throw new Error(`${file.name}: ${(await res.json()).detail}`);
    }
  } catch (err) {
    $("#ds-error").textContent = err.message;
    if (!project) $("#ds-source").setAttribute("aria-invalid", "true");
    else location.hash = `#/p/${project.slug}`; // created; the failed file can be attached again there
    return;
  } finally {
    create.disabled = false;
    create.textContent = "Create";
  }
  $("#ds-name").value = "";
  $("#ds-source").value = "";
  $("#ds-files").value = "";
  showChosenFiles();
  location.hash = `#/p/${project.slug}`;
});

// ---------- Studio ----------

async function showStudio(slug) {
  const project = await (await api(`/api/projects/${slug}`)).json();
  state.slug = slug;
  state.entry = project.entry;
  closeCompare();
  state.page = project.entry;
  // A built-in design system changes in the workspace (design-systems/<id>/); the studio only shows it.
  state.builtin = Boolean(project.builtin);
  state.approved = project.approved || null;
  state.planFirst = Boolean(project.plan_first);
  updatePlanFirst();
  for (const id of ["chat-form", "comment-mode", "edit-mode", "draw-mode"]) $(`#${id}`).hidden = state.builtin;
  $("#home").hidden = true;
  $("#studio").hidden = false;
  $("#project-name").textContent = project.name;
  state.local = Boolean(project.model && project.model.startsWith("ollama:"));
  fillModelSelect($("#model-select"), project.model || "");
  // Set when a Claude Code session used this project through the MCP link.
  $("#link-note").hidden = !project.last_claude_code;
  $("#link-note").textContent = project.last_claude_code
    ? `Claude Code · ${timeAgo(project.last_claude_code)}` : "";
  document.title = `${project.name} · Ultimate Design`;
  renderPages(project.files);
  state.isSystem = project.kind === "design-system";
  state.palette = [];
  state.priorityCount = 0;
  $("#palette-note").hidden = true; // until the canvas reports the page's palette
  $("#priority-mode").hidden = true;
  $("#palette-browse").hidden = true; // designs without a system show it (renderDesignSystemChoice)
  $("#technique-browse").hidden = state.isSystem;
  $("#edit-technique").hidden = state.isSystem;
  state.usage = project.usage;
  renderUsage();

  $("#chat-log").replaceChildren();
  $("#project-menu").open = false;
  setTab("agent");
  showFindings(null);
  state.steps = null;
  state.techniques = new Set();
  state.questionCard = null;
  state.running = false; // history renders as finished; a live turn is picked up below
  state.replaying = true;
  for (const event of project.chat) renderEvent(event);
  state.replaying = false;
  animateIn($(".studio-body"));
  setView("chat");
  setRunning(project.running);
  state.viewing = null;
  state.tweakValues = {};
  state.edits = { styles: {}, texts: [], structural: [] };
  state.board = null;
  state.boardFrame = null;
  stopPresenting();
  if (draw.on) setDrawMode(false);
  setCanvasView("page", { reload: false });
  setEditMode(false);
  setCommentMode(false);
  hideCommentForm();
  renderComments(project.comments);
  renderAttachments(project.attachments);
  $("#capture-form").hidden = true;
  renderVersions(project.versions);
  reloadCanvas(project.files.includes(project.entry));

  const isSystem = project.kind === "design-system";
  $("#ds-source-note").hidden = !isSystem;
  $("#ds-source-note").textContent = !isSystem ? ""
    : project.builtin ? `Built in · change design-systems/${project.builtin}/ in the workspace, or duplicate it to change it here`
    : `Extracted from ${project.source || "attached files"}`;
  $("#ds-refresh").hidden = !(isSystem && /^https:/.test(project.source || ""));
  $("#ds-choice").hidden = isSystem;
  if (isSystem && !project.builtin && project.chat.length === 0) {
    $("#chat-input").value = project.source ? "Extract the design system from the source."
      : "Extract the design system from the attached files.";
  }
  if (state.prefill && project.chat.length === 0) $("#chat-input").value = state.prefill;
  state.prefill = null;
  $("#reference-choice").hidden = isSystem;
  $("#reference-error").textContent = "";
  if (!isSystem) renderReferences(project.references);
  if (!isSystem) await renderDesignSystemChoice(project.design_system);
  updateProjectChip();
  renderConnectorChoice(project.connectors);
  if (project.running) {
    // A turn started before this page loaded (reload, or another tab): pick it up where
    // the saved chat ends.
    setStatus("Working…");
    followTurn(slug, () => api(`/api/projects/${slug}/turn?since=${project.turn_events}`));
  }
}

// ---------- Model (switchable per project) ----------

$("#model-select").addEventListener("change", async () => {
  const model = $("#model-select").value || null;
  try {
    const meta = await (await api(`/api/projects/${state.slug}/model`, {
      method: "PUT", body: JSON.stringify({ model }),
    })).json();
    state.local = Boolean(meta.model && meta.model.startsWith("ollama:"));
    setStatus(meta.session_id === null && meta.pending_note?.includes("model was switched")
      ? "Model changed. The next message starts a new conversation (the files stay)."
      : "Model changed from your next message.");
  } catch (err) {
    setStatus(err.message);
  }
});

// ---------- Design systems ----------

async function renderDesignSystemChoice(current) {
  const systems = (await (await api("/api/projects")).json()).filter((p) => p.kind === "design-system");
  const select = $("#ds-select");
  select.replaceChildren(new Option("None", ""));
  for (const s of systems) select.append(new Option(s.name, s.slug));
  select.value = current || "";
  // Wada palettes are for designs without a design system (verify follows the system).
  $("#palette-browse").hidden = Boolean(current);
}

$("#ds-select").addEventListener("change", async () => {
  const choice = $("#ds-select").value || null;
  updateProjectChip();
  try {
    await api(`/api/projects/${state.slug}/design-system`, {
      method: "PUT",
      body: JSON.stringify({ design_system: choice }),
    });
  } catch (err) {
    setStatus(err.message);
    return;
  }
  await loadVersions();
  $("#palette-browse").hidden = Boolean(choice);
  if (choice && !$("#chat-input").value.trim()) {
    $("#chat-input").value = "Restyle the design with the design system.";
  }
  setStatus(choice ? "Design system attached. The agent applies it on your next message." : "Design system removed.");
});

$("#ds-refresh").addEventListener("click", async () => {
  const button = $("#ds-refresh");
  button.disabled = true;
  setStatus("Fetching the source again…");
  try {
    await api(`/api/projects/${state.slug}/source/refresh`, { method: "POST" });
    setStatus("Source refreshed. Ask the agent to update the system from it.");
  } catch (err) {
    setStatus(err.message);
  } finally {
    button.disabled = false;
  }
});

// ---------- References (reference folders for a design) ----------

function renderReferences(list) {
  $("#reference-summary").textContent = list.length ? `References · ${list.length}` : "References";
  $("#reference-list").hidden = list.length === 0;
  $("#reference-list").replaceChildren(...list.map((r) => {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.className = "reference-source mono";
    name.textContent = r.source;
    name.title = r.source; // truncated to one line; the full path on hover
    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn-icon btn-icon-sm";
    del.setAttribute("aria-label", `Disconnect ${r.source}`);
    del.append(icon(["M6 6l12 12", "M18 6L6 18"], 12));
    del.onclick = async () => {
      try {
        const meta = await (await api(`/api/projects/${state.slug}/references?source=${encodeURIComponent(r.source)}`,
          { method: "DELETE" })).json();
        renderReferences(meta.references);
      } catch (err) {
        setStatus(err.message);
      }
    };
    li.append(name, del);
    return li;
  }));
}

$("#reference-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("#reference-source");
  const source = input.value.trim();
  if (!source) return;
  $("#reference-error").textContent = "";
  input.removeAttribute("aria-invalid");
  const add = $("#reference-add");
  add.disabled = true;
  add.textContent = /^https:/.test(source) ? "Fetching…" : "Adding…";
  try {
    const meta = await (await api(`/api/projects/${state.slug}/references`, {
      method: "POST", body: JSON.stringify({ source }),
    })).json();
    input.value = "";
    renderReferences(meta.references);
    setStatus("The agent can read it from your next message.");
  } catch (err) {
    $("#reference-error").textContent = err.message;
    input.setAttribute("aria-invalid", "true");
  } finally {
    add.disabled = false;
    add.textContent = "Add";
  }
});

// ---------- Connectors (per project) ----------

async function renderConnectorChoice(chosen) {
  const list = await (await api("/api/connectors")).json();
  $("#connector-choice").hidden = list.length === 0;
  const on = new Set(chosen);
  const fieldset = $("#connector-options");
  fieldset.replaceChildren(fieldset.querySelector("legend"), ...list.map((c) => {
    const label = document.createElement("label");
    label.className = "check";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.value = c.name;
    box.checked = on.has(c.name);
    box.onchange = saveConnectorChoice;
    label.append(box, c.name);
    return label;
  }));
  updateConnectorSummary();
}

function updateConnectorSummary() {
  const n = document.querySelectorAll("#connector-options input:checked").length;
  $("#connector-summary").textContent = n ? `Connectors · ${n} on` : "Connectors · off";
}

async function saveConnectorChoice() {
  const names = [...document.querySelectorAll("#connector-options input:checked")].map((b) => b.value);
  try {
    await api(`/api/projects/${state.slug}/connectors`, { method: "PUT", body: JSON.stringify({ names }) });
    setStatus("Connectors apply from your next message.");
  } catch (err) {
    setStatus(err.message);
  }
  updateConnectorSummary();
}

// ---------- Export ----------

// <details> has no built-in Escape or click-outside close.
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if ($("#export").open) {
    $("#export").open = false;
    $("#export summary").focus();
  } else if (state.commentMode && !$("#comment-form").contains(e.target)) {
    setCommentMode(false);
  } else if (state.editMode && !$("#edit-panel").contains(e.target)) {
    setEditMode(false);
  } else if (draw.on) {
    setDrawMode(false);
  }
});
document.addEventListener("click", (e) => {
  if (!$("#export").contains(e.target)) $("#export").open = false;
});

$("#handoff").addEventListener("click", () => {
  $("#export").open = false;
  $("#chat-input").value = "Write handoff notes in HANDOFF.md.";
  sendMessage();
});

// ---------- Board: the pages side by side (app/board.py) ----------

const BOARD_ZOOMS = [0.1, 0.15, 0.2, 0.25, 0.33, 0.5, 0.67, 0.75, 1];
const ROW_GAP = 120; // board px between rows, and 80 between frames (in CSS), as in Claude Design

// reload: false when the caller loads the canvas itself (opening a project).
function setCanvasView(view, { reload = true } = {}) {
  state.canvasView = view;
  const board = view === "board";
  $("#view-page").setAttribute("aria-pressed", String(!board));
  $("#view-board").setAttribute("aria-pressed", String(board));
  $("#board").hidden = !board;
  $("#studio").dataset.canvasView = view;
  if (board) {
    if (state.editMode) setEditMode(false);
    if (state.commentMode) setCommentMode(false);
    $("#canvas-box").hidden = true;
    $("#canvas-empty").hidden = true;
    animateIn($("#board"));
    loadBoard();
  } else if (state.slug && reload) {
    state.fadeCanvas = true;
    reloadCanvas(state.pages.length > 0);
  }
  $("#comment-mode").disabled = board;
  $("#draw-mode").disabled = board;
  if (board && draw.on) setDrawMode(false);
  $("#edit-mode").disabled = board || Boolean(state.viewing);
  updateTweaksVisibility();
  updateStagePill();
}

$("#view-page").addEventListener("click", () => setCanvasView("page"));
$("#view-board").addEventListener("click", () => setCanvasView("board"));

async function loadBoard() {
  const slug = state.slug;
  const board = await (await api(`/api/projects/${slug}/board`)).json();
  if (state.slug !== slug || state.canvasView !== "board") return;
  const first = !state.board;
  state.board = board;
  renderBoard();
  if (first) fitBoard();
}

function renderBoard() {
  const { rows, frames, problems } = state.board;
  const surface = $("#board-surface");
  const stamp = Date.now();
  surface.replaceChildren(...rows.map((rowTitle, r) => {
    const row = document.createElement("section");
    row.className = "board-row";
    row.setAttribute("aria-label", rowTitle || `Row ${r + 1}`);
    if (rowTitle) {
      const title = document.createElement("p");
      title.className = "board-row-title";
      title.textContent = rowTitle;
      row.append(title);
    }
    const strip = document.createElement("div");
    strip.className = "board-frames";
    for (const f of frames.filter((fr) => fr.row === r)) strip.append(boardFrame(f, stamp));
    row.append(strip);
    return row;
  }));
  surface.style.setProperty("--row-gap", `${ROW_GAP}px`);
  $("#board-problems").hidden = problems.length === 0;
  $("#board-problems").textContent = problems.join(" · ");
  $("#canvas-empty").hidden = frames.length > 0;
  applyBoardTransform();
}

function boardFrame(f, stamp) {
  const key = `${f.page}@${f.width}`;
  const figure = document.createElement("figure");
  figure.className = "board-frame";
  figure.style.width = `${f.width}px`; // the caption never widens a frame (see fitBoard)
  figure.dataset.key = key;
  if (state.boardFrame?.key === key) figure.dataset.selected = "";
  const caption = document.createElement("figcaption");
  const title = document.createElement("span");
  title.className = "frame-title";
  title.textContent = f.title;
  const meta = document.createElement("span");
  meta.className = "frame-meta";
  meta.textContent = `${f.page} · ${f.width}`;
  const open = document.createElement("button");
  open.type = "button";
  open.className = "frame-open";
  open.textContent = "Open";
  open.setAttribute("aria-label", `Open ${f.title}`);
  open.addEventListener("click", () => openFrame(f));
  caption.append(title, meta, open);
  const view = document.createElement("div");
  view.className = "frame-view";
  view.style.width = `${f.width}px`;
  view.style.height = `${f.height}px`;
  const frame = document.createElement("iframe");
  frame.src = `/p/${state.slug}/${f.page}?t=${stamp}`;
  frame.title = `Preview of ${f.title}`;
  frame.tabIndex = -1;
  frame.loading = "lazy";
  frame.setAttribute("sandbox", "allow-scripts");
  view.append(frame);
  // A click (not a drag) selects the frame, so "this" in the next message means it.
  view.addEventListener("click", () => {
    if (boardDrag.moved) return;
    state.boardFrame = state.boardFrame?.key === key ? null : { ...f, key };
    for (const el of document.querySelectorAll(".board-frame")) {
      if (el.dataset.key === state.boardFrame?.key) el.dataset.selected = "";
      else delete el.dataset.selected;
    }
    updateStagePill();
  });
  view.addEventListener("dblclick", () => openFrame(f));
  figure.append(caption, view);
  return figure;
}

function openFrame(f) {
  state.page = f.page;
  renderPages(state.pages.includes(f.page) ? state.pages : [...state.pages, f.page]);
  $(`.toolbar .viewport button[data-width="${f.width}"]`)?.click();
  setCanvasView("page");
}

function applyBoardTransform() {
  const { x, y } = state.boardPan;
  const z = state.boardZoom;
  $("#board-surface").style.transform = `translate(${x}px, ${y}px) scale(${z})`;
  $("#board").style.setProperty("--board-z", String(z));
  $("#board-zoom-level").textContent = `${Math.round(z * 100)}%`;
  // Tiny frames keep only their title and Open button.
  if (z < 0.2) $("#board").dataset.compact = "";
  else delete $("#board").dataset.compact;
}

// Zoom to `z`, keeping the board point under (cx, cy) (stage coordinates) in place.
function zoomBoard(z, cx, cy) {
  const stage = $("#board").getBoundingClientRect();
  const px = cx ?? stage.width / 2;
  const py = cy ?? stage.height / 2;
  const old = state.boardZoom;
  z = Math.min(1, Math.max(0.1, z));
  state.boardPan.x = px - ((px - state.boardPan.x) / old) * z;
  state.boardPan.y = py - ((py - state.boardPan.y) / old) * z;
  state.boardZoom = z;
  applyBoardTransform();
}

function stepZoom(dir) {
  const z = state.boardZoom;
  const next = dir > 0 ? BOARD_ZOOMS.find((v) => v > z + 0.001) : [...BOARD_ZOOMS].reverse().find((v) => v < z - 0.001);
  zoomBoard(next ?? z);
}

// Fit from the board data, not the rendered surface: captions and row titles keep a
// constant size on screen, so in board units they grow as the zoom shrinks, and a
// measured fit would never settle. They get a fixed allowance in screen px instead.
const FRAME_GAP = 80;
const LABEL_SPACE = 48; // screen px per row for a row title and a caption

function fitBoard() {
  if (!state.board || !state.board.frames.length) return;
  const stage = $("#board").getBoundingClientRect();
  if (!stage.width) return;
  const rows = state.board.rows.map((_, r) => state.board.frames.filter((f) => f.row === r));
  const width = Math.max(...rows.map((fs) => fs.reduce((w, f) => w + f.width, 0) + FRAME_GAP * Math.max(0, fs.length - 1)));
  const height = rows.reduce((h, fs) => h + Math.max(0, ...fs.map((f) => f.height)), 0) + ROW_GAP * (rows.length - 1);
  const z = Math.min(1, Math.max(0.1, Math.min((stage.width - 80) / width,
    (stage.height - 120 - LABEL_SPACE * rows.length) / height)));
  state.boardZoom = Math.round(z * 1000) / 1000;
  state.boardPan = { x: Math.max(40, (stage.width - width * z) / 2), y: 40 + LABEL_SPACE };
  applyBoardTransform();
}

$("#board-zoom-in").addEventListener("click", () => stepZoom(1));
$("#board-zoom-out").addEventListener("click", () => stepZoom(-1));
$("#board-fit").addEventListener("click", fitBoard);

// Wheel pans; with Ctrl (a trackpad pinch sends Ctrl too) it zooms around the pointer.
$("#board").addEventListener("wheel", (e) => {
  e.preventDefault();
  const stage = $("#board").getBoundingClientRect();
  if (e.ctrlKey || e.metaKey) {
    zoomBoard(state.boardZoom * Math.exp(-e.deltaY / 300), e.clientX - stage.left, e.clientY - stage.top);
  } else {
    state.boardPan.x -= e.deltaX;
    state.boardPan.y -= e.deltaY;
    applyBoardTransform();
  }
}, { passive: false });

// Drag anywhere except a caption button to pan.
const boardDrag = { moved: false };
$("#board").addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || e.target.closest("button, .board-zoom")) return;
  const start = { x: e.clientX, y: e.clientY, px: state.boardPan.x, py: state.boardPan.y };
  boardDrag.moved = false;
  const move = (ev) => {
    const dx = ev.clientX - start.x;
    const dy = ev.clientY - start.y;
    if (Math.hypot(dx, dy) > 4) boardDrag.moved = true;
    state.boardPan = { x: start.px + dx, y: start.py + dy };
    applyBoardTransform();
  };
  const up = () => {
    document.removeEventListener("pointermove", move);
    setTimeout(() => { boardDrag.moved = false; }, 0);
  };
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", up, { once: true });
});

// Keyboard: arrows pan, + and - zoom, 0 fits (the board itself takes focus).
$("#board").addEventListener("keydown", (e) => {
  const step = 60;
  const moves = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
  if (moves[e.key]) {
    e.preventDefault();
    state.boardPan.x += moves[e.key][0];
    state.boardPan.y += moves[e.key][1];
    applyBoardTransform();
  } else if (e.key === "+" || e.key === "=") stepZoom(1);
  else if (e.key === "-") stepZoom(-1);
  else if (e.key === "0") fitBoard();
});

// ---------- Draw: sketch over the canvas and attach it ----------

// Fixed ink, like the bridge's overlays: it must read on any design.
const DRAW_COLORS = { red: "#e03131", blue: "#1971c2" };
const draw = { on: false, color: "red", strokes: [], current: null };

function setDrawMode(on) {
  if (on && state.editMode) setEditMode(false);
  if (on && state.commentMode) setCommentMode(false);
  draw.on = on;
  $("#draw-mode").setAttribute("aria-pressed", String(on));
  $("#draw-bar").hidden = !on;
  $("#draw-layer").hidden = !on;
  if (on) sizeDrawLayer();
  else { draw.strokes = []; redraw(); }
  updateDrawButtons();
  updateTweaksVisibility();
  updateStagePill();
}

function sizeDrawLayer() {
  const layer = $("#draw-layer");
  const box = $("#canvas-box").getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  layer.width = Math.round(box.width * dpr);
  layer.height = Math.round(box.height * dpr);
  layer.style.width = `${box.width}px`;
  layer.style.height = `${box.height}px`;
  redraw();
}

function redraw() {
  const layer = $("#draw-layer");
  const ctx = layer.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, layer.width, layer.height);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = 4;
  for (const stroke of draw.strokes) {
    ctx.strokeStyle = DRAW_COLORS[stroke.color];
    ctx.beginPath();
    stroke.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    if (stroke.points.length === 1) ctx.lineTo(stroke.points[0][0] + 0.1, stroke.points[0][1]);
    ctx.stroke();
  }
}

function updateDrawButtons() {
  const empty = draw.strokes.length === 0;
  $("#draw-undo").disabled = empty;
  $("#draw-clear").disabled = empty;
  $("#draw-attach").disabled = empty;
}

$("#draw-layer").addEventListener("pointerdown", (e) => {
  const layer = $("#draw-layer");
  layer.setPointerCapture(e.pointerId);
  const at = (ev) => { const r = layer.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
  draw.current = { color: draw.color, points: [at(e)] };
  draw.strokes.push(draw.current);
  redraw();
  const move = (ev) => { draw.current.points.push(at(ev)); redraw(); };
  layer.addEventListener("pointermove", move);
  layer.addEventListener("pointerup", () => {
    layer.removeEventListener("pointermove", move);
    draw.current = null;
    updateDrawButtons();
  }, { once: true });
});

$("#draw-mode").addEventListener("click", () => setDrawMode(!draw.on));
for (const swatch of document.querySelectorAll(".draw-swatch")) {
  swatch.style.setProperty("--swatch", DRAW_COLORS[swatch.dataset.color]);
  swatch.addEventListener("click", () => {
    draw.color = swatch.dataset.color;
    for (const s of document.querySelectorAll(".draw-swatch")) s.setAttribute("aria-pressed", String(s === swatch));
  });
}
$("#draw-undo").addEventListener("click", () => { draw.strokes.pop(); redraw(); updateDrawButtons(); });
$("#draw-clear").addEventListener("click", () => { draw.strokes = []; redraw(); updateDrawButtons(); });

// The server renders the page at the canvas's size and scroll, lays the strokes over it
// and attaches the screenshot to the next message.
$("#draw-attach").addEventListener("click", async () => {
  const button = $("#draw-attach");
  button.disabled = true;
  setStatus("Attaching the sketch…");
  try {
    const item = await (await api(`/api/projects/${state.slug}/attachments/sketch`, {
      method: "POST",
      body: JSON.stringify({
        page: state.page, width: canvasWidth(), height: Math.round(parseFloat($("#canvas").style.height)),
        scroll_y: state.canvasScroll || 0, overlay: $("#draw-layer").toDataURL("image/png"),
      }),
    })).json();
    renderAttachments([...state.attachments, item]);
    setStatus("Sketch attached. Say what it shows and send.");
    setDrawMode(false);
    if (narrow.matches) setView("chat");
    $("#chat-input").focus();
  } catch (err) {
    setStatus(err.message);
    updateDrawButtons();
  }
});

// ---------- Present: the frames full screen, one at a time ----------

const present = { frames: [], index: 0 };

async function startPresenting() {
  if (!state.board) state.board = await (await api(`/api/projects/${state.slug}/board`)).json();
  present.frames = state.board.frames;
  if (!present.frames.length) return;
  const start = state.canvasView === "board" && state.boardFrame
    ? present.frames.findIndex((f) => `${f.page}@${f.width}` === state.boardFrame.key)
    : present.frames.findIndex((f) => f.page === state.page);
  present.index = Math.max(0, start);
  $("#present-view").hidden = false;
  showPresentFrame();
  $("#present-view").requestFullscreen?.().catch(() => { /* the overlay covers the window anyway */ });
  $("#present-view").focus();
}

function showPresentFrame() {
  const f = present.frames[present.index];
  const frame = $("#present-frame");
  // A screen frame fills the height at its device width (scaled down if wider than the
  // window); paper keeps its sheet proportions.
  const scale = Math.min(1, window.innerWidth / f.width, f.paper ? (window.innerHeight - 64) / f.height : 1);
  const height = f.paper ? f.height : (window.innerHeight - 64) / scale;
  Object.assign(frame.style, { width: `${f.width}px`, height: `${height}px`, transform: `scale(${scale})` });
  $(".present-stage").style.height = `${height * scale}px`;
  frame.src = `/canvas/${state.slug}/${f.page}?t=${Date.now()}`;
  $("#present-title").textContent = `${present.index + 1} / ${present.frames.length} · ${f.title}`;
  $("#present-prev").disabled = present.index === 0;
  $("#present-next").disabled = present.index === present.frames.length - 1;
  // A new frame is a new page: keys go back to the presentation until the user clicks in.
  if (document.activeElement === frame) $("#present-view").focus();
}

function stepPresent(dir) {
  const next = present.index + dir;
  if (next < 0 || next >= present.frames.length) return;
  present.index = next;
  showPresentFrame();
}

function stopPresenting() {
  if ($("#present-view").hidden) return;
  $("#present-view").hidden = true;
  $("#present-frame").src = "about:blank";
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  $("#present").focus();
}

function presentKey(key) {
  if (key === "ArrowRight" || key === "PageDown") stepPresent(1);
  else if (key === "ArrowLeft" || key === "PageUp") stepPresent(-1);
  else if (key === "Escape") stopPresenting();
}

$("#present").addEventListener("click", startPresenting);
$("#present-next").addEventListener("click", () => stepPresent(1));
$("#present-prev").addEventListener("click", () => stepPresent(-1));
$("#present-exit").addEventListener("click", stopPresenting);
document.addEventListener("keydown", (e) => {
  if (!$("#present-view").hidden) presentKey(e.key);
});
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement) stopPresenting(); // Esc in full screen exits both
});

// ---------- Pages ----------

// HTML pages of the design (the attached design system's files are not pages of it).
function renderPages(files) {
  state.pages = files.filter((f) => /\.html?$/i.test(f) && !f.startsWith("design-system/"));
  if (!state.pages.includes(state.page)) state.page = state.entry;
  const select = $("#page-select");
  select.replaceChildren(...state.pages.map((f) => new Option(f, f)));
  select.value = state.page;
  $("#page-picker").hidden = state.pages.length < 2;
  renderOutline();
  $("#open-tab").href = `/p/${state.slug}/${state.page}`;
  // Page exports follow the page on the canvas; the board PDF and the ZIP cover everything.
  for (const a of document.querySelectorAll("#export a[data-format]")) {
    const perPage = ["html", "png", "pdf"].includes(a.dataset.format);
    a.href = `/api/projects/${state.slug}/export/${a.dataset.format}`
      + (perPage ? `?page=${encodeURIComponent(state.page)}` : "");
  }
}

// The left column (redesign gate, section 5): pages grouped by folder (Pages, Directions, ...).
function renderOutline() {
  const groups = new Map();
  for (const page of state.pages) {
    const folder = page.includes("/") ? page.split("/")[0] : "";
    const name = folder ? folder.charAt(0).toUpperCase() + folder.slice(1).replace(/[-_]/g, " ") : "Pages";
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(page);
  }
  // Top-level pages first, then each folder (directions/, ...).
  const ordered = [...groups].sort(([a], [b]) => (a === "Pages" ? -1 : b === "Pages" ? 1 : a.localeCompare(b)));
  $("#outline-pages").replaceChildren(...ordered.map(([name, pages]) => {
    const section = document.createElement("section");
    const h = document.createElement("h2");
    h.className = "outline-label";
    h.textContent = name;
    const ul = document.createElement("ul");
    ul.append(...pages.map((page) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = page.includes("/") ? page.slice(page.indexOf("/") + 1) : page;
      b.title = page;
      if (page === state.page) b.setAttribute("aria-current", "page");
      b.addEventListener("click", () => {
        if (state.canvasView === "board") setCanvasView("page", { reload: false });
        state.page = page;
        state.fadeCanvas = true;
        renderPages(state.pages);
        reloadCanvas();
        if (narrow.matches) setView("canvas");
      });
      li.append(b);
      return li;
    }));
    section.append(h, ul);
    return section;
  }));
}

// The top bar's chip: the design system and the page's palette (redesign gate, section 7).
function updateProjectChip() {
  const ds = $("#ds-select");
  const parts = [];
  if (!state.isSystem && ds.value) parts.push(ds.selectedOptions[0]?.textContent.replace(/ \(.*\)$/, ""));
  if (state.paletteNumber) parts.push(`Wada ${pad3(state.paletteNumber)}`);
  $("#project-chip").textContent = parts.join(" · ");
  $("#project-chip").hidden = !parts.length;
}

// The settings popover closes on Escape and on a click outside it.
document.addEventListener("click", (e) => {
  if ($("#project-menu").open && !e.target.closest("#project-menu")) $("#project-menu").open = false;
});
$("#project-menu").addEventListener("keydown", (e) => {
  if (e.key === "Escape" && $("#project-menu").open) {
    e.stopPropagation();
    $("#project-menu").open = false;
    $("#project-menu summary").focus();
  }
});

async function refreshPages() {
  renderPages((await (await api(`/api/projects/${state.slug}`)).json()).files);
}

$("#page-select").addEventListener("change", () => {
  state.page = $("#page-select").value;
  renderPages(state.pages);
  reloadCanvas();
});

// The canvas URL's path after /canvas/<slug>/ or /canvas-version/<slug>/<sha>/.
function pageFromPath(path) {
  const m = decodeURIComponent(path).match(/^\/canvas(?:-version\/[^/]+\/[^/]+|\/[^/]+)\/(.*)$/);
  return (m && m[1]) || state.entry;
}

// ---------- Canvas bridge (static/canvas-bridge.js runs inside the iframe) ----------

function toCanvas(msg) {
  $("#canvas").contentWindow?.postMessage({ source: "pm-studio", ...msg }, "*");
}

window.addEventListener("message", (e) => {
  // The presentation frame only steps; everything else comes from the canvas.
  if (e.source === $("#present-frame").contentWindow && e.data?.source === "pm-bridge") {
    if (e.data.type === "ready") $("#present-frame").contentWindow.postMessage({ source: "pm-studio", type: "present", on: true }, "*");
    else if (e.data.type === "present-key") presentKey(e.data.key);
    return;
  }
  if (e.source !== $("#canvas").contentWindow || e.data?.source !== "pm-bridge") return;
  const msg = e.data;
  if (msg.type === "ready") {
    // A page, version or view the user chose fades in; a reload after the agent writes does not
    // (it would flash on every write).
    if (state.fadeCanvas) { state.fadeCanvas = false; animateIn($("#canvas-box")); }
    state.canvasScroll = 0;
    state.styleBefore = {};
    const page = pageFromPath(msg.path || "");
    if (page !== state.page) { // a link in the design opened another page
      state.page = page;
      if (!state.pages.includes(page)) state.pages = [...state.pages, page];
      renderPages(state.pages);
      state.tweakValues = {};
      if (state.selection) { state.selection = null; renderSelection(); }
    }
    if ((msg.fixedWidth || null) !== (state.pageWidth || null)) {
      state.pageWidth = msg.fixedWidth || null;
      updateViewportButtons();
      fitCanvas();
    }
    state.tokens = msg.tokens || [];
    state.fontTokens = msg.fontTokens || [];
    state.sizeTokens = msg.sizeTokens || [];
    state.pageFonts = msg.pageFonts || [];
    renderTokenOptions();
    showPalette(msg.palette);
    state.priorityCount = msg.priorities || 0;
    updatePriorityButton();
    renderTweaks(msg.tweaks);
    for (const [name, value] of Object.entries(state.tweakValues)) toCanvas({ type: "set-tweak", name, value });
    renderOptions(msg.options);
    sendPins();
    toCanvas({ type: "comment-mode", on: state.commentMode });
    // Unsaved direct edits survive a canvas reload.
    for (const [selector, props] of Object.entries(state.edits.styles[state.page] || {})) {
      for (const [prop, value] of Object.entries(props)) toCanvas({ type: "set-style", selector, prop, value });
    }
    for (const t of state.edits.texts) toCanvas({ type: "set-text", selector: t.selector, text: t.after });
    toCanvas({ type: "edit-mode", on: state.editMode });
  } else if (msg.type === "selected") {
    state.selection = msg.selector ? msg : null;
    renderSelection();
  } else if (msg.type === "scroll") {
    state.canvasScroll = msg.y;
  } else if (msg.type === "structural") {
    // Duplicate and wrap are previewed in the canvas; the agent makes them real.
    if (msg.ok) {
      state.edits.structural.push({ ...msg, page: state.page });
      updateEditButtons();
      if (msg.kind === "wrap") { state.selection = null; renderSelection(); }
    } else {
      setStatus(msg.reason);
    }
  } else if (msg.type === "text-edited") {
    recordText(msg);
  } else if (msg.type === "style-changed") {
    for (const [prop, value] of Object.entries(msg.props)) recordStyle(msg.selector, prop, value);
  } else if (msg.type === "style-before") {
    const props = ((state.styleBefore[state.page] ||= {})[msg.selector] ||= {});
    if (!(msg.prop in props)) props[msg.prop] = msg.value;
  } else if (msg.type === "picked") {
    showCommentForm(msg);
  } else if (msg.type === "escape") {
    if (state.editMode) setEditMode(false);
    else setCommentMode(false);
  }
});

// ---------- Comments ----------

function setCommentMode(on) {
  if (on && state.editMode) setEditMode(false);
  if (on && draw.on) setDrawMode(false);
  state.commentMode = on;
  $("#comment-mode").setAttribute("aria-pressed", String(on));
  toCanvas({ type: "comment-mode", on });
  updateTweaksVisibility(); // Tweaks get out of the way while picking elements
  updateStagePill();
}

$("#comment-mode").addEventListener("click", () => setCommentMode(!state.commentMode));

function showCommentForm(picked) {
  state.picked = picked;
  const text = picked.text ? ` “${picked.text.slice(0, 60)}”` : "";
  $("#comment-target").textContent = `Comment on <${picked.tag}>${text}`;
  $("#comment-form").hidden = false;
  if (narrow.matches) setView("chat"); // the form lives in the chat pane
  $("#comment-note").focus();
}

function hideCommentForm() {
  state.picked = null;
  $("#comment-note").value = "";
  $("#comment-form").hidden = true;
}

$("#comment-cancel").addEventListener("click", hideCommentForm);

$("#comment-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const note = $("#comment-note").value.trim();
  if (!note || !state.picked) return;
  await api(`/api/projects/${state.slug}/comments`, {
    method: "POST",
    body: JSON.stringify({
      selector: state.picked.selector,
      tag: state.picked.tag,
      element_text: state.picked.text,
      note,
      page: state.page === state.entry ? "" : state.page,
    }),
  });
  hideCommentForm();
  await loadComments();
});

async function loadComments() {
  renderComments(await (await api(`/api/projects/${state.slug}/comments`)).json());
}

function renderComments(list) {
  state.comments = list;
  $("#comments").hidden = list.length === 0;
  const ol = $("#comment-list");
  ol.replaceChildren();
  list.forEach((c, i) => {
    const li = document.createElement("li");
    const note = document.createElement("span");
    note.className = "note";
    note.textContent = c.note;
    const target = document.createElement("span");
    target.className = "target";
    target.textContent = `<${c.tag}>${c.element_text ? ` “${c.element_text.slice(0, 40)}”` : ""}`
      + (c.page ? ` · ${c.page}` : "");
    note.append(target);
    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn-icon btn-icon-sm";
    del.setAttribute("aria-label", `Delete comment ${i + 1}`);
    del.append(icon(["M6 6l12 12", "M18 6L6 18"]));
    del.onclick = async () => {
      await api(`/api/projects/${state.slug}/comments/${c.id}`, { method: "DELETE" });
      loadComments();
    };
    // Ticked comments go with the next message; unticked ones stay open for later.
    const send = document.createElement("input");
    send.type = "checkbox";
    send.checked = !state.commentHold.has(c.id);
    send.setAttribute("aria-label", `Send comment ${i + 1} with the next message`);
    send.addEventListener("change", () => {
      if (send.checked) state.commentHold.delete(c.id);
      else state.commentHold.add(c.id);
    });
    li.append(send, numberBadge(i + 1), note, del);
    ol.append(li);
  });
  sendPins();
}

// Pins for the comments on the page the canvas shows.
function sendPins() {
  const here = (c) => (c.page || state.entry) === state.page;
  toCanvas({ type: "pins", pins: state.comments.map((c, i) => ({ selector: c.selector, label: String(i + 1), c }))
    .filter((p) => here(p.c)).map(({ selector, label }) => ({ selector, label })) });
}

// ---------- Direct edits (Edit mode) ----------

function setEditMode(on) {
  if (on && state.commentMode) setCommentMode(false);
  if (on && draw.on) setDrawMode(false);
  state.editMode = on;
  $("#edit-mode").setAttribute("aria-pressed", String(on));
  $("#edit-panel").hidden = !on;
  $("#inspect-empty").hidden = on;
  if (on) setTab("inspect");
  else if (state.tab === "inspect") setTab("agent");
  if (!on) state.selection = null;
  toCanvas({ type: "edit-mode", on });
  renderSelection();
  updateTweaksVisibility();
  updateStagePill();
}

$("#edit-mode").addEventListener("click", () => setEditMode(!state.editMode));
$("#inspect-edit").addEventListener("click", () => setEditMode(true));

// ---- The right panel's tabs (redesign gate, section 5): Agent, Inspect, Findings, History ----
const TABS = ["agent", "inspect", "findings", "history"];
function setTab(name) {
  state.tab = name;
  for (const t of TABS) {
    const btn = $(`#tab-${t}-btn`);
    btn.setAttribute("aria-selected", String(t === name));
    btn.tabIndex = t === name ? 0 : -1;
    $(`#tab-${t}`).hidden = t !== name;
  }
  animateIn($(`#tab-${name}`));
}
for (const t of TABS) $(`#tab-${t}-btn`).addEventListener("click", () => setTab(t));
$(".side-tabs").addEventListener("keydown", (e) => {
  const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
  if (!step) return;
  e.preventDefault();
  const next = TABS[(TABS.indexOf(state.tab || "agent") + step + TABS.length) % TABS.length];
  setTab(next);
  $(`#tab-${next}-btn`).focus();
});

function recordStyle(selector, prop, value) {
  ((state.edits.styles[state.page] ||= {})[selector] ||= {})[prop] = value;
  updateEditButtons();
}

function recordText({ selector, before, after }) {
  const existing = state.edits.texts.find((t) => t.selector === selector);
  if (existing) existing.after = after; // keep the original text as "before"
  else state.edits.texts.push({ selector, before, after, page: state.page });
  updateEditButtons();
}

function editCount() {
  return Object.values(state.edits.styles).flatMap(Object.values)
    .reduce((n, p) => n + Object.keys(p).length, 0) + state.edits.texts.length + state.edits.structural.length;
}

function updateEditButtons() {
  const n = editCount();
  $("#edit-count").hidden = n === 0;
  $("#edit-count").textContent = `${n} unsaved`;
  $("#edit-discard").disabled = n === 0;
  $("#edit-save").disabled = n === 0 || state.running;
}

const FIELD_FROM_BOX = { "edit-width": "width", "edit-height": "height", "edit-pad-y": "paddingY",
  "edit-pad-x": "paddingX", "edit-mar-y": "marginY", "edit-mar-x": "marginX", "edit-gap": "gap",
  "edit-radius": "radius", "edit-font": "fontSize", "edit-align": "textAlign", "edit-x": "x",
  "edit-y": "y", "edit-weight": "fontWeight", "edit-tracking": "letterSpacing", "edit-leading": "lineHeight",
  "edit-motion-enter": "motionEnter", "edit-motion-hover": "motionHover", "edit-motion-speed": "motionSpeed" };
const COLOR_FIELDS = { "edit-color": "color", "edit-bg": "background" };
const EDIT_HELP = "Click an element to select it; shift-click to add more. Drag to move. "
  + "Double-click text to change it. Drag the corner handle to resize.";

function renderSelection() {
  const sel = state.selection;
  const multi = Boolean(sel && sel.count > 1);
  $("#edit-fields").hidden = !sel || multi;
  $("#edit-align-group").hidden = !multi;
  if (!sel) {
    $("#edit-target").textContent = EDIT_HELP;
    return;
  }
  if (multi) {
    $("#edit-target").textContent = `${sel.count} elements selected. Align them, or drag to move them together.`;
    return;
  }
  $("#edit-target").textContent = `<${sel.tag}>${sel.text ? ` “${sel.text.slice(0, 40)}”` : ""}`;
  for (const [id, key] of Object.entries(FIELD_FROM_BOX)) $(`#${id}`).value = sel.box[key];
  // Only the controls that apply: type for text, gap for flex and grid containers.
  for (const el of document.querySelectorAll("#edit-fields [data-when='text']")) el.hidden = !sel.box.hasText;
  for (const el of document.querySelectorAll("#edit-fields [data-when='layout']")) el.hidden = !sel.box.layout;
  renderFontOptions(sel.box.fontFamily);
  for (const [id, key] of Object.entries(COLOR_FIELDS)) {
    $(`#${id}`).value = sel.box[key] || "#ffffff";
    const choice = colourChoices().find((c) => c.hex === sel.box[key]);
    $(`#${id}-token`).value = choice ? choice.value : "";
  }
  $("#edit-text").hidden = !sel.textLeaf;
}

// Font families: the design system's font tokens first, then the fonts the page uses.
function renderFontOptions(current) {
  const select = $("#edit-font-family");
  const first = (f) => f.split(",")[0].replace(/["']/g, "").trim();
  const options = [new Option(`${first(current || "")} (current)`, "")];
  for (const t of state.fontTokens || []) options.push(new Option(`${t.name.replace(/^--/, "")} · ${first(t.value)}`, `var(${t.name})`));
  for (const f of state.pageFonts || []) if (f !== current) options.push(new Option(first(f), f));
  select.replaceChildren(...options);
  const sizes = state.sizeTokens || [];
  $("#edit-font-token-row").hidden = sizes.length === 0;
  $("#edit-font-token").replaceChildren(new Option("Custom", ""),
    ...sizes.map((t) => new Option(`${t.name.replace(/^--/, "")} · ${t.value}`, `var(${t.name})`)));
}

// The colours offered next to each colour picker: the design system's tokens, or else the
// page's Wada palette. `value` is what the edit writes, `hex` what the picker shows.
function colourChoices() {
  if (state.tokens.length) {
    return state.tokens.map((t) => ({ label: t.name.replace(/^--/, ""), value: `var(${t.name})`, hex: t.value.toLowerCase() }));
  }
  return (state.palette || []).map((c) => ({ label: `${c.name} · ${c.hex}`, value: c.hex, hex: c.hex }));
}

function renderTokenOptions() {
  const choices = colourChoices();
  for (const id of Object.keys(COLOR_FIELDS)) {
    const select = $(`#${id}-token`);
    select.replaceChildren(new Option(choices.length ? "Custom" : "No system colours", ""),
      ...choices.map((c) => new Option(c.label, c.value)));
    select.disabled = choices.length === 0;
  }
}

// ---- The page's Wada palette (<meta name="palette" content="wada:006">), from the bridge ----
let wadaCombinations = null; // fetched once, when first needed
async function wadaData() {
  if (!wadaCombinations) wadaCombinations = await (await api("/api/palettes/wada")).json();
  return wadaCombinations;
}

async function showPalette(content) {
  const n = /^\s*wada\s*:\s*0*(\d{1,3})\s*$/i.exec(content || "")?.[1];
  state.paletteNumber = n ? Number(n) : null;
  if (n) await wadaData();
  state.palette = (n && wadaCombinations[n]?.colors) || [];
  updateProjectChip();
  const note = $("#palette-note");
  note.hidden = !n || state.isSystem;
  if (n) {
    const label = document.createElement("span");
    label.textContent = `Palette · Wada ${n.padStart(3, "0")}${state.palette.length ? "" : " (no such combination)"}`;
    const chips = state.palette.map((c) => {
      const chip = document.createElement("span");
      chip.className = "swatch";
      chip.style.background = c.hex;
      chip.title = `${c.name} ${c.hex}`;
      chip.setAttribute("role", "img");
      chip.setAttribute("aria-label", `${c.name} ${c.hex}`);
      return chip;
    });
    note.replaceChildren(label, ...chips);
  }
  renderTokenOptions();
}

// ---- Library: Wada palettes and techniques, browsed in a studio dialog or the Home view ----
// The same filters and grids serve both. In the studio, choosing drafts a message for the
// design on screen; on Home, it starts a new design with that message waiting.
const pad3 = (n) => String(n).padStart(3, "0");
const filterValue = (root, name) => {
  const el = root.querySelector(`[data-filter="${name}"]`);
  return el.type === "checkbox" ? el.checked : el.value.trim();
};
const onFilters = (root, render) => {
  for (const el of root.querySelectorAll("[data-filter]")) el.addEventListener(el.type === "search" ? "input" : "change", render);
};

function paletteMessage(n) {
  const names = wadaCombinations[n].colors.map((c) => `${c.name} ${c.hex}`).join(", ");
  return `Use Wada ${pad3(n)} (${names}) as the palette for this design.`;
}

// `current`: the combination to mark (the canvas page's); `onPick(n)` when one is chosen.
function renderPaletteGrid(root, grid, count, current, onPick) {
  const f = (name) => filterValue(root, name);
  const query = f("search").toLowerCase();
  const items = Object.entries(wadaCombinations).filter(([, c]) =>
    (!f("size") || c.colors.length === Number(f("size")))
    && (!f("harmony") || c.harmony === f("harmony"))
    && (!f("value") || c.value === f("value"))
    && (!f("strength") || c.strength === f("strength"))
    && (!f("text") || c.text_contrast >= 4.5)
    && (!query || c.colors.some((colour) => colour.name.toLowerCase().includes(query) || colour.hex === query)));
  count.textContent = `${items.length} of ${Object.keys(wadaCombinations).length} combinations`;
  grid.replaceChildren(...items.map(([n, c]) => {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "palette-item";
    button.dataset.number = n;
    const names = c.colors.map((colour) => colour.name).join(", ");
    const isCurrent = Number(n) === current;
    if (isCurrent) button.setAttribute("aria-current", "true");
    const strip = document.createElement("span");
    strip.className = "palette-strip";
    strip.setAttribute("aria-hidden", "true"); // the colour names are in the text; titles are for hover
    for (const colour of c.colors) {
      const block = document.createElement("span");
      block.style.background = colour.hex;
      block.title = `${colour.name} ${colour.hex}`;
      strip.append(block);
    }
    const head = document.createElement("span");
    head.className = "palette-number";
    head.textContent = `Wada ${pad3(n)}${isCurrent ? " · current" : ""}`;
    const label = document.createElement("span");
    label.className = "palette-names";
    label.textContent = names;
    const tags = document.createElement("span");
    tags.className = "palette-tags";
    tags.textContent = `${c.harmony} · ${c.value} · ${c.strength} · text ${c.text_contrast}:1`;
    // Spaces between the parts so the name read out (the button's text) does not run together.
    button.append(strip, head, " ", label, " ", tags);
    button.addEventListener("click", () => onPick(Number(n)));
    li.append(button);
    return li;
  }));
}

// A drafted request in the composer, for the user to edit and send.
function draftMessage(text, status) {
  setView("chat");
  const input = $("#chat-input");
  input.value = text;
  input.focus();
  setStatus(status);
}

const renderStudioPalettes = () => renderPaletteGrid($("#palette-browser"), $("#palette-grid"), $("#palette-count"),
  state.paletteNumber, (n) => {
    $("#palette-browser").close();
    draftMessage(paletteMessage(n), `Wada ${pad3(n)} is in the message. Edit it or send it.`);
  });

$("#palette-browse").addEventListener("click", async () => {
  await wadaData();
  renderStudioPalettes();
  $("#palette-browser").showModal();
  $("#palette-browser [aria-current]")?.scrollIntoView({ block: "center" });
});
$("#palette-close").addEventListener("click", () => $("#palette-browser").close());
onFilters($("#palette-browser"), renderStudioPalettes);

// ---- Techniques ----
let techniqueList = null;
let rank = null; // the library's intent ranker, shared with its own tooling
async function techniqueData() {
  if (!techniqueList) {
    [techniqueList, rank] = await Promise.all([
      api("/api/techniques").then((r) => r.json()), import("/creative-library/engine/recipes/rank.js")]);
  }
  return techniqueList;
}

// Example asks under the search box: the library's own README intents and two more.
const INTENT_EXAMPLES = ["make this feel hand-made", "add depth without 3D", "break up a flat field",
  "make it look printed", "a calm moving background"];
for (const holder of document.querySelectorAll("[data-intent-examples]")) {
  const input = $(`#${holder.dataset.intentExamples}`);
  holder.replaceChildren(...INTENT_EXAMPLES.map((text) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "btn btn-secondary btn-small";
    chip.textContent = text;
    chip.addEventListener("click", () => {
      input.value = text;
      input.dispatchEvent(new Event("input"));
    });
    return chip;
  }));
}

function renderTechniqueGrid(root, grid, count, onOpen) {
  const kind = root.querySelector('[data-filter="kind"]');
  if (kind.options.length === 1) { // the kinds come from the data, once
    for (const primitive of [...new Set(techniqueList.map((t) => t.primitive))].sort()) kind.append(new Option(primitive, primitive));
  }
  // A query is a design ask, ranked by the library's own ranker against its intent index
  // (creative-library/engine/recipes/rank.js); without one, every technique by name.
  const query = filterValue(root, "search");
  const ranked = query ? rank.rankByIntent(techniqueList, query) : techniqueList.map((t) => ({ technique: t, phrases: [] }));
  const items = ranked.filter((r) => !kind.value || r.technique.primitive === kind.value);
  count.textContent = !query ? `${items.length} of ${techniqueList.length} techniques`
    : items.length ? `${items.length} techniques for “${query}”, best first`
    : `Nothing in the library for “${query}” yet.`;
  grid.replaceChildren(...items.map(({ technique: t, phrases }) => {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "technique-item";
    button.dataset.id = t.id;
    const img = document.createElement("img");
    img.alt = "";
    img.loading = "lazy";
    if (t.screenshot) img.src = t.screenshot;
    const label = document.createElement("span");
    label.className = "technique-label";
    label.textContent = t.label;
    const kindTag = document.createElement("span");
    kindTag.className = "technique-kind";
    kindTag.textContent = t.primitive;
    const summary = document.createElement("span");
    summary.className = "technique-summary";
    summary.textContent = t.description;
    button.append(img, label, " ", kindTag, " ", summary);
    // Why it ranked: the purpose from the index that the ask matched.
    const why = phrases[0];
    if (why) {
      const fits = document.createElement("span");
      fits.className = "technique-why";
      fits.textContent = `For: ${why}`;
      button.append(" ", fits);
    }
    button.addEventListener("click", () => onOpen(t.id));
    li.append(button);
    return li;
  }));
}

// The dialog serves the studio (mode "design": use on the design on screen, or on the
// element selected in Edit mode) and Home's Library (mode "library": start a new design).
const techniqueDialog = { mode: "design", target: null };

function techniqueMessage(t, target) {
  const what = `the ${t.label} technique from the library (${t.source})`;
  return target
    ? `Apply ${what} to the selected <${target.tag}>${target.text ? ` "${target.text.slice(0, 40)}"` : ""} (\`${target.selector}\`).`
    : `Use ${what} in this design.`;
}

function showTechniqueList() {
  $("#technique-detail").hidden = true;
  $("#technique-list").hidden = false;
  $("#technique-demo").removeAttribute("src"); // stops its animation
}

function showTechniqueDetail(id) {
  const t = techniqueList.find((x) => x.id === id);
  $("#technique-list").hidden = true;
  $("#technique-detail").hidden = false;
  $("#technique-name").textContent = t.label;
  $("#technique-kind").textContent = t.primitive;
  $("#technique-description").textContent = t.description;
  $("#technique-demo").src = `/library/demo/${encodeURIComponent(t.id)}`;
  $("#technique-demo").title = `Live demo of ${t.label}`;
  $("#technique-notes").textContent = t.notes || "No notes in the recipe.";
  // The parameter map: what each knob does, its useful range, and what the library's sweep
  // measured, with the strip of frames as the evidence.
  $("#technique-props").replaceChildren(...Object.entries(t.props).map(([name, p]) => {
    const li = document.createElement("li");
    li.className = "technique-param";
    const head = document.createElement("div");
    const code = document.createElement("code");
    code.textContent = name;
    const range = p.range ? `${p.range[0]}–${p.range[1]}${p.unit ? ` ${p.unit}` : ""}` : p.type;
    head.append(code, ` ${range}${"default" in p ? `, default ${JSON.stringify(p.default)}` : ""}`);
    li.append(head);
    if (p.controls) {
      const what = document.createElement("p");
      what.textContent = p.controls;
      li.append(what);
    }
    const e = t.evidence[name] || {};
    if (e.strip) {
      const img = document.createElement("img");
      img.src = e.strip;
      img.loading = "lazy";
      img.alt = `${t.label} rendered at ${name} ${(p.sweep || []).map((v) => JSON.stringify(v)).join(", ")}`;
      // Small at panel width; the full strip opens on its own for a closer look (grain, fine lines).
      const full = document.createElement("a");
      full.href = e.strip;
      full.target = "_blank";
      full.rel = "noopener";
      full.append(img);
      li.append(full);
    }
    const note = e.verdict === "unswept" ? `Not shown in a still frame: ${e.reason}.`
      : e.verdict === "partial" ? `Flat between ${e.flatSegments.map(([a, b]) => `${a} and ${b}`).join(", ")}.${p.breaks ? ` ${p.breaks.below || p.breaks.above}` : ""}`
      : p.breaks ? Object.values(p.breaks).join(" ") : "";
    if (note) {
      const n = document.createElement("p");
      n.className = "technique-param-note";
      n.textContent = note;
      li.append(n);
    }
    return li;
  }));
  const target = techniqueDialog.mode === "design" ? techniqueDialog.target : null;
  $("#technique-target").hidden = !target;
  $("#technique-target").textContent = target ? `For the selected <${target.tag}>${target.text ? ` "${target.text.slice(0, 40)}"` : ""}` : "";
  $("#technique-use").textContent = techniqueDialog.mode === "library" ? "Start a design with it" : "Use on this design";
  $("#technique-use").dataset.id = t.id;
  $("#technique-back").focus();
}

async function openTechniques({ mode = "design", target = null, id = null } = {}) {
  await techniqueData();
  Object.assign(techniqueDialog, { mode, target });
  $("#technique-browser-help").textContent = mode === "library"
    ? "Verified visual techniques from the library. Start a new design with one; the request waits in its chat box."
    : "Verified visual techniques from the library: textures, patterns, effects, motion, charts and 3D. Choose one and the agent builds it into this design; the message is in the chat box for you to edit and send.";
  renderTechniqueGrid($("#technique-list"), $("#technique-grid"), $("#technique-count"), showTechniqueDetail);
  if (id) showTechniqueDetail(id);
  else showTechniqueList();
  if (!$("#technique-browser").open) $("#technique-browser").showModal();
}

$("#technique-use").addEventListener("click", () => {
  const t = techniqueList.find((x) => x.id === $("#technique-use").dataset.id);
  $("#technique-browser").close();
  if (techniqueDialog.mode === "library") createDesign(t.label, techniqueMessage(t, null));
  else draftMessage(techniqueMessage(t, techniqueDialog.target), `${t.label} is in the message. Edit it or send it.`);
});
$("#technique-back").addEventListener("click", () => {
  showTechniqueList();
  $(`#technique-grid [data-id="${CSS.escape($("#technique-use").dataset.id)}"]`)?.focus();
});
$("#technique-close").addEventListener("click", () => $("#technique-browser").close());
$("#technique-browser").addEventListener("close", showTechniqueList);
onFilters($("#technique-list"), () => renderTechniqueGrid($("#technique-list"), $("#technique-grid"), $("#technique-count"), showTechniqueDetail));
$("#technique-browse").addEventListener("click", () => openTechniques());
$("#edit-technique").addEventListener("click", () => openTechniques({ target: state.selection }));

// ---- Home: the Library view ----
function setLibraryTab(tab) {
  for (const b of document.querySelectorAll(".library-tabs [data-tab]")) b.setAttribute("aria-pressed", String(b.dataset.tab === tab));
  for (const name of ["techniques", "palettes"]) $(`#library-${name}`).hidden = name !== tab;
}

const renderLibraryTechniques = () => renderTechniqueGrid($("#library-techniques"), $("#library-technique-grid"),
  $("#library-technique-count"), (id) => openTechniques({ mode: "library", id }));
const renderLibraryPalettes = () => renderPaletteGrid($("#library-palettes"), $("#library-palette-grid"),
  $("#library-palette-count"), null, (n) => createDesign(`Wada ${pad3(n)}`, paletteMessage(n)));

for (const b of document.querySelectorAll(".library-tabs [data-tab]")) b.addEventListener("click", () => setLibraryTab(b.dataset.tab));
onFilters($("#library-techniques"), renderLibraryTechniques);
onFilters($("#library-palettes"), renderLibraryPalettes);

async function showLibrary() {
  await Promise.all([techniqueData(), wadaData()]);
  renderLibraryTechniques();
  renderLibraryPalettes();
}

// ---- Priority marks: the page's data-priority order drawn over the canvas ----
function updatePriorityButton() {
  $("#priority-mode").hidden = !state.priorityCount;
  $("#priority-mode").setAttribute("aria-pressed", String(Boolean(state.priorities)));
  toCanvas({ type: "priorities", on: Boolean(state.priorities) && state.priorityCount > 0 });
}

$("#priority-mode").addEventListener("click", () => {
  state.priorities = !state.priorities;
  updatePriorityButton();
});

function setStyle(prop, value) {
  recordStyle(state.selection.selector, prop, value);
  toCanvas({ type: "set-style", selector: state.selection.selector, prop, value });
}

for (const input of document.querySelectorAll("#edit-fields [data-prop]")) {
  input.addEventListener("input", () => {
    if (!state.selection) return;
    const raw = input.value.trim();
    const prop = input.dataset.prop;
    if (prop === "translate") {
      setStyle(prop, `${Number($("#edit-x").value) || 0}px ${Number($("#edit-y").value) || 0}px`);
      return;
    }
    if (prop === "color" || prop === "background-color") {
      if (!raw) return; // "Custom" in a token list: the picker next to it holds the value
      if (input.tagName === "SELECT") {
        const choice = colourChoices().find((c) => c.value === raw);
        if (choice && /^#[0-9a-f]{6}$/i.test(choice.hex)) input.previousElementSibling.value = choice.hex;
      } else {
        $(`#${input.id}-token`).value = "";
      }
      setStyle(prop, raw);
      return;
    }
    if (prop === "line-height") { // unitless, like the design's own leading
      setStyle(prop, raw === "" ? "normal" : String(Number(raw)));
      return;
    }
    if (prop === "font-size" && input.tagName === "SELECT") $("#edit-font").value = "";
    const sizing = ["width", "height"].includes(prop);
    if (raw === "" && !sizing) return;
    const value = input.tagName === "SELECT" ? raw : raw === "" ? "auto" : `${Number(raw)}px`;
    for (const p of prop.split(" ")) setStyle(p, value);
  });
}

$("#edit-motion-play").addEventListener("click", () => toCanvas({ type: "replay-motion" }));
$("#edit-duplicate").addEventListener("click", () => toCanvas({ type: "duplicate" }));
$("#edit-wrap-flex").addEventListener("click", () => toCanvas({ type: "wrap", layout: "flex" }));
$("#edit-wrap-grid").addEventListener("click", () => toCanvas({ type: "wrap", layout: "grid" }));
// Delete hides the element now; the agent removes it from the source on its next turn.
$("#edit-delete").addEventListener("click", () => {
  if (!state.selection) return;
  setStyle("display", "none");
  state.selection = null;
  renderSelection();
});

// What the agent is asked to make real, for previews it can't be saved as CSS.
function structuralMessage(items) {
  const where = (it) => (it.page && it.page !== state.entry ? ` on ${it.page}` : "");
  return "Please make these changes I previewed in Edit mode:\n" + items.map((it) => it.kind === "duplicate"
    ? `- Duplicate <${it.tag}>${it.text ? ` “${it.text}”` : ""} (\`${it.selector}\`)${where(it)}, placing the copy right after it.`
    : `- Wrap ${it.selectors.map((sel, i) => `\`${sel}\` (“${it.labels[i]}”)`).join(", ")}${where(it)} in a ${
      it.layout === "grid" ? "grid with one column each" : "flex row"} with a 16px gap (use the design's spacing token if it has one).`).join("\n");
}

for (const btn of document.querySelectorAll("#edit-align-group [data-edge]")) {
  btn.addEventListener("click", () => toCanvas({ type: "align", edge: btn.dataset.edge }));
}

$("#edit-text").addEventListener("click", () => toCanvas({ type: "edit-text" }));

$("#edit-discard").addEventListener("click", () => {
  state.edits = { styles: {}, texts: [], structural: [] };
  updateEditButtons();
  reloadCanvas();
});

$("#edit-save").addEventListener("click", async () => {
  let result;
  try {
    result = await (await api(`/api/projects/${state.slug}/edits`, {
      method: "POST", body: JSON.stringify({ ...state.edits, before: editedBefore() }),
    })).json();
  } catch (err) {
    setStatus(err.message);
    return;
  }
  const structural = state.edits.structural;
  state.edits = { styles: {}, texts: [], structural: [] };
  updateEditButtons();
  if (structural.length) {
    $("#chat-input").value = structuralMessage(structural) + (result.unplaced.length
      ? "\n\nAnd these text changes:\n" + result.unplaced.map((t) => `- “${t.before}” → “${t.after}”`).join("\n") : "");
    setStatus("Saved. Duplicating and wrapping need the agent: they're in the message box, send when ready.");
  } else if (result.unplaced.length) {
    // Text that doesn't occur exactly once in the files needs the agent's judgement.
    $("#chat-input").value = "Please make these text changes on the page:\n" + result.unplaced
      .map((t) => `- “${t.before}” → “${t.after}”`).join("\n");
    setStatus(`${result.unplaced.length} text change(s) couldn't be placed automatically; `
      + "they're in the message box for the agent.");
  } else {
    setStatus("Edits saved as a new version.");
  }
  whyCard(result.decisions);
  await loadVersions();
  reloadCanvas();
});

// The computed values the edited properties had before Edit mode changed them.
function editedBefore() {
  const out = {};
  for (const [page, rules] of Object.entries(state.edits.styles)) {
    for (const [selector, props] of Object.entries(rules)) {
      for (const prop of Object.keys(props)) {
        const value = state.styleBefore[page]?.[selector]?.[prop];
        if (value !== undefined) ((out[page] ||= {})[selector] ||= {})[prop] = value;
      }
    }
  }
  return out;
}

// After a change the user made themselves (an edit, a restore, kept tweaks) is logged as their
// decision: an optional reason, in their words. Nothing is filled in for them.
function whyCard(ids) {
  if (!ids || !ids.length) return;
  for (const old of document.querySelectorAll(".why-card")) old.remove();
  const form = document.createElement("form");
  form.className = "msg why-card";
  const label = document.createElement("label");
  const input = document.createElement("input");
  input.type = "text";
  input.id = `why-${Date.now()}`;
  label.htmlFor = input.id;
  label.textContent = ids.length === 1 ? "Logged as your decision. Why? (optional)"
    : `Logged as ${ids.length} decisions. Why? (optional)`;
  const save = document.createElement("button");
  save.type = "submit";
  save.className = "btn btn-secondary";
  save.textContent = "Add reason";
  const row = document.createElement("div");
  row.className = "row";
  row.append(input, save);
  form.append(label, row);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!input.value.trim()) return;
    try {
      await api(`/api/projects/${state.slug}/decisions/why`, {
        method: "POST", body: JSON.stringify({ ids, why: input.value }),
      });
    } catch (err) {
      setStatus(err.message);
      return;
    }
    form.replaceChildren(Object.assign(document.createElement("p"), { textContent: "Reason added." }));
    form.classList.add("done");
  });
  animateIn(form);
  $("#side-prompt").append(form); // under every tab: an Edit save keeps the inspector open
}

// ---------- Attachments ----------

function renderAttachments(list) {
  state.attachments = list;
  const ul = $("#attachment-list");
  ul.hidden = list.length === 0;
  ul.replaceChildren(...list.map((a) => {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.className = "file-name";
    name.textContent = a.source ? `${a.name} (${new URL(a.source).hostname})` : a.name;
    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn-icon btn-icon-sm";
    del.setAttribute("aria-label", `Remove ${a.name}`);
    del.append(icon(["M6 6l12 12", "M18 6L6 18"], 12));
    del.onclick = async () => {
      await api(`/api/projects/${state.slug}/attachments/${a.id}`, { method: "DELETE" });
      renderAttachments(state.attachments.filter((x) => x.id !== a.id));
    };
    li.append(name, del);
    return li;
  }));
}

async function uploadFiles(files) {
  for (const file of files) {
    setStatus(`Attaching ${file.name}…`);
    try {
      const res = await fetch(`/api/projects/${state.slug}/attachments?name=${encodeURIComponent(file.name)}`,
        { method: "POST", body: file });
      if (!res.ok) throw new Error((await res.json()).detail);
      renderAttachments([...state.attachments, await res.json()]);
      setStatus("");
    } catch (err) {
      setStatus(`${file.name}: ${err.message}`);
    }
  }
}

$("#attach").addEventListener("click", () => $("#attach-input").click());
$("#attach-input").addEventListener("change", () => {
  uploadFiles([...$("#attach-input").files]);
  $("#attach-input").value = "";
});

// Paste images or drop files anywhere on the chat pane.
$("#chat-input").addEventListener("paste", (e) => {
  const files = [...e.clipboardData.files];
  if (files.length) {
    e.preventDefault();
    uploadFiles(files);
  }
});
const chatPane = $(".chat-pane");
chatPane.addEventListener("dragover", (e) => {
  if ([...e.dataTransfer.types].includes("Files")) {
    e.preventDefault();
    chatPane.dataset.drop = "";
  }
});
chatPane.addEventListener("dragleave", (e) => {
  if (!chatPane.contains(e.relatedTarget)) delete chatPane.dataset.drop;
});
chatPane.addEventListener("drop", (e) => {
  delete chatPane.dataset.drop;
  if (e.dataTransfer.files.length) {
    e.preventDefault();
    uploadFiles([...e.dataTransfer.files]);
  }
});

$("#capture").addEventListener("click", () => {
  $("#capture-form").hidden = false;
  $("#capture-url").focus();
});
$("#capture-cancel").addEventListener("click", () => { $("#capture-form").hidden = true; });
$("#capture-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const url = $("#capture-url").value.trim();
  if (!url) return;
  const go = $("#capture-go");
  go.disabled = true;
  setStatus(`Capturing ${url}…`);
  try {
    const items = await (await api(`/api/projects/${state.slug}/attachments/capture`, {
      method: "POST", body: JSON.stringify({ url }),
    })).json();
    renderAttachments([...state.attachments, ...items]);
    $("#capture-url").value = "";
    $("#capture-form").hidden = true;
    setStatus("");
  } catch (err) {
    setStatus(err.message);
  } finally {
    go.disabled = false;
  }
});

// ---------- Tweaks ----------

function renderTweaks(tweaks) {
  state.tweaks = tweaks;
  const names = new Set(tweaks.map((t) => t.name));
  for (const name of Object.keys(state.tweakValues)) if (!names.has(name)) delete state.tweakValues[name];
  updateTweaksVisibility();
  const form = $("#tweaks-form");
  form.replaceChildren();
  tweaks.forEach((t, i) => {
    const id = `tweak-${i}`;
    const value = t.name in state.tweakValues ? state.tweakValues[t.name] : t.value;
    const field = document.createElement("div");
    const label = document.createElement("label");
    label.htmlFor = id;
    label.textContent = t.label || t.name;
    let input;
    if (t.type === "enum") {
      input = document.createElement("select");
      for (const option of t.options || []) input.append(new Option(option, option));
      input.value = value;
    } else {
      input = document.createElement("input");
      input.type = { color: "color", range: "range", boolean: "checkbox" }[t.type] || "text";
      if (t.type === "range") Object.assign(input, { min: t.min ?? 0, max: t.max ?? 100, step: t.step ?? 1 });
      if (t.type === "boolean") input.checked = Boolean(value);
      else input.value = value;
    }
    input.id = id;
    const output = document.createElement("output");
    output.htmlFor = id;
    const showValue = () => { output.textContent = t.type === "range" ? `${input.value}${t.unit || ""}` : ""; };
    showValue();
    input.addEventListener("input", () => {
      const v = t.type === "boolean" ? input.checked : t.type === "range" ? Number(input.value) : input.value;
      state.tweakValues[t.name] = v;
      toCanvas({ type: "set-tweak", name: t.name, value: v });
      showValue();
      updateTweakButtons();
    });
    if (t.type === "boolean") {
      label.className = "check";
      label.prepend(input);
      field.append(label);
    } else if (t.type === "color" || t.type === "enum") {
      // One row: label left, control right (a colour also shows its hex value).
      field.className = "inline";
      const control = document.createElement("span");
      control.className = "control";
      if (t.type === "color") {
        const hex = document.createElement("span");
        hex.className = "hex";
        hex.textContent = input.value;
        input.addEventListener("input", () => { hex.textContent = input.value; });
        control.append(hex);
      }
      control.append(input);
      field.append(label, control);
    } else {
      label.append(output);
      field.append(label, input);
    }
    form.append(field);
  });
  updateTweakButtons();
}

// The panel floats over the design, so it can be collapsed to a pill; it also collapses
// by itself in comment mode and comes back after.
function updateTweaksVisibility() {
  const has = state.tweaks.length > 0 && state.canvasView !== "board";
  const collapsed = state.tweaksCollapsed || state.commentMode || state.editMode || draw.on;
  $("#tweaks-panel").hidden = !has || collapsed;
  // In Edit mode the inspector takes the same corner, so the pill steps aside too.
  $("#tweaks-open").hidden = !has || !collapsed || state.editMode;
}

$("#tweaks-collapse").addEventListener("click", () => {
  state.tweaksCollapsed = true;
  updateTweaksVisibility();
  $("#tweaks-open").focus();
});

$("#tweaks-open").addEventListener("click", () => {
  state.tweaksCollapsed = false;
  if (state.commentMode) setCommentMode(false);
  updateTweaksVisibility();
  $("#tweaks-collapse").focus();
});

function updateTweakButtons() {
  const changed = Object.keys(state.tweakValues).length > 0;
  $("#tweaks-dirty").hidden = !changed;
  $("#tweaks-reset").disabled = !changed;
  // Keeping values rewrites the live files, so not while previewing an old version.
  $("#tweaks-keep").disabled = !changed || Boolean(state.viewing) || $("#send").disabled;
}

$("#tweaks-reset").addEventListener("click", () => {
  state.tweakValues = {};
  for (const t of state.tweaks) toCanvas({ type: "set-tweak", name: t.name, value: t.value });
  renderTweaks(state.tweaks);
});

$("#tweaks-keep").addEventListener("click", async () => {
  try {
    const result = await (await api(`/api/projects/${state.slug}/tweaks`, {
      method: "POST",
      body: JSON.stringify({ values: state.tweakValues, page: state.page }),
    })).json();
    whyCard(result.decisions);
  } catch (err) {
    setStatus(err.message);
    return;
  }
  state.tweakValues = {};
  await loadVersions();
  reloadCanvas();
});

// ---------- Options ----------

function renderOptions(options) {
  $("#options-bar").hidden = options.length === 0;
  const ul = $("#option-list");
  ul.replaceChildren();
  for (const o of options) {
    const name = o.label ? `${o.id} · ${o.label}` : o.id;
    const li = document.createElement("li");
    const show = document.createElement("button");
    show.type = "button";
    show.textContent = name;
    show.setAttribute("aria-pressed", "false");
    show.onclick = () => {
      toCanvas({ type: "scroll-to", option: o.id });
      for (const b of ul.querySelectorAll("button[aria-pressed]")) b.setAttribute("aria-pressed", String(b === show));
    };
    const keep = document.createElement("button");
    keep.type = "button";
    keep.textContent = "Keep";
    keep.setAttribute("aria-label", `Keep option ${name}`);
    keep.onclick = () => {
      $("#chat-input").value = `Keep option ${o.id}${o.label ? ` (${o.label})` : ""} and remove the other options.`;
      sendMessage();
    };
    li.append(show, keep);
    ul.append(li);
  }
}

// ---------- Versions ----------

async function loadVersions() {
  renderVersions(await (await api(`/api/projects/${state.slug}/versions`)).json());
}

// The History tab: one thumbnail per version, newest first. Choosing one previews it on the
// canvas; Restore and Branch act on the one chosen (redesign gate, section 6).
function renderVersions(versions) {
  state.versions = versions;
  const current = versions[versions.length - 1]?.sha;
  const shown = state.viewing || current;
  $("#history-list").replaceChildren(...versions.map((v, i) => {
    const li = document.createElement("li");
    const pick = document.createElement("button");
    pick.type = "button";
    pick.className = "history-item";
    if (v.sha === shown) pick.setAttribute("aria-current", "true");
    const img = document.createElement("img");
    img.alt = "";
    img.loading = "lazy";
    img.src = `/api/projects/${state.slug}/versions/${v.sha}/thumbnail`;
    img.onerror = () => img.remove();
    const text = document.createElement("span");
    text.className = "history-text";
    const title = document.createElement("span");
    title.className = "history-title";
    title.textContent = `${i + 1} · ${v.message}`;
    const when = document.createElement("span");
    when.className = "history-when";
    const approved = state.approved?.sha === v.sha ? " · approved for build" : "";
    when.textContent = `${v.sha === current ? "current · " : ""}${timeAgo(v.time)}${approved}`;
    text.append(title, when);
    pick.append(img, text);
    pick.addEventListener("click", () => selectVersion(v.sha === current ? null : v.sha));
    li.append(pick);
    return li;
  }).reverse());
  updateVersionLabel();
}

function versionNumber(sha) {
  return state.versions.findIndex((v) => v.sha === sha) + 1;
}

// What depends on the version on screen: Restore, Approve (current only), Edit and Board.
function updateVersionLabel() {
  const latest = !state.viewing;
  const current = state.versions[state.versions.length - 1];
  $("#restore").hidden = latest || state.builtin;
  $("#branch").disabled = state.versions.length === 0;
  // Approval is of the current version: shown on it, and done once per version.
  const approved = Boolean(current) && state.approved?.sha === current.sha;
  $("#approve").hidden = !current || state.builtin;
  $("#approve").disabled = approved || !latest;
  $("#approve").textContent = approved ? "Approved for build" : "Approve for build";
  // Compare the version on screen with the current one; on the current, what the last version changed.
  $("#compare").disabled = state.versions.length < 2;
  $("#compare").textContent = latest ? "What changed last" : "Compare with current";
  $("#edit-mode").disabled = Boolean(state.viewing) || state.canvasView === "board";
  // The board shows the live files, so not while an old version is on screen.
  $("#view-board").disabled = Boolean(state.viewing);
  updateStagePill();
}

// ---- Compare: two versions of the canvas page side by side, changes outlined (app/compare.py) ----
function compareVersions() {
  const n = state.versions.length;
  if (n < 2) return null;
  const b = state.versions[n - 1].sha;
  const a = state.viewing && state.viewing !== b ? state.viewing : state.versions[n - 2].sha;
  return { a, b };
}

async function openCompare() {
  const pair = compareVersions();
  if (!pair) return;
  const { a, b } = pair;
  const page = state.page || state.entry;
  const query = `page=${encodeURIComponent(page)}&width=${canvasWidth()}`;
  const view = $("#compare-view");
  view.hidden = false;
  $("#studio").dataset.compare = "";
  animateIn(view);
  $("#compare-label").textContent = `Version ${versionNumber(a)} → Version ${versionNumber(b)} · ${page}`;
  $("#compare-a-label").textContent = `Version ${versionNumber(a)}`;
  $("#compare-b-label").textContent = `Version ${versionNumber(b)}${b === state.versions[state.versions.length - 1].sha ? " (current)" : ""}`;
  $("#compare-status").textContent = "Rendering both versions…";
  $("#compare-files").replaceChildren();
  for (const side of ["a", "b"]) { $(`#compare-${side}`).removeAttribute("src"); $(`#compare-${side}-boxes`).replaceChildren(); }
  let result;
  try {
    result = await (await api(`/api/projects/${state.slug}/compare?a=${a}&b=${b}&${query}`)).json();
  } catch (err) {
    $("#compare-status").textContent = err.message;
    return;
  }
  if (view.hidden) return; // closed while it rendered
  $("#compare-files").replaceChildren(...result.files.map((f) => {
    const li = document.createElement("li");
    li.textContent = f.added === null ? `${f.path} (binary)` : `${f.path} +${f.added} −${f.removed}`;
    return li;
  }));
  for (const [side, sha] of [["a", a], ["b", b]]) {
    if (result.missing !== side) $(`#compare-${side}`).src = `/api/projects/${state.slug}/versions/${sha}/shot?${query}`;
    $(`#compare-${side}`).alt = result.missing === side ? "" : `${page} in version ${versionNumber(sha)}`;
  }
  if (result.missing) {
    $("#compare-status").textContent = `${page} is not in version ${versionNumber(result.missing === "a" ? a : b)}.`;
    return;
  }
  const count = result.boxes.length;
  $("#compare-status").textContent = count ? `${count} changed area${count === 1 ? "" : "s"}` : "No visible change on this page";
  result.size.heights.forEach((height, i) => {
    $(`#compare-${"ab"[i]}-boxes`).replaceChildren(...result.boxes.map((box) => {
      const div = document.createElement("div");
      div.className = "compare-box";
      Object.assign(div.style, {
        left: `${(box.x / result.size.width) * 100}%`, width: `${(box.w / result.size.width) * 100}%`,
        top: `${(box.y / height) * 100}%`, height: `${(box.h / height) * 100}%`,
      });
      return div;
    }));
  });
}

function closeCompare() {
  $("#compare-view").hidden = true;
  delete $("#studio").dataset.compare;
}

$("#compare").addEventListener("click", openCompare);
$("#compare-close").addEventListener("click", closeCompare);
$("#compare-highlight").addEventListener("click", () => {
  const on = $("#compare-highlight").getAttribute("aria-pressed") !== "true";
  $("#compare-highlight").setAttribute("aria-pressed", String(on));
  $("#compare-view").classList.toggle("no-highlight", !on);
});
$("#compare-view").addEventListener("keydown", (e) => { if (e.key === "Escape") closeCompare(); });

function selectVersion(sha) {
  closeCompare();
  state.viewing = sha;
  state.fadeCanvas = true;
  if (state.viewing && state.canvasView === "board") setCanvasView("page");
  // Edits apply to the live files, so not while an old version is on screen.
  if (state.viewing && state.editMode) setEditMode(false);
  renderVersions(state.versions);
  updateTweakButtons();
  reloadCanvas();
}

$("#approve").addEventListener("click", async () => {
  try {
    state.approved = await (await api(`/api/projects/${state.slug}/approve`, { method: "POST", body: "{}" })).json();
  } catch (err) {
    setStatus(err.message);
    return;
  }
  renderVersions(state.versions);
  setStatus("Approved for build. Claude Code can implement this version.");
});

// A new project from the version on screen, to try another direction without losing this one.
$("#branch").addEventListener("click", async () => {
  const sha = state.viewing || state.versions[state.versions.length - 1]?.sha;
  if (!sha) return;
  try {
    const project = await (await api(`/api/projects/${state.slug}/branch`, {
      method: "POST", body: JSON.stringify({ sha }),
    })).json();
    location.hash = `#/p/${project.slug}`;
  } catch (err) {
    setStatus(err.message);
  }
});

$("#restore").addEventListener("click", async () => {
  try {
    const result = await (await api(`/api/projects/${state.slug}/restore`, {
      method: "POST",
      body: JSON.stringify({ sha: state.viewing }),
    })).json();
    whyCard(result.decisions);
  } catch (err) {
    setStatus(err.message);
    return;
  }
  state.viewing = null;
  await loadVersions();
  reloadCanvas();
});

function appendToLog(node) {
  const log = $("#chat-log");
  if (!state.replaying) animateIn(node); // the saved history appears at once, new events ease in
  log.append(node);
  log.scrollTop = log.scrollHeight;
}

function message(cls, text) {
  const div = document.createElement("div");
  div.className = `msg ${cls}`;
  div.textContent = text;
  appendToLog(div);
  return div;
}

// Consecutive tool calls collapse into one "N steps" group, like Claude Code. While a
// turn runs, its group is a card (data-live) whose summary is one progress line:
// spinner, what the agent is doing now, step count and elapsed time.
// What the agent read from the technique library this turn (creative-library/), from its
// Read steps: recipes by id, and the Wada palettes.
function noteTechnique(summary) {
  if (!state.techniques) state.techniques = new Set();
  const recipe = /creative-library\/recipes\/web\/([a-z0-9_-]+)\.js$/.exec(summary);
  if (recipe && recipe[1] !== "registry") state.techniques.add(recipe[1]);
  if (/creative-library\/palettes\/wada\//.test(summary)) state.techniques.add("Wada palettes");
}

const compact = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));

function tokenSummary(t) {
  return `${compact(t.input || 0)} in · ${compact(t.output || 0)} out · ${compact(t.cache_read || 0)} cache read`;
}

// The project's running total in the header, from the server's sum of finished turns.
function renderUsage() {
  const u = state.usage;
  $("#usage-note").hidden = !u || !u.turns;
  if (!u || !u.turns) return;
  $("#usage-note").textContent = `${u.turns} turn${u.turns === 1 ? "" : "s"} · $${u.cost_usd.toFixed(2)} API-equivalent`;
  $("#usage-note").title = `Tokens so far: ${tokenSummary(u)}, ${compact(u.cache_write || 0)} cache write`;
}

function addStep(event) {
  if (!state.steps) {
    const details = document.createElement("details");
    details.className = "steps";
    const summary = document.createElement("summary");
    const ol = document.createElement("ol");
    details.append(summary, ol);
    appendToLog(details);
    state.steps = { details, summary, ol, count: 0, latest: "" };
  }
  const li = document.createElement("li");
  li.dataset.id = event.id;
  li.textContent = event.summary;
  state.steps.ol.append(li);
  state.steps.count += 1;
  state.steps.latest = friendlyStep(event.summary);
  renderStepSummary(state.steps.details);
}

const STEP_WORDS = { Write: "Writing", Edit: "Editing", Read: "Reading", Glob: "Searching files",
  Grep: "Searching", verify: "Checking the rendered page", screenshot: "Taking a screenshot",
  eval_js: "Measuring the page", resolve_comment: "Resolving a comment",
  ask_questions: "Asking you a few questions" };

function friendlyStep(summary) {
  const [tool, ...rest] = summary.split(" ");
  const connector = tool.split("__"); // a connector's tool: mcp__<name>__<tool>
  if (connector.length >= 3 && connector[0] === "mcp") return `Using ${connector[1]}: ${connector.slice(2).join("__")}`;
  const word = STEP_WORDS[tool];
  if (!word) return summary;
  return ["Write", "Edit", "Read"].includes(tool) && rest.length ? `${word} ${rest.join(" ")}` : word;
}

function renderStepSummary(details) {
  const group = details === state.steps?.details ? state.steps : null;
  const summary = details.querySelector("summary");
  const count = details.querySelectorAll("li").length;
  const steps = `${count} step${count === 1 ? "" : "s"}`;
  if (!state.running || !group) {
    delete details.dataset.live;
    summary.textContent = steps;
    return;
  }
  details.dataset.live = "";
  const secs = Math.max(0, Math.floor((Date.now() - state.turnStart) / 1000));
  const spinner = document.createElement("span");
  spinner.className = "spinner";
  spinner.setAttribute("aria-hidden", "true");
  const label = document.createElement("span");
  label.className = "step-label";
  label.textContent = group.latest;
  const meta = document.createElement("span");
  meta.className = "step-count";
  meta.textContent = `${steps} · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  summary.replaceChildren(spinner, label, meta);
}

setInterval(() => {
  if (state.running && state.steps) renderStepSummary(state.steps.details);
}, 1000);

function markStep(event) {
  if (!event.is_error) return;
  const li = $(`#chat-log li[data-id="${CSS.escape(event.id)}"]`);
  if (li) {
    li.classList.add("failed");
    li.textContent += " (failed)";
  }
}

// ---------- Questions (the agent's ask_questions tool) ----------

let questionCount = 0; // unique input names across cards

// Only the latest unanswered card can be used; sending any message answers it.
function closeQuestionCards() {
  for (const form of document.querySelectorAll("#chat-log .questions:not([data-answered])")) {
    form.dataset.answered = "";
    for (const el of form.querySelectorAll("input, button")) el.disabled = true;
  }
}

function questionCard(questions) {
  const n = ++questionCount;
  const form = document.createElement("form");
  form.className = "msg questions";
  const heading = document.createElement("h2");
  heading.id = `questions-${n}`;
  heading.textContent = "A few questions first";
  form.setAttribute("aria-labelledby", heading.id);
  form.append(heading);
  const fields = questions.map((q, i) => {
    const fieldset = document.createElement("fieldset");
    const legend = document.createElement("legend");
    legend.textContent = q.text;
    fieldset.append(legend);
    const choices = (q.options || []).map((option) => {
      const label = document.createElement("label");
      label.className = "check";
      const input = document.createElement("input");
      input.type = q.multiple ? "checkbox" : "radio";
      input.name = `q${n}-${i}`;
      input.value = option;
      label.append(input, option);
      fieldset.append(label);
      return input;
    });
    // With options, "Other" and its field share one row; without, the field is the answer.
    const other = document.createElement("input");
    other.type = "text";
    other.id = `q${n}-${i}-other`;
    const otherLabel = document.createElement("label");
    otherLabel.htmlFor = other.id;
    otherLabel.textContent = choices.length ? "Other" : "Your answer";
    const otherRow = document.createElement("div");
    otherRow.className = choices.length ? "other-row" : "answer-row";
    otherRow.append(otherLabel, other);
    fieldset.append(otherRow);
    form.append(fieldset);
    return { q, choices, other };
  });
  const row = document.createElement("div");
  row.className = "row";
  const send = document.createElement("button");
  send.type = "submit";
  send.className = "btn btn-primary";
  send.textContent = "Send answers";
  const skip = document.createElement("button");
  skip.type = "button";
  skip.className = "btn btn-secondary";
  skip.textContent = "Just build it";
  row.append(send, skip);
  form.append(row);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const lines = fields.map(({ q, choices, other }, i) => {
      const picked = choices.filter((c) => c.checked).map((c) => c.value);
      if (other.value.trim()) picked.push(other.value.trim());
      return `${i + 1}. ${q.text}\n   ${picked.length ? picked.join(", ") : "No preference; your call."}`;
    });
    const answers = fields.map(({ q, choices, other }) => ({
      question: q.text, options: q.options || [], chose: choices.filter((c) => c.checked).map((c) => c.value),
      other: other.value.trim(), topic: q.topic || null, rule: q.rule || null,
    }));
    answerQuestions(`Answers to your questions:\n${lines.join("\n")}`, answers);
  });
  skip.addEventListener("click", () => answerQuestions(
    "No preference on these. Build it with your own assumptions, and say what you assumed."));
  return form;
}

function closePlanCards() {
  for (const form of document.querySelectorAll("#chat-log .plan:not([data-answered])")) {
    form.dataset.answered = "";
    for (const el of form.querySelectorAll("textarea, button")) el.disabled = true;
  }
}

// The agent's plan (propose_plan), to approve as it is or edited. Changing it in words is
// the composer: Plan first stays on, so the agent answers with a new plan.
function planCard(event) {
  const form = document.createElement("form");
  form.className = "msg plan";
  const heading = document.createElement("h2");
  heading.id = `plan-${++questionCount}`;
  heading.textContent = "Plan";
  form.setAttribute("aria-labelledby", heading.id);
  const summary = document.createElement("p");
  summary.textContent = event.summary;
  const list = document.createElement("ol");
  list.className = "plan-steps";
  const addStep = (text) => {
    const li = document.createElement("li");
    const input = document.createElement("textarea");
    input.rows = 1;
    input.value = text;
    input.setAttribute("aria-label", `Step ${list.children.length + 1}`);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn-icon plan-remove";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove step ${list.children.length + 1}`);
    remove.addEventListener("click", () => li.remove());
    li.append(input, remove);
    list.append(li);
    return input;
  };
  for (const step of event.steps || []) addStep(step);
  const row = document.createElement("div");
  row.className = "row";
  const build = document.createElement("button");
  build.type = "submit";
  build.className = "btn btn-primary";
  build.textContent = "Build this";
  const add = document.createElement("button");
  add.type = "button";
  add.className = "btn btn-secondary";
  add.textContent = "Add step";
  add.addEventListener("click", () => addStep("").focus());
  row.append(build, add);
  const hint = document.createElement("p");
  hint.className = "plan-hint";
  hint.textContent = "Edit the steps, or say what to change in the message box.";
  form.append(heading, summary, list, row, hint);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if ($("#send").disabled) return;
    const steps = [...list.querySelectorAll("textarea")].map((i) => i.value.replace(/\s+/g, " ").trim()).filter(Boolean);
    if (!steps.length) return;
    $("#chat-input").value = `Build this plan:\n${steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`;
    state.pendingPlan = steps;
    sendMessage();
  });
  return form;
}

function updatePlanFirst() {
  $("#plan-first").setAttribute("aria-pressed", String(Boolean(state.planFirst)));
}

$("#plan-first").addEventListener("click", async () => {
  const on = !state.planFirst;
  try {
    await api(`/api/projects/${state.slug}/plan-first`, { method: "PUT", body: JSON.stringify({ on }) });
    state.planFirst = on;
  } catch (err) {
    setStatus(err.message);
  }
  updatePlanFirst();
});

function answerQuestions(text, answers = null) {
  if ($("#send").disabled) return;
  $("#chat-input").value = text;
  state.pendingAnswers = answers;
  sendMessage();
}

function renderEvent(event) {
  switch (event.type) {
    case "user": {
      closeQuestionCards();
      closePlanCards();
      state.steps = null;
      state.techniques = new Set();
      const div = message("user", event.text || (event.comments?.length ? "(comments only)" : "(files only)"));
      const where = contextLine(event.context);
      if (where) div.append(where);
      if (event.attachments?.length) {
        const ul = document.createElement("ul");
        ul.className = "msg-files";
        for (const a of event.attachments) {
          const li = document.createElement("li");
          const link = document.createElement("a");
          link.href = `/api/projects/${state.slug}/attachments/${a.id}`;
          link.target = "_blank";
          link.rel = "noopener";
          link.textContent = a.name;
          li.append(link);
          ul.append(li);
        }
        div.append(ul);
      }
      if (event.comments?.length) {
        const ol = document.createElement("ol");
        ol.className = "msg-comments";
        event.comments.forEach((c, i) => {
          const li = document.createElement("li");
          const text = document.createElement("span");
          text.textContent = `${c.note} <${c.tag}>`;
          li.append(numberBadge(i + 1), text);
          ol.append(li);
        });
        div.append(ol);
      }
      break;
    }
    case "text": {
      state.steps = null;
      const div = message("assistant", "");
      div.append(renderMarkdown(event.text));
      break;
    }
    case "tool":
      addStep(event);
      noteTechnique(event.summary || "");
      break;
    case "tool_result":
      markStep(event);
      break;
    case "done": {
      state.steps = null;
      // The agent's intro text streams after its questions; put the form last.
      if (state.questionCard) appendToLog(state.questionCard);
      state.questionCard = null;
      const meta = document.createElement("div");
      meta.className = "turn-meta";
      // The CLI prices local models as if they were Claude; that number means nothing.
      const local = event.local ?? state.local;
      const cost = local ? " · local model"
        : event.cost_usd != null ? ` · $${event.cost_usd.toFixed(3)} API-equivalent` : "";
      const tokens = !local && event.tokens ? ` · ${tokenSummary(event.tokens)}` : "";
      meta.textContent = (event.is_error ? "Turn ended with an error" : "Done") + cost + tokens;
      appendToLog(meta);
      if (state.techniques?.size) {
        // Each name opens that technique (or the palette browser) in the studio.
        const used = document.createElement("div");
        used.className = "turn-meta turn-techniques";
        used.append("From the technique library: ");
        [...state.techniques].forEach((name, i) => {
          const link = document.createElement("button");
          link.type = "button";
          link.className = "link-button";
          link.textContent = name;
          link.onclick = name === "Wada palettes" ? () => $("#palette-browse").click()
            : () => openTechniques({ id: name });
          used.append(...(i ? [", ", link] : [link]));
        });
        appendToLog(used);
      }
      state.techniques = new Set();
      break;
    }
    case "error":
      state.steps = null;
      message("error", event.message);
      break;
    case "note":
      state.steps = null;
      message("note", event.text);
      break;
    case "questions":
      state.steps = null;
      state.questionCard = questionCard(event.questions);
      appendToLog(state.questionCard);
      break;
    case "plan":
      state.steps = null;
      appendToLog(planCard(event));
      break;
    case "findings":
      state.steps = null;
      appendToLog(findingsCard(event));
      showFindings(event);
      break;
  }
}

// The Findings tab holds the latest check, with its count on the tab (redesign gate, section 5).
function showFindings(event) {
  $("#findings-empty").hidden = Boolean(event);
  $("#findings-panel").replaceChildren(...(event ? [findingsCard(event)] : []));
  const n = event ? event.findings.length : 0;
  $("#findings-count").hidden = !n;
  $("#findings-count").textContent = String(n);
}

// design-guide's gate on the pages a turn changed (docs/gate-rulebook.md): each finding names
// its rule. The user may dismiss any rule's findings for this project except the accessibility
// floor's; a dismissal is logged as their decision, with an optional reason in their words.
function findingsCard(event) {
  const card = document.createElement("section");
  card.className = "msg findings";
  const heading = document.createElement("h2");
  heading.id = `findings-${++questionCount}`;
  heading.textContent = event.findings.length
    ? `design-guide's rules: ${event.findings.length} finding${event.findings.length === 1 ? "" : "s"}`
    : "design-guide's rules: nothing found";
  card.setAttribute("aria-labelledby", heading.id);
  const meta = document.createElement("p");
  meta.className = "findings-meta";
  meta.textContent = `${event.pages.join(", ")} · rulebook ${event.rulebook}`;
  card.append(heading, meta);
  const list = document.createElement("ul");
  for (const f of event.findings) {
    const li = document.createElement("li");
    const title = document.createElement("p");
    title.className = "finding-title";
    const code = document.createElement("code");
    code.textContent = f.rule;
    title.append(f.blocking ? "Must fix · " : "", f.title, " ", code);
    const reason = document.createElement("p");
    reason.className = "finding-reason";
    reason.textContent = `${f.page}: ${f.reasons.slice(0, 2).join("; ")}${f.reasons.length > 2 ? ` (+${f.reasons.length - 2} more)` : ""}`;
    li.append(title, reason);
    if (f.dismissable) {
      const dismiss = document.createElement("button");
      dismiss.type = "button";
      dismiss.className = "btn btn-secondary";
      dismiss.textContent = "Dismiss for this project";
      dismiss.addEventListener("click", async () => {
        let record;
        try {
          record = await (await api(`/api/projects/${state.slug}/findings/dismiss`, {
            method: "POST", body: JSON.stringify({ rule: f.rule, page: f.page }),
          })).json();
        } catch (err) {
          setStatus(err.message);
          return;
        }
        dismiss.replaceWith(Object.assign(document.createElement("p"), {
          className: "finding-reason", textContent: "Dismissed for this project." }));
        whyCard([record.id]);
      });
      li.append(dismiss);
    }
    list.append(li);
  }
  if (event.findings.length) card.append(list);
  // The agent's own declared exceptions to the design system or palette: shown, never hidden.
  if (event.exceptions?.length) {
    const heading2 = Object.assign(document.createElement("p"), { className: "finding-title",
      textContent: "Exceptions the agent declared" });
    const ex = document.createElement("ul");
    ex.className = "finding-exceptions";
    ex.append(...event.exceptions.map((e) => {
      const li = document.createElement("li");
      const code = document.createElement("code");
      code.textContent = e.name;
      li.append(code, `: ${e.value} (${e.file})`);
      return li;
    }));
    card.append(heading2, ex);
  }
  for (const err of event.errors || []) card.append(Object.assign(document.createElement("p"), {
    className: "finding-reason", textContent: `Not checked: ${err}` }));
  return card;
}

function setRunning(running) {
  if (running && !state.running) state.turnStart = Date.now();
  state.running = running;
  if (!running) {
    for (const d of document.querySelectorAll(".steps[data-live]")) renderStepSummary(d);
  }
  updateStagePill();
  $("#send").disabled = running;
  $("#stop").hidden = !running;
  $("#restore").disabled = running;
  $("#ds-select").disabled = running;
  $("#model-select").disabled = running;
  $("#handoff").disabled = running;
  updateEditButtons();
  updateTweakButtons();
}

function setStatus(text) {
  $("#status").textContent = text;
}

// One line over the canvas saying what it is showing, most important first.
function updateStagePill() {
  let text = "";
  const n = versionNumber(state.viewing);
  if (state.commentMode) text = "Comment mode: click an element to comment. Esc to leave.";
  else if (draw.on) text = "Draw on the design, then attach the sketch. Esc to leave.";
  else if (state.editMode) text = "Edit mode: click to select, shift-click for more, drag to move. Esc to leave.";
  else if (state.canvasView === "board") {
    text = state.boardFrame ? `Board: “${state.boardFrame.title}” selected` : "Board: click a frame to select it";
  }
  else if (state.viewing) text = `Previewing version ${n} of ${state.versions.length}, not the current design`;
  else if (state.running) text = "Updates after every file write";
  $("#stage-pill").textContent = text;
  $("#stage-pill").hidden = !text;
}

function reloadCanvas(hasEntry = true) {
  if (state.canvasView === "board") return loadBoard(); // the board shows every page itself
  const frame = $("#canvas");
  $("#canvas-empty").hidden = hasEntry;
  $("#canvas-box").hidden = !hasEntry;
  if (hasEntry) {
    frame.src = state.viewing
      ? `/canvas-version/${state.slug}/${state.viewing}/${state.page}`
      : `/canvas/${state.slug}/${state.page}?t=${Date.now()}`;
  }
  fitCanvas();
}

// Render the design at the chosen device width, scaled down to fit the stage.
// The width the canvas page renders at: the page's own fixed width (`fixedWidth` in the bridge's
// ready, e.g. a letter sheet at 816), or else the chosen device width.
function canvasWidth() {
  return state.pageWidth || state.width;
}

function updateViewportButtons() {
  const fixed = state.pageWidth;
  for (const b of document.querySelectorAll(".toolbar .viewport button")) b.disabled = Boolean(fixed);
  $("#viewport-select").disabled = Boolean(fixed);
  $(".toolbar .viewport").title = fixed ? `This page is made ${fixed} px wide, so it is shown at that width` : "";
}

function fitCanvas() {
  const stage = $("#canvas-stage");
  const style = getComputedStyle(stage);
  const availW = stage.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const availH = stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  if (availW <= 0 || availH <= 0) return;
  const width = canvasWidth();
  const scale = Math.min(1, availW / width);
  const frame = $("#canvas");
  frame.style.width = `${width}px`;
  frame.style.height = `${availH / scale}px`;
  frame.style.transform = `scale(${scale})`;
  $("#canvas-box").style.width = `${width * scale}px`;
  $("#canvas-box").style.height = `${availH}px`;
  // Only the scale shows: the width is on the viewport buttons, and the toolbar is crowded.
  $("#zoom").textContent = `${Math.round(scale * 100)}%`;
  $("#zoom").title = `${width}px at ${Math.round(scale * 100)}%`;
  $("#zoom").setAttribute("aria-label", $("#zoom").title);
  if (draw.on) sizeDrawLayer();
}

new ResizeObserver(fitCanvas).observe($("#canvas-stage"));

async function sendMessage() {
  const input = $("#chat-input");
  const text = input.value.trim();
  const sending = state.comments.filter((c) => !state.commentHold.has(c.id));
  if ((!text && !sending.length && !state.attachments.length) || !state.slug || $("#send").disabled) return;
  const slug = state.slug;
  input.value = "";
  const context = viewContext();
  const answers = state.pendingAnswers;  // set only by the questions form
  state.pendingAnswers = null;
  const plan = state.pendingPlan;  // set only by a plan card's "Build this"
  state.pendingPlan = null;
  closeCompare(); // a new version is coming; compare again once it is there
  renderEvent({ type: "user", text, comments: sending, attachments: state.attachments, context });
  renderAttachments([]);
  setRunning(true);
  setStatus("Working…");
  if (state.viewing) {
    // The agent edits the live files, so show those rather than a past version.
    state.viewing = null;
    renderVersions(state.versions);
    reloadCanvas();
  }

  await followTurn(slug, () => api(`/api/projects/${slug}/chat`, {
    method: "POST",
    body: JSON.stringify({ message: text, context, comment_ids: sending.map((c) => c.id), answers, plan }),
  }));
}

// What the user is looking at, sent with every message so the agent can resolve "this".
function viewContext() {
  if (state.canvasView === "board") {
    const f = state.boardFrame;
    return { view: "board", page: f ? f.page : "", width: f ? f.width : null, selected: null };
  }
  const sel = state.editMode && state.selection;
  return {
    page: state.page, width: canvasWidth(),
    selected: sel ? { selector: sel.selector, tag: sel.tag, text: sel.text || "", count: sel.count || 1 } : null,
  };
}

// A muted line under a user message, shown only when it adds something: another page, a
// narrower width, or a selected element.
function contextLine(ctx) {
  if (!ctx) return null;
  const parts = [];
  if (ctx.page && ctx.page !== state.entry) parts.push(ctx.page);
  if (ctx.width && ctx.width !== 1440) parts.push(`${ctx.width}px`);
  if (ctx.selected) {
    parts.push(`<${ctx.selected.tag}>${ctx.selected.text ? ` “${ctx.selected.text.slice(0, 30)}”` : ""}`
      + (ctx.selected.count > 1 ? ` +${ctx.selected.count - 1}` : ""));
  }
  if (!parts.length) return null;
  const p = document.createElement("p");
  p.className = "msg-context";
  p.textContent = `On ${parts.join(" · ")}`;
  return p;
}

// Render a turn's events as they stream in. `open` starts the request: the chat POST for
// a new message, or the reattach route after a reload. The turn itself runs on the
// server, so leaving the page never stops it.
async function followTurn(slug, open) {
  const writeIds = new Set();
  try {
    const res = await open();
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop();
      for (const chunk of chunks) {
        if (!chunk.startsWith("data: ") || state.slug !== slug) continue;
        const event = JSON.parse(chunk.slice(6));
        renderEvent(event);
        if (event.type === "done" && !event.local && state.usage) { // same sum as server.usage_total
          state.usage.turns += 1;
          state.usage.cost_usd += event.cost_usd || 0;
          for (const [key, value] of Object.entries(event.tokens || {})) state.usage[key] = (state.usage[key] || 0) + value;
          renderUsage();
        }
        if (event.type === "tool" && WRITE_TOOLS.has(event.name)) writeIds.add(event.id);
        // Show each file write as soon as it lands.
        if (event.type === "tool_result" && writeIds.has(event.id)) {
          if (state.canvasView === "board") loadBoard();
          else reloadCanvas();
        }
        if (event.type === "version") loadVersions();
      }
    }
  } catch (err) {
    if (state.slug === slug) renderEvent({ type: "error", message: err.message });
  } finally {
    if (state.slug === slug) {
      setRunning(false);
      setStatus("");
      if (writeIds.size) {
        await refreshPages(); // the agent may have added or removed pages
        if (state.canvasView === "board") loadBoard();
        else reloadCanvas();
      }
      loadComments(); // the agent may have resolved some
    }
  }
}

$("#chat-form").addEventListener("submit", (e) => {
  e.preventDefault();
  sendMessage();
});

$("#chat-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

$("#stop").addEventListener("click", () => {
  api(`/api/projects/${state.slug}/stop`, { method: "POST" });
});

$("#reload").addEventListener("click", () => reloadCanvas());

for (const btn of document.querySelectorAll(".toolbar .viewport button")) {
  btn.addEventListener("click", () => {
    state.width = Number(btn.dataset.width);
    fitCanvas();
    for (const b of document.querySelectorAll(".toolbar .viewport button")) {
      b.setAttribute("aria-pressed", String(b === btn));
    }
    $("#viewport-select").value = btn.dataset.width;
  });
}

// Phones show a select instead of the segmented buttons; it drives the same buttons.
$("#viewport-select").addEventListener("change", () => {
  $(`.toolbar .viewport button[data-width="${$("#viewport-select").value}"]`).click();
});

// ---------- Narrow screens: Chat and Canvas as two views ----------

function setView(view) {
  $("#studio").dataset.view = view;
  for (const b of document.querySelectorAll(".view-switch button")) {
    b.setAttribute("aria-pressed", String(b.dataset.view === view));
  }
}

for (const btn of document.querySelectorAll(".view-switch button")) {
  btn.addEventListener("click", () => setView(btn.dataset.view));
}

// ---------- Resizable chat pane ----------

const CHAT_MIN = 320;
const CHAT_MAX = 560;
const CHAT_STEP = 16;

function setChatWidth(px) {
  const width = Math.round(Math.min(CHAT_MAX, Math.max(CHAT_MIN, px)));
  $("#studio").style.setProperty("--pm-chat-w", `${width}px`);
  try { localStorage.setItem("pm-chat-w", String(width)); } catch { /* storage may be blocked */ }
}

function chatWidth() {
  return $(".chat-pane").getBoundingClientRect().width;
}

try {
  const saved = Number(localStorage.getItem("pm-chat-w"));
  if (saved) setChatWidth(saved);
} catch { /* storage may be blocked */ }

// The panel sits on the right, so its handle is its left edge: left widens it.
$("#chat-resize").addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    e.preventDefault();
    setChatWidth(chatWidth() + (e.key === "ArrowLeft" ? CHAT_STEP : -CHAT_STEP));
  }
});

$("#chat-resize").addEventListener("pointerdown", (e) => {
  const handle = $("#chat-resize");
  handle.setPointerCapture(e.pointerId);
  const right = $(".chat-pane").getBoundingClientRect().right;
  const move = (ev) => setChatWidth(right - ev.clientX);
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", () => handle.removeEventListener("pointermove", move), { once: true });
});

// ---------- Routing ----------

function route() {
  if ($("#new-dialog").open) $("#new-dialog").close(); // a creation that navigated is done with the sheet
  const match = location.hash.match(/^#\/p\/([^/]+)$/);
  const section = { "#/systems": "systems", "#/library": "library", "#/rules": "rules" }[location.hash] || "projects";
  (match ? showStudio(match[1]) : showHome(section)).catch((err) => {
    console.error(err);
    location.hash = "#/";
  });
}

window.addEventListener("hashchange", route);
route();
