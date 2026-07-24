# M5 summary (task M5-R2)

Recorded: 2026-07-25. Milestone **M5 — Vue one-surface wiring and shell**.

## Progress ledger

| Snapshot | Count |
| --- | --- |
| After **M4-R2** | **61 / 114** |
| After **6.3** (`checkpoint-50f6f445`) | **62 / 114** |
| After **M5.1** (`checkpoint-f196491e`) | **63 / 114** |
| After **M5.2** (`checkpoint-3c59b526`) | **64 / 114** |
| After **M5-R1** (`checkpoint-a5412cf4`) | **65 / 114** |
| After **M5-R2** (this artifact) | **66 / 114** |

## Both adapters are now editable

Clicking a painted glyph places the caret at that glyph, typing updates the
canonical model, and pages repaint with a visible caret and selection — in
**React and Vue**. Each proven by its own 11-scenario Playwright suite driven by
real CDP input, neither of which places a caret programmatically.

## The parity result worth stating

**All 11 Vue scenarios passed on the first run.** No Vue-specific debugging was
needed, because Vue consumes the same event bridge, the same overlay geometry,
and the same click target as React. The two bugs M3 found the hard way —
`pointermove` reporting `button: -1`, and the click that concludes a drag
collapsing the range — were fixed once in shared code and Vue never had them.

That is the payoff of M2 having put the bridge, overlays, and click target in the
engine instead of in the React adapter. M5.1 extended the same rule to ruler tick
geometry and the toolbar can/exec wiring, which had been sitting in
`packages/react`: both are platform-agnostic, so both moved into `engine-editor`
with React keeping thin re-export shims.

## What M5 landed

| Task | Deliverable |
| --- | --- |
| 6.3 | Vue host wired to the shared controller: bridge, overlays, click target, `ep-root` scoping, metrics from the pages stack |
| M5.1 | Vue shell — frame, title chrome, page indicator, display-only rulers, can/exec toolbar — same class names and testids as React |
| M5.2 | Vue interaction spec, deliberately parallel to React's |

Two implementation notes recorded rather than glossed:

- The Vue shell is `defineComponent` render functions, **not** `.vue` SFCs. This
  package is SFC-free and typechecks with plain `tsc`; an SFC would need
  `vue-tsc` or a module shim that erases prop types. The M5.1 manifest named
  `.vue` files and the row records the substitution.
- The Vue demo had **never imported the core stylesheet**. It had no `--doc-*`
  tokens at all, so caret, selection, and page background painted transparent and
  the page stack spanned the viewport instead of hugging its page.

## Defects found by the M5 gates

| # | Defect | Severity |
| --- | --- | --- |
| 1 | The input host stopped following the caret on scroll — a 48px drift, taking browser IME and autofill UI with it | **High** |
| 2 | `check:parity-contract` was measuring a pre-greenfield surface and had been failing since the strip; its extractor also could not see method-style ref members at all | **High** (a gate that cannot fail is not a gate) |
| 3 | The Vue demo never loaded the core stylesheet | Medium |

Defect 1 is the more interesting one: the gate had been passing **vacuously**.
Before the M4 shell, the harness wrapped the editor in its own scrolling div, so
the test's `scrollTop` assignment moved nothing and the assertion compared two
unchanged rectangles. Adding real chrome made the element genuinely scrollable
and turned a green check into a red one that had always been wrong.

## Gate status

| M5 requirement | Status |
| --- | --- |
| Vue interaction suite passes | **Pass — 11/11** |
| React suite still passes | **Pass — 11/11** |
| `verify:real-adapter-smoke` / `gate` | **Pass — 2/2, 12/12** |
| `check:parity-contract` | **Pass** |
| Adapter CSS import-only | **Pass** |
| `bun run typecheck` | Fail — pre-existing `@docx-editor.dev/nuxt` TS5097 |

## Claim allowed after M5

**None** — M5 is explicitly "pre-paired preview" in the milestone map. The paired
bounded-document internal/preview alpha is **M6**, and public
`interactive-paginated` remains task **8.10**.

## Carried into M6

- **M4-R3 is still unchecked.** It requires an independent review with no open
  Blocker/High; the M4 review on file is the author's own. M6 should not be
  signed off while that gate is open.
- Task 6.6 switches both root URLs to the one-surface editor and drops the
  `?realAdapter=1` query. Both adapters can now support that.
- Cosmetic, carried from M3: per-cluster selection gaps, no undo coalescing.
- `docs/api/docx-editor-{react,vue}/index.api.md` remain untracked and on the
  preserve-list; both extract from a stale `dist` and need their own rebuild step.
