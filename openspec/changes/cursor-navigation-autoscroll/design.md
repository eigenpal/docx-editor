# Design: Cursor Navigation & Auto-Scroll

## Architecture context

Our editor has a hidden ProseMirror instance (off-screen, receives keyboard input) and visible pages (layout-painter DOM). The `useVisualLineNavigation` hook handles arrow key mapping between PM positions and visual line positions on the painted pages.

## Arrow key navigation

The `useVisualLineNavigation` hook maps PM document positions to visual coordinates on painted pages. Issues arise when:

- Visual line breaks don't correspond to PM document structure
- Split paragraphs across pages create discontinuities in visual position mapping
- The cursor position in the hidden PM doesn't always map to a visible position

**Fix:** Improve `getPositionFromMouse()` and visual line mapping to handle:

1. Lines at page boundaries
2. Split paragraphs that span pages
3. Consistent vertical stepping (same X position, next visual line Y)

## Auto-scroll on keyboard navigation

After each cursor movement, check if the new cursor position is visible in the viewport. If not, scroll to make it visible.

```
1. After PM selection change → get visual position of cursor
2. Check if position is within viewport bounds
3. If below viewport → scrollIntoView with block: 'nearest'
4. If above viewport → scrollIntoView with block: 'nearest'
```

## Auto-scroll during drag-select

During mousedown+mousemove (drag selection):

1. Track mouse Y relative to viewport edges
2. If mouse is within ~30px of top/bottom edge, start auto-scroll timer
3. Scroll at speed proportional to distance beyond edge
4. Continue extending selection as scroll reveals new content
5. Stop auto-scroll on mouseup

## Cross-page split block selection

When a paragraph is split across pages, it renders as two separate DOM elements. The `getPositionFromMouse` function needs to map coordinates from either fragment back to the correct PM position, treating both as part of the same paragraph.

## Key files

| File                                          | Change                                    |
| --------------------------------------------- | ----------------------------------------- |
| `src/paged-editor/PagedEditor.tsx`            | Drag-select auto-scroll, scroll-into-view |
| `src/paged-editor/useVisualLineNavigation.ts` | Arrow key line mapping                    |
| `src/paged-editor/getPositionFromMouse.ts`    | Position mapping for split blocks         |
