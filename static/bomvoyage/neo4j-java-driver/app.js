/* BOMvoyage: interactive graph + time slider + inspector + Cypher console. */
"use strict";

const ECOSYSTEM_COLORS = {
  python: "#4b8bbe",
  java: "#e76f00",
  rust: "#dea584",
  go: "#00add8",
  node: "#8cc84b",
  generic: "#8b949e",
};

/// Packages are green; vulnerable ones (detailed mode) break out as red
/// triangles. The scheme is the same in every mode — a vulnerable package
/// is always the one non-green shape on the canvas.
const PACKAGE_GREEN = "#3fb950";
const VULNERABLE_RED = "#f85149";

/// Arrival flourish colors. PURPLE is reserved for net-new dependencies;
/// an upgraded version arrives YELLOW on the replaced version's spot.
/// Both fade to the node's true color — green, or red when it arrives
/// with known advisories (a vulnerable package never animates as green).
const ARRIVAL_PURPLE = "#a371f7";
const UPGRADE_YELLOW = "#f2cc60";
const ARRIVAL_PINK = "#ff7bac";
/// Base duration of graph motion (layout glides, fan animation). The 4×
/// control divides it by four — and divides the sweep pacing by four —
/// while it's active.
const ANIM_MS = 900;
let playbackRate = 1;        // 1 or 4 (the 4× toggle)
let runningLayout = null;    // layout whose animation is in flight (stoppable on pause)
let driftPending = false;    // a scratch drift computation is in flight (the sweep waits for it)
let motionGen = 0;           // bumped on pause: drift computed before a pause snaps instead of animating

/// Node kinds a query can return, with their canvas look. Package nodes are
/// coloured by ecosystem instead.
const KIND_STYLES = {
  Person: { color: "#4c8dff", shape: "round-rectangle", legend: "sq" },
  Manifest: { color: "#a371f7", shape: "round-tag", legend: "sq" },
  File: { color: "#6e7681", shape: "rectangle", legend: "sq" },
  Commit: { color: "#3fb950", shape: "diamond", legend: "dia" },
  Project: { color: "#f0b429", shape: "star", legend: "" },
};

const STALE_AS_OF = "9999-12-31T23:59:59Z"; // $as_of at HEAD

let cy = null;
let commits = [];            // [{sha, date, summary, author}] oldest-first
let selectedPackage = null;  // purl
let showTransitive = null;   // null = auto-decide on the first load
let lastElements = null;     // full as-of element set from /api/graph
let view = "devs";           // 'devs' (default) | 'areas'
let queryElements = null;    // raw-Cypher result shown in the main canvas
let lastCypher = null;       // the query behind queryElements
let days = [];               // distinct commit dates (yyyy-mm-dd), ascending
let selectedDate = null;     // explicit calendar pick (yyyy-mm-dd)
let calMonth = null;         // month the calendar popover is showing
let playing = false;         // autoplay sweep running?
let playTimer = null;        // pending next-step timeout of the sweep
let detailedPackages = 0;    // packages carrying deps.dev data (from /api/meta)
let needsFullLayout = true;  // next render rebuilds from scratch (first render, glitch recovery, view flips)
let lastRenderWasQuery = false; // previous canvas content was a raw-Cypher result
const DIRECT_ONLY_THRESHOLD = 20;

const $ = (id) => document.getElementById(id);

async function fetchJson(url, opts) {
  // A generated static site (bomvoyage site) answers everything from an
  // in-browser RelateDb (WASM) — same response shapes, no server.
  if (window.BOMVOYAGE_STATIC) return window.BOMVOYAGE_STATIC.fetchJson(url, opts);
  const res = await fetch(url, opts);
  const body = await res.json();
  if (body.error) throw new Error(body.error);
  return body;
}

// ---------------------------------------------------------------- time

function asOfValue() {
  // Calendar pick wins; else the slider's DAY (end of day, so the whole
  // day's commits are included). Past the last day = HEAD.
  if (selectedDate) return `${selectedDate}T23:59:59Z`;
  const idx = Number($("slider").value);
  if (commits.length === 0 || idx >= days.length) return null; // HEAD
  return `${days[idx]}T23:59:59Z`;
}

function setAsOfLabel(asOf) {
  const banner = $("travel-banner");
  $("reset-btn").disabled = !asOf;
  if (!asOf) {
    $("asof-chip").textContent = "HEAD";
    banner.hidden = true;
    banner.innerHTML = "";
    markCalendarSelection();
    return;
  }
  const day = asOf.slice(0, 10);
  $("asof-chip").textContent = day;
  const dayCommits = commits.filter((c) => c.date.startsWith(day));
  const last = dayCommits[dayCommits.length - 1];
  const detail = last
    ? `${dayCommits.length} commit${dayCommits.length === 1 ? "" : "s"} that day · last ${last.sha.slice(0, 8)} — ${last.summary}`
    : "no commits that day — the SBOM as it stood before the next one";
  // The banner is the unmissable time-travel signal: gold when viewing the
  // past, absent at HEAD.
  banner.hidden = false;
  banner.innerHTML =
    `<span>⏱</span><strong>Time travel — dependencies as of ${escapeHtml(day)}</strong>` +
    `<span class="detail">${escapeHtml(detail)}</span>`;
  markCalendarSelection();
}

// ---------------------------------------------------------------- views

function visibleElements(elements) {
  const nodes = elements.nodes.map((n) => ({
    data: Object.assign({ type: "package" }, n.data),
  }));
  if (showTransitive) return { nodes, edges: elements.edges };
  const direct = nodes.filter((n) => n.data.scope === "direct");
  const ids = new Set(direct.map((n) => n.data.id));
  const edges = elements.edges.filter(
    (e) => ids.has(e.data.source) && ids.has(e.data.target)
  );
  return { nodes: direct, edges };
}

/// Repo sub-area of one manifest path: its directory ("(root)" for top-level).
function areaOf(manifest) {
  const dir = manifest.includes("/") ? manifest.slice(0, manifest.lastIndexOf("/")) : "";
  return dir || "(root)";
}

/// Build the elements for the active view from the as-of package set.
/// Both views share the package nodes (scope-filtered); they differ in
/// what the packages are linked to:
///   devs  — DIRECT packages hang off the developer who added them;
///           transitive packages hang off the DEPENDS_ON graph that pulled
///           them in, never off a developer
///   areas — packages hang off the repo sub-area whose manifest declares them
function buildViewElements(elements) {
  const prefix = view === "devs" ? "dev:" : "area:";
  const groupOf = view === "devs"
    ? (d) => d.added_by || "(unknown)"
    : (d) => areaOf(d.manifest || "");

  const nodes = [];
  const edges = [];
  const groups = new Map(); // group name -> node
  const pkgIds = new Set(elements.nodes.map((n) => n.data.id));

  for (const n of elements.nodes) {
    const attributed = view === "areas" || n.data.scope === "direct";
    if (attributed) {
      const group = groupOf(n.data);
      if (!groups.has(group)) {
        groups.set(group, {
          data: { id: prefix + group, label: group, type: prefix.slice(0, -1) },
        });
      }
      edges.push({
        data: { source: prefix + group, target: n.data.id, source_kind: "attribution" },
      });
    }
    nodes.push(n);
  }

  if (view === "devs") {
    for (const e of elements.edges) {
      if (pkgIds.has(e.data.source) && pkgIds.has(e.data.target)) edges.push(e);
    }
  }
  return { nodes: [...groups.values()].concat(nodes), edges };
}

// ---------------------------------------------------------------- canvas

function nodeColor(n) {
  const kind = n.data("kind");
  if (kind && KIND_STYLES[kind]) return KIND_STYLES[kind].color;
  // Uniform green for packages (the vulnerable selector overrides to red
  // triangles after this in CY_STYLE).
  return PACKAGE_GREEN;
}

