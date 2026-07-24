# M0 authority review (task M0-R2)

Recorded: 2026-07-24. Evidence-only re-check of task **1.4**; no broad verification rerun.

## Progress ledger

| Snapshot | Count | Notes |
| --- | --- | --- |
| M0 historical (tasks **1–4**) | **28** | Sections 1–4 implementation complete |
| Pre-**5.5** current (adds **5.1–5.4**) | **32** | Interaction controller through pointer-drag selection |
| Post-**5.5** (commit **`checkpoint-a7763cfb`**, 33rd task) | **33 / 114** | Engine-side keyboard navigation landed |
| After **M0-R1** | **34 / 114** | Baseline verification recorded |
| After **M0-R2** (this artifact) | **35 / 114** | Authority/import re-check recorded |

### Stale M0-R2 wording vs authoritative state

When task **M0-R2** was authored, its checkbox text assumed task **5.5** remained
unchecked. **5.5** subsequently completed as the **33rd** counted task in commit
**`checkpoint-a7763cfb`** (`feat(engine-editor): add geometry-owned keyboard navigation`).
This review records authority boundaries only; it does not re-open **5.5**.

## Task 1.4 verification

**Command:**

```bash
bun test ./packages/engine-core/test/adapter-authority.test.ts
```

**Result (2026-07-24):** **14 pass, 0 fail** (34 `expect()` calls, exit 0).

The test file is `packages/engine-core/test/adapter-authority.test.ts`. It scans
production adapter sources under `packages/react/src` and `packages/vue/src` plus
each adapter `package.json`.

### Assertions exercised (both adapters)

| Check | Scope |
| --- | --- |
| No ProseMirror or private geometry package imports | All `.ts`/`.tsx`/`.vue` sources |
| No document-geometry derivation or facade bypass in executable code | Forbidden tokens: `EditorView`, `ProseMirror`, `prosemirror` imports, `mountDocxEditor`, `docxEditorSession`, `resolveDomPosition`, local `hitTest`/`getCaretRect`/`getSelectionRects`/`getPageGeometry`/`layoutBlocks`/`measureParagraph` |
| Public facade wiring present | `createEditor` from `@docx-editor.dev/engine-editor` and `EditorHost` from `@docx-editor.dev/core-contract/editor` |
| `package.json` dependency hygiene | No `prosemirror-*`, `@docx-editor.dev/engine-binding`, `engine-layout`, or `engine-output`; only allowed engine deps `@docx-editor.dev/core-contract` and `@docx-editor.dev/engine-editor` |

Comment-only mentions of forbidden symbols are ignored (fixture-covered).

## Production adapter import audit (manual cross-check)

Scanned sources (8 files total):

| Package | Source files |
| --- | --- |
| `@docx-editor.dev/react` | `DocxEditor.tsx`, `paintDisplay.tsx`, `types.ts`, `index.ts` |
| `@docx-editor.dev/vue` | `DocxEditor.ts`, `paintDisplay.ts`, `types.ts`, `index.ts` |

### Allowed external imports observed

Both adapters import only:

- Framework: `react` / `vue`
- `@docx-editor.dev/core-contract/editor` (`Editor`, `EditorHost`, document types)
- `@docx-editor.dev/core-contract/geometry` (`DisplayPage`, `DisplayItem` types for paint)
- `@docx-editor.dev/engine-editor` (`createEditor`, `measureInteractionHostMetrics`, paint helpers `runStyle`/`colorToCss`/`borderSegLine`)

### Forbidden imports not found

- No `prosemirror-*` packages
- No `@docx-editor.dev/engine-binding`, `engine-layout`, or `engine-output`
- No `examples/shared` orchestration imports
- No retired authority modules: `PagedEditor`, `OffscreenEditorHost`, `useLayoutPipeline`, `usePagesPointer`

Hosts construct `Editor` via `createEditor({ host, ... })` and supply DOM handles through
`EditorHost`; they paint engine-emitted `DisplayPage[]` and do not implement hit testing,
caret geometry, or selection geometry locally.

### `package.json` dependencies

Both adapters declare only `@docx-editor.dev/core-contract` and
`@docx-editor.dev/engine-editor` under `devDependencies` (plus framework peers and
build tooling). No forbidden ProseMirror or private engine packages.

## Allowed claims after M0-R2

- Task **1.4** authority/import guard remains green on current production adapters
- Adapters remain thin `Editor`/`EditorHost` hosts without ProseMirror or private
  geometry authority (consistent with design **D1**, **D2**, spec "Canonical and
  geometry authority separation")

**Not allowed:** upgrading to `interactive-paginated`, feature-WYSIWYG, or direct
painted-page interaction claims (M3+ / **8.10** gates unchanged).

## Blockers

None for M0-R2. M0 review is complete; **M1** (**5.6a**, **5.7a**, **M1-R1**,
**M1-R2**) is next.
