# Baseline evidence

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