const CY_STYLE = [
  {
    selector: "node",
    style: {
      "background-color": nodeColor,
      label: "data(label)",
      color: "#c9d1d9",
      "font-size": 9,
      "text-valign": "bottom",
      "text-margin-y": 4,
      "text-outline-color": "#0b0e14",
      "text-outline-width": 2,
      "min-zoomed-font-size": 7,
      width: 18,
      height: 18,
      "border-width": 0,
      "transition-property": "opacity",
      "transition-duration": "120ms",
    },
  },
  { selector: "node[scope = 'transitive']", style: { width: 12, height: 12 } },
  // Detailed mode: packages whose deps.dev data reports security advisories
  // break the ecosystem color/shape scheme deliberately — red triangles are
  // the one thing you should spot from across the room. Placed after the
  // entries above so it wins on color and size; `vulns` only exists on
  // Package nodes, so query-result kind shapes are unaffected.
  {
    selector: "node[vulns > 0]",
    style: {
      shape: "triangle",
      "background-color": VULNERABLE_RED,
      width: 16,
      height: 16,
    },
  },
  {
    selector: "node[type = 'dev'], node[type = 'area']",
    style: {
      shape: "round-rectangle",
      width: "label",
      height: 22,
      padding: "7px",
      "background-color": "#1f3a66",
      "border-width": 1,
      "border-color": "#4c8dff",
      color: "#e6e8eb",
      "font-size": 11,
      "font-weight": 600,
      "text-valign": "center",
      "text-margin-y": 0,
      "text-outline-width": 0,
    },
  },
  {
    selector: "node[type = 'area']",
    style: { "background-color": "#2e2160", "border-color": "#a371f7" },
  },
  // Query-result nodes: shape by kind.
  ...Object.entries(KIND_STYLES).map(([kind, s]) => ({
    selector: `node[kind = '${kind}']`,
    style: { shape: s.shape, width: kind === "Person" ? 22 : 16, height: kind === "Person" ? 22 : 16 },
  })),
  { selector: "node[kind = 'Package']", style: { width: 18, height: 18 } },
  {
    selector: "edge",
    style: {
      width: 1.2,
      "line-color": "#30363d",
      "target-arrow-color": "#30363d",
      "target-arrow-shape": "triangle",
      "arrow-scale": 0.8,
      "curve-style": "bezier",
      "transition-property": "opacity",
      "transition-duration": "120ms",
    },
  },
  { selector: "edge[source_kind = 'synthesized']", style: { "line-style": "dashed" } },
  {
    selector: "edge[source_kind = 'attribution']",
    style: { "line-color": "rgba(76,141,255,0.45)", "target-arrow-color": "rgba(76,141,255,0.45)" },
  },
  {
    selector: "edge[source_kind = 'query']",
    style: {
      label: "data(label)",
      "font-size": 7,
      color: "#6e7681",
      "text-rotation": "autorotate",
      "text-background-color": "#0b0e14",
      "text-background-opacity": 1,
      "text-background-padding": "1px",
      "min-zoomed-font-size": 8,
      "line-color": "#3a4350",
      "target-arrow-color": "#3a4350",
    },
  },
  { selector: "node.dense", style: { "min-zoomed-font-size": 11 } },
  { selector: ".faded", style: { opacity: 0.12 } },
  {
    selector: "node:selected",
    style: { "border-width": 3, "border-color": "#ffffff", "border-opacity": 0.9 },
  },
  {
    selector: "edge.hl",
    style: { "line-color": "#4c8dff", "target-arrow-color": "#4c8dff", width: 2, color: "#c9d1d9" },
  },
];

/// Hub-and-spoke results (one developer → 200 packages) knot up under a
/// force layout; rings by degree read far better. `seeded` (incremental
/// updates) starts from the nodes' current positions — the layout computes
/// the day's ideal arrangement silently and the drift logic (MAX_DRIFT)
/// migrates nodes toward it gradually, so nothing ever jumps.
function layoutOptions(n, seeded) {
  if (cy && n > 40) {
    const maxDeg = cy.nodes().max((x) => x.degree()).value;
    if (maxDeg > n * 0.3) {
      // Hubs in the middle; the rest packed into rings whose capacity grows
      // outward, so 200 spokes make a compact disc, not one giant circle.
      const ring = new Map();
      const rest = cy.nodes().filter((x) => x.degree() <= n * 0.3)
        .sort((a, b) => b.degree() - a.degree() || String(a.data("label")).localeCompare(b.data("label")));
      let r = 0, used = 0;
      rest.forEach((x) => {
        if (used >= 14 * (r + 1)) { r++; used = 0; }
        ring.set(x.id(), r);
        used++;
      });
      return {
        name: "concentric",
        animate: false,
        concentric: (x) => (ring.has(x.id()) ? -ring.get(x.id()) : 1),
        levelWidth: () => 1,
        minNodeSpacing: 22,
        padding: 40,
      };
    }
  }
  return {
    name: "cose",
    animate: false,
    randomize: !seeded,
    nodeRepulsion: () => (n > 150 ? 9000 : 6000),
    idealEdgeLength: () => (n > 150 ? 50 : 70),
    nodeOverlap: 8,
    numIter: n > 400 ? 600 : 1000,
    padding: 40,
  };
}

/// Hand-placed layout for the dependencies (areas) view: force layout knots
/// that star-of-stars into a hairball. Hubs go evenly on a big ring (like
/// the devs view), each hub's packages fan on a circle around it sized so
/// neighbouring fans never touch. Returns false when there are no hubs.
/// With `animate`, nodes drift toward their slot (clamped to MAX_DRIFT —
/// the arrangement migrates over days instead of jumping).
function applyAreasLayout(animate, unconstrained) {
  const hubs = cy.nodes("[type = 'area']");
  if (hubs.length === 0) return false;
  const tau = Math.PI * 2;
  const fans = [];
  hubs.forEach((h) => {
    const kids = h
      .outgoers("node")
      .toArray()
      .sort((a, b) => String(a.data("label")).localeCompare(String(b.data("label"))));
    fans.push({ hub: h, kids, pr: 34 + 11 * Math.sqrt(kids.length) });
  });
  // Ring circumference sized so adjacent fans stay pr_i + pr_j + gap apart.
  const R = Math.max(170, (fans.reduce((s, f) => s + 2 * f.pr, 0) / tau) * 1.35);
  const ms = unconstrained ? 0 : animate ? ANIM_MS / playbackRate : 0;
  const place = (node, x, y) => {
    if (node.locked()) return; // pinned (version-bump replacement)
    if (unconstrained) node.position({ x, y });
    else driftToward(node, x, y, ms);
  };
  let angle = -Math.PI / 2;
  fans.forEach((f, i) => {
    const mid = angle + f.pr / R; // centre of this hub's angular slice
    angle += (2 * f.pr) / R;
    const hx = R * Math.cos(mid);
    const hy = R * Math.sin(mid);
    place(f.hub, hx, hy);
    const spin = i * 2.4; // stagger fans so neighbours don't line up
    f.kids.forEach((p, j) => {
      const pa = mid + spin + (j / Math.max(f.kids.length, 1)) * tau;
      place(p, hx + f.pr * Math.cos(pa), hy + f.pr * Math.sin(pa));
    });
  });
  return true;
}

/// Fit all elements, but never zoom a small graph into absurdity.
function fitReasonably() {
  cy.fit(undefined, 48);
  if (cy.zoom() > 1.3) {
    cy.zoom(1.3);
    cy.center();
  }
}

function buildGraph(elements) {
  try {
    rebuildGraph(elements);
  } catch (e) {
    // A cytoscape internal (e.g. a deferred search-filter pass colliding
    // with the rebuild storm of a fast slider drag) can wedge the instance:
    // burn it down and start a fresh one rather than leaving a dead canvas
    // that ignores the slider until the app is restarted.
    setStatus(`graph glitch, recovered: ${e.message}`, "error");
    try {
      cy.destroy();
    } catch (_) {
      // already gone
    }
    cy = null;
    needsFullLayout = true;
    rebuildGraph(elements);
  }
}

// ------------------------------------------------------------- diffing

/// Edge identity across renders: endpoints plus what kind of edge it is
/// (a package↔package DEPENDS_ON edge and a hub attribution edge are
/// different edges even between the same pair). Accepts both a plain
/// `{data: …}` element and a live cytoscape edge (where `data` is a method).
function edgeKeyOf(e) {
  const d = typeof e.data === "function" ? e.data() : e.data;
  return `${d.source}\u0000${d.target}\u0000${d.source_kind}`;
}

/// Pure diff of two cytoscape element sets — the basis of smooth time
/// travel. Persisting nodes keep their identity (and therefore position);
/// only genuinely new/gone elements change the picture. Pure JSON-in/out
/// so the vm-based UI smoke can assert on it without a canvas.
function diffElements(oldEls, newEls) {
  const oldNodes = new Map(oldEls.nodes.map((n) => [n.data.id, n]));
  const newNodes = new Map(newEls.nodes.map((n) => [n.data.id, n]));
  const keptNodeIds = [];
  const addedNodes = [];
  const removedNodeIds = [];
  for (const [id, n] of newNodes) {
    if (oldNodes.has(id)) keptNodeIds.push(id);
    else addedNodes.push(n);
  }
  for (const id of oldNodes.keys()) {
    if (!newNodes.has(id)) removedNodeIds.push(id);
  }
  const oldEdges = new Map(oldEls.edges.map((e) => [edgeKeyOf(e), e]));
  const newEdges = new Map(newEls.edges.map((e) => [edgeKeyOf(e), e]));
  const addedEdges = [];
  const removedEdgeKeys = [];
  for (const [k, e] of newEdges) {
    if (!oldEdges.has(k)) addedEdges.push(e);
  }
  for (const k of oldEdges.keys()) {
    if (!newEdges.has(k)) removedEdgeKeys.push(k);
  }
  const unchanged =
    addedNodes.length === 0 &&
    removedNodeIds.length === 0 &&
    addedEdges.length === 0 &&
    removedEdgeKeys.length === 0;
  return { keptNodeIds, addedNodes, removedNodeIds, addedEdges, removedEdgeKeys, unchanged };
}

/// Where a brand-new node materializes: next to a persisted neighbour it
/// connects to (so the seed layout starts local, not at a random corner),
/// else near a same-kind hub, else centre.
function spawnPosition(id, elements) {
  for (const e of elements.edges) {
    const other =
      e.data.source === id ? e.data.target : e.data.target === id ? e.data.source : null;
    if (other) {
      const n = cy.getElementById(other);
      if (n.nonempty()) {
        const p = n.position();
        return { x: p.x + (Math.random() - 0.5) * 40, y: p.y + (Math.random() - 0.5) * 40 };
      }
    }
  }
  const colon = id.indexOf(":");
  if (colon > 0) {
    const prefix = id.slice(0, colon + 1);
    const hub = cy.nodes().filter((n) => String(n.id()).startsWith(prefix)).first();
    if (hub.nonempty()) {
      const p = hub.position();
      return { x: p.x + 50, y: p.y + 50 };
    }
  }
  return { x: 0, y: 0 };
}

