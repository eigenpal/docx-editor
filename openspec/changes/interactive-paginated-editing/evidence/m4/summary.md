# M4 summary (task M4-R3)

Recorded: 2026-07-25. Milestone **M4 — polished retired shell port (React)**.

## Progress ledger

| Snapshot | Count |
| --- | --- |
| After **M3-R2** | **51 / 114** |
| After **M4.0** (`checkpoint-e2a1c81d`) | **52 / 114** |
| After **M4.1** (`checkpoint-aa24316f`) | **53 / 114** |
| After **M4.2–M4.6** (`checkpoint-78c75dee`) | **58 / 114** |
| After **M4.7** (`checkpoint-587e792f`) | **59 / 114** |
| After **M4-R1** (`checkpoint-a12eaf36`) | **60 / 114** |
| After **M4-R2** (`checkpoint-f38c1e1c`) | **61 / 114** |

## What M4 landed

A polished shell around the working editor: title chrome, a toolbar wired
`can` → `exec`, display-only rulers, a page indicator, a sidebar frame, and a
page backdrop — with the M3 interaction flow intact through all of it.

The substance is in what did **not** come across. The retired toolbar read
`undoDepth`/`redoDepth` off a ProseMirror `EditorState`; the retired rulers took
eight margin, indent, and tab mutation callbacks plus `SectionProperties`. Both
are re-expressions, not ports: toolbar state is one `Editor.can(command)`
answer, rulers read `Editor.getPageGeometry()` and render no handles at all.

`M4.0` also had to land the engine command path, because `Editor.can`/`exec`
supported only `setSelection` before it.

## Defects found and fixed during M4

| # | Defect | Severity | Status |
| --- | --- | --- | --- |
| 1 | Preserved runs painted unstyled on reopen — layout read only `props`, never `rPrCapsule` | **High** (every reopened document, predates M4) | Fixed `checkpoint-c483b2d5` |
| 2 | Shell chrome read engine state during render without subscribing, so the toolbar kept its first `can()` answer as the selection moved and the rulers kept the first document's page size after a load | **Medium** | Fixed — `useEditorSnapshot` |

Defect 1 was first characterized as save data loss. That was **wrong** and the
record is corrected: inflating `word/document.xml` from the editor's own
`save()` output showed `<w:rPr><w:b/></w:rPr>` intact. The bytes were always
correct; only the rendering was not.

## Architecture self-review

| Rule | Result |
| --- | --- |
| No `PagedEditor`, `OffscreenEditorHost`, `useLayoutPipeline`, `usePagesPointer` in adapters | **Pass** — only prose comments naming what was not implemented |
| No ProseMirror import in adapters | **Pass** |
| No adapter-side geometry derivation (`getBoundingClientRect`, `elementFromPoint`, `caretRangeFromPoint`) | **Pass** — zero hits in `packages/react/src` and `packages/vue/src` |
| Adapters use public `Editor`/`EditorHost` only | **Pass** |
| Toolbar calls `can` before `exec` | **Pass** — verified live by wrapping `editor.exec` and counting |
| Save calls `Editor.save()` | **Pass** — verified live by wrapping `editor.save` |
| Rulers display-only | **Pass** — `pointer-events: none`, zero handles |
| Unsupported controls disabled or hidden, never faked | **Pass** — underline disabled with the engine's own reason |
| Adapter CSS import-only | **Pass** — all shell CSS in the core stylesheet |
| `adapter-authority.test.ts` | **Pass** — 14/14 |

## M4-R3 gate status — NOT COMPLETE

M4-R3 requires an **independent review with no open Blocker/High**. The review
above is a **self-review**, which is not independent, so **M4-R3 is left
unchecked**. Marking it complete would be a false completion claim: the whole
point of an independent gate is that the author does not sign it.

What an independent reviewer should look at first:

1. `useEditorSnapshot` re-renders shell chrome on every `change`, `selectionChange`,
   and `display` event. That is correct but unthrottled; under sustained typing
   it re-renders the toolbar per keystroke. No measured problem, but it is the
   most likely performance complaint.
2. The `runEditCommand` dry-run path in `edit-surface.ts` runs the real
   ProseMirror command with no dispatch to answer `can()`. That is the standard
   PM idiom and cannot mutate, but it is worth a second pair of eyes.
3. The underline decision (M4.0): wired but refused, because `w:u` carries a
   style and `RunProps.underline` is a boolean. A reviewer may reasonably want
   underline modeled as a style instead, which is a `document-engine`
   lossless-package-model change.

## Claim allowed after M4

**Internal React alpha with shell** — and only once M4-R3 is signed by someone
other than the author. Not public `interactive-paginated`, which remains **8.10**.

## Carried into M5

- `bun run check:parity-contract` fails on the stale untracked Vue API snapshot.
  It **is** in the M5-R1 bundle and must clear before M5 passes.
- Vue has no one-surface wiring, no shell, and does not stamp the click-target
  attribute. That is 6.3 / M5.1 / M5.2.
- `bun run typecheck` still fails only in `@docx-editor.dev/nuxt` (TS5097).
- Cosmetic, carried from M3: per-cluster selection gaps, no undo coalescing.
