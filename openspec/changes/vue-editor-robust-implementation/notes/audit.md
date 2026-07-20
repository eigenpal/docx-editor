# Per-component audit map (OpenSpec §3.1)

Each row pairs a Vue SFC under `packages/vue/src/components/` with (a) its React peer in `packages/react/src/components/`, (b) the row from the parity matrix in `specs/vue-react-parity/spec.md`, and (c) a status of `done`, `partial`, `missing`, or `intentional-divergence`. `done` requires all three criteria from the matrix (parity spec green, screenshot diff under tolerance, sign-off in `notes/qa-signoff.md`); anything less is `partial`. Update both this file and the matrix row in the PR that changes a component.

## Vue → React mapping

| Vue file (`packages/vue/src/components/`) | React peer (`packages/react/src/components/`)                     | Parity matrix row                  | Status                                                                |
| ----------------------------------------- | ----------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------- |
| `DocxEditorVue.vue`                       | `DocxEditor.tsx` (name divergence: SFC suffix)                    | Mount + render DOCX                | partial                                                               |
| `BasicToolbar.vue`                        | `FormattingBar.tsx` (Toolbar.tsx wraps FormattingBar inline)      | Bold/italic/underline + Alignment  | partial                                                               |
| `ui/ResponsiveToolbar.vue`                | `ui/ResponsiveToolbar.tsx`                                        | (toolbar layout — no matrix row)   | partial                                                               |
| `MenuBar.vue`                             | `TitleBar.tsx` (exports MenuBar sub-component)                    | (chrome — no matrix row)           | partial                                                               |
| `DocumentName.vue`                        | `TitleBar.tsx` (exports DocumentName sub-component)               | (chrome — no matrix row)           | partial                                                               |
| `ui/TableToolbar.vue`                     | `Toolbar.tsx` (table-mode branch) + `ui/TableOptionsDropdown.tsx` | Tables — insert / edit / delete    | partial                                                               |
| `dialogs/InsertTableDialog.vue`           | `dialogs/InsertTableDialog.tsx`                                   | Tables — insert / edit / delete    | partial                                                               |
| `dialogs/TablePropertiesDialog.vue`       | `dialogs/TablePropertiesDialog.tsx`                               | Tables — insert / edit / delete    | partial                                                               |
| `ui/TableStyleGallery.vue`                | `ui/TableStyleGallery.tsx`                                        | Tables — insert / edit / delete    | partial                                                               |
| `dialogs/FindReplaceDialog.vue`           | `dialogs/FindReplaceDialog.tsx`                                   | Find / replace                     | partial                                                               |
| `dialogs/HyperlinkDialog.vue`             | `dialogs/HyperlinkDialog.tsx`                                     | Hyperlinks                         | partial                                                               |
| `dialogs/InsertImageDialog.vue`           | `dialogs/InsertImageDialog.tsx`                                   | Image insert / resize / replace    | partial                                                               |
| `dialogs/ImagePropertiesDialog.vue`       | `dialogs/ImagePropertiesDialog.tsx`                               | Image insert / resize / replace    | partial                                                               |
| `dialogs/ImagePositionDialog.vue`         | `dialogs/ImagePositionDialog.tsx`                                 | Image insert / resize / replace    | partial                                                               |
| `ImageSelectionOverlay.vue`               | `ui/ImageTransformDropdown.tsx` + `ui/ImageWrapDropdown.tsx`      | Image insert / resize / replace    | partial                                                               |
| `dialogs/PageSetupDialog.vue`             | `dialogs/PageSetupDialog.tsx`                                     | Page setup (size, margins, etc.)   | partial                                                               |
| `dialogs/KeyboardShortcutsDialog.vue`     | `dialogs/KeyboardShortcutsDialog.tsx`                             | Keyboard shortcuts dialog          | partial                                                               |
| `dialogs/FootnotePropertiesDialog.vue`    | `dialogs/FootnotePropertiesDialog.tsx`                            | Footnotes / endnotes               | partial                                                               |
| `dialogs/PasteSpecialDialog.vue`          | `dialogs/PasteSpecialDialog.tsx`                                  | Paste special                      | partial                                                               |
| `dialogs/InsertSymbolDialog.vue`          | `dialogs/InsertSymbolDialog.tsx`                                  | Symbol insertion                   | partial                                                               |
| `InlineHeaderFooterEditor.vue`            | `InlineHeaderFooterEditor.tsx`                                    | Header / footer editing            | partial                                                               |
| `DocumentOutline.vue`                     | `DocumentOutline.tsx`                                             | Document outline                   | partial                                                               |
| `TextContextMenu.vue`                     | `TextContextMenu.tsx` (+ `ContextMenu.tsx`)                       | (context menu — no matrix row)     | partial                                                               |
| `PrintButton.vue`                         | `ui/Button.tsx` consumers (no dedicated PrintButton.tsx)          | Printing                           | partial                                                               |
| `ui/UnsavedIndicator.vue`                 | `ui/UnsavedIndicator.tsx`                                         | (chrome — no matrix row)           | partial                                                               |
| `ui/HorizontalRuler.vue`                  | `ui/HorizontalRuler.tsx`                                          | (chrome — no matrix row)           | partial                                                               |
| `ui/VerticalRuler.vue`                    | `ui/VerticalRuler.tsx`                                            | (chrome — no matrix row)           | partial                                                               |
| `ErrorBoundary.vue`                       | `ErrorBoundary.tsx`                                               | (no matrix row — supporting infra) | partial                                                               |
| `UnifiedSidebar.vue`                      | `UnifiedSidebar.tsx`                                              | Comments + Tracked changes         | partial                                                               |
| `sidebar/CommentCard.vue`                 | `sidebar/CommentCard.tsx`                                         | Comments                           | partial                                                               |
| `sidebar/AddCommentCard.vue`              | `sidebar/AddCommentCard.tsx`                                      | Comments                           | partial                                                               |
| `sidebar/TrackedChangeCard.vue`           | `sidebar/TrackedChangeCard.tsx`                                   | Tracked changes                    | missing (matrix row is `missing` for Vue; file present but not wired) |