/// The version-less base of a purl (`pkg:cargo/serde@1.0.1` →
/// `pkg:cargo/serde`) — how a version bump is recognized as the same
/// dependency in a new version. Null for ids without a version part
/// (hubs, query nodes). The `@` before the version is the LAST one —
/// npm scoped names (`pkg:npm/@types/node@20.1.0`) keep working.
function baseOf(id) {
  const at = id.lastIndexOf("@");
  return at > 4 ? id.slice(0, at) : null;
}

/// A brand-new dependency arrives purple, an upgraded version arrives
/// yellow (on the replaced version's spot), and both fade to the node's
/// TRUE color — green, or red when it arrives with known advisories
/// (border fading out throughout). The fade is slow — twice the base
/// motion time — and deliberately NOT gated on travel: a day change
/// never waits for it, and a re-arrival mid-fade (an update landing
/// while the previous transition is still running) restarts the
/// transition from the current color immediately. The inline styles are
/// cleared afterwards so the stylesheet regains full control (e.g. a
/// later `vulns > 0` must be able to turn the node red). Hubs
/// (dev:/area:) are groupings, not dependencies — they arrive plain.
const arrivalAnims = new Map(); // ele id -> {anim, timer} of the flourish in flight

function arriveWithFlourish(ele, data, isUpgrade) {
  if (data.type !== "package") return;
  const from = isUpgrade ? UPGRADE_YELLOW : ARRIVAL_PURPLE;
  const to = (data.vulns || 0) > 0 ? VULNERABLE_RED : PACKAGE_GREEN;
  const fadeMs = (ANIM_MS * 4) / playbackRate; // twice the earlier fade
  // An update landing mid-fade restarts the transition at once: stop the
  // prior flourish's animation (cytoscape otherwise QUEUES the new one
  // behind it) and cancel its cleanup so it can't cut the new one short.
  const prior = arrivalAnims.get(ele.id());
  if (prior) {
    try {
      prior.anim.stop();
    } catch (_) {}
    liveAnimations.delete(prior.anim);
    clearTimeout(prior.timer);
  }
  // Marked while fading: the sweep waits for position motion but not for
  // this color crossfade (it continues gracefully across steps).
  ele.addClass("arriving");
  ele.style({
    "background-color": from,
    "border-color": ARRIVAL_PINK,
    "border-width": 2.5,
  });
  const anim = ele.animation(
    {
      style: {
        "background-color": to,
        "border-color": to,
        "border-width": 0,
      },
    },
    { duration: fadeMs, easing: "ease-in-out" }
  );
  liveAnimations.add(anim);
  anim.play();
  // When the fade finishes, hand styling back to the stylesheet.
  const timer = setTimeout(() => {
    arrivalAnims.delete(ele.id());
    liveAnimations.delete(anim);
    if (ele.inside()) {
      ele.removeClass("arriving");
      ele.removeStyle();
    }
  }, fadeMs + 100);
  arrivalAnims.set(ele.id(), { anim, timer });
}

// ------------------------------------------------------- gradual drift

// Position animations we've started (via ele.animation — the only stop()
// that actually works; eles.stop() is a silent no-op on playing motion).
const liveAnimations = new Set();

function animatePos(ele, to, ms) {
  if (ms <= 0) {
    ele.position(to);
    return;
  }
  const anim = ele.animation({ position: to }, { duration: ms, easing: "ease-in-out" });
  liveAnimations.add(anim);
  anim.play();
  setTimeout(() => liveAnimations.delete(anim), ms + 120);
}

/// Freeze every in-flight position motion exactly where it is — pause.
function freezeMotions() {
  for (const anim of liveAnimations) {
    try {
      anim.stop();
    } catch (_) {
      // already finished
    }
  }
  liveAnimations.clear();
}

/// How far any existing node may move per timeline step (model px): the
/// layout computes the day's ideal arrangement, but existing nodes crawl
/// toward it over several days instead of jumping. Small changes settle
/// in a day; big reshuffles unfold over a week of days.
const MAX_DRIFT = 80;

/// Move `node` up to MAX_DRIFT toward (tx, ty), animating when ms > 0.
/// Locked nodes (version-bump pins) don't move.
function driftToward(node, tx, ty, ms) {
  if (node.locked()) return;
  const p = node.position();
  const dx = tx - p.x, dy = ty - p.y;
  const d = Math.hypot(dx, dy);
  const s = d > MAX_DRIFT ? MAX_DRIFT / d : 1;
  animatePos(node, { x: p.x + dx * s, y: p.y + dy * s }, ms);
}

/// Compute a day's target arrangement: a tiny deterministic Fruchterman–
/// Reingold-style relaxation run on the day's element arrays (no rendering,
/// no instance). Unlike cose — whose equilibrium ignores the seed — this
/// genuinely relaxes FROM the current positions, which is what makes
/// gradual drift possible: each day's target is near where the graph
/// already is. Locked nodes act as anchors. Resolves a Map of id → {x, y}.
function computeDriftTargets(nodeEls, edgeEls) {
  try {
    const nodes = nodeEls.map((n) => ({
      id: n.data.id,
      x: n.position.x,
      y: n.position.y,
      locked: !!n.locked,
    }));
    const edges = edgeEls.map((e) => ({ source: e.data.source, target: e.data.target }));
    return Promise.resolve(relaxTargets(nodes, edges, 150));
  } catch (e) {
    return Promise.resolve(new Map());
  }
}

/// The relaxation itself (pure, testable): repulsion on all pairs, springs
/// on edges pulling toward IDEAL length, damped velocity-capped integration
/// from the input positions.
function relaxTargets(nodes, edges, iterations) {
  const n = nodes.length;
  const idx = new Map(nodes.map((v, i) => [v.id, i]));
  const px = nodes.map((v) => v.x);
  const py = nodes.map((v) => v.y);
  const vx = new Float64Array(n);
  const vy = new Float64Array(n);
  const locked = nodes.map((v) => !!v.locked);
  const eix = [];
  for (const e of edges) {
    const a = idx.get(e.source), b = idx.get(e.target);
    if (a !== undefined && b !== undefined && a !== b) eix.push([a, b]);
  }
  const REPULSION = 9000;
  const REPULSION_CUTOFF = 320; // px — distant clusters don't push each other apart
  const GRAVITY = 0.02;         // weak pull toward the origin keeps the arrangement centered
  const SPRING = 0.02;
  const IDEAL = 70;
  const DAMPING = 0.72;
  const MAX_STEP = 6;
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = px[j] - px[i], dy = py[j] - py[i];
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          // deterministic jitter for exact overlaps (no Math.random: the
          // same graph must relax the same way every run)
          dx = ((i * 31 + j * 17) % 11 - 5) * 0.1 || 0.5;
          dy = ((i * 13 + j * 29) % 11 - 5) * 0.1 || 0.5;
          d2 = dx * dx + dy * dy;
        }
        const d = Math.sqrt(d2);
        if (d > REPULSION_CUTOFF) continue; // far clusters ignore each other
        const f = REPULSION / d2 / d; // force / distance → multiply by unit components
        const fx = dx * f, fy = dy * f;
        if (!locked[i]) { vx[i] -= fx; vy[i] -= fy; }
        if (!locked[j]) { vx[j] += fx; vy[j] += fy; }
      }
    }
    for (let i = 0; i < n; i++) {
      if (locked[i]) continue;
      // gravity: without it, repulsion slowly inflates the arrangement and
      // clusters drift out of the view over long sweeps
      vx[i] -= px[i] * GRAVITY;
      vy[i] -= py[i] * GRAVITY;
    }
    for (const [a, b] of eix) {
      const dx = px[b] - px[a], dy = py[b] - py[a];
      const d = Math.max(Math.hypot(dx, dy), 1);
      const f = (d - IDEAL) * SPRING;
      const fx = (dx / d) * f, fy = (dy / d) * f;
      if (!locked[a]) { vx[a] += fx; vy[a] += fy; }
      if (!locked[b]) { vx[b] -= fx; vy[b] -= fy; }
    }
    for (let i = 0; i < n; i++) {
      if (locked[i]) continue;
      vx[i] *= DAMPING; vy[i] *= DAMPING;
      const v = Math.hypot(vx[i], vy[i]);
      if (v > MAX_STEP) { vx[i] *= MAX_STEP / v; vy[i] *= MAX_STEP / v; }
      px[i] += vx[i]; py[i] += vy[i];
    }
  }
  return new Map(nodes.map((v, i) => [v.id, { x: px[i], y: py[i] }]));
}

/// Move `ele` from `from` toward `tgt`, clamped to MAX_DRIFT, over `ms`
/// (ms <= 0 → snap instantly, used when the motion begins after a pause).
function glideClamped(ele, from, tgt, ms) {
  if (!ele.inside() || ele.locked()) return;
  const dx = tgt.x - from.x, dy = tgt.y - from.y;
  const d = Math.hypot(dx, dy);
  const s = d > MAX_DRIFT ? MAX_DRIFT / d : 1;
  animatePos(ele, { x: from.x + dx * s, y: from.y + dy * s }, ms);
}

/// A fresh arrival: wind back to its spawn point and glide to its slot
/// (unclamped — new nodes may travel freely).
function glideBack(ele, from, tgt, ms) {
  if (!ele.inside() || ele.locked()) return;
  animatePos(ele, tgt, ms);
}

