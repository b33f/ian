/* BOMvoyage static site: on-demand CURRENT-ONLY scan of a GitHub repo.
 *
 * A browser cannot run git (and full history replay in JS would be the
 * whole scan pipeline), so an org/repo entered into the URL box fetches
 * the repo's CURRENT manifests from GitHub's API and builds a current-only
 * graph in the in-browser RelateDb: no time travel, no usage sites — the
 * pre-built snapshot remains the full-fidelity view. Static mode only:
 * the box stays hidden when a server is answering.
 */
"use strict";

window.BOMVOYAGE_ONDEMAND = (function () {
  const GITHUB_HOSTS = ["api.github.com", "raw.githubusercontent.com", "github.com"];
  // mirrors discover.rs SKIP_DIRS
  const SKIP_DIRS = [".git", "target", "node_modules", "vendor", "dist", "build",
    "bower_components", ".next", ".nuxt", ".svelte-kit", ".turbo", ".yarn", "coverage"];
  const MAX_MANIFESTS = 50;
  const FETCH_CONCURRENCY = 8;

  /// JS port of discover.rs kind_for — the subset of manifests the
  /// on-demand parser supports (current-only).
  function classify(path) {
    const segs = path.split("/");
    if (segs.some((s) => SKIP_DIRS.includes(s))) return null;
    const name = segs[segs.length - 1];
    if (name === "Cargo.toml") return "cargo-toml";
    if (name === "Cargo.lock") return "cargo-lock";
    if (name === "go.mod") return "go-mod";
    if (name === "pyproject.toml") return "pyproject";
    if (name === "pom.xml") return "pom";
    if (name === "package.json") return "package-json";
    if (name === "requirements.txt" || /^requirements-.*\.txt$/.test(name)) return "requirements";
    return null;
  }

  function validSpec(spec) {
    const parts = spec.split("/");
    if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
    return parts.every((p) => /^[A-Za-z0-9._-]+$/.test(p) && !p.includes(".."));
  }

  function purlFor(eco, name, version) {
    // eco: graph spelling (python/java/rust/go/node)
    const at = version ? "@" + version : "";
    if (eco === "maven") {
      const [g, a] = name.split(":");
      return `pkg:maven/${g}/${a}${at}`;
    }
    return `pkg:${eco}/${name}${at}`;
  }

  function graphEco(prefixEco) {
    // purl-prefix eco (as used in purlFor) → graph spelling
    return { pypi: "python", maven: "java", cargo: "rust", golang: "go", npm: "node" }[prefixEco] || prefixEco;
  }

  // ------------------------------------------------------ parsers (pure)

  function parsePackageJson(text) {
    const j = JSON.parse(text);
    const out = [];
    for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      for (const [name, spec] of Object.entries(j[section] || {})) {
        if (typeof spec !== "string" || spec.startsWith("file:") || spec.startsWith("link:")) continue;
        out.push({ name, version: spec.replace(/^[^0-9v]*/, "") || spec, scope: "direct", eco: "npm" });
      }
    }
    return out;
  }

  function parseCargoToml(text) {
    const out = [];
    let section = null;
    for (const rawLine of text.split("\n")) {
      const line = rawLine.split("#")[0].trim();
      const heading = line.match(/^\[([^\]]+)\]$/);
      if (heading) { section = heading[1]; continue; }
      if (!line.includes("=")) continue;
      const isDep = section === "dependencies" || section === "dev-dependencies" || section === "build-dependencies";
      if (!isDep) continue;
      const eq = line.indexOf("=");
      const name = line.slice(0, eq).trim().replace(/^"|"$/g, "");
      const rest = line.slice(eq + 1).trim();
      let version = null;
      const inline = rest.match(/version\s*=\s*"([^"]+)"/);
      if (inline) version = inline[1];
      else if (rest.startsWith('"')) version = rest.replace(/^"|"$/g, "");
      out.push({ name, version: version || "", scope: "direct", eco: "cargo" });
    }
    return out;
  }

  function parseCargoLock(text) {
    const out = [];
    let current = null;
    for (const rawLine of text.split("\n")) {
      const line = rawLine.trim();
      if (line === "[[package]]") { current = {}; continue; }
      if (!current) continue;
      const m = line.match(/^(name|version)\s*=\s*"([^"]+)"/);
      if (m) current[m[1]] = m[2];
      if (line === "" && current.name) {
        out.push({ name: current.name, version: current.version || "", scope: "transitive", eco: "cargo" });
        current = null;
      }
    }
    if (current && current.name) out.push({ name: current.name, version: current.version || "", scope: "transitive", eco: "cargo" });
    return out;
  }

  function parseGoMod(text) {
    const out = [];
    let inBlock = false;
    for (const rawLine of text.split("\n")) {
      const line = rawLine.trim();
      if (line.startsWith("require (")) { inBlock = true; continue; }
      if (line === ")") { inBlock = false; continue; }
      const m = line.match(/^([^\s]+)\s+(v[^\s]+)(\s+\/\/\s+indirect)?$/) || (inBlock ? line.match(/^([^\s]+)\s+(v[^\s]+)/) : null);
      if (!m) continue;
      out.push({ name: m[1], version: m[2], scope: /indirect/.test(line) ? "transitive" : "direct", eco: "golang" });
    }
    return out;
  }

  function parsePom(text) {
    // structured regex rather than DOMParser: works the same in the
    // browser and in the node smoke harness
    const out = [];
    const blocks = text.match(/<dependencies>[\s\S]*?<\/dependencies>/g) || [];
    for (const block of blocks) {
      for (const m of block.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
        const pick = (tag) => {
          const t = m[1].match(new RegExp(`<${tag}>([^<]+)</${tag}>`));
          return t ? t[1].trim() : "";
        };
        const g = pick("groupId"), a = pick("artifactId");
        if (g && a) out.push({ name: `${g}:${a}`, version: pick("version"), scope: "direct", eco: "maven" });
      }
    }
    return out;
  }

  function parseRequirements(text) {
    const out = [];
    for (const rawLine of text.split("\n")) {
      let line = rawLine.trim().split("#")[0].trim();
      if (!line || line.startsWith("-")) continue; // -r includes, -e edits
      const pin = line.match(/^([A-Za-z0-9._-]+)\s*==\s*([^;\s]+)/);
      if (pin) out.push({ name: pin[1], version: pin[2], scope: "direct", eco: "pypi" });
      else {
        const name = line.match(/^([A-Za-z0-9._-]+)/);
        if (name) out.push({ name: name[1], version: "", scope: "direct", eco: "pypi" });
      }
    }
    return out;
  }

  function parsePyproject(text) {
    const out = [];
    let section = null;
    for (const rawLine of text.split("\n")) {
      const line = rawLine.trim();
      const heading = line.match(/^\[(.+)\]$/);
      if (heading) { section = heading[1]; continue; }
      if (section === "project" && line.startsWith("dependencies")) {
        const list = line.slice(line.indexOf("=") + 1).trim();
        for (const m of list.matchAll(/"([^"]+)"/g)) {
          const spec = m[1].trim();
          const name = spec.match(/^([A-Za-z0-9._-]+)/);
          const ver = spec.match(/[=<>!~]+\s*([0-9][^,;\s]*)/);
          if (name) out.push({ name: name[1], version: ver ? ver[1] : "", scope: "direct", eco: "pypi" });
        }
      }
      if (section === "tool.poetry.dependencies" && line.includes("=")) {
        const name = line.split("=")[0].trim();
        const ver = line.match(/=\s*"([^"]+)"/);
        if (name && name !== "python") out.push({ name, version: ver ? ver[1].replace(/[^0-9.].*$/, "") : "", scope: "direct", eco: "pypi" });
      }
    }
    return out;
  }

  const PARSERS = {
    "package-json": parsePackageJson,
    "cargo-toml": parseCargoToml,
    "cargo-lock": parseCargoLock,
    "go-mod": parseGoMod,
    "pom": parsePom,
    "requirements": parseRequirements,
    "pyproject": parsePyproject,
  };

  /// Parse one manifest → [{name, version, scope, eco(graph spelling), purl}].
  /// Parsers emit the purl-prefix ecosystem (npm/pypi/…); rows carry the
  /// graph spelling (node/python/…) and the purl keeps the prefix.
  function parseManifest(kind, text) {
    return PARSERS[kind](text).map((p) => ({
      ...p,
      eco: graphEco(p.eco),
      purl: purlFor(p.eco, p.name, p.version),
    }));
  }

  // ------------------------------------------------------ github fetch

  async function gh(url) {
    const res = await fetch(url, { headers: { Accept: "application/vnd.github+json" } });
    if (res.status === 403 || res.status === 429) {
      throw new Error("GitHub API rate limit hit — try again in a while");
    }
    if (res.status === 404) {
      throw new Error("GitHub API 404 — no such repo (or it is private)");
    }
    if (!res.ok) throw new Error(`GitHub API ${res.status} for ${url.split("?")[0]}`);
    return res.json();
  }

  /// Encode a repo-relative path for a raw.githubusercontent URL: each
  /// segment percent-encoded (a crafted filename with `?`, `#` or `%` must
  /// not be able to redirect the request off the file it names), `/`
  /// preserved as the separator.
  function encodePath(p) {
    if (p.split("/").some((s) => s === ".." || s === ".")) {
      throw new Error(`refusing suspicious manifest path: ${p}`);
    }
    return p.split("/").map(encodeURIComponent).join("/");
  }

  async function scanRepo(spec) {
    if (!validSpec(spec)) throw new Error("enter a github org/repo like neo4j/neo4j-java-driver");
    const head = await gh(`https://api.github.com/repos/${spec}/commits/HEAD`);
    const headSha = head.sha;
    const tree = await gh(`https://api.github.com/repos/${spec}/git/trees/HEAD?recursive=1`);
    const paths = (tree.tree || [])
      .filter((e) => e.type === "blob")
      .map((e) => e.path)
      .filter((p) => classify(p));
    if (!paths.length) throw new Error("no supported dependency manifests found in this repository");
    const truncated = !!tree.truncated;
    const selected = paths.slice(0, MAX_MANIFESTS);

    const manifests = [];
    const packages = new Map(); // purl → row
    const declares = [];
    for (let i = 0; i < selected.length; i += FETCH_CONCURRENCY) {
      const chunk = selected.slice(i, i + FETCH_CONCURRENCY);
      const contents = await Promise.all(
        chunk.map((p) =>
          fetch(`https://raw.githubusercontent.com/${spec}/HEAD/${encodePath(p)}`)
            .then((r) => (r.ok ? r.text() : ""))
        )
      );
      for (let j = 0; j < chunk.length; j++) {
        const kind = classify(chunk[j]);
        const text = contents[j];
        if (!text) continue;
        let pkgs;
        try {
          pkgs = parseManifest(kind, text);
        } catch (_) {
          continue; // unparseable manifest: skipped, like a warned scan
        }
        manifests.push({ path: chunk[j], kind });
        const eco = graphEco({ "cargo-toml": "cargo", "cargo-lock": "cargo", "go-mod": "golang",
          "pyproject": "pypi", "pom": "maven", "package-json": "npm", "requirements": "pypi" }[kind]);
        for (const p of pkgs) {
          const purl = p.purl;
          if (!packages.has(purl)) {
            packages.set(purl, { purl, name: p.name, eco: p.eco, version: p.version, scope: p.scope });
          }
          declares.push({
            manifest: chunk[j], purl, key: `${chunk[j]}|${purl}|ondemand`,
            since_sha: "ondemand", since_date: "1970-01-01T00:00:00Z",
            removed_sha: null, removed_date: null, requirement: "", scope: p.scope,
            email: "", name: "", provisional: false,
          });
        }
      }
    }

    const repoName = spec;
    const rootPurl = `pkg:generic/${repoName}@${headSha}`;
    const stages = {
      packages: [...packages.values(), { purl: rootPurl, name: repoName, eco: "generic", version: headSha, scope: "direct" }],
      project: [{ name: repoName, head_sha: headSha, scanned_at: new Date().toISOString().replace(/\.\d+Z$/, "Z"), tool_version: "wasm-ondemand", scan_quality: "current-only", history_head: "" }],
      has_manifest: manifests.map((m) => ({ name: repoName, path: m.path, eco: graphEco({ "cargo-toml": "cargo", "go-mod": "golang", "pyproject": "pypi", "pom": "maven", "package-json": "npm", "requirements": "pypi", "cargo-lock": "cargo" }[m.kind]), kind: m.kind })),
      root: [{ name: repoName, purl: rootPurl }],
      declares,
    };
    return { stages, truncated, manifestCount: manifests.length, packageCount: packages.size };
  }

  // ------------------------------------------------------------- wiring

  let currentOrg = null;          // org whose suggestions were SUCCESSFULLY loaded
  let lastSpec = null;            // the spec the box should show
  const suggestionCache = new Map(); // org -> last successful listing (a
                                     // rate-limited retry must not wipe it)

  /// The account's most-starred repos. `/orgs/{o}/repos` only answers for
  /// real organizations — user accounts 404 there, so fall back to
  /// `/users/{a}/repos` (which answers for both).
  async function orgTopRepos(account) {
    const q = "?sort=stars&per_page=10&direction=desc";
    let res = await fetch(`https://api.github.com/orgs/${encodeURIComponent(account)}/repos${q}`);
    if (res.status === 404) {
      res = await fetch(`https://api.github.com/users/${encodeURIComponent(account)}/repos${q}`);
    }
    if (!res.ok) return null;
    const repos = await res.json();
    return Array.isArray(repos) ? repos : null;
  }

  function renderSuggestions(org, repos) {
    const dl = document.getElementById("repo-suggestions");
    if (!dl) return;
    dl.innerHTML = "";
    for (const r of repos) {
      const opt = document.createElement("option");
      opt.value = `${org}/${r.name}`;
      if (r.description) opt.label = `${r.name} — ${String(r.description).slice(0, 60)}`;
      dl.appendChild(opt);
    }
  }

  async function noteSpec(spec) {
    if (!spec) return;
    lastSpec = spec;
    const input = document.getElementById("repo-input");
    if (input && !input.value) input.value = spec;
    const org = spec.split("/")[0];
    if (org === currentOrg) return;
    // Show the cached listing immediately, then refresh from the network —
    // a failed/rate-limited fetch must not wipe what was there, and must
    // not mark the org loaded (the next call retries).
    const cached = suggestionCache.get(org);
    if (cached) renderSuggestions(org, cached);
    try {
      const repos = await orgTopRepos(org);
      if (repos) {
        currentOrg = org; // only after success: failures retry on the next call
        suggestionCache.set(org, repos);
        renderSuggestions(org, repos);
      } else {
        console.warn(`repo suggestions: no repository listing for ${org}`);
      }
    } catch (e) {
      console.warn(`repo suggestions failed for ${org}:`, e);
    }
  }

  async function wire() {
    // The box works in BOTH modes: on a generated static site it scans
    // in-browser; against the server it calls /api/scan-repo, which
    // clones + scans server-side and hot-swaps the served database.
    const box = document.getElementById("repo-box");
    const input = document.getElementById("repo-input");
    const go = document.getElementById("repo-go");
    const status = document.getElementById("repo-status");
    if (!box || !input || !go) return;
    box.hidden = false;

    const run = async () => {
      const spec = input.value.trim().replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "");
      const set = (t) => (status.textContent = t);
      try {
        go.disabled = true;
        input.disabled = true;
        set("scanning …");
        if (window.BOMVOYAGE_STATIC) {
          const result = await scanRepo(spec);
          await window.BOMVOYAGE_STATIC.replayStages(result.stages);
          set(`${result.packageCount} packages · ${result.manifestCount} manifests` +
              (result.truncated ? " · tree truncated (huge repo — partial)" : ""));
        } else {
          const res = await fetchJson("api/scan-repo", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ repo: spec }),
          });
          set(`${res.repo}: ${res.packages} packages · ${res.commits} commits`);
        }
        currentOrg = null; // refresh the suggestions for the new org
        await noteSpec(spec);
        if (window.BOMVOYAGE_ON_GRAPH_REBUILT) await window.BOMVOYAGE_ON_GRAPH_REBUILT();
      } catch (e) {
        set(`failed: ${e.message}`);
      } finally {
        go.disabled = false;
        input.disabled = false;
      }
    };
    go.addEventListener("click", run);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") run();
    });
    // Self-heal: focusing an empty-dropdown box retries the listing (a
    // rate-limited fetch at page load recovers the moment the user looks).
    input.addEventListener("focus", () => {
      if (lastSpec && !document.getElementById("repo-suggestions")?.children.length) {
        currentOrg = null;
        noteSpec(lastSpec);
      }
    });
  }

  wire();

  return { classify, parseManifest, scanRepo, validSpec, purlFor, noteSpec };
})();