Every row above is `partial` (or `missing` for `TrackedChangeCard`) because no matrix row has yet met all three `done` criteria; the `[STUB]` description in `packages/vue/package.json` (Decision 1) is the canonical signal.

## Reverse map: React-only components (no Vue peer in `packages/vue/src/components/`)

| React file                 | Parity matrix row               | Why no Vue peer                                                                                             |
| -------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `Toolbar.tsx`              | (composition root for toolbar)  | Vue splits this across `BasicToolbar.vue` + `ResponsiveToolbar.vue`                                         |
| `EditorToolbar.tsx`        | (host-app toolbar API)          | Vue does not yet expose host-app toolbar composition; spec gap                                              |
| `EditorToolbarContext.tsx` | (toolbar context)               | Vue toolbar uses props/`provide`-`inject`; idiomatic divergence                                             |
| `FormattingBar.tsx`        | Bold/italic/underline           | Folded into `BasicToolbar.vue`                                                                              |
| `TitleBar.tsx`             | (chrome)                        | Vue split into `MenuBar.vue` + `DocumentName.vue`                                                           |
| `CommentMarginMarkers.tsx` | Comments                        | Not yet implemented in Vue; gap blocks Comments → `done`                                                    |
| `ContextMenu.tsx`          | (context menu)                  | Vue inlines context-menu plumbing into `TextContextMenu.vue`                                                |
| `DocxEditorHelpers.tsx`    | (internal helpers)              | Vue equivalents inline in `DocxEditorVue.vue`                                                               |
| `ResponsePreview.tsx`      | Agent SDK — AI response preview | Lives at `packages/agent-use/src/vue/components/AIResponsePreview.vue` (Decision 7 — out of editor adapter) |
| `TableOptionsDropdown.tsx` | Tables                          | Vue uses `ui/TableMoreDropdown.vue` for the equivalent overflow actions                                     |

## Vue-only components (no React peer in `packages/react/src/components/`)

| Vue file     | Reason                                      |
| ------------ | ------------------------------------------- |
| `Avatar.vue` | Sidebar-only helper with no React file peer |

Agent UI files (`AgentPanel.vue`, `AgentChatLog.vue`, `AgentComposer.vue`, `AgentSuggestionChip.vue`, `AgentTimeline.vue`, `AIContextMenu.vue`, `AIResponsePreview.vue`) live under `packages/agent-use/src/vue/components/` per Decision 7 — out of scope for this audit, tracked by the Agent SDK rows in the matrix.

## How to update

When a PR touches a Vue component, bump its status here in the same change alongside the matrix row in `specs/vue-react-parity/spec.md`. A row reaches `done` only after all three matrix criteria hold.