function rebuildGraph(elements) {
  if (!cy) {
    cy = cytoscape({
      container: $("cy"),
      style: CY_STYLE,
      wheelSensitivity: 0.25,
      minZoom: 0.05,
      maxZoom: 4,
    });
    needsFullLayout = true;
    cy.on("tap", "node", (evt) => onNodeTap(evt.target));
    cy.on("tap", "edge", (evt) => showEdge(evt.target));
    cy.on("tap", (evt) => {
      if (evt.target === cy) clearHighlight();
    });
    wireClusterDrag();
  }
  // Query results own the canvas wholesale (arbitrary element sets, another
  // id space) — they always take the full path, and so does the view render
  // that follows a dismissed query.
  const isQuery = !!queryElements;
  const full = needsFullLayout || isQuery || lastRenderWasQuery;
  let changed = true;
  // Nodes pinned while the incremental layout runs — version-bump
  // replacements only (pinned on the replaced version's spot). Released on
  // layoutstop or a timeout failsafe.
  const heldReplacements = [];
  // Day-start positions / spawn points driving the gradual drift.
  const prePersisting = []; // {ele, from}
  const spawnFrom = [];     // {ele, from}

  // Dense canvases only label nodes once you zoom in — but the dependencies
  // view is hand-placed and spread out, so it always labels.
  const handPlaced = !isQuery && view === "areas";
  cy.nodes().toggleClass("dense", !handPlaced && elements.nodes.length > 80);

  if (full) {
    cy.batch(() => {
      cy.elements().remove();
      cy.add(elements);
    });
  } else {
    const diff = diffElements(
      {
        nodes: cy.nodes().map((n) => ({ data: Object.assign({}, n.data()) })),
        edges: cy.edges().map((e) => ({ data: Object.assign({}, e.data()) })),
      },
      elements
    );
    changed = !diff.unchanged;
    const nextData = new Map(elements.nodes.map((n) => [n.data.id, n.data]));
    cy.batch(() => {
      if (changed) {
        // Data refresh plus day-start position capture for the drift: the
        // layout's target arrangement is computed silently, then every
        // existing node moves at most MAX_DRIFT toward it — the arrangement
        // migrates gradually over days instead of jumping or freezing.
        for (const id of diff.keptNodeIds) {
          const n = cy.getElementById(id);
          if (n.nonempty()) {
            n.data(nextData.get(id));
            const p = n.position();
            prePersisting.push({ ele: n, from: { x: p.x, y: p.y } });
          }
        }
        // A version bump is a new purl (a Package node IS name+version):
        // when the diff removes pkg:x/y@OLD and adds pkg:x/y@NEW, the new
        // version takes over the old one's exact spot in the graph.
        const replacedAt = new Map();
        for (const id of diff.removedNodeIds) {
          const base = baseOf(id);
          if (base === null) continue;
          const old = cy.getElementById(id);
          if (old.nonempty()) replacedAt.set(base, old.position());
        }
        const rmKeys = new Set(diff.removedEdgeKeys);
        cy.edges()
          .filter((e) => rmKeys.has(edgeKeyOf(e)))
          .remove();
        for (const id of diff.removedNodeIds) cy.getElementById(id).remove();
        for (const n of diff.addedNodes) {
          const base = baseOf(n.data.id);
          const replacement = base !== null ? replacedAt.get(base) : undefined;
          const pos = replacement || spawnPosition(n.data.id, elements);
          const ele = cy.add({ data: Object.assign({}, n.data), position: pos });
          arriveWithFlourish(ele, n.data, replacement !== undefined);
          const p = ele.position();
          spawnFrom.push({ ele, from: { x: p.x, y: p.y } });
          if (replacement) {
            ele.lock();
            heldReplacements.push(ele);
          }
        }
        for (const e of diff.addedEdges) {
          cy.add({ data: Object.assign({}, e.data) });
        }
      } else {
        // Data refresh always runs — a node can change its label, scope or
        // vulns count with its identity (and position) untouched.
        for (const id of diff.keptNodeIds) {
          const n = cy.getElementById(id);
          if (n.nonempty()) n.data(nextData.get(id));
        }
      }
    });
  }
  lastRenderWasQuery = isQuery;

  if (elements.nodes.length === 0) return; // nothing to lay out or fit
  // An unchanged element set means nothing moved: no layout, no fit — the
  // graph is perfectly stable between days that differ in nothing.
  if (changed) {
    const animMs = ANIM_MS / playbackRate;
    const gen = motionGen; // pause bumps this: drift computed before a pause snaps instead of animating
    if (handPlaced && applyAreasLayout(true)) {
      // The areas layout drifted every node toward its slot (clamped) —
      // replacements stay pinned on their replaced version's spot.
      for (const e of heldReplacements) if (e.inside()) e.unlock();
      heldReplacements.length = 0;
      fitReasonably();
    } else if (full) {
      // Fresh arrangement (first render, view flip, query result, glitch
      // recovery): the classic random layout, on the canvas.
      runningLayout = cy.layout(layoutOptions(elements.nodes.length, false)).run();
      runningLayout.on("layoutstop", () => {
        runningLayout = null;
        for (const e of heldReplacements) if (e.inside()) e.unlock();
        heldReplacements.length = 0;
      });
      fitReasonably();
    } else {
      // Compute the day's target arrangement on a HEADLESS scratch instance
      // (cose seeded from the current arrangement): nothing moves on screen
      // while it thinks. Then migrate the real canvas — persisting nodes
      // glide one MAX_DRIFT step toward their target, arrivals glide in
      // from their spawn point, replacements unlock on their version's spot.
      driftPending = true;
      computeDriftTargets(
        cy.nodes().map((n) => ({
          data: Object.assign({}, n.data()),
          position: { x: n.position().x, y: n.position().y },
          locked: n.locked(),
        })),
        cy.edges().map((e) => ({ data: Object.assign({}, e.data()) }))
      ).then((targets) => {
        driftPending = false;
        if (gen !== motionGen) {
          // paused while the drift was computing: freeze the frame as it
          // stands — discard the targets entirely rather than snapping
          for (const e of heldReplacements) if (e.inside()) e.unlock();
          heldReplacements.length = 0;
          return;
        }
        cy.batch(() => {
          for (const d of prePersisting) {
            const tgt = targets.get(d.ele.id());
            if (tgt) glideClamped(d.ele, d.from, tgt, animMs);
          }
          for (const d of spawnFrom) {
            const tgt = targets.get(d.ele.id());
            if (tgt) glideBack(d.ele, d.from, tgt, animMs);
          }
        });
        for (const e of heldReplacements) if (e.inside()) e.unlock();
        heldReplacements.length = 0;
      });
      // Failsafe: never leave a replacement node locked if the scratch
      // layout stalls.
      setTimeout(() => {
        driftPending = false;
        for (const e of heldReplacements) if (e.inside()) e.unlock();
        heldReplacements.length = 0;
      }, (ANIM_MS * 4) / playbackRate + 1500);
      fitReasonably();
    }
  }
  renderLegend();
  const empty = $("empty-state");
  empty.hidden = elements.nodes.length > 0;
  if (!empty.hidden) {
    empty.innerHTML = queryElements
      ? "<div><b>No graph values</b>The query returned rows but no nodes.</div>"
      : "<div><b>No dependencies</b>Nothing was declared at this point in time.</div>";
  }
  needsFullLayout = false;
}

// ---------------------------------------------- dragging a cluster by hub

/// Dragging a developer/repo-area hub: the first ~100px moves the hub
/// alone; keep dragging and its attached dependencies join, moving as one
/// combined unit for the rest of the drag. Release to drop the cluster.
const CLUSTER_DRAG_JOIN = 100;
let clusterDrag = null; // {node, start, deps, offsets, joined} while a hub drag is live

function wireClusterDrag() {
  const hubSel = "node[type = 'dev'], node[type = 'area']";
  cy.on("grab", hubSel, (evt) => {
    const node = evt.target;
    const p = node.position();
    clusterDrag = {
      node,
      start: { x: p.x, y: p.y },
      deps: node.outgoers("node").toArray(),
      offsets: null,
      joined: false,
    };
  });
  cy.on("drag", hubSel, (evt) => {
    const st = clusterDrag;
    if (!st || evt.target !== st.node) return;
    const p = st.node.position();
    if (!st.joined) {
      const moved = Math.hypot(p.x - st.start.x, p.y - st.start.y);
      if (moved < CLUSTER_DRAG_JOIN) return; // the hub moves alone for now
      // the user keeps pulling: the dependencies join as one unit, each
      // keeping its offset from the hub at the moment of joining
      st.joined = true;
      st.offsets = st.deps.map((d) => {
        const dp = d.position();
        return { ele: d, dx: dp.x - p.x, dy: dp.y - p.y };
      });
    }
    for (const o of st.offsets) {
      if (!o.ele.inside() || o.ele.grabbed() || o.ele.locked()) continue;
      o.ele.position({ x: p.x + o.dx, y: p.y + o.dy });
    }
  });
  cy.on("free", hubSel, () => {
    clusterDrag = null;
  });
}

function highlight(node) {
  const hood = node.closedNeighborhood();
  cy.batch(() => {
    cy.elements().addClass("faded").removeClass("hl");
    hood.removeClass("faded");
    node.connectedEdges().addClass("hl");
  });
}

function clearHighlight() {
  if (!cy) return;
  cy.elements().removeClass("faded hl");
}

