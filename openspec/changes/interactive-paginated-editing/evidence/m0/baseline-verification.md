# M0 baseline verification (task M0-R1)

Recorded: 2026-07-24. Evidence-only reconciliation; no broad verification rerun.

## Progress ledger

| Snapshot | Count | Notes |
| --- | --- | --- |
| M0 historical (tasks **1–4**) | **28** | Sections 1–4 implementation complete |
| Pre-**5.5** current (adds **5.1–5.4**) | **32** | Interaction controller through pointer-drag selection |
| Post-**5.5** authoritative (openspec apply) | **33 / 114** | Task **5.5** landed as the 33rd counted checkbox |
| After **M0-R1** (this artifact) | **34 / 114** | M0 review gate **M0-R1** marked complete |

### Task 5.5 completion (subsequent to runbook snapshot)

When `one-surface-execution-plan.md` §2 and the top ledger in `tasks.md` were
authored, task **5.5** was still in progress and progress read **32 / 114**.
**5.5** subsequently completed as the **33rd** counted task in commit
**`checkpoint-a7763cfb`** (`feat(engine-editor): add geometry-owned keyboard navigation`).
It is **not** in progress.

Deliverables named in task **5.5** (`keyboard-navigation.ts`, `navigation-session.ts`,
`navigation-stops.ts`, `navigation-geometry.ts`, `line-catalog.ts`, and their unit
tests) are present in that commit. Paginated-surface browser automation for
keyboard navigation remains **not claimed** until M3+ (see browser matrix).

## M0 scope verification (tasks 1–4)

All **28** M0 implementation checkboxes remain checked:

| Section | Tasks | Status |
| --- | --- | --- |
| 1. Authority, status, conformance vocabulary | 1.1–1.5 | complete |
| 2. Interaction contracts and immutable frames | 2.1–2.6 | complete |
| 3. Semantic positions, clusters, and geometry | 3.1–3.9 | complete |
| 4. Hidden input-host falsification gate | 4.1–4.8 | complete |

M0 review tasks **M0-R2** (authority/import re-check) remain open.

## Cross-check: `input-host-prototype-evidence.md`

| Claim in input-host evidence | Baseline alignment |
| --- | --- |
| Hidden input-host mechanism **approved** on Desktop Chromium (task **4.8**, 2026-07-24) | Consistent — M0 §4 deliverable |
| Technique: fixed-position clip shell, opacity-hidden, pointer-transparent, caret-near placement | Consistent with design **D8** |
| Does **not** approve direct painted-page interaction, `interactive-paginated`, feature-WYSIWYG, real CJK IME, mobile, Firefox, WebKit | Consistent — M0 approves mechanism only |
| Recorded gates: `verify:real-adapter-gate` 12/12, `verify:real-adapter-smoke` 2/2, `verify:a11y-tree` 9/9 | Consistent with `browser-platform-matrix.md` required CI rows |
| Deferral: mid-paragraph-start insert caret on painted surface | Consistent — not an M0 claim |

**Contradictions:** none requiring artifact edits.

## Cross-check: `browser-platform-matrix.md`

| Claim in browser matrix | Baseline alignment |
| --- | --- |
| Frozen for task **1.5** | Consistent with M0 §1 |
| Required CI: `verify:real-adapter-smoke`, `verify:real-adapter-gate`, `verify:a11y-tree` on Desktop Chromium | Consistent with task **4.8** evidence |
| Task **4.8** approves hidden input-host only; not direct painted-page interaction | Consistent with input-host evidence |
| M3–M6 internal/preview alpha only; first formal public `interactive-paginated` at **8.10** | Consistent with proposal/design/tasks milestone map |
| Keyboard navigation on paginated surface: **Not automated** | Consistent — task **5.5** is engine-side; adapter one-surface proof is M3+ |
| Diagnostic `?edit=1` smoke is non-interactive-paginated evidence | Consistent |

**Contradictions:** none requiring artifact edits.

## Allowed claims after M0-R1

- Hidden input-host mechanism on Desktop Chromium (already approved at **4.8**)
- M0 baseline contracts and geometry/index work (tasks **1–4**)
- Engine-side keyboard navigation implementation (task **5.5**, commit **`checkpoint-a7763cfb`**)

**Not allowed:** `interactive-paginated`, feature-WYSIWYG, direct painted-page
pointer/keyboard interaction, or upgrade of public manifests (M3–M6 / **8.10**
gates unchanged).

## Blockers

None for M0-R1. **M0-R2** remains the next M0 review gate.
