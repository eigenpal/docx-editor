---
'@docx-editor.dev/react': minor
---

`Editor.setMode('view' | 'edit')` switches read-only at runtime. Previously `mode` was read once when the editor was created, so changing the prop did nothing and the only way to toggle it was to rebuild the editor — which threw away the undo history and the reader's place. The React `mode` prop now follows through to it.

`EditorSnapshot.selectionCollapsed` tells a caret from a range. Asking that used to mean comparing `query({ type: 'selectedText' })` to `''`, which builds the whole selected string to produce one boolean.

`useEditorCommand` now takes a raw `EditorCommand` as well as a chrome slot, so a control the registry does not describe — `{ type: 'selectAll' }`, or your own formatting action — gets the same enabled state, active state and can-before-exec behaviour as a packaged one.

`Editor.getPageGeometry()` returns real page boxes. It returned an empty array before, which left both Vue rulers rendering nothing.

Removed from the `Editor` contract: `hitTest`, `resolvePointer`, `dispatchInteraction`, `getInteractionFrame`, `getDisplay`, `getSelectionRects`, `getCaretRect`, `getCaretGeometry`, `getSelectionGeometry`, `getScrollGeometry`, `getAccessibilityObservation`, `getInputHostObservation`, `getInteractionHostMetrics`, `getCaretClientRect`, the `display` event, and `EditorHost.onDisplay`/`onScrollRestore`/`getRenderedTextGeometry`/`getInteractionHostMetrics`. Every one was a stub with no caller. They were removed rather than filled in because an empty answer from them is indistinguishable from a real one — `hitTest` returning `null` also means "you clicked the page margin". Pointer interaction is unaffected: it never went through these, and the hit-test implementation stays where the engine uses it.