function renderLegend() {
  const legend = $("legend");
  if (!cy) return;
  const items = new Map();
  let vulnCount = 0;
  cy.nodes().forEach((n) => {
    const kind = n.data("kind");
    const type = n.data("type");
    let key, label, color, cls = "";
    if (type === "dev") { key = "dev"; label = "Developer"; color = "#4c8dff"; cls = "sq"; }
    else if (type === "area") { key = "area"; label = "Repo area"; color = "#a371f7"; cls = "sq"; }
    else if (kind && KIND_STYLES[kind]) {
      key = kind; label = kind; color = KIND_STYLES[kind].color; cls = KIND_STYLES[kind].legend;
    } else if (!kind || kind === "Package") {
      const eco = n.data("ecosystem");
      if (!eco) {
        if (kind) {
          key = "Package"; label = "Package"; color = ECOSYSTEM_COLORS.generic;
        } else return;
      } else {
        // One green entry for all packages — nodes are uniform green, so
        // per-ecosystem legend colors would show hues nothing carries.
        key = "dep"; label = "dependency"; color = PACKAGE_GREEN;
      }
    } else {
      key = kind; label = kind; color = ECOSYSTEM_COLORS.generic;
    }
    if ((n.data("vulns") || 0) > 0) vulnCount++;
    if (key && !items.has(key)) items.set(key, { label, color, cls, count: 0 });
    if (key) items.get(key).count++;
  });
  // The vulnerable entry goes last, on a shape of its own — the legend
  // teaches the red triangle in one glance.
  if (vulnCount > 0) {
    items.set("vulnerable", { label: "vulnerable", color: VULNERABLE_RED, cls: "tri", count: vulnCount });
  }
  legend.innerHTML = [...items.values()]
    .map((i) => `<span><i class="${i.cls}" style="background:${i.color}"></i>${escapeHtml(i.label)} <b class="muted">${i.count}</b></span>`)
    .join("");
}

function onNodeTap(node) {
  highlight(node);
  const d = node.data();
  if (d.type === "package") return showPackage(d.id);
  if (d.kind === "Package" && d.purl) return showPackage(d.purl);
  if (d.type === "dev") return showGroupDeps("Developer", d.label, node);
  if (d.type === "area") return showGroupDeps("Repo area", d.label, node);
  showProps(d.kind || "Node", d.label, d.props || {});
}

// ---------------------------------------------------------------- render

/// Bumped on every refresh; a slower in-flight refresh whose slider position
/// has been superseded drops its render instead of painting a stale frame
/// (and racing the newer rebuild into cytoscape internals).
let renderSeq = 0;

async function refresh() {
  const seq = ++renderSeq;
  const asOf = asOfValue();
  setAsOfLabel(asOf);
  const q = asOf ? `?as_of=${encodeURIComponent(asOf)}` : "";
  try {
    const payload = await fetchJson(`api/graph${q}`);
    if (seq !== renderSeq) return; // a newer refresh is already in charge
    lastElements = payload.elements;
    if (showTransitive === null) {
      showTransitive = lastElements.nodes.length <= DIRECT_ONLY_THRESHOLD;
    }
    updateScopeToggle();
    // A query that reads $as_of follows the slider; any other query result
    // stays put until dismissed.
    if (queryElements && lastCypher && lastCypher.includes("$as_of")) {
      await runCypher({ silentFocus: true });
    } else {
      renderCurrentView();
    }
    if (selectedPackage) showPackage(selectedPackage, asOf);
  } catch (e) {
    if (seq === renderSeq) setStatus(`error: ${e.message}`, "error");
  }
}

/// The main canvas shows the active view — or, while one is active, the raw
/// query result.
function renderCurrentView() {
  const viewsEl = $("views");
  viewsEl.classList.toggle("dimmed", !!queryElements);
  if (queryElements) {
    buildGraph(queryElements);
    return;
  }
  if (lastElements) buildGraph(buildViewElements(visibleElements(lastElements)));
}

function clearQueryResult() {
  queryElements = null;
  lastCypher = null;
  $("query-pill").hidden = true;
  renderCurrentView();
}

function updateScopeToggle() {
  const box = $("scope-toggle");
  const label = $("scope-label");
  if (!box || !lastElements) return;
  const total = lastElements.nodes.length;
  const direct = lastElements.nodes.filter((n) => n.data.scope === "direct").length;
  box.checked = showTransitive;
  label.textContent = showTransitive ? `Direct + transitive (${total})` : `Direct only (${direct})`;
}

function toggleScope() {
  showTransitive = $("scope-toggle").checked;
  updateScopeToggle();
  if (queryElements) clearQueryResult();
  else renderCurrentView();
}

function setView(newView) {
  view = newView;
  for (const btn of document.querySelectorAll("[data-view]")) {
    btn.classList.toggle("active", btn.dataset.view === view);
  }
  if (queryElements) clearQueryResult();
  else renderCurrentView();
}

// ---------------------------------------------------------------- inspector

function setInspectorTitle(t) {
  $("inspector-title").textContent = t;
}

/// Detailed-mode data for a package node, straight from the canvas (the
/// /api/graph payload already carries it — no extra fetch). Null for nodes
/// that aren't detailed (flag off) or aren't on the canvas.
function detailedFor(purl) {
  if (!cy) return null;
  const n = cy.getElementById(purl);
  return n.nonempty() ? n.data() : null;
}

/// Hostname of a URL for link labels; the raw URL as fallback for
/// anything the URL parser can't chew.
function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function severityClass(sev) {
  const s = String(sev || "").toUpperCase();
  if (s === "CRITICAL" || s === "HIGH") return "sev-high";
  if (s === "MODERATE" || s === "MEDIUM") return "sev-medium";
  if (s === "LOW") return "sev-low";
  return "sev-unknown";
}

