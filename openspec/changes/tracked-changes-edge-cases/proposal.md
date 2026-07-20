# Tracked Changes Edge Cases

## Problem

Two edge cases in tracked changes (suggesting mode) behavior:

1. **Undo of last suggestion leaves orphan comment** — in suggesting mode, when a user makes a change, the text is highlighted and a comment is auto-created. When there is only one suggestion and the user presses Undo, the highlight is removed but the comment remains visible. Works correctly when there are multiple suggestions — only fails for the last (or only) one.

2. **Comment shows extra letter in suggesting mode** — when typing in suggesting mode, the "Added" section in the auto-created comment shows a repeated last letter if the typed text is at least 2 characters long. Adding a space makes the extra letter disappear. This is a display-only bug in the comment UI, not in the actual document content.

## Scope

- Fix undo to remove both highlight marks and associated comment when undoing the last suggestion
- Fix comment display to show correct text without repeated characters

## Out of scope

- Tracked changes collaboration sync (not applicable)
- Accept/reject workflow (already works)
