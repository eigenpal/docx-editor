# Cursor Navigation & Auto-Scroll

## Problem

Three related issues with cursor movement and scrolling in our paginated editor:

1. **Arrow key navigation inconsistent** — pressing Arrow Down repeatedly doesn't move the cursor consistently. The cursor may skip lines, jump unexpectedly, or stop moving entirely at certain positions. No auto-scroll occurs when the cursor reaches the bottom of the visible area.

2. **No auto-scroll during drag-select** — when selecting text by clicking and dragging toward the top or bottom edge of the viewport, the editor doesn't auto-scroll. The selection stops at the viewport boundary, forcing users to manually scroll and re-select.

3. **Cross-page selection fails on split paragraphs** — click-and-drag selection works between distinct paragraphs on different pages but fails when a single paragraph spans two pages (split block). The selection sticks at the page break.

## Scope

- Fix arrow key cursor movement to be consistent line-by-line
- Add auto-scroll when cursor moves beyond visible area (keyboard navigation)
- Add auto-scroll during drag-select near viewport edges
- Fix selection continuity through split blocks across page boundaries

## Out of scope

- Virtual scrolling / lazy page rendering
- Cursor blinking visual style
