# Tasks: Cursor Navigation & Auto-Scroll

## Investigation

- [ ] Trace arrow-down behavior in `useVisualLineNavigation` — identify where cursor jumps or stops
- [ ] Test drag-select near viewport edges — confirm no auto-scroll occurs
- [ ] Test selection across a split paragraph spanning two pages
- [ ] Identify how `getPositionFromMouse` handles split block DOM elements

## Arrow key navigation

- [ ] Fix visual line stepping to handle page boundaries
- [ ] Fix cursor movement through split paragraphs
- [ ] Maintain horizontal position (X coordinate) across line movements
- [ ] Handle edge case: cursor at last line of page → first line of next page

## Auto-scroll on keyboard

- [ ] After PM selection change, get visual cursor position
- [ ] If cursor outside viewport, `scrollIntoView({ block: 'nearest' })`
- [ ] Handle both up and down scroll directions
- [ ] Smooth scroll behavior

## Auto-scroll during drag-select

- [ ] Detect mouse position near viewport edges during mousedown+mousemove
- [ ] Start scroll timer when within threshold (~30px from edge)
- [ ] Scroll speed proportional to distance beyond edge
- [ ] Continue extending selection as new content becomes visible
- [ ] Clean up timer on mouseup

## Cross-page selection

- [ ] Map coordinates from split block fragments to correct PM positions
- [ ] Ensure selection highlights continuously through split blocks
- [ ] Test selection starting on page N, ending on page N+1 through split paragraph

## Testing

- [ ] E2E test: arrow-down through multi-page document
- [ ] E2E test: arrow-down scrolls page when cursor reaches bottom
- [ ] E2E test: drag-select triggers auto-scroll near bottom edge
- [ ] E2E test: selection through split paragraph across pages
- [ ] Run `bun run typecheck`
