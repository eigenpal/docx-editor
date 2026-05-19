---
'@eigenpal/docx-editor-react': patch
'@eigenpal/docx-editor-vue': patch
---

API Extractor snapshots for the 6 published subpaths of `@eigenpal/docx-editor-react` (root, `/ui`, `/hooks`, `/dialogs`, `/plugin-api`, `/styles`) and `@eigenpal/docx-editor-vue` (root, `/ui`, `/composables`, `/dialogs`, `/plugin-api`, `/styles`). CI now fails on undocumented public-surface drift via `bun run api:check`.

Adds `etc/parity.contract.json` — the cross-adapter parity contract listing which `DocxEditorProps` fields and `DocxEditorRef` members are paired between React and Vue, which are deliberately deferred in Vue, and which are Vue-exclusive. `bun run check:parity-contract` (also gated in CI) parses both snapshots and fails on any drift the contract doesn't acknowledge. Adding a new prop or ref method to either adapter forces an explicit classification in the contract.

Vue composables now declare named `Use*Return` interfaces (`UseClipboardReturn`, `UseFindReplaceReturn`, `UseSelectionHighlightReturn`, `UseTableSelectionReturn`, `UseHistoryReturn`, `UseTableResizeReturn`, `UseDragAutoScrollReturn`, `UseVisualLineNavigationReturn`, `UseDocxEditorReturn`). Before this change the composables returned anonymous object literals that recursively expanded core's internal types in the published `.d.ts`, inflating `etc/composables.api.md` to 3,526 lines and locking core's internal `Run`/`Comment` shape into Vue's public contract. Named returns drop the snapshot to ~450 lines and decouple Vue's surface from core's internals.

Vue's `useTableSelection` no longer exposes `manager: TableSelectionManager` in its return — it was unused by any internal consumer and leaked core's `TableSelectionManager` class as part of Vue's public surface.

Side effect for `@eigenpal/docx-editor-vue`: the build no longer writes workspace-relative source paths (e.g. `../../core/src/core.ts`) into published declarations. Those paths were valid in this repo but unresolvable once installed from npm; setting `pathsToAliases: false` on the dts plugin keeps the package names (`@eigenpal/docx-editor-core`, `@eigenpal/docx-editor-i18n`) intact in `dist/*.d.ts`.

No runtime change for either package.
