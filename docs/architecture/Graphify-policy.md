# Graphify coverage and local verification

Every change must finish with `npm run graphify:refresh`, `npm run graphify:check`, and the repository's `npm run verify:local`. The local verifier enforces the fast graph check before its other checks. Refresh again after any eligible file changes, additions, deletions, or policy changes. GitHub Actions stays deployment-only.

Install the explicitly pinned CLI with `uv tool install graphifyy==0.9.91` on a new workstation. Confirm `graphify --version` prints `graphify 0.9.91`. Upgrade that pin deliberately together with the wrapper, regenerated manifest, and local validation; do not silently install `latest`.

`scripts/graphify.mjs refresh` builds an isolated temporary snapshot from `git ls-files --cached --others --exclude-standard`. This works before the first commit and includes untracked implementation work. It indexes every nonexcluded UTF-8 text file in the repository, including application code, tests, scripts, SQL, JSON/YAML configuration, CSS and documentation. Binary assets are omitted. Deleted working-tree files are omitted and invalidate an older manifest. Gitignored files are not added; tracked files are filtered again by `.graphifyignore` and the wrapper's mandatory credential/vendor/local-state exclusions. Owned symlinks fail unless explicitly excluded; there are no cross-repository source dependencies.

The snapshot includes only eligible bytes. Environment files (including `.env.example`), credentials, `node_modules`, build outputs, caches, authentication states, local worktrees and full graph artifacts are excluded. `.graphifyignore` uses positive repository-relative `*`, `**`, and `?` globs, one per line; no negation or parent-directory patterns. Review any new exclusion as a scope change. The policy file and wrapper themselves remain indexed. The manifest is the sole generated indexed-source exception so it never hashes itself.

The wrapper runs this pinned extraction against the snapshot and a fresh temporary output directory:

```sh
GRAPHIFY_NO_AUTO_REFRESH=1 graphify extract SNAPSHOT --code-only --no-cluster --max-workers 2 --out TEMP_OUTPUT
```

A full fresh extraction deliberately replaces the old local graph. `graphify update --force` is unnecessary and must not substitute for this command: Graphify's code-only merge can retain prior semantic nodes. The child receives an allowlisted process environment without inherited API credentials. No semantic APIs, clustering, HTML export, package installation, database access or remote services are used. Input/output semantic tokens must both be zero. Source is limited to 15,000 files, 8 MiB per text file and 96 MiB total; final graph JSON is limited to 128 MiB. Refresh requires 512 MiB free on both repository and temporary storage, uses two AST workers, monitors a 384 MiB temporary-directory budget and 128 MiB free-space floor every 250 ms, has a ten-minute extraction timeout, kills the extraction process group on budget failure, and removes its temporary snapshot/output in a `finally` cleanup. It retains only one full graph and receipt locally.

The graph preserves all nodes and edges emitted by the pinned AST extraction and its endpoint finalization. Absolute temporary source prefixes are normalized and output ordering is canonical. The wrapper adds one `owned_file` node, with source hash, for every eligible file. It adds no semantic or guessed relationship edges. File nodes guarantee coverage even when Graphify skips or cannot parse Markdown, SQL, configuration, or another format. AST extraction itself can emit labeled static inferences and external module stubs; those remain extractor claims. Missing AST symbols/edges do not establish absence of behavior. Check source and executable tests for actual UI → API → service → RPC/SQL contracts and authorization. File-only coverage is reported separately from files with AST nodes.

Refresh writes:

- `graphify-out/graph.json`: full local graph, ignored by Git.
- `graphify-out/receipt.json`: local source/graph digest pair, ignored by Git.
- `docs/architecture/graphify-manifest.json`: compact tracked source SHA-256 map, source-set digest, CLI/policy version, graph SHA-256 and counts, coverage summary, and relation limits. It contains no checkout paths or timestamps.

`graphify:check` recomputes the complete eligible source set and every hash. It rejects changed/new/deleted/excluded files, missing graph/receipt, graph digest disagreement, duplicate IDs, missing file coverage, sources outside the owned corpus, and edges/hyperedges with invalid endpoints. It never runs extraction or silently refreshes. A clean clone must run `graphify:refresh` before verification; a tracked manifest alone cannot validate graph endpoints. The check requires no Graphify installation once a valid local refresh exists.

The source digest, file ordering and JSON serialization are stable across clones. Full graph hashes describe the exact generated artifact; extractor output can still vary by platform/parser implementation, so they are receipts rather than a promise of cross-platform byte-identical AST extraction. Commit refreshed manifests with source changes and review coverage changes. A valid graph and a passing local build do not override a failed hosted-performance gate, unapplied database migrations, or missing deployment validation.
