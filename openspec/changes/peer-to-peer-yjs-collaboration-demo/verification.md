## Verification record

### Automated proof results

The following gates passed on August 24, 2026:

- Scoped collaboration tests: 23 tests passed.
- Playwright collaboration interaction tests: 2 tests passed.
- Headless dependency graph: 14 tests passed.
- Repository typecheck.
- Repository lint.
- API extraction and API check.
- Adapter parity.
- Internationalization validation.
- Strict validation for both collaboration OpenSpec changes.

The conformance fixtures covered local, reordered, duplicated, disconnected,
browser, and headless delivery paths. All replicas produced equal canonical
fingerprints and save/reopen semantic digests.

One remote Yjs transaction that changes several paragraphs now publishes one
canonical revision. Replaying the same acknowledged output is a no-op.

### Full repository test baseline

The parallel suite completed with 8,492 passes and 16 failures. Most failures
were timeouts while lint, API extraction, and twelve test workers ran together.
The collaboration-related `runtime-boundaries.test.ts` file passed when rerun
without that load.

Three failures came from existing repository residue outside this change:

- `packages/agents` still exists.
- Removed agent demo directories still exist.
- `packages/agent-use` exists without a `package.json`.

This change does not remove those directories because they may contain unrelated
work. The full test and serial test gates remain open.

### Manual proof status

The user confirmed the Vercel two-window collaboration flow worked. The separate
machine run is not recorded yet. Automated browser-to-headless coverage passed,
but it does not replace the required separate-machine manual run.
