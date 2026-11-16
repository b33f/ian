---
title: BOMvoyage
date: 2026-11-16
hide_date: true
reading_time: false
---

**A temporal Software Bill of Materials — every dependency has a story.**

BOMvoyage scans a repository's dependency manifests, replays its git history into a graph
database, and serves an interactive explorer with time travel: who added each dependency,
when, every version bump, and when things were removed. A detailed mode layers on live data
from [deps.dev](https://deps.dev) — licenses, repository links, and security advisories,
with vulnerable dependencies highlighted as red triangles while you scrub through history.

## Try it live

**[Launch the live demo — the Neo4j Java driver](neo4j-java-driver/)** — the driver's full
dependency history (243 package versions across 317 commits) running entirely in your
browser on the WASM build of [RelateDB](https://relatedb.ai/). Drag the time-travel slider
(or press play) and watch the dependency graph evolve since 2015.

## Links

- [GitHub — b33f/BOMvoyage](https://github.com/b33f/BOMvoyage)
- [Live demo](neo4j-java-driver/)
