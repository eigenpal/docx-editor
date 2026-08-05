# @docx-editor.dev/pro

## 2.0.0

### Minor Changes

- 26095c6: Deleting text that carried comments or tracked changes now clears them from the review rail instead of leaving empty cards behind, matching Word: the comment record goes with the words it covered, and an untracked delete drops the `w:ins`/`w:del` it emptied. A reply to a tracked change renders inside that change's card rather than as a separate card beside it, replies included. Every card carries a delete control on the open card — it removes a comment thread, a single reply, or discards a suggestion — through the new `Editor.deleteReviewItem`, `DocxEditor.Review.Delete` and `useReview().remove`. Also fixes a card dismissed from its reply box refusing to reopen.

### Patch Changes

- Updated dependencies [26095c6]
- Updated dependencies [26095c6]
- Updated dependencies [26095c6]
- Updated dependencies [26095c6]
- Updated dependencies [26095c6]
- Updated dependencies [26095c6]
- Updated dependencies [26095c6]
- Updated dependencies [26095c6]
- Updated dependencies [26095c6]
- Updated dependencies [26095c6]
- Updated dependencies [26095c6]
- Updated dependencies [26095c6]
- Updated dependencies [26095c6]
- Updated dependencies [26095c6]
  - @docx-editor.dev/react@2.0.0
  - @docx-editor.dev/core@2.0.0