async function showPackage(purl, asOfOverride) {
  selectedPackage = purl;
  setInspectorTitle("Package");
  const details = $("pkg-details");
  details.innerHTML = `<p class="hint">Loading…</p>`;
  const asOf = asOfOverride ?? asOfValue();
  const suffix = asOf ? `&as_of=${encodeURIComponent(asOf)}` : "";
  try {
    const [history, usage] = await Promise.all([
      fetchJson(`api/history?name=${encodeURIComponent(purl)}${suffix}`),
      fetchJson(`api/usage?purl=${encodeURIComponent(purl)}`),
    ]);
    if (selectedPackage !== purl) return; // a newer click won
    const rows = history.rows || [];
    const current = rows.filter((r) => !r.removed_date);
    const latest = current[current.length - 1] || rows[rows.length - 1] || {};
    const usages = usage.rows || [];
    const name = decodeURIComponent(purl.replace(/^pkg:[^/]+\//, "").replace(/@[^@/]*$/, ""));
    const purlType = (purl.match(/^pkg:([^/]+)\//) || [])[1];
    const eco = { pypi: "python", maven: "java", cargo: "rust", golang: "go", npm: "node" }[purlType] || purlType;

    // Detailed-mode data lives on the node (per-version): license, links,
    // advisories. Advisory knowledge is as-known-now, but the version —
    // and therefore the advisory set — follows the timeline correctly.
    const det = detailedFor(purl) || {};
    const vulns = det.vulns || 0;
    const advisories = Array.isArray(det.advisories) ? det.advisories : [];
    const links = [];
    if (det.depsdev_url) links.push(`<a href="${escapeHtml(det.depsdev_url)}" target="_blank" rel="noreferrer">deps.dev</a>`);
    if (det.homepage) links.push(`<a href="${escapeHtml(det.homepage)}" target="_blank" rel="noreferrer">${escapeHtml(hostnameOf(det.homepage))}</a>`);
    if (det.repository) links.push(`<a href="${escapeHtml(det.repository)}" target="_blank" rel="noreferrer">${escapeHtml(hostnameOf(det.repository))}</a>`);
    const advisoryItems = advisories
      .map((a) => {
        if (!a || !a.id) return "";
        const alias = Array.isArray(a.aliases) && a.aliases.length ? ` <span class="muted">(${escapeHtml(a.aliases.join(", "))})</span>` : "";
        const sev = a.severity ? `<span class="sev ${severityClass(a.severity)}">${escapeHtml(String(a.severity).toUpperCase())}</span>` : "";
        const summary = a.summary ? `<span class="summary">${escapeHtml(a.summary)}</span>` : "";
        return `<li><a href="https://osv.dev/vulnerability/${encodeURIComponent(a.id)}" target="_blank" rel="noreferrer"><code>${escapeHtml(a.id)}</code></a>${alias}${sev}${summary}</li>`;
      })
      .join("");

    const timeline = rows
      .map((r) => {
        const live = !r.removed_date;
        return `<li class="${live ? "live" : ""}"><code>${escapeHtml(r.version || r.requirement || "?")}</code>
          ${live ? '<span class="tag live">live</span>' : '<span class="tag removed">removed</span>'}<br>
          <span class="when">added ${fmtDate(r.added_date)} by ${escapeHtml(r.added_by_name || "?")}` +
          (r.removed_date ? ` · removed ${fmtDate(r.removed_date)}` : "") + `</span></li>`;
      })
      .join("");

    details.innerHTML = `
      <p class="insp-title">${escapeHtml(name)}</p>
      <div class="insp-sub">
        ${eco ? `<span class="badge"><span class="swatch" style="background:${ECOSYSTEM_COLORS[eco] || ECOSYSTEM_COLORS.generic}"></span>${escapeHtml(eco)}</span>` : ""}
        ${current.length ? '<span class="badge">in use</span>' : '<span class="badge">not declared</span>'}
        ${det.license ? `<span class="badge" title="License">${escapeHtml(det.license)}</span>` : ""}
        ${det.deprecated ? '<span class="badge">deprecated</span>' : ""}
        ${vulns > 0 ? `<span class="badge vuln">${vulns} advers${vulns === 1 ? "y" : "ies"}</span>` : ""}
      </div>
      <dl>
        <dt>Package URL</dt><dd class="mono">${escapeHtml(purl)}</dd>
        <dt>Requirement</dt><dd><code>${escapeHtml(latest.requirement || "?")}</code> in <code>${escapeHtml(latest.manifest || "?")}</code></dd>
        <dt>Added by</dt><dd>${escapeHtml(latest.added_by_name || "?")} <span class="muted">${escapeHtml(latest.added_by_email || "")}</span><br><span class="muted">${fmtDate(latest.added_date)}</span></dd>
        <dt>Version timeline</dt><dd><ul class="timeline">${timeline || "<li>no history</li>"}</ul></dd>
        ${links.length ? `<dt>Links</dt><dd class="links">${links.join(" · ")}</dd>` : ""}
        ${advisoryItems ? `<dt>Security advisories</dt><dd><ul class="advisory">${advisoryItems}</ul></dd>` : ""}
        <dt>Used in ${usages.length} file${usages.length === 1 ? "" : "s"}</dt>
        <dd><ul class="files">${usages.map((u) => `<li><code>${escapeHtml(u.file)}</code><em>${escapeHtml(u.symbol)}</em></li>`).join("") || '<li class="muted">No usage sites found</li>'}</ul></dd>
      </dl>`;
  } catch (e) {
    details.innerHTML = `<p class="hint">${escapeHtml(e.message)}</p>`;
  }
}

/// A group hub selected on the canvas (developer or repo area): list the
/// packages attributed to it, each clickable into the full package panel.
function showGroupDeps(kind, label, node) {
  selectedPackage = null;
  setInspectorTitle(kind);
  const kids = node
    .outgoers("node")
    .toArray()
    .sort((a, b) => String(a.data("label")).localeCompare(String(b.data("label"))));
  const items = kids
    .map((k) => {
      const d = k.data();
      // Match the canvas: packages are uniform green.
      const swatch = PACKAGE_GREEN;
      return `<li><a data-purl="${escapeHtml(d.id)}" href="#"><i class="swatch" style="background:${swatch}"></i>${escapeHtml(d.label)}</a></li>`;
    })
    .join("");
  const what = kind === "Developer" ? "added" : "declared here";
  $("pkg-details").innerHTML = `
    <p class="insp-title">${escapeHtml(label)}</p>
    <p class="hint">${kids.length} package${kids.length === 1 ? "" : "s"} ${what}${asOfValue() ? " as of this date" : ""}. Click one for its history.</p>
    <ul class="dep-list">${items}</ul>`;
  for (const a of $("pkg-details").querySelectorAll("a[data-purl]")) {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      showPackage(a.dataset.purl);
    });
  }
}

function propsTable(props) {
  const keys = Object.keys(props).sort();
  if (!keys.length) return '<p class="hint">No properties.</p>';
  return `<table class="props">${keys
    .map((k) => `<tr><td>${escapeHtml(k)}</td><td>${formatCell(props[k]).html}</td></tr>`)
    .join("")}</table>`;
}

function showProps(kind, label, props) {
  selectedPackage = null;
  setInspectorTitle(kind);
  $("pkg-details").innerHTML = `
    <p class="insp-title">${escapeHtml(label)}</p>
    <div class="insp-sub"><span class="badge">${escapeHtml(kind)}</span></div>
    ${propsTable(props)}`;
}

function showEdge(edge) {
  const d = edge.data();
  clearHighlight();
  edge.addClass("hl");
  selectedPackage = null;
  setInspectorTitle("Relationship");
  $("pkg-details").innerHTML = `
    <p class="insp-title">${escapeHtml(d.label || "edge")}</p>
    <p class="hint">${escapeHtml(edge.source().data("label"))} → ${escapeHtml(edge.target().data("label"))}</p>
    ${d.props ? propsTable(d.props) : ""}`;
}

function fmtDate(iso) {
  return (iso || "?").slice(0, 10);
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------- init

/// The meta line in the app bar: counts, scan date, ecosystem badges,
/// version chip, project title.
function renderMeta(meta) {
  // repo mode: prepopulate the on-demand box (prefill + the org's popular
  // repos as dropdown suggestions)
  if (meta.repo_spec && window.BOMVOYAGE_ONDEMAND) {
    window.BOMVOYAGE_ONDEMAND.noteSpec(meta.repo_spec);
  }
  const badges = (meta.ecosystems || [])
    .map((e) => `<span class="badge"><span class="swatch" style="background:${ECOSYSTEM_COLORS[e.ecosystem] || ECOSYSTEM_COLORS.generic}"></span>${escapeHtml(e.ecosystem)} · ${e.names}</span>`)
    .join("");
  const project = meta.name && meta.name !== "." ? meta.name : null;
  if (project) {
    $("project").textContent = project;
    $("project").hidden = false;
    document.title = `${project} · BOMvoyage`;
  }
  if (meta.version) {
    const v = $("version");
    v.textContent = `v${meta.version}`;
    v.hidden = false;
  }
  $("meta").innerHTML =
    `<span><strong>${meta.total_packages}</strong> package versions</span><span class="sep">·</span>` +
    `<span>scanned ${fmtDate(meta.last_scanned_at)}</span><span class="sep">·</span>` +
    `<span>resolution <strong>${escapeHtml(meta.scan_quality)}</strong></span>${badges}`;
}

async function init() {
  // A swapped graph (on-demand repo scan, UI box) lands here: full
  // re-read of meta + commits + a fresh layout.
  window.BOMVOYAGE_ON_GRAPH_REBUILT = async () => {
    needsFullLayout = true;
    queryElements = null;
    lastCypher = null;
    $("query-pill").hidden = true;
    pausePlay();
    try {
      const meta = await fetchJson("api/meta");
      renderMeta(meta);
      detailedPackages = meta.detailed_packages || 0;
      addVulnerablePreset();
      const commitPayload = await fetchJson("api/commits");
      setCommits(commitPayload.rows || []);
    } catch (e) {
      setStatus(`error: ${e.message}`, "error");
    }
    setView("areas");
    refresh();
  };
  const meta = await fetchJson("api/meta");
  renderMeta(meta);
  detailedPackages = meta.detailed_packages || 0;
  const commitPayload = await fetchJson("api/commits");
  setCommits(commitPayload.rows || []);
  const slider = $("slider");
  slider.addEventListener("input", () => {
    pauseForManualNav();
    refresh();
  });
  wireCalendar();
  $("reset-btn").addEventListener("click", () => {
    pauseForManualNav();
    slider.value = slider.max;
    refresh();
  });
  $("play-btn").addEventListener("click", () => startPlay());
  $("pause-btn").addEventListener("click", pausePlay);
  $("rewind-btn").addEventListener("click", rewindPlay);
  $("rate-btn").addEventListener("click", toggleRate);
  $("scope-toggle").addEventListener("change", toggleScope);
  $("clear-query").addEventListener("click", clearQueryResult);
  for (const btn of document.querySelectorAll("[data-view]")) {
    btn.addEventListener("click", () => setView(btn.dataset.view));
  }
  wireCanvasControls();
  wireCypherConsole();

  await refresh();
  pollHistoryStatus(meta.history_current);
  pollUpdateAvailable();
  // The default experience: the sweep starts itself on load, oldest day
  // first, and loops until the user pauses.
  updatePlayButtons();
  if (days.length > 0) {
    $("slider").value = 0;
    startPlay();
  }
}

// ---------------------------------------------------------------- update banner

// The release check runs on a background thread in the binary; poll
// /api/update briefly until it reports, then show a dismissible box.
function pollUpdateAvailable() {
  let polls = 0;
  const tick = async () => {
    let info;
    try {
      info = await fetchJson("api/update");
    } catch {
      return; // server without update support or gone — stay silent
    }
    if (info.available) return showUpdateBanner(info);
    if (info.checking && ++polls < 15) setTimeout(tick, 2000);
  };
  setTimeout(tick, 3000);
}

function showUpdateBanner(info) {
  if ($("update-banner")) return;
  const box = document.createElement("div");
  box.id = "update-banner";
  box.innerHTML =
    `<span>⬆ <b>BOMvoyage ${escapeHtml(info.latest)}</b> is available` +
    ` (you have ${escapeHtml(info.current)}) — run <code>bomvoyage update apply</code> to upgrade</span>` +
    `<button type="button" title="Dismiss">×</button>`;
  box.querySelector("button").addEventListener("click", () => box.remove());
  document.body.appendChild(box);
}

function setCommits(rows) {
  commits = rows; // ascending by date
  days = [...new Set(commits.map((c) => c.date.slice(0, 10)))]; // one tick per DAY
  const slider = $("slider");
  slider.max = days.length; // past the last day = HEAD
  // A late history load (background scan finishing) rewinds a running sweep
  // to the oldest day and restarts it over the full timeline: the pending
  // step was scheduled against the old (provisional) day count, so without
  // this the sweep sits frozen on day 0 until that stale timer fires.
  if (playing) {
    slider.value = 0;
    startPlay();
  } else {
    slider.value = slider.max;
  }
  updatePlayButtons();
}

function wireCanvasControls() {
  $("zoom-in").addEventListener("click", () => cy && cy.zoom({ level: cy.zoom() * 1.25, renderedPosition: center() }));
  $("zoom-out").addEventListener("click", () => cy && cy.zoom({ level: cy.zoom() / 1.25, renderedPosition: center() }));
  $("zoom-fit").addEventListener("click", () => cy && fitReasonably());
  $("relayout").addEventListener("click", () => {
    if (!cy) return;
    // Fully re-optimized in one click: exact slots, no drift clamp (the
    // MAX_DRIFT limit governs time travel only, not explicit relayouts).
    if (!applyAreasLayout(false, true)) {
      cy.layout(layoutOptions(cy.nodes().length)).run();
    }
    fitReasonably();
  });
  function center() {
    const r = $("cy").getBoundingClientRect();
    return { x: r.width / 2, y: r.height / 2 };
  }
}

function pollHistoryStatus(current) {
  updateScanOverlay(current ? null : {});
  if (current) return;
  const timer = setInterval(async () => {
    try {
      const meta = await fetchJson("api/meta");
      if (meta.history_current) {
        clearInterval(timer);
        updateScanOverlay(null);
        const commitPayload = await fetchJson("api/commits");
        setCommits(commitPayload.rows || []);
        refresh();
      } else {
        updateScanOverlay(meta.walk || {});
      }
    } catch (_) {
      // server momentarily busy — keep polling
    }
  }, 2000);
}

/// The big top-left canvas overlay while the background walk runs:
/// "Scanning Git History …" + the walker's phase and progress
/// (deps.dev counts when that pass is in flight). Hidden at HEAD-complete.
function updateScanOverlay(walk) {
  const el = $("scan-overlay");
  if (!el) return;
  if (!walk) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const progress = $("scan-progress");
  if (progress) {
    const parts = [];
    if (walk.phase) parts.push(walk.phase);
    if (walk.progress) parts.push(`${walk.progress} packages fetched via deps.dev`);
    progress.textContent = parts.join(" — ") || "this takes a moment; the graph is already usable";
  }
}


// ---- calendar picker: one month at a time; days with git checkpoints
// carry a dot, the viewed day is highlighted, any day is selectable.
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
const DOW = ["S", "M", "T", "W", "T", "F", "S"];

function wireCalendar() {
  const btn = $("datebtn");
  const cal = $("calendar");
  const latest = commits.length ? commits[commits.length - 1].date.slice(0, 10) : null;
  calMonth = latest ? new Date(latest + "T12:00:00Z") : new Date();
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    cal.hidden = !cal.hidden;
    if (!cal.hidden) renderCalendar();
  });
  cal.addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", () => { cal.hidden = true; });
}

function renderCalendar() {
  const cal = $("calendar");
  if (cal.hidden) return;
  const y = calMonth.getUTCFullYear();
  const m = calMonth.getUTCMonth();
  const asOfDate = (asOfValue() || "").slice(0, 10);
  const checkpoints = new Set(days);

  let html = `<div id="cal-head">
    <button type="button" id="cal-prev" aria-label="Previous month">‹</button>
    <span>${MONTHS[m]} ${y}</span>
    <button type="button" id="cal-next" aria-label="Next month">›</button>
  </div><div id="cal-grid">`;
  for (const d of DOW) html += `<div class="cal-dow">${d}</div>`;
  const first = new Date(Date.UTC(y, m, 1)).getUTCDay();
  const nDays = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  for (let i = 0; i < first; i++) html += `<div class="cal-day blank"></div>`;
  for (let d = 1; d <= nDays; d++) {
    const dateStr = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const classes = ["cal-day", checkpoints.has(dateStr) ? "checkpoint" : "", asOfDate === dateStr ? "selected" : ""]
      .filter(Boolean).join(" ");
    html += `<div class="${classes}" data-date="${dateStr}" title="${dayCommitCount(dateStr)} commits">${d}</div>`;
  }
  html += `</div><div id="cal-legend"><span class="dot"></span> day with git checkpoints — click any day to time travel</div>`;
  cal.innerHTML = html;
  $("cal-prev").addEventListener("click", () => {
    calMonth = new Date(Date.UTC(y, m - 1, 1));
    renderCalendar();
  });
  $("cal-next").addEventListener("click", () => {
    calMonth = new Date(Date.UTC(y, m + 1, 1));
    renderCalendar();
  });
  for (const cell of cal.querySelectorAll(".cal-day[data-date]")) {
    cell.addEventListener("click", () => pickDay(cell.dataset.date));
  }
}

function dayCommitCount(dateStr) {
  return commits.filter((c) => c.date.startsWith(dateStr)).length;
}

function pickDay(dateStr) {
  pauseForManualNav();
  selectedDate = dateStr;
  const idx = days.indexOf(dateStr);
  const slider = $("slider");
  if (idx >= 0) slider.value = idx;
  else if (days.length && dateStr > days[days.length - 1]) slider.value = slider.max;
  else slider.value = 0;
  refresh();
}

function markCalendarSelection() {
  if ($("calendar").hidden) return;
  renderCalendar();
}

// ---------------------------------------------------------------- playback

/// The autoplay sweep — the tool's point in one glance. It walks the slider
/// one DAY at a time from the oldest commit to HEAD, the whole sweep ~30s
/// however many days there are, holds on the newest for 5s, then loops,
/// until paused. Each step waits for the graph to finish rendering, so a
/// slow backend stretches the sweep instead of piling up requests.
const PLAY_SWEEP_MS = 30000;
const PLAY_HOLD_MS = 5000;

function updatePlayButtons() {
  const hasDays = days.length > 0;
  $("rewind-btn").disabled = !hasDays;
  $("play-btn").disabled = !hasDays || playing;
  $("pause-btn").disabled = !hasDays || !playing;
  $("play-controls").classList.toggle("playing", playing);
}

function pausePlay() {
  if (!playing) return;
  playing = false;
  clearTimeout(playTimer);
  playTimer = null;
  // Freeze the frame: in-flight graph motion from the last rendered day
  // snaps to its end state now — a paused sweep must not keep animating
  // in the background. Bumping motionGen makes any drift computation that
  // is still in flight apply as a snap instead of starting new motion;
  // bumping renderSeq discards a sweep refresh that is still mid-fetch,
  // so a day whose render hadn't landed yet never lands after the pause.
  motionGen++;
  renderSeq++;
  if (runningLayout) {
    runningLayout.stop();
    runningLayout = null;
  }
  freezeMotions();
  updatePlayButtons();
}

/// The 4× control: quadruple-speed animations and sweep pacing.
function toggleRate() {
  playbackRate = playbackRate === 1 ? 4 : 1;
  $("rate-btn").classList.toggle("active", playbackRate === 4);
}

/// Manual navigation is an implicit pause: the sweep must never fight the
/// slider or calendar for the as-of value.
function pauseForManualNav() {
  pausePlay();
  selectedDate = null;
}

function rewindPlay() {
  pausePlay();
  $("slider").value = 0;
  refresh();
}

/// Resume (or begin) the sweep from wherever the slider sits.
function startPlay() {
  clearTimeout(playTimer);
  playing = true;
  selectedDate = null;
  updatePlayButtons();
  const step = async () => {
    const t0 = performance.now();
    await refresh();
    if (!playing) return;
    // The slider must not outrun the motion: hold until the day's
    // animations finished, then dwell out the rest of the step budget.
    // (Arrival fades are excluded — a color crossfade may continue
    // gracefully across steps; it is position motion that must never
    // be chopped mid-glide.)
    await animationsSettled();
    if (!playing) return;
    const slider = $("slider");
    const atEnd = Number(slider.value) >= days.length; // HEAD
    // ~30s for a full sweep when animation is faster than the budget,
    // but never more than 2.5s parked on one day — the provisional
    // timeline (one day) would otherwise sit frozen for the whole budget.
    // Animation-heavy days simply run slower than this budget: the sweep
    // is animation-bound by design.
    const interval = Math.min(2500, Math.max(120, PLAY_SWEEP_MS / Math.max(days.length, 1))) / playbackRate;
    const wait = Math.max(0, interval - (performance.now() - t0));
    playTimer = setTimeout(() => {
      if (!playing) return;
      slider.value = atEnd ? 0 : Number(slider.value) + 1;
      step();
    }, atEnd ? PLAY_HOLD_MS / playbackRate : wait);
  };
  step();
}

/// Resolves once no position animation is in flight (bounded — a stuck
/// animation may never delay a sweep longer than the cap). A seeded cose
/// layout spends its first ticks computing before any node animates, so
/// the running layout handle counts as motion too. Exits early when the
/// sweep is paused meanwhile.
function animationsSettled() {
  if (!cy) return Promise.resolve();
  const cap = (ANIM_MS * 2.5) / playbackRate;
  const t0 = performance.now();
  return new Promise((resolve) => {
    const poll = () => {
      if (!playing || !cy) return resolve();
      const moving =
        driftPending ||
        runningLayout !== null ||
        cy
          .nodes()
          .toArray()
          .some((n) => n.animated() && !n.hasClass("arriving"));
      if (!moving || performance.now() - t0 > cap) return resolve();
      setTimeout(poll, 50);
    };
    poll();
  });
}

// ---------------------------------------------------------------- cypher

/// Presets are graph-shaped (drawn on the canvas) unless marked `table`.
const CYPHER_PRESETS = [
  {
    name: "Who added what",
    cypher: "MATCH p=(x:Person)-[:ADDED]->(:Package)\nRETURN p LIMIT 200",
  },
  {
    name: "Live dependencies (as of slider)",
    cypher:
      "MATCH p=(m:Manifest)-[r:DECLARES]->(:Package)\nWHERE r.since_date <= $as_of\n  AND (r.removed_date IS NULL OR r.removed_date > $as_of)\nRETURN p LIMIT 300",
  },
  {
    name: "Dependency tree",
    cypher: "MATCH p=(:Package)-[:DEPENDS_ON]->(:Package)\nRETURN p LIMIT 300",
  },
  {
    name: "Most-imported packages",
    cypher:
      "MATCH (f:File)-[:IMPORTS]->(p:Package)\nWITH p, count(DISTINCT f) AS files\nORDER BY files DESC LIMIT 5\nMATCH path=(:File)-[:IMPORTS]->(p)\nRETURN path",
  },
  {
    name: "Removed dependencies",
    cypher: "MATCH p=(x:Person)-[:REMOVED]->(:Package)\nRETURN p LIMIT 200",
  },
  {
    name: "Commits touching manifests",
    cypher: "MATCH p=(c:Commit)-[:TOUCHED]->(:Manifest)\nRETURN p LIMIT 200",
  },
  {
    name: "Top contributors",
    table: true,
    cypher:
      "MATCH (x:Person)-[:ADDED]->(p:Package)\nRETURN x.name AS developer, count(DISTINCT p) AS added\nORDER BY added DESC LIMIT 10",
  },
  {
    name: "Duplicate versions",
    table: true,
    cypher:
      "MATCH (p:Package)\nWITH p.name AS name, count(*) AS versions, collect(p.version) AS vs\nWHERE versions > 1\nRETURN name, versions, vs ORDER BY versions DESC",
  },
];

/// Detailed-mode-only preset, appended when the graph carries deps.dev
/// data: every dependency with advisories at the slider's point in time,
/// linked to the developer who put that version there. Attribution rides
/// the ADDED edge opened by the same commit the live DECLARES interval
/// starts at, so time travel shows only attribution that had happened by
/// then. On an undetailed graph `p.vulns > 0` matches nothing.
const VULNERABLE_PRESET = {
  name: "Vulnerable deps + who added them",
  cypher:
    "MATCH (m:Manifest)-[r:DECLARES]->(p:Package)\n" +
    "WHERE p.vulns > 0\n" +
    "  AND r.since_date <= $as_of\n" +
    "  AND (r.removed_date IS NULL OR r.removed_date > $as_of)\n" +
    "MATCH (x:Person)-[a:ADDED]->(p)\n" +
    "WHERE a.at_sha = r.since_sha\n" +
    "RETURN x, a, p LIMIT 200",
};

let vulnerablePresetWired = false;

function presetButton(preset) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.title = preset.table ? "Table result" : "Draws on the canvas";
  btn.innerHTML = `<i class="${preset.table ? "tbl" : ""}"></i>${escapeHtml(preset.name)}`;
  btn.addEventListener("click", () => {
    $("cypher-input").value = preset.cypher;
    runCypher();
  });
  return btn;
}

