---
title: Projects
date: 2026-11-16
hide_date: true
reading_time: false
---

Things I've built and shipped.

## BOMvoyage

A temporal Software Bill of Materials (SBOM) generator and explorer, powered by the embedded
graph engine [RelateDB](https://relatedb.ai/). It scans dependency manifests (Python, Java,
Rust, Go, Node.js), replays the git history into a graph, and serves an interactive explorer
with time travel: who added each dependency, when, every version bump, and when it was
removed. A detailed mode layers in live data from deps.dev — licenses, repository links, and
security advisories, with vulnerable dependencies flagged as red triangles.

- [BOMvoyage — project page](/bomvoyage/)
- [Live demo: the Neo4j Java driver's dependency history](/bomvoyage/neo4j-java-driver/)
- [GitHub — b33f/BOMvoyage](https://github.com/b33f/BOMvoyage)

## neo4j-cert-tool

A CLI for generating and verifying TLS certificates for Neo4j 2025.x clusters — CA,
intermediate and self-signed certificates, wired for encrypted Bolt/HTTPS configuration and
certificate rotation.

- [GitHub — b33f/neo4j-cert-tool](https://github.com/b33f/neo4j-cert-tool)
