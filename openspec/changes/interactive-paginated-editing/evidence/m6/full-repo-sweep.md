# Full-repository sweep (M6 handoff)

Re-run at **`checkpoint-fd4db029`** (2026-07-25), after the round-3 review fixes.

> **This file was previously wrong, and the correction matters.** It recorded
> "1814 pass, 6 fail — no regressions from this session's work" measured at
> `checkpoint-cb228b0a`, then went untouched through fourteen further commits, six of which
> changed product code. One of those (`checkpoint-5d739a2a`) fixed a caret/focus regression
> *introduced in-session* by `checkpoint-0e9e41bf`, so the "no regressions" conclusion was
> falsified after it was written and the sweep was never re-run; a later commit
> edited this file and left `1814` in place. Caught by the round-3 evidence audit.
> Numbers below are valid only for the commit named above.

## Result at `checkpoint-fd4db029`

```bash
bun test
```

**1853 pass, 5 fail, 2 errors, 212,107 expect() calls across 189 files (56.4s).**

Named failures, all in `packages/core/spike/tests/**`, all pre-existing:

| Failure | File | Pre-existing at `checkpoint-90e74c0a`? |
| --- | --- | --- |
| `package test migration inventory` — retired sources absent / retained on disk | `migration-inventory.test.ts` | Yes |
| `package test migration inventory` — engine-neutral import closures | same | Yes |
| `surviving test boundary guard` — retired core subpaths / workspace aliases | `test-boundary-guard.test.ts` | Yes |
| 2 errors | Playwright specs the bun runner globs up | Yes — harness artifact, not a product failure |

Independent audit re-ran the baseline in a throwaway clone and confirmed the same
failure set at `checkpoint-90e74c0a` (1716 pass / 6 fail / 2 errors there).

### Why the count moved from 6 fail to 5

`a11y harness vite workspace exports` was previously counted as a failure. It is
**not** a code failure: the test spawns its own vite dev server on the fixed port
**5299**, and leftover *detached* harness servers from earlier gate runs were still
holding it, so every later run died with "harness child exited before ready
(signal)". Clearing the leftover listener makes it pass (`"ok": true`, probe
`resolveDefaultWordBoundary`, phases fresh + cached).

Worth recording as a hazard, not a footnote: the failure looks exactly like a
regression, two independent reviewers each correctly guessed "environmental"
without being able to confirm it, and the real cause was process hygiene.
**Check `lsof -ti:5299` before believing that test's verdict.** Same hazard on
5273/5274.

## One real regression, found and fixed

```bash
bun run check:export-parity
```

Reported **24 react-only exports**. The M4 shell and M5.1 port had added
component prop types, a sidebar, and re-exports of the shared toolbar and ruler
helpers to **React only** — precisely the adapter drift the repo rule exists to
prevent, and invisible to every suite that had been passing.

Fixed at `checkpoint-cb228b0a`: Vue declares named prop interfaces for every shell
component, gains the sidebar counterpart, and re-exports the same shared engine
helpers. **Named-export parity: 47 names match** — independently reproduced, and
the baseline was 15, so the drift really was introduced and fixed inside this
change. The paired interaction gate is 14/14 at `checkpoint-fd4db029`.

This is the argument for running the whole suite before handing off: eleven
targeted suites and six browser gates were all green while the two published
package surfaces had silently diverged.

## Repo-wide check status

| Check | Result | Note |
| --- | --- | --- |
| `bun test` | 1853 pass / 5 fail | all failures pre-existing (see above) |
| `check:export-parity` | **Pass — 47 names match** | fixed this session |
| `check:parity-contract` | **Pass** | gate repaired at M5-R1; it had been measuring a pre-greenfield surface |
| `check:adapter-css-thin` | Pass | gate repaired at 6.1; it had been failing on a missing file |
| `check:editor-contract` | **Pass — repaired** | had been throwing ENOENT on `packages/react/src/components/DocxEditor.tsx`, a path the strip deleted. Repointed at the greenfield types; allowlists reset from ~18 retired props to the three real divergences. |
| `check:public-docs-surface` | **Fail — pre-existing, and NOT a stale-path bug** | see below |
| `api:check` (react, vue) | **Pass — after rebuild + re-extract** | Named by M4.0 and by the matrix, this was never run during the milestone and was FAILING (`API surface drift in 1 entry` for react). It also could not have measured anything useful: the extractor reads `dist`, which was a build predating this change, so it compared stale to stale. Both packages rebuilt, both snapshots re-extracted, and each now contains this change's new exports. Found by independent evidence audit. |
| `bun run typecheck` | Fail — pre-existing | `@docx-editor.dev/nuxt` TS5097 only; every package this change touched typechecks clean |
| `openspec validate --strict` | Pass | |

**Four** separate CI gates in this repo were left pointing at paths or shapes the
greenfield strip `checkpoint-701c1a9f` removed: `check:adapter-css-thin` aborted on a
missing file, `check:parity-contract` measured a package surface that no longer
exists, `check:editor-contract` threw ENOENT on a deleted path, and
`check:public-docs-surface` still lists removed plugin symbols.

Three are now repaired and measuring real invariants again. Each repair was
verified to still FAIL on real drift, not merely to pass — `check:editor-contract`
was confirmed by injecting a Vue-only prop and watching it reject. A gate that
cannot fail is worse than no gate, because it reads as coverage.

`check:public-docs-surface` remains, and is a **different kind of failure** —
worth stating precisely rather than lumping in with the other three.

The other three read paths or shapes that no longer exist: broken plumbing,
repairable without any product decision. This one reports that the greenfield
packages do not export a surface the public docs still promise:

- `renderAsync`, `DocxEditorHandle`, `RenderAsyncOptions` — missing from **both** adapters
- `EditorToolbar`, `Toolbar`, `ColorPicker`, `FontOption` — the documented React customization surface
- `PluginHost`, `EditorPlugin`, `PluginPanelProps`, `RenderedDomContext`, `templatePlugin` — the documented plugin API

That is an accurate signal, not a broken check. Clearing it means either
reimplementing those surfaces on the greenfield packages or amending what the
docs promise — a product decision about the published contract, and squarely
outside this change. Two of those groups are retired authority the architecture
rules forbid restoring here at all.

Fails identically at `checkpoint-90e74c0a`.

## Preserved work untouched

`packages/engine-core/src/package/docx/read.ts` and
`packages/engine-core/src/package/preservation-capsule.ts` remain modified and
unstaged; `docs/api/docx-editor-react/*` and `docs/api/docx-editor-vue/*` remain
untracked. None was staged in any commit of this change; independently verified across the
whole range by the round-3 evidence audit.

## Browser gates at `checkpoint-fd4db029`

| Gate | Result |
| --- | --- |
| `verify:real-adapter-smoke` | 2/2 |
| `verify:real-adapter-gate` | 12/12 |
| `test:e2e:paired-one-surface-interaction` | 14/14 |