/// The preset buttons are always a pure function of CYPHER_PRESETS —
/// rendered from scratch, so no call path can ever duplicate one.
function renderPresets() {
  const holder = $("cypher-presets");
  holder.innerHTML = "";
  for (const preset of CYPHER_PRESETS) {
    holder.appendChild(presetButton(preset));
  }
}

/// Offer the vulnerable-dependencies preset once — and at any time: a
/// `serve --detailed` graph only gains its deps.dev data when the
/// background history walk finishes, possibly after this page loaded.
function addVulnerablePreset() {
  if (vulnerablePresetWired || detailedPackages <= 0) return;
  vulnerablePresetWired = true;
  const firstTable = CYPHER_PRESETS.findIndex((p) => p.table);
  const at = firstTable === -1 ? CYPHER_PRESETS.length : firstTable;
  CYPHER_PRESETS.splice(at, 0, VULNERABLE_PRESET);
  // Before the console is built there is nothing to re-render — the
  // wiring loop picks the preset up from the array itself.
  if ($("cypher-presets").children.length > 0) renderPresets();
}

function wireCypherConsole() {
  addVulnerablePreset();
  renderPresets();
  $("run-cypher").addEventListener("click", () => runCypher());
  $("cypher-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      runCypher();
    }
  });
  $("cypher-input").value = CYPHER_PRESETS[0].cypher;

  const box = $("cypher-box");
  $("cypher-toggle").addEventListener("click", () => {
    box.classList.toggle("collapsed");
    if (!box.classList.contains("collapsed")) $("cypher-input").focus();
    requestAnimationFrame(() => cy && cy.resize());
  });

  for (const tab of document.querySelectorAll("#cypher-results [data-tab]")) {
    tab.addEventListener("click", () => {
      for (const t of document.querySelectorAll("#cypher-results [data-tab]")) {
        t.classList.toggle("active", t === tab);
      }
      $("cypher-table").hidden = tab.dataset.tab !== "table";
      $("cypher-output").hidden = tab.dataset.tab !== "json";
    });
  }

  // Drag the top edge to resize the console.
  const handle = $("cypher-resize");
  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = box.getBoundingClientRect().height;
    const move = (ev) => {
      const h = Math.min(window.innerHeight * 0.7, Math.max(140, startH + (startY - ev.clientY)));
      box.style.height = `${h}px`;
      cy && cy.resize();
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      cy && cy.resize();
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  });
}

