---
'@eigenpal/docx-editor-core': patch
---

Tag three subpath helpers as `@internal` in TSDoc: `managers/TableSelectionManager`, `prosemirror/utils/extractTrackedChanges`, `prosemirror/utils/visualLineNavigation`. The subpaths stay in `package.json` `exports` for back-compat (shipped in v1.0), but the snapshots in `etc/managers-TableSelectionManager.api.md`, `etc/prosemirror-utils-extractTrackedChanges.api.md`, and `etc/prosemirror-utils-visualLineNavigation.api.md` now mark every export `// @internal`.

Consumers should reach for the adapter-side wrappers (`useTableSelection`, `useTrackedChanges`, `useVisualLineNavigation` in React/Vue) instead of these subpaths. The tag is a signal of intent — these subpaths are expected to move behind public surfaces in a future major.
