# Baseline evidence

## Current baseline (re-recorded after section 3, task 3.3)

Recorded after the gate infrastructure repair. This supersedes the original capture below,
which is retained because this change's tasks were written against it.

- `bun test`: **2265 pass, 0 fail, 0 errors.** Run twice back to back with identical
  results, which is itself part of the evidence: the previous failure set included a probe
  that leaked a server and poisoned the following run.
- `bun run typecheck`: passed.
- `bun run api:check`: passed. `@docx-editor.dev/agents` is skipped with a printed reason
  (it cannot build against the current engine), and the runner fails if that package ever
  gains a `dist`, so the exemption cannot outlive its cause.
- `bun run i18n:validate`: passed.
- `bunx playwright test --config browser-first.config.ts` from `e2e/`: 8 passed.
- `openspec validate typed-ooxml-paragraph-editor --strict`: valid.

### Known failing, and why

- `bun run check:parity` fails inside `check:public-docs-surface`. The published docs still
  describe the retired adapter surface (`renderAsync`, `DocxEditorHandle`, the toolbar
  exports, the whole React plugin API) that the greenfield migration removed. This is not
  infrastructure drift; it is the public support claim section 11 exists to reconcile, and
  task 11.4 forbids updating those claims before paired acceptance. It must not be silenced
  before then.
- `packages/agents` does not build: `src/bridge.ts` imports `@docx-editor.dev/core/headless`,
  removed in the greenfield migration. The package's own `typecheck` already skips for the
  same reason.

### What made the previous baseline unreadable

Each was a permanent red that hid real regressions, and none was a product defect:

1. **Duplicate Happy DOM registration.** One test file used an unguarded
   `beforeAll(register)` plus `afterAll(unregister)` while seventeen others used a guarded
   one-time register. bun runs all files in one process, so the unguarded call threw
   whenever another file loaded first, and the unregister tore the DOM out from under files
   that still needed it.
2. **Duplicate Playwright loading.** `bun test` claims `*.spec.*`, so two Playwright e2e
   files under `packages/` were loaded by the unit runner, tripping Playwright's own
   "Requiring @playwright/test second time" guard. They now use a `.pwtest.ts` suffix bun
   does not claim.
3. **A deleted decision record.** A guard asserted
   `openspec/changes/document-engine/spike-architecture-decision.md` was still `Accepted`,
   but this change's task 1.1 removed that change. It read a missing file and could never
   pass again. Replaced by the invariant it protected: exactly one active change.
4. **Stale migration inventories.** Five of ten "engine-neutral retained" test files were
   deleted with the adapter code they covered. They are now recorded as
   `engineNeutralRetired` with a reason, so the counts reconcile and a further unexplained
   disappearance still fails. A guarded test root that had been deleted is repointed, and a
   new assertion fails if any guarded root goes missing rather than silently scanning
   nothing.
5. **A self-poisoning probe.** The a11y harness export probe pinned port 5299. One
   interrupted run left its detached vite child holding the port; every later run then
   failed to bind, hit the 180s test budget, and the timeout killed the probe before its
   teardown ran, leaking another holder. It now binds an ephemeral port and finishes in
   about a second. Verified by starting a decoy server on 5299 and confirming the probe
   still passes.

Rebinding the frozen-artifact oracle hash was required after editing the package test
inventory, which is that mechanism working as designed.

---

## Original baseline (superseded, retained as the record the tasks were written against)

Recorded: 2026-07-28 before implementation of this change.

Repository HEAD at capture: `checkpoint-ca39632fd5aa12e23d729b91fc35d1c7c781696f`.

## Commands and results

- `bun run typecheck`: passed.
- `bun test`: failed with **2210 pass, 7 fail, 2 errors**.

The captured output reported seven failures but exposed only these five distinct printed failure names:

1. `spike disposability milestone gate (task 1.6) > the spike-to-production decision record is Accepted`
2. `package test migration inventory > engine-neutral retained runtime import closures avoid retired coupling signals`
3. `package test migration inventory > retired sources are absent and retained sources remain on disk`
4. `surviving test boundary guard > surviving tests and checks avoid retired core subpaths and workspace aliases`
5. unnamed duplicate Happy DOM registration

The capture does not identify two additional distinct failure names. This record therefore preserves the reported count of seven while listing only the five names actually printed; it does not invent labels for the remaining two.

The two reported error sources were:

1. `packages/core/spike/e2e/poc-finish-line.spec.ts`: duplicate `@playwright/test` loading.
2. `packages/react/src/components/DocxEditor/hooks/useControllableBoolean.test.tsx`: duplicate Happy DOM global registration.

The parity, API, and i18n commands had been chained after `bun test` and therefore did not run when the test command failed. This is not a clean baseline. Independent results run while preparing this change must be recorded separately and must not rewrite the test result above.

## Baseline policy

Implementation may not claim completion by treating these failures as expected success. Each verification run must distinguish pre-existing failures from new regressions, and the infrastructure failures must be repaired or explicitly blocked before the production acceptance gate can pass.

## Verification pass after section 9 (tasks 12.1–12.4)

Run at the completion of the incremental-layout section. Reported as measured, including the
one gate that still fails.

- `bun test`: **2666 pass, 0 fail** across 248 files. The baseline above recorded 2265 pass;
  the growth is this change's own tests, and the failure count has stayed at zero.
- Focused suites (task 12.1), each run on its own: `engine-core` 701, `engine-binding` 253,
  `engine-layout` 350, `engine-output` 27, `engine-editor` 608 — all passing.
- `bun run typecheck`: passed.
- `bun run api:check`: passed, 0 errors. `@docx-editor.dev/agents` remains skipped with its
  printed reason.
- `bun run i18n:validate`: passed, 726 keys in sync across every locale.
- `openspec validate typed-ooxml-paragraph-editor --strict`: valid.
- `bun run check:parity`: **fails, and NOT only for the reason recorded above.** It now stops
  at the FIRST step, `check:export-parity`, on named-export drift introduced by the paginated
  hosts (`PaginatedDocxEditorShell`, `PaginatedDocxEditorHandle`, `PaginatedDocxEditorProps`,
  `PaginatedDocxEditorShellProps` React-only; `PaginatedDocxEditorExpose` Vue-only) — so it
  never reaches `check:public-docs-surface` at all. Recording it as the accepted docs-surface
  failure laundered a fresh gate failure under an old one, which is the exact thing this
  section exists to prevent. The Vue shell and the export-parity entries are task 11.3 work.
  The docs-surface failure below is still real and still deferred — the published docs describe the retired adapter surface the
  greenfield migration removed. Task 11.4 forbids updating those claims before paired
  acceptance, so this stays failing and reported rather than silenced.
