# Tasks: Toolbar & Selection Interactions

## Investigation

- [x] Test: select text → open font dropdown → check if selection highlight remains
- [x] Test: open dropdown → click editor body → check if dropdown closes
- [x] Test in Firefox: select text → right-click → check if selection resets
- [x] Test: type in default font → check if toolbar shows font name/size
- [x] Check if table options button has tooltip

## Selection preservation

- [x] Ensure selection overlay renders based on PM stored selection, not focus state
- [x] Verify dropdown mousedown uses `stopPropagation()` on all dropdown types
- [x] Test with font picker, color picker, alignment dropdown

## Dropdown close

- [x] Add global mousedown listener to close dropdowns on outside click
- [x] Handle ProseMirror mousedown interaction (capture phase if needed)
- [x] Ensure clicking another toolbar button closes the previous dropdown

## Firefox right-click

- [x] Check `event.button === 2` in mousedown handler
- [x] If right-click is within existing selection, preserve selection
- [x] Test right-click context menu with selected text in Firefox

## Default font display

- [x] Resolve effective font from style hierarchy in `selectionTracker`
- [x] Walk: run properties → paragraph style → docDefaults
- [x] Display resolved font name and size in toolbar when no explicit formatting

## Table tooltip

- [x] Add tooltip to table options toolbar icon

## Testing

- [x] E2E test: selection stays highlighted when dropdown opens
- [x] E2E test: dropdown closes on editor body click
- [x] Test in Firefox: right-click preserves selection
- [x] E2E test: default font shown in toolbar
- [x] Run `bun run typecheck`
