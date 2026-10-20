<!-- Generated from docs/site/content/recipes by scripts/sync-agent-docs.mjs. Edit the source and run `bun run docs:agent`. -->

# Which API for which job

The library has two ways to change a document. Each one fits a different host. Choose the path first, then use the symbol for your task.

| Job | Use |
| --- | --- |
| Build a review UI in the browser | The React or Vue adapter hooks, plus the review hooks and `DocxEditorReview` from `@docx-editor.dev/pro/react` or `@docx-editor.dev/pro/vue`. |
| Edit in a headless, server, or agent pipeline | The editing API in `@docx-editor.dev/editor-api`, which follows the Office.js object model. |

| Task | Browser host (React or Vue) | Headless, server, or agent |
| --- | --- | --- |
| [Comment on found text](./comment-on-found-text.md) | `editor.findMatches`, `editor.selectMatch`, then `useReview().comment` | `body.search`, then `Range.insertComment` |
| Reply to a thread | `useReview().reply(item, text)` | `Comment.reply(text)` |
| [Record a tracked replacement](./tracked-replacement.md) | Suggesting mode, then `editor.exec({ type: 'replaceMatch', match, text })` | `document.changeTrackingMode = 'TrackMineOnly'`, then `Range.insertText(text, 'Replace')` |
| [Propose an AI rewrite as tracked changes](./propose-rewrite.md) | The same code through `DocxEditor.createBrowser` from `@docx-editor.dev/editor-api/browser` | `prepareRewrite` from `@docx-editor.dev/editor-api/agent` |
| [Accept or reject a change](./accept-reject-without-scrolling.md) | `useReview().accept(item)` or `useReview().reject(item)` | `Revision.accept()` or `Revision.reject()` |
| [Open or reveal a change without scrolling](./accept-reject-without-scrolling.md) | `useReview().setActive(key, { reveal: false })` | Not applicable: no viewport |
| [Highlight ranges](./highlight-ranges.md) | `useHighlights(name, source, options)` | Not applicable |
| [Custom review rail cards](./custom-review-cards.md) | `DocxEditorReview` with `preset` set to `false`, `useReview().items`, `useStackedReviewPositions`, and `useReviewRailMetrics` | Not applicable |
| Comment-on-selection button | `DocxEditorReview.AddComment` as a direct child of `DocxEditorReview`, or `useEditorCommand('review.addComment')` | Not applicable |
| Page setup and paragraph dialogs from a custom toolbar | `DocxEditor.PageSetupDialog` or `DocxEditor.ParagraphDialog` with `open` and a close handler (`onClose` in React, `@close` in Vue); enable the button from `usePageSetup().isEnabled` or `useParagraphFormat().isEnabled` | `Section.pageSetup`, and `Paragraph` properties such as `alignment` |

The review hooks need `reviewModule()` from `@docx-editor.dev/pro` in the editor's modules, and an editor `author` for comments and tracked changes. The editing API takes its author from the `author` option of `DocxEditor.createServer`, imported from `@docx-editor.dev/editor-api`, or of `DocxEditor.createBrowser`, imported from `@docx-editor.dev/editor-api/browser`.

## Recipes

- [Comment on found text](./comment-on-found-text.md)
- [Replace as a tracked change](./tracked-replacement.md)
- [Propose an AI rewrite as tracked changes](./propose-rewrite.md)
- [Custom cards in the review rail](./custom-review-cards.md)
- [Highlight ranges](./highlight-ranges.md)
- [Accept or reject without scrolling](./accept-reject-without-scrolling.md)

For the full hook reference, see [React hooks](https://www.docx-editor.dev/docs/2.x/react/hooks) and [Vue composables](https://www.docx-editor.dev/docs/2.x/vue/composables). For the editing API, see [Editing API](https://www.docx-editor.dev/docs/2.x/editor-api).
