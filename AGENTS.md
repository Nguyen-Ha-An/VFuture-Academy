# Repository verification policy

Run Graphify and every applicable local check before calling a change verified, review-ready, or ready to merge:

1. Finish source, configuration, database, documentation and test edits.
2. Run `npm run graphify:refresh`, then `npm run graphify:check`.
3. Run `npm run verify:local` and resolve failures. The local verifier must enforce `graphify:check`; source edits after refresh require another refresh.
4. Review the tracked `docs/architecture/graphify-manifest.json` changes with the source. Commit the manifest, but keep the full `graphify-out/` directory ignored.

Graphify requires the explicitly pinned local CLI `graphify 0.9.91` (`uv tool install graphifyy==0.9.91` for a new installation). The wrapper forces `GRAPHIFY_NO_AUTO_REFRESH=1`, code-only extraction, no clustering, and at most two workers. It must never invoke semantic APIs or index credentials, vendor trees, build outputs, local authentication states, or other ignored runtime artifacts.

Coverage includes all eligible tracked and unignored new owned text files throughout this repository, including source, tests, SQL, configuration and docs. File-only coverage for an unsupported format is explicit; it does not establish semantic relationships. Inspect actual source and tests to adjudicate call paths, permissions, SQL/RPC contracts, and product behavior. Never invent graph edges or present AST static inference as runtime proof.

A clean clone intentionally has no local graph artifact: run `graphify:refresh` before `verify:local`. Do not bypass a missing graph/receipt or treat only a manifest timestamp as freshness evidence. See `docs/architecture/Graphify-policy.md`.

GitHub Actions is deployment-only. Keep Graphify, tests, lint, type checks, SQL contracts, browser contracts and builds local. Passing local checks does not establish live database state, hosted performance, or deployment correctness. Preserve documented release gates and verify deployment separately when release work is authorized.
