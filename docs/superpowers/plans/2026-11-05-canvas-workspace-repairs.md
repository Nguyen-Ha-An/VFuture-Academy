# Canvas workspace repairs

Continue the approved Canvas/Vinschool direction in `docs/design/canvas/implementation.md`: complete the staff interiors and repair the reported backend routing failures. Preserve existing permissions, published history, EN/VI and both themes. MCP work is deferred at the user's request.

1. Reproduce the course-import transport failure against the SQL function signature; add regression coverage before correcting the RPC request. Inspect both new-course and existing-draft paths.
2. Trace Studio, teaching and Administration request paths, methods, scope/actor parameters, redirects and RPC signatures. Fix school-scoped grading detail requests, stale request guards and school-entry scope preservation; test authorized and unauthorized cases.
3. Replace the remaining legacy teaching dashboard controls and school table with existing Canvas components; put pending work before historical metrics and preserve usable desktop/mobile navigation.
4. Reproduce and fix the staff session guard's permanent overlay after a temporary session-check failure. Keep content concealed until the same actor is positively revalidated; an actual account change must remain concealed until the authorized layout remounts.
5. Review the integrated diff and browser screenshots. Run `npm run graphify:refresh`, `npm run graphify:check`, then `BICEP_BIN="$HOME/.azure/bin/bicep" npm run verify:local`. Resolve failures and rerun freshness after edits. Review and commit the tracked manifest with the source; retain ignored graph artifacts locally.

Backend routing and staff presentation have independent owners. The integrating agent owns session recovery, review and the final local gate. Production changes, merge and deployment are separate from this repair pass; local fixture checks do not establish live signed-in workflows. Static route/RPC inventory is supporting evidence only, not proof of the deployed database or authenticated runtime.
