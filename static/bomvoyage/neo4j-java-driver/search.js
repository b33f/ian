/* BOMvoyage: live dependency search. Filters package nodes on the main
 * canvas by name as you type. Self-contained: it reads the `cy` instance that
 * app.js owns and re-applies itself after every redraw (view switch, scope
 * toggle, time travel, raw-Cypher result). */
"use strict";

(() => {
  const input = document.getElementById("dep-search");
  const count = document.getElementById("search-count");
  const clearBtn = document.getElementById("search-clear");
  if (!input) return;

  let term = "";
  let boundCy = null;     // the cytoscape instance we've attached to
  let pending = null;     // debounce timer for redraw re-application

  const isPackage = (n) =>
    n.data("type") === "package" || n.data("kind") === "Package";

  function haystack(n) {
    return [n.data("label"), n.data("name"), n.data("purl")]
      .filter(Boolean).join(" ").toLowerCase();
  }

  function apply() {
    const c = typeof cy !== "undefined" ? cy : null;
    if (!c) return;
    c.batch(() => {
      c.elements().removeClass("search-hidden search-match");
      if (!term) return;
      const packages = c.nodes().filter(isPackage);
      const matches = packages.filter((n) => haystack(n).includes(term));
      packages.difference(matches).addClass("search-hidden");
      matches.addClass("search-match");
      // Context nodes (developers, areas, manifests, files, people…) stay only
      // when they touch a match, so a found library never floats alone.
      const keep = matches.neighborhood().nodes();
      c.nodes()
        .filter((n) => !isPackage(n))
        .difference(keep)
        .addClass("search-hidden");
    });
    updateCount(c);
  }

  function updateCount(c) {
    clearBtn.hidden = !term;
    if (!term) { count.textContent = ""; return; }
    const total = c.nodes().filter(isPackage).length;
    const found = c.nodes(".search-match").length;
    count.textContent = `${found} of ${total}`;
    count.classList.toggle("none", found === 0);
  }

  function setTerm(value) {
    term = value.trim().toLowerCase();
    apply();
  }

  // Attach to whichever cytoscape instance app.js currently owns; re-apply
  // the filter whenever its elements are replaced.
  function attach() {
    const c = typeof cy !== "undefined" ? cy : null;
    if (!c || c === boundCy) return;
    boundCy = c;
    c.style()
      .selector(".search-hidden").style({ display: "none" })
      .selector("node.search-match").style({
        "border-width": 3,
        "border-color": "#f2cc60",
        "font-weight": "bold",
        "z-index": 20,
      })
      .update();
    c.on("add", () => {
      clearTimeout(pending);
      pending = setTimeout(apply, 0);
    });
    apply();
  }
  setInterval(attach, 300);

  let debounce = null;
  input.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => setTerm(input.value), 80);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      input.value = "";
      setTerm("");
      input.blur();
    } else if (e.key === "Enter") {
      setTerm(input.value);
      const c = typeof cy !== "undefined" ? cy : null;
      const hits = c ? c.nodes(".search-match") : null;
      if (!hits || hits.length === 0) return;
      c.animate({ fit: { eles: hits.closedNeighborhood(), padding: 60 }, duration: 250 });
      if (c.zoom() > 1.6) c.zoom(1.6);
      if (hits.length === 1) {
        c.elements().unselect();
        hits.select();
        const purl = hits.data("purl") || hits.data("id");
        if (typeof showPackage === "function" && purl) showPackage(purl);
      }
    }
  });
  clearBtn.addEventListener("click", () => {
    input.value = "";
    setTerm("");
    input.focus();
  });
  // "/" focuses search from anywhere outside a text field.
  document.addEventListener("keydown", (e) => {
    const tag = (e.target.tagName || "").toLowerCase();
    if (e.key === "/" && tag !== "input" && tag !== "textarea") {
      e.preventDefault();
      input.focus();
      input.select();
    }
  });
})();
