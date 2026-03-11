# Design: Toolbar & Selection Interactions

## Selection preservation

Our architecture: hidden ProseMirror (off-screen) holds the real selection, and the visible pages paint a selection overlay based on PM state.

When a toolbar dropdown opens, mousedown events on the dropdown shouldn't steal PM focus. Current approach uses `stopPropagation()` on dropdown mousedown — verify this works for all dropdown types.

The selection overlay in layout-painter should continue rendering even when the dropdown has focus. Check if the overlay re-render is triggered by PM blur events.

**Fix:** Ensure selection overlay persists based on PM's stored selection range, not on PM's focus state.

## Dropdown close on outside click

Use a global mousedown listener that checks if the click target is inside any open dropdown. If not, close all dropdowns.

**Gotcha:** ProseMirror mousedown handling can intercept events before our global listener. The dropdown close handler should be registered on the document level with capture phase or use the `handlePagesMouseDown` entry point.

## Firefox right-click

Firefox fires `mousedown` on right-click before the context menu appears, which can trigger PM's selection update.

**Fix:** In the mousedown handler, check `event.button === 2` (right-click) and if the click is within the existing selection range, prevent PM from updating the selection.

## Default font display

The `selectionTracker` plugin reports the current selection's formatting. When text has no explicit font (inherits from style/docDefaults), the tracker should resolve the effective font by walking the style hierarchy: run properties → paragraph style → docDefaults.

## Table options tooltip

Add `title` prop to the table options toolbar button, matching the pattern used by other toolbar items.

## Key files

| File                                          | Change                                              |
| --------------------------------------------- | --------------------------------------------------- |
| `src/components/Toolbar.tsx`                  | Dropdown close, default font display, tooltip       |
| `src/prosemirror/plugins/selectionTracker.ts` | Resolve inherited fonts                             |
| `src/paged-editor/PagedEditor.tsx`            | Selection overlay persistence, right-click handling |
| `src/components/ui/`                          | Dropdown components — close on outside click        |
