---
'@eigenpal/docx-editor-react': patch
---

Internal refactor: continue the DocxEditor.tsx cap effort. Extract the 432-LOC useImperativeHandle block into a useDocxEditorRefApi hook (preserves the dep array byte-for-byte so the editor-contract gate stays green). Pull the floating-overlay block (hyperlink popup, text + image context menus, toast container) into DocxEditorOverlays. Pull the lazy-loaded Suspense dialog block into DocxEditorDialogs — the lazy() import sites move with the JSX so the dialog code-split chunk is owned by the new component. Memoize the 60-line onSelectionChange closure on the PagedEditor mount. DocxEditor.tsx now 3724 → 3183 LOC. No public API change.