function setStatus(text, cls) {
  const s = $("cypher-status");
  s.textContent = text;
  s.className = "muted " + (cls || "");
}

async function runCypher(opts = {}) {
  const cypher = opts.silentFocus && lastCypher ? lastCypher : $("cypher-input").value.trim();
  if (!cypher) return;
  const box = $("cypher-box");
  if (box.classList.contains("collapsed") && !opts.silentFocus) {
    box.classList.remove("collapsed");
    requestAnimationFrame(() => cy && cy.resize());
  }
  const runBtn = $("run-cypher");
  runBtn.disabled = true;
  setStatus("Running…");
  const started = performance.now();
  try {
    const body = { cypher };
    if (cypher.includes("$as_of")) body.params = { as_of: asOfValue() || STALE_AS_OF };
    const res = await fetchJson("api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const ms = Math.round(performance.now() - started);
    const rows = res.rows || [];
    renderResultTable(res.columns || Object.keys(rows[0] || {}), rows);
    $("cypher-output").textContent = JSON.stringify(rows, null, 2).slice(0, 200000);

    const elements = res.elements;
    const rowsText = `${rows.length} row${rows.length === 1 ? "" : "s"} · ${ms} ms`;
    if (elements && elements.nodes.length > 0) {
      // Graph-shaped result: take over the main canvas.
      queryElements = elements;
      lastCypher = cypher;
      $("query-pill").hidden = false;
      $("query-pill-text").textContent =
        `Query result · ${elements.nodes.length} nodes · ${elements.edges.length} relationships` +
        (cypher.includes("$as_of") ? ` · as of ${asOfValue() ? asOfValue().slice(0, 10) : "HEAD"}` : "");
      renderCurrentView();
      setStatus(`Drawn on canvas — ${elements.nodes.length} nodes, ${elements.edges.length} relationships · ${rowsText}`, "ok");
    } else {
      setStatus(`${rowsText} · no nodes to draw (return nodes, relationships or paths to see them on the canvas)`);
    }
  } catch (e) {
    setStatus(`Error: ${e.message}`, "error");
    $("cypher-table").innerHTML = `<p class="hint" style="color:var(--danger)">${escapeHtml(e.message)}</p>`;
    $("cypher-output").textContent = e.message;
  } finally {
    runBtn.disabled = false;
  }
}

/// One cell of the result table: entities show as `(:Label {name})`.
function formatCell(v) {
  if (v === null || v === undefined) return { html: "null", cls: "null" };
  if (typeof v === "number") return { html: String(v), cls: "num" };
  if (typeof v === "boolean") return { html: String(v), cls: "num" };
  if (typeof v === "string") return { html: escapeHtml(v), cls: "" };
  if (Array.isArray(v)) {
    const inner = v.slice(0, 20).map((x) => formatCell(x).html).join(", ");
    return { html: `[${inner}${v.length > 20 ? ", …" : ""}]`, cls: "" };
  }
  if (v._labels) {
    const name = v.name || v.purl || v.path || v.email || v.sha || "";
    return { html: `<span class="ent">(:${escapeHtml(v._labels.join(":"))})</span> ${escapeHtml(name)}`, cls: "" };
  }
  if (v._type) return { html: `<span class="ent">[:${escapeHtml(v._type)}]</span>`, cls: "" };
  if (v._path_length !== undefined) {
    const names = (v.nodes || []).map((n) => escapeHtml(n.name || n.purl || n.path || n.email || "?"));
    return { html: `<span class="ent">path</span> ${names.join(" → ")}`, cls: "" };
  }
  return { html: escapeHtml(JSON.stringify(v)), cls: "" };
}

function renderResultTable(columns, rows) {
  const holder = $("cypher-table");
  if (!rows.length) {
    holder.innerHTML = '<p class="hint">No rows.</p>';
    return;
  }
  const cap = 500;
  const head = columns.map((c) => `<th>${escapeHtml(c)}</th>`).join("");
  const body = rows.slice(0, cap).map((r) =>
    "<tr>" + columns.map((c) => {
      const f = formatCell(r[c]);
      return `<td class="${f.cls}" title="${escapeHtml(typeof r[c] === "string" ? r[c] : "")}">${f.html}</td>`;
    }).join("") + "</tr>"
  ).join("");
  holder.innerHTML = `<table class="rtable"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>` +
    (rows.length > cap ? `<p class="hint">Showing first ${cap} of ${rows.length} rows.</p>` : "");
}

init().catch((e) => {
  console.error("BOMvoyage init failed:", e);
  $("meta").textContent = `failed to load: ${e.message}`;
});
