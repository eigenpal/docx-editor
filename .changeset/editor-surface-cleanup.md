---
'@docx-editor.dev/react': minor
---

`selectAll`, `copy`, `cut` and `paste` are editor commands, so a menu row or a button of your own gets the same `can()` answer the packaged controls get. `copy` and `cut` are refused at a collapsed caret instead of reporting themselves available and then doing nothing.

A document opened for viewing now allows `selectAll` and `copy`. The viewing gate refused every command, so a reader could neither select nor copy the document the viewer exists to show — and it disagreed with `mode: 'view'`, which has always refused only edits.

`EditorSnapshot.selectionCollapsed` tells a caret from a range. Asking that used to mean comparing `query({ type: 'selectedText' })` to `''`, which builds the whole selected string to produce one boolean.

`useEditorCommand` now takes a raw `EditorCommand` as well as a chrome slot, so a control the registry does not describe — `{ type: 'selectAll' }`, or your own formatting action — gets the same enabled state, active state and can-before-exec behaviour as a packaged one.

`Editor.getPageGeometry()` returns real page boxes, in 96dpi content pixels. It returned an empty array before, which left both Vue rulers rendering nothing.

Removed from the `Editor` contract: `hitTest`, `resolvePointer`, `dispatchInteraction`, `getInteractionFrame`, `getDisplay`, `getSelectionRects`, `getCaretRect`, `getCaretGeometry`, `getSelectionGeometry`, `getScrollGeometry`, `getAccessibilityObservation`, `getInputHostObservation`, `getInteractionHostMetrics`, `getCaretClientRect`, the `display` event, and `EditorHost.onDisplay`/`onScrollRestore`/`getRenderedTextGeometry`/`getInteractionHostMetrics`. Every one was a stub with no caller. They were removed rather than filled in because an empty answer from them is indistinguishable from a real one — `hitTest` returning `null` also means "you clicked the page margin". Pointer interaction is unaffected: it never went through these, and the hit-test implementation stays where the engine uses it.
