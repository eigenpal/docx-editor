# Baseline evidence

## Re-recorded after the drift repair (106 failures → 0)

The suite had drifted to **106 failures** against the 0 this file records. Nothing hid it:
`.github/workflows/ci.yml` triggers only on `main`, and every one of these landed through a
PR targeting `docx-editor-v2`, so no test job ever ran on any of them. Fixing that trigger
is a separate change; until it lands, the suite has to be run locally before merge.

- `bun test`: **5908 pass, 1 skip, 0 fail** across 387 files.
- `bun run typecheck`: passes for all eight packages.
- `bun run api:check`, `bun run check:parity`, `bun run i18n:validate` (957 keys),
  `openspec validate typed-ooxml-paragraph-editor --strict`: all pass.
- `bun run lint`: 98 problems (43 errors), byte-identical to the count before this repair.
  Pre-existing and untouched here.
- `check:public-docs-surface`, recorded below as deliberately red under task 11.4, now
  passes — the surface it objected to has since been reconciled.
- Note: `bun run build` must have run, or `packages/pro` cannot resolve
  `@docx-editor.dev/react` and three tests fail at module load. `api:check` needs
  `packages/editor-api` built for the same reason.

The one skip is a smoke test over `e2e/fixtures/pr140-shapes-and-page-breaks.docx`, which was
never committed. It now skips on a missing fixture instead of failing, and starts running
again if the document lands.

Two product defects were found and fixed rather than papered over, both invisible because
the tests that would have caught them were failing for an unrelated reason:

1. **Spec-valid pictures vanished.** `pic:blipFill` demanded exactly one of `a:stretch` /
   `a:tile` and `pic:spPr` demanded both `a:xfrm` and `a:prstGeom`. ECMA-376 makes all three
   `minOccurs="0"`, so a conforming picture demoted to `generic` and never rendered.
2. **Empty spaced paragraphs took the whole line box.** Once `auto`/`atLeast` extras moved
   BELOW the glyph band, `leading` correctly became zero — but the caret, the painter and the
   content-control boundary all still derived the band as `box.height - leading`. On a
   double-spaced empty paragraph that is the entire box, so the caret was twice the height of
   the text about to be typed. Layout now publishes `LineRecord.glyphBand` and all three read
   it.

The remaining 104 were test defects, not product defects. The largest group by far: PR #119
(`feat: add rich table editing`) changed `DEFAULT_RUN_STYLE.fontSizePt` from 11 to 10 as an
unrelated one-liner. The change is right — 10pt is Word's terminal fallback when no level of
the style hierarchy authors `w:sz`, and `run-style.test.ts` asserts exactly that — but
`createFixedMeasurer`'s 6pt/14pt base describes an 11pt run, so 51 layout and paint tests
silently began measuring everything at 10/11. They now author `w:sz="22"` (or the
`elevenPointDefaults()` docDefaults) so the expectation is stated rather than inherited.

## Re-recorded at section 13 (Word-accurate pointer interaction)

- `bun test`: **2682 pass, 0 fail, 0 errors**, with section 13 rebased onto the Word-fidelity
  work. 2606 of those predate this section; it adds 76.
- `bun run typecheck`: passed (all packages; `@docx-editor.dev/agents` skips for the reason
  recorded under 11.3).
- `bun run api:check`: passed, 0 errors. Requires the React and Vue packages to be BUILT
  first; a clean checkout reports "No built .d.ts files" until then.
- `bun run i18n:validate`, `bun run check:parity-contract`, `bun run check:adapter-css-thin`:
  passed.
- `openspec validate typed-ooxml-paragraph-editor --strict`: valid.
- `bun run check:parity` still stops at `check:public-docs-surface`, unchanged and for the
  reason recorded under task 11.4.
- Note: `bun install` must have run. Without it the layout lane cannot resolve `harfbuzzjs`
  and the whole font/shaping suite fails at module load, which reads as 27 unrelated failures.

## Earlier baseline (re-recorded after section 3, task 3.3)

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
  The docs-surface failure below is still real and still deferred.
- `bun run check:export-parity`: **now passes.** The paginated hosts export the same names
  from both adapters, and the one genuine gap — no Vue counterpart to the React shell — is
  recorded in `notes/intentional-export-divergence.md` with the reason rather than silenced.
- `bun run check:parity-contract`: fails with 16 issues, all of them LEGACY `DocxEditorRef`
  members (`getZoom`, `print`, `proposeChange`, `replyToComment`, `scrollToPage`, …). None
  are from this change; the contract was last updated before it began. Recorded so the next
  reader does not attribute it here, and so it is not mistaken for the docs-surface failure — the published docs describe the retired adapter surface the
  greenfield migration removed. Task 11.4 forbids updating those claims before paired
  acceptance, so this stays failing and reported rather than silenced.

## Baseline re-record before the retired-lane retirement (task 6.7 / 11.x work)

Run on 2026-07-30 at the start of the "retire the second preservation model" slice,
12 commits after the section-9 record (HEAD `checkpoint-d0755cc6`):

- `bun test`: **2767 pass, 0 fail, 0 skip** across 253 files. Growth from 2666 is the
  perf-work tests landed since; failure count stays zero.
- `bun run typecheck`: passed (all workspaces; `@docx-editor.dev/agents` skipped with its
  printed reason, as before).

Every phase gate of the retirement slice diffs against this record. Skip count is watched
explicitly: fixture-gated suites go silently missing rather than failing when a path breaks.

## After the retired-lane deletion (task 6.7 / 11.1-11.2)

The sweep removed 400+ files: the PackageModel byte-capsule engine, its layout/display
lanes, the retired binding cluster, and the sync/server/clients lanes built on the deleted
model, together with their test suites.

- `bun test`: **1531 pass, 0 fail** across 123 files. The drop from 2827 is the deleted
  retired suites, accounted file-by-file in the sweep record — not silent skips; skip
  count stays zero.
- `bun run typecheck`, `check:lane-boundaries` (now store+layout), `api:check`,
  `check:export-parity`, `check:editor-contract`, `check:parity-contract`,
  `check:adapter-css-thin`, `i18n:validate`: all pass.
- `check:public-docs-surface`: still deliberately red per task 11.4's owner note.
- Capsule vocabulary (`rPrCapsule`/`pPrCapsule`/`pAttrsCapsule`/`blockRanges`): zero
  references in `packages/core/src` outside the guard test's own scan.
