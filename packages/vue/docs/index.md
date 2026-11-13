# Task recipes

| Task | Browser controls (React or Vue) |
| --- | --- |
| [Highlight ranges](./highlight-ranges.md) | `useHighlights(name, source, options)` |
| Page setup and paragraph dialogs | `DocxEditor.PageSetupDialog` or `DocxEditor.ParagraphDialog` |

Comments and tracked changes need a review module in the editor's `modules`. In this fork that is `reviewModule()` from `@gw/docx-review` (`extensions/review`), which also provides the `ReviewPanel`. Comments and tracked changes need an author: the editor's `author` prop.
