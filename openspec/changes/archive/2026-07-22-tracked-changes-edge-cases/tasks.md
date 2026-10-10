# Tasks: Tracked Changes Edge Cases

## Investigation

- [ ] Check if suggesting mode is implemented and how track-change marks interact with comments
- [ ] Test: enter suggesting mode → type text → undo → check if comment is removed
- [ ] Test: enter suggesting mode → type "AB" → check comment "Added" text
- [ ] Trace comment creation/removal lifecycle during undo

## Orphan comment fix

- [ ] After undo transaction, detect orphaned comments (no marks reference them)
- [ ] Remove orphaned comments from comment store
- [ ] Test with single suggestion → undo → comment removed
- [ ] Test with multiple suggestions → undo one → only that comment removed
- [ ] Test redo after undo → comment restored

## Extra letter fix

- [ ] Identify where comment "Added" text is extracted
- [ ] Ensure extraction uses committed PM state (`state.doc.textBetween`)
- [ ] Not DOM content or pre-transaction state
- [ ] Test: type "ABCD" in suggesting mode → comment shows "ABCD" not "ABCDD"

## Testing

- [ ] E2E test: undo last suggestion removes comment
- [ ] E2E test: undo one of many suggestions removes only that comment
- [ ] E2E test: redo restores suggestion and comment
- [ ] E2E test: suggesting mode typing shows correct text in comment
- [ ] Run `bun run typecheck`
