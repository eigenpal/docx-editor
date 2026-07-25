# M1 verification log

Milestone: **M1 — finish 5.5 + body-paragraph 5.6a + synchronous stale 5.7a**
Branch: `spec/greenfield-pipeline`
Commits under test:

| Task | Commit |
| --- | --- |
| 5.5 | `checkpoint-a7763cfb` |
| M0-R1 | `checkpoint-96d885be` |
| M0-R2 | `checkpoint-90e74c0a` |
| 5.6a | `checkpoint-aef0c191` |
| 5.7a | `checkpoint-c2e4721a` |

## 1. Task test bundle

```bash
bun test packages/engine-editor/test/keyboard-navigation.test.ts \
  packages/engine-editor/test/navigation-session.test.ts \
  packages/engine-editor/test/navigation-production.test.ts \
  packages/engine-editor/test/line-catalog.test.ts \
  packages/engine-editor/test/interaction-planner.test.ts \
  packages/engine-core/test/adapter-authority.test.ts
```

**Result: pass — 82 pass, 0 fail, 268 expect() calls across 6 files.**

Wider runs taken at the same commit:

| Suite | Result |
| --- | --- |
| `bun test packages/engine-editor/test` | 328 pass, 0 fail (37 files) |
| `bun test packages/engine-core` | 495 pass, 0 fail (53 files) |
| `bun test packages/engine-layout` | included in the engine-core/layout run, 0 fail |

## 2. Typecheck

```bash
bun run typecheck
```

**Result: fail — but not from M1 work. The only failing package is
`@docx-editor.dev/nuxt`.**

- `packages/engine-editor` typecheck: **pass** (`tsc --noEmit`, exit 0).
- `packages/engine-server` typecheck: pass.
- `@docx-editor.dev/nuxt`: exits 2 with TS5097 (`An import path can only end
  with a '.ts' extension when 'allowImportingTsExtensions' is enabled`) against
  `packages/engine-binding/src/*` and `packages/engine-layout/src/*`.

Evidence that this predates M1 and is unrelated to it:

- The TS5097 sites span four engine packages, measured at `checkpoint-fd4db029`:
  **163 `engine-core`, 54 `engine-editor`, 31 `engine-binding`, 21
  `engine-layout`**. (This bullet previously asserted "every TS5097 site is in
  `engine-binding` or `engine-layout`", which is false — the conclusion below is
  unaffected, but the evidence offered for it was wrong. Caught by the round-3
  evidence audit, reproduced here.) The M1 commits (`checkpoint-aef0c191`, `checkpoint-c2e4721a`) touch
  only `packages/engine-editor/src/interaction-planner.ts` and three test files,
  so they cannot be the cause of an error class that predates them across all
  four packages.
- `packages/nuxt/tsconfig.json` has not been modified since the `checkpoint-6130fecd`
  repository migration.
- The error class is a tsconfig flag condition affecting every file in those
  packages, including modules untouched by this change
  (`engine-binding/src/accessibility-projection.ts`, `binding.ts`,
  `edit-surface.ts`).

**This is a pre-existing repo-wide condition, recorded here rather than
suppressed. It is not fixed by M1 and must not be claimed as passing.** It is a
prerequisite to clear before any milestone whose gate depends on a whole-repo
typecheck being green.

## 3. Strict OpenSpec validation

```bash
openspec validate interactive-paginated-editing --strict
```

**Result: pass — `Change 'interactive-paginated-editing' is valid`, exit 0.**

## 4. Diff checks

```bash
git diff --check
```

**Result: pass — clean, no whitespace errors.**

Staged-path discipline held for both M1 implementation commits: staged paths
matched the per-task staging manifest exactly, verified with
`git diff --cached --name-only | sort` against the manifest row before each
commit. The 5.7a manifest row was amended in `tasks.md` to name
`interaction-planner.ts` instead of `navigation-session.ts`, because synchronous
target re-resolution belongs beside the other planner preconditions rather than
in the visual-advance sidecar; the substitution is recorded in the row itself.

Unrelated dirty files were preserved and never staged:
`packages/engine-core/src/package/docx/read.ts`,
`packages/engine-core/src/package/preservation-capsule.ts`, untracked
`docs/api/docx-editor-react/*`, untracked `docs/api/docx-editor-vue/*`.

## 5. Gate status

| M1-R1 requirement | Status |
| --- | --- |
| Listed tests pass | Pass |
| Strict validation passes | Pass |
| `git diff --check` clean | Pass |
| `bun run typecheck` | **Fail — pre-existing `@docx-editor.dev/nuxt` TS5097, outside M1 scope** |
