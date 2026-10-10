# Tasks: Toolbar & Selection Interactions

## Investigation

- [ ] Test: select text → open font dropdown → check if selection highlight remains
- [ ] Test: open dropdown → click editor body → check if dropdown closes
- [ ] Test in Firefox: select text → right-click → check if selection resets
- [ ] Test: type in default font → check if toolbar shows font name/size
- [ ] Check if table options button has tooltip

## Selection preservation

- [ ] Ensure selection overlay renders based on PM stored selection, not focus state
- [ ] Verify dropdown mousedown uses `stopPropagation()` on all dropdown types
- [ ] Test with font picker, color picker, alignment dropdown

## Dropdown close

- [ ] Add global mousedown listener to close dropdowns on outside click
- [ ] Handle ProseMirror mousedown interaction (capture phase if needed)
- [ ] Ensure clicking another toolbar button closes the previous dropdown

## Firefox right-click

- [ ] Check `event.button === 2` in mousedown handler
- [ ] If right-click is within existing selection, preserve selection
- [ ] Test right-click context menu with selected text in Firefox

## Default font display

- [ ] Resolve effective font from style hierarchy in `selectionTracker`
- [ ] Walk: run properties → paragraph style → docDefaults
- [ ] Display resolved font name and size in toolbar when no explicit formatting

## Table tooltip

- [ ] Add tooltip to table options toolbar icon

## Testing

- [ ] E2E test: selection stays highlighted when dropdown opens
- [ ] E2E test: dropdown closes on editor body click
- [ ] Test in Firefox: right-click preserves selection
- [ ] E2E test: default font shown in toolbar
- [ ] Run `bun run typecheck`
