# M4 verification log

Milestone: **M4 — polished retired shell port (React)**
Recorded: 2026-07-25. Branch `spec/greenfield-pipeline`.

| Task | Commit |
| --- | --- |
| M4.0 | `checkpoint-e2a1c81d` |
| capsule render fix | `checkpoint-c483b2d5` |
| M4.1 | `checkpoint-aa24316f` |
| M4.2–M4.6 | `checkpoint-78c75dee` |
| M4.7 | `checkpoint-587e792f` |

## Gate command

```bash
bun run test:e2e:react-one-surface-interaction
```

**Result: pass — 11 passed.** Expected: all scenarios pass.

This is the M4 standing constraint and the reason the gate is the M3 spec
unchanged: chrome that breaks click-to-caret is a failed port however good it
looks. All eleven scenarios — click-to-caret, type/backspace, shift-click,
double-click, drag, keyboard navigation, margin refusal, clipboard paste, IME
composition, undo/redo, save/reopen — pass **through the shell**.

## Supporting runs

| Check | Result |
| --- | --- |
| `bun test packages/react/test` | 25 pass, 0 fail |
| `bun test packages/engine-editor/test` | 0 fail |
| `bun test` across engine packages | 1110 pass, 1 fail (pre-existing `a11y-harness-vite-exports` vite spawn) |
| `packages/react` typecheck | Pass |
| `packages/engine-binding` typecheck | Pass |
| `packages/engine-layout` typecheck | Pass |
| `bun run check:adapter-css-thin` | Pass — all shell CSS landed in the core stylesheet |
| `bun run typecheck` | Fail — unchanged pre-existing `@docx-editor.dev/nuxt` TS5097 |

## Manual Chrome evidence (feeds M4-R2)

Against `http://localhost:5273/?realAdapter=1` with the shell mounted:

| Check | Result |
| --- | --- |
| Shell renders title bar, toolbar, both rulers, page indicator slot | Pass — testids `docx-editor-shell`, `document-title-bar`, `docx-editor-toolbar`, `horizontal-ruler`, `vertical-ruler` |
| Toolbar enabled state comes from `Editor.can` | Pass — bold/italic/undo/redo/save enabled |
| Unsupported control disabled with the engine's reason | Pass — underline disabled, tooltip is the engine's own sentence about `w:u` carrying a style |
| Toolbar click runs `Editor.exec` | Pass — Bold on a dragged word took model revision 0 → 1 and repainted `Edit` bold |
| Save uses `Editor.save()` | Pass — wired directly, not through can/exec |
| Rulers are display-only | Pass — inch ticks from `getPageGeometry()`, no handles, `pointer-events: none` |
| Page sheet and backdrop | Pass — white sheet with shadow on the app background |

## Defect found and fixed during M4

**Bold was not visible after reopening a saved document.** First characterized as
save data loss; that was wrong and is corrected in the record. Inflating
`word/document.xml` from the editor's own `save()` output showed
`<w:rPr><w:b/></w:rPr>` intact — the bytes were always correct.

The real cause: the live session parses with `{ preserveAll: true }`, so on
reopen `<w:b/>` lands in an `rPrCapsule` rather than `props.bold`, and
`paragraph-layout.ts` only ever read `props`. Every *preserved* run therefore
painted unstyled — which affected any reopened document, not just edited ones,
and predates this milestone. Fixed in `engine-layout` (`checkpoint-c483b2d5`) with a
bounded capsule reader that respects an explicit-off `w:val` and never lets
`w:bCs` satisfy `w:b`.

## Gate status

| M4-R1 requirement | Status |
| --- | --- |
| `test:e2e:react-one-surface-interaction` all pass | **Pass — 11/11** |
