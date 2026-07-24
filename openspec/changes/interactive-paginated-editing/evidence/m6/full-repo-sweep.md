# Full-repository sweep (M6 handoff)

Recorded: 2026-07-25 at `checkpoint-cb228b0a`. Run because this session landed 41 commits
while mostly exercising targeted suites; a reviewer's first question is whether
anything else in the repo regressed.

## Result: no regressions from this session's work

```bash
bun test
```

**1814 pass, 6 fail, 2 errors, 212000 expect() calls across 186 files.**

Every failure is pre-existing. Each was re-run at **`checkpoint-90e74c0a`** — this
session's starting commit, before any of its work — and fails identically there:

| Failure | Pre-existing at `checkpoint-90e74c0a`? |
| --- | --- |
| `a11y harness vite workspace exports` | Yes — vite child process spawn, recorded since M2 |
| `package test migration inventory` (2 tests) | Yes — 8 pass / 2 fail at session start |
| `surviving test boundary guard` (1 test) | Yes — 4 pass / 1 fail at session start |
| 2 errors | Playwright specs picked up by the bun runner from `packages/core/spike/node_modules` — a harness artifact, not a product failure |

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
helpers. **Named-export parity: 47 names match.** The paired interaction gate is
still 7/7 after the change.

This is the argument for running the whole suite before handing off: eleven
targeted suites and six browser gates were all green while the two published
package surfaces had silently diverged.

## Repo-wide check status

| Check | Result | Note |
| --- | --- | --- |
| `bun test` | 1814 pass / 6 fail | all failures pre-existing |
| `check:export-parity` | **Pass — 47 names match** | fixed this session |
| `check:parity-contract` | **Pass** | gate repaired at M5-R1; it had been measuring a pre-greenfield surface |
| `check:adapter-css-thin` | Pass | gate repaired at 6.1; it had been failing on a missing file |
| `check:editor-contract` | **Pass — repaired** | had been throwing ENOENT on `packages/react/src/components/DocxEditor.tsx`, a path the strip deleted. Repointed at the greenfield types; allowlists reset from ~18 retired props to the three real divergences. |
| `check:public-docs-surface` | **Fail — pre-existing** | docs-site surface lists plugin symbols (`PluginHost`, `EditorPlugin`, `templatePlugin`, …) that no longer exist. Fails identically at `checkpoint-90e74c0a`; outside this change. |
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

`check:public-docs-surface` remains, and belongs to whoever owns the docs-site
surface.

## Preserved work untouched

`packages/engine-core/src/package/docx/read.ts` and
`packages/engine-core/src/package/preservation-capsule.ts` remain modified and
unstaged; `docs/api/docx-editor-react/*` and `docs/api/docx-editor-vue/*` remain
untracked. None was staged in any of this session's 41 commits.
