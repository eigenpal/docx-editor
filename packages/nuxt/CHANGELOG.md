# @eigenpal/nuxt-docx-editor

## 1.2.1

### Patch Changes

- @eigenpal/docx-editor-vue@1.2.1

## 1.2.0

### Patch Changes

- Updated dependencies [362a65f]
- Updated dependencies [d791e05]
- Updated dependencies [a60ed77]
- Updated dependencies [a60ed77]
  - @eigenpal/docx-editor-vue@1.2.0

## 1.1.0

### Minor Changes

- 42ea72d: Track structural edits as OOXML revisions in suggesting mode. Paragraph-break insert/delete, paragraph-property changes, and table row/cell insert/delete/merge are now recorded, round-tripped through DOCX, and shown in the tracked-changes sidebar (React and Vue, localized). Adds `acceptChangeById(id)` / `rejectChangeById(id)`, and `acceptAllChanges` / `rejectAllChanges` now resolve every revision type rather than inline marks only. Fixes #614.

### Patch Changes

- Updated dependencies [9d7138e]
- Updated dependencies [9d7138e]
- Updated dependencies [42ea72d]
  - @eigenpal/docx-editor-vue@1.1.0

## 1.0.3

### Patch Changes

- Updated dependencies [6d56181]
  - @eigenpal/docx-editor-vue@1.0.3

## 1.0.2

### Patch Changes

- ffba596: Add `@eigenpal/nuxt-docx-editor`, a Nuxt 3 & 4 module that auto-imports an SSR-safe `<DocxEditor>` component wrapping the Vue adapter.
  - @eigenpal/docx-editor-vue@1.0.2
