# Design: Tracked Changes Edge Cases

## Orphan comment on last undo

### Root cause hypothesis

When undoing a suggestion:

1. The PM transaction removes the track-change marks from the text
2. A separate mechanism should detect that no more marks reference the comment and remove it

When there are multiple suggestions, removing one still leaves other marks, and the comment cleanup logic works. When the last suggestion is undone, the cleanup may not trigger because:

- The comment removal is triggered by checking remaining marks, but the check runs before the undo transaction is fully applied
- Or the check only runs when marks are removed via accept/reject, not via undo

### Fix

After an undo transaction that removes track-change marks, check if any comments are now orphaned (no marks reference them). If so, remove those comments from the comment store.

## Extra letter in comment display

### Root cause hypothesis

The comment "Added" text is derived from the current document content within the track-change mark range. If the mark range is calculated before the PM state update is reflected in the DOM, it may include the character being typed (from the input event) plus the character from the PM state (one step behind).

### Fix

Ensure the comment text extraction reads from the committed PM state, not from a mix of DOM + PM state. Use `state.doc.textBetween(from, to)` on the post-transaction state.

## Key files

| File                                | Change                                  |
| ----------------------------------- | --------------------------------------- |
| `src/prosemirror/extensions/marks/` | Track change mark removal/undo handling |
| `src/prosemirror/plugins/`          | Comment store cleanup after undo        |
| `src/components/`                   | Comment sidebar text display            |
