/* BOMvoyage static-site backend: answers the app's seven API calls from an
 * in-browser RelateDb (@relate/relate-wasm), so the explorer runs fully
 * client-side on any static host.
 *
 * Load order (generated index.html): queries.js (BOMVOYAGE_QUERIES) → this
 * file → cytoscape → app.js. fetchJson() awaits the `ready` promise, which
 * resolves once the WASM engine is up and the snapshot is replayed.
 */
"use strict";

window.BOMVOYAGE_STATIC = (function () {
  const Q = window.BOMVOYAGE_QUERIES;
  const SNAPSHOT_URL = "snapshot.json";
  const BATCH = 500; // mirrors write.rs BATCH — UNWIND chunk size

  let db = null; // RelateDb (in-memory, read-only)
  let readyResolve = null;
  const ready = new Promise((r) => (readyResolve = r));
  let bootError = null;

  // ------------------------------------------------------------- helpers

  function error(message) {
    return { error: message };
  }

  async function execute(query, params) {
    if (!db) {
      throw new Error(
        bootError ||
          "the graph engine is not loaded — reload the page (and serve it over HTTP: opening index.html from a file cannot work)"
      );
    }
    const raw = db.execute(query, params ? JSON.stringify(params) : null);
    const envelope = JSON.parse(raw);
    if (envelope.error) throw new Error(envelope.error);
    return envelope;
  }

  function rowsOf(envelope) {
    // The wire envelope's rows are already named maps ({col: value});
    // tolerate array rows too, mapped by column.
    const cols = envelope.columns || [];
    return (envelope.rows || []).map((r) => {
      if (!Array.isArray(r)) return r;
      const m = {};
      cols.forEach((c, i) => (m[c] = r[i] === undefined ? null : r[i]));
      return m;
    });
  }

  function valueToWire(v) {
    return v === null || v === undefined ? null : v;
  }

  /// JS port of resolve_as_of (graph/mod.rs): HEAD → max commit date,
  /// 10-char date → end of day, ≥20-char datetime → passthrough,
  /// else sha prefix → lookup.
  async function resolveAsOf(token) {
    if (token === null || token === undefined || token === "" || String(token).toUpperCase() === "HEAD") {
      const env = await execute("MATCH (c:Commit) RETURN max(c.date) AS d");
      const rows = rowsOf(env);
      const d = rows[0] && rows[0].d;
      return d || "9999-12-31T23:59:59Z";
    }
    const t = String(token);
    if (t.length === 10 && t[4] === "-") return t + "T23:59:59Z";
    if (t.length >= 20) return t;
    const env = await execute(Q.SHA_DATE, { sha: t });
    const rows = rowsOf(env);
    if (rows[0] && rows[0].date) return rows[0].date;
    throw new Error(`--as-of ${JSON.stringify(t)} is neither an ISO date nor a known commit prefix`);
  }

  // ----------------------------------------------- element wire building

  /// Port of Api::graph's row → cytoscape element mapping. (Wire rows are
  /// named maps already — rowsOf normalizes.)
  function graphPayload(asOf, pkgsEnv, edgesEnv) {
    const pkgs = rowsOf(pkgsEnv);
    const edges = rowsOf(edgesEnv);
    const str = (v) => (v === null || v === undefined ? "" : String(v));
    const versionSuffix = (v) => (v ? "@" + v : "");
    const nodes = pkgs.map((r) => {
      const vulns = typeof r.vulns === "number" ? r.vulns : 0;
      const rawAdv = r.advisories;
      let advisories = null;
      if (vulns > 0 && rawAdv) {
        try { advisories = JSON.parse(rawAdv); } catch (_) { advisories = null; }
      }
      return {
        data: {
          id: str(r.purl),
          label: str(r.name) + versionSuffix(str(r.version)),
          ecosystem: str(r.ecosystem),
          scope: str(r.scope),
          manifest: str(r.manifest),
          added_by: str(r.added_by),
          added_date: str(r.added_date),
          requirement: str(r.requirement),
          vulns: vulns,
          license: str(r.license),
          depsdev_url: str(r.depsdev_url),
          homepage: str(r.homepage),
          repository: str(r.repository),
          advisories: advisories,
        },
      };
    });
    const edgesJson = edges.map((r) => ({
      data: {
        source: str(r.from),
        target: str(r.to),
        source_kind: str(r.source),
      },
    }));
    return { as_of: asOf, elements: { nodes, edges: edgesJson } };
  }

  // --- raw-cypher console: port of graph_elements_of -------------------

  function wireProps(obj) {
    const props = {};
    for (const k in obj) {
      if (k === "_labels" || k === "_type" || k === "_path_length" || k === "_nodes") continue;
      props[k] = valueToWire(obj[k]);
    }
    return props;
  }

  function collectGraphValues(cell, nodes, edges, seenNodes, seenEdges) {
    if (cell === null || cell === undefined) return;
    if (Array.isArray(cell)) {
      for (const c of cell) collectGraphValues(c, nodes, edges, seenNodes, seenEdges);
      return;
    }
    if (typeof cell !== "object") return;
    if (cell._labels) {
      // a node: { _labels: [..], ...props }
      const id = "n" + (cell._id !== undefined ? cell._id : "x" + (cell.purl || cell.name || cell.path || cell.email || cell.sha || JSON.stringify(cell).length));
      if (!seenNodes.has(id)) {
        seenNodes.set(id, true);
        const kind = cell._labels[0] || "";
        let label = cell.name || cell.path || cell.email || cell.purl || cell.summary || cell.title || cell.sha || (kind || "n");
        if (kind === "Package" && cell.version) label = `${label}@${cell.version}`;
        else if (kind === "Commit" && cell.sha) label = String(cell.sha).slice(0, 8);
        else if ((kind === "File" || kind === "Manifest") && label.includes("/")) {
          const parts = String(label).split("/").reverse().slice(0, 2).reverse();
          if (parts.length >= 2) label = parts[parts.length - 2] + "/" + parts[parts.length - 1];
        }
        nodes.push({
          data: {
            id, label, type: "query", kind,
            labels: cell._labels,
            ecosystem: kind === "Package" ? (cell.ecosystem || null) : null,
            scope: cell.scope || null,
            purl: cell.purl || null,
            vulns: kind === "Package" ? (typeof cell.vulns === "number" ? cell.vulns : 0) : null,
            props: wireProps(cell),
          },
        });
      }
      return;
    }
    if (cell._type) {
      // a relationship: { _type, _src?, _dst?, ...props }
      const id = "r" + (cell._id !== undefined ? cell._id : edges.length);
      if (!seenEdges.has(id)) {
        seenEdges.set(id, true);
        edges.push({
          data: {
            id,
            source: cell._src !== undefined ? "n" + cell._src : (cell._from || "?"),
            target: cell._dst !== undefined ? "n" + cell._dst : (cell._to || "?"),
            label: cell._type,
            source_kind: "query",
            props: wireProps(cell),
          },
        });
      }
      return;
    }
    if (cell._path_length !== undefined) {
      const sub = cell._nodes || cell.nodes || [];
      for (const c of sub) collectGraphValues(c, nodes, edges, seenNodes, seenEdges);
      return;
    }
    // scalar / map value: nothing to draw
  }

  /// Port of graph_elements_of: rows → {nodes, edges} with endpoint stubs.
  function graphElementsOf(envelope) {
    const nodes = [], edges = [];
    const seenNodes = new Map(), seenEdges = new Map();
    for (const row of envelope.rows || []) {
      const cells = Array.isArray(row) ? row : Object.values(row || {});
      for (const cell of cells) collectGraphValues(cell, nodes, edges, seenNodes, seenEdges);
    }
    // stub missing endpoints (cytoscape rejects dangling edges)
    const ids = new Set(nodes.map((n) => n.data.id));
    for (const e of edges) {
      for (const end of ["source", "target"]) {
        if (!ids.has(e.data[end])) {
          ids.add(e.data[end]);
          nodes.push({ data: { id: e.data[end], label: "?", type: "query", kind: "", ecosystem: null, props: {} } });
        }
      }
    }
    return { nodes, edges };
  }

  // --------------------------------------------------------- dispatch

  async function handle(url, opts) {
    // A failed boot is the root problem — surface it before anything else.
    if (bootError && !db) return error(bootError);
    if (!Q) return error("queries not loaded — queries.js is missing from this deployment");
    const path = url.split("?")[0];
    const qs = url.includes("?") ? url.split("?")[1] : "";
    const qp = (name) => {
      for (const pair of qs.split("&")) {
        const [k, v] = pair.split("=");
        if (k === name) return decodeURIComponent((v || "").replace(/\+/g, " "));
      }
      return null;
    };

    switch (path) {
      case "api/meta": {
        const env = await execute(Q.META);
        const row = rowsOf(env)[0] || {};
        const headSha = row.head_sha || "";
        const historyHead = row.history_head || "";
        const countEnv = await execute(Q.META_COUNTS);
        const totalEnv = await execute(Q.META_TOTAL);
        const detEnv = await execute(Q.META_DETAILED);
        const intValue = (env) => {
          const r = rowsOf(env)[0] || {};
          return typeof r.n === "number" ? r.n : 0;
        };
        return {
          name: window.BOMVOYAGE_SNAPSHOT_META.name || ".",
          repo_spec: window.BOMVOYAGE_SNAPSHOT_META.repo_spec || null,
          version: window.BOMVOYAGE_SNAPSHOT_META.tool_version || "",
          head_sha: headSha,
          last_scanned_at: row.scanned_at || "",
          scan_quality: row.scan_quality || "",
          history_current: true, // static site: the snapshot IS the full history
          total_packages: intValue(totalEnv),
          detailed_packages: intValue(detEnv),
          ecosystems: rowsOf(countEnv).map((r) => ({ ecosystem: r.eco, names: r.n })),
        };
      }
      case "api/graph": {
        const asOf = await resolveAsOf(qp("as_of"));
        const params = { as_of: asOf };
        const pkgs = await execute(Q.LIVE_PACKAGES, params);
        const edges = await execute(Q.LIVE_DEPENDS_ON, params);
        return graphPayload(asOf, pkgs, edges);
      }
      case "api/history": {
        const name = qp("name");
        if (!name) return error("missing ?name=");
        const env = await execute(Q.HISTORY, { name });
        return { rows: rowsOf(env) };
      }
      case "api/usage": {
        const purl = qp("purl");
        if (!purl) return error("missing ?purl=");
        const env = await execute(Q.USAGE, { purl });
        return { rows: rowsOf(env) };
      }
      case "api/commits": {
        const env = await execute(Q.COMMITS);
        return { rows: rowsOf(env) };
      }
      case "api/update":
        return { checking: false, available: false };
      case "api/query": {
        let body = {};
        const raw = opts && opts.body;
        if (raw) {
          try {
            // the UI passes a string (JSON.stringify); tolerate bytes too
            body = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
          } catch (_) {
            return error("missing cypher");
          }
        }
        const cypher = body.cypher;
        if (!cypher) return error("missing cypher");
        const upper = cypher.trimStart().toUpperCase();
        for (const banned of ["CREATE", "MERGE", "DELETE", "SET ", "REMOVE", "DROP", "DETACH", "CALL {", "LOAD CSV", "FOREACH"]) {
          if (upper.startsWith(banned)) {
            return error(`read-only endpoint: refusing statements starting with ${banned.trim()}`);
          }
        }
        const env = await execute(cypher, body.params);
        const out = { rows: rowsOf(env), columns: env.columns || [] };
        out.elements = graphElementsOf(env);
        return out;
      }
      default:
        return error("not found");
    }
  }

  // ------------------------------------------------------------ replay

  async function replaySnapshot(snapshot) {
    const stages = snapshot.stages || {};
    // order matters: MATCH targets must exist before the edges land
    const order = [
      ["packages", Q.MERGE_PACKAGES],
      ["detailed", Q.MERGE_PACKAGE_DETAILED],
      ["commits", Q.MERGE_COMMITS],
      ["people", Q.MERGE_PEOPLE],
      ["project", Q.MERGE_PROJECT],
      ["has_manifest", Q.MERGE_HAS_MANIFEST],
      ["root", Q.MERGE_ROOT],
      ["declares", Q.MERGE_DECLARES],
      ["depends_on", Q.MERGE_DEPENDS_ON],
      ["imports", Q.MERGE_IMPORTS],
      ["added", Q.MERGE_ADDED],
      ["removed", Q.MERGE_REMOVED],
      ["touched", Q.MERGE_TOUCHED],
    ];
    const total = order.reduce((s, [name]) => s + ((stages[name] || []).length), 0);
    let done = 0;
    const meta = document.getElementById("meta");
    for (const [name, statement] of order) {
      const rows = stages[name] || [];
      if (!rows.length) continue;
      for (let i = 0; i < rows.length; i += BATCH) {
        await execute(statement, { rows: rows.slice(i, i + BATCH) });
        done += Math.min(BATCH, rows.length - i);
        if (meta && total) meta.textContent = `replaying snapshot… ${done}/${total}`;
      }
    }
    if (meta) meta.textContent = "";
  }

  async function boot() {
    try {
      const meta = document.getElementById("meta");
      if (window.location && window.location.protocol === "file:") {
        // file:// pages cannot load ES modules or fetch() — the engine can
        // never start. Say so plainly instead of a cryptic null error.
        throw new Error(
          "this page was opened from a file — browsers block module loading on file:// URLs. Serve the folder over HTTP instead: run 'python3 -m http.server' in the site directory and open http://localhost:8000/, or deploy it (e.g. npx wrangler pages deploy .)"
        );
      }
      if (meta) meta.textContent = "loading the graph engine (WASM)…";
      if (window.BOMVOYAGE_RELATE_FACTORY) {
        // Injection seam for tests: a fake engine object with execute().
        db = window.BOMVOYAGE_RELATE_FACTORY();
      } else {
        const relate = await import(window.BOMVOYAGE_WASM_MODULE || "./relate/relate.js");
        await relate.default(); // load relate_bg.wasm
        if (relate.__start) relate.__start();
        // WRITABLE: the snapshot replay MERGEs into the fresh in-memory db
        // (read-only refuses writes). The only writes after replay come
        // through fetchJson's prefix-refused console — the same guard the
        // server enforces.
        db = new relate.RelateDb();
      }
      if (meta) meta.textContent = "replaying snapshot…";
      const res = await fetch(SNAPSHOT_URL);
      const snapshot = await res.json();
      if (snapshot.format !== 1) {
        throw new Error(`snapshot format ${snapshot.format} not supported by this page`);
      }
      window.BOMVOYAGE_SNAPSHOT_META = snapshot;
      await replaySnapshot(snapshot);
      readyResolve();
    } catch (e) {
      console.error("BOMvoyage static boot failed:", e);
      bootError = e.message;
      const meta = document.getElementById("meta");
      if (meta) meta.textContent = `failed to load: ${e.message}`;
      readyResolve(); // unblock fetchJson; each call surfaces the real error
      throw e;
    }
  }

  async function fetchJson(url, opts) {
    await ready;
    const result = await handle(url, opts);
    if (result && result.error) throw new Error(result.error);
    return result;
  }

  // Boot errors are surfaced three ways above (console, meta text,
  // bootError); the rethrown promise needs a handler so the page's process
  // doesn't die of an unhandled rejection after a handled failure.
  boot().catch(() => {});

  return { fetchJson, ready, replayStages };

  /// Swap the instance for an on-demand scan (ondemand.js): reset the db
  /// and replay the given stages, then resolve when serving resumes.
  async function replayStages(stages) {
    await ready; // initial snapshot replay must be done before a swap
    if (!db) throw new Error("graph engine not loaded");
    db.reset();
    await replaySnapshot({ stages });
  }
})();
