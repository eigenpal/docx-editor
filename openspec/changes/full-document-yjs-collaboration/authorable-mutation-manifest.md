# Authorable mutation manifest (task 0.5)

Frozen inventory of what the editor can author at the implementation base
commit. Full collaboration means coverage of this manifest. This change does
not add missing editor capabilities.

Machine-readable copy:
`openspec/changes/full-document-yjs-collaboration/authorable-mutation-manifest.json`.

Drift test:
`packages/core/src/store/__tests__/authorable-mutation-manifest.test.ts`.

## Base

| Field                      | Value                                         |
| -------------------------- | --------------------------------------------- |
| Git commit                 | `45cf9fb5350af2ea70443342928376972b00ea79`    |
| Subject                    | feat: add peer-to-peer Yjs collaboration demo |
| Date                       | 2026-08-24 14:45:47 +0200                     |
| `TreeDocOp` kinds          | **69**                                        |
| Single-part apply          | **57**                                        |
| Header/footer lifecycle    | **5**                                         |
| Note lifecycle             | **5**                                         |
| Explicit unsupported kinds | **2**                                         |
| Chrome slots               | **55**                                        |

The kinds file is not dirty in the working tree. Later files in this change
do not add `TreeDocOp` kinds.

## Apply and validate paths

`validateTreeOp` runs first. `applyTreeOp` never mutates after a refusal.

| Path                    | Kinds | Validate                       | Commit                                                               |
| ----------------------- | ----- | ------------------------------ | -------------------------------------------------------------------- |
| Single-part             | 57    | `validateTreeOp`               | `applyTreeOp`                                                        |
| Header/footer lifecycle | 5     | `invalidArgs` on a single part | `TreePackageStore.applyLifecycleOp` → `applyHeaderFooterLifecycleOp` |
| Note lifecycle          | 5     | `invalidArgs` on a single part | `TreePackageStore.applyLifecycleOp` → `applyNoteLifecycleOp`         |
| Repeating section       | 2     | `unsupported`                  | none                                                                 |

`TREE_OP_REACH` is a mapped type over `TreeDocOpKind`. Reach classification
covers all 69 kinds.

## Story scopes

Editable `StoryScope` members:

- `body`
- `headerFooter` with `rId`
- `notesPart` with `noteKind` `footnote` or `endnote`

Text boxes are not an editable scope.

Story-parity exceptions that are authorable:

- Body only: `insertNote`, `insertPageBreak`, `insertToc`, `setSectionMark`
- Furniture only: `insertPageField`

Lifecycle ops are package writes. They are not story-scoped `applyTreeOps`.

## Package intents

Named production hooks that child splices cannot represent:

- `withPart`, `withNewPart`, `withoutPart`
- `withRelationshipsPartFor`, `withRelationship`
- `withContentTypeOverride` (two implementations)
- `withBinaryPart`, `withEmbeddedImage`, `withoutUnreferencedImagePart`
- `addComment`, `setCommentResolved`
- `insertCustomNodeWrite`, `removeCustomNodeWrite`
- `ensureListDefinition`, `ensureNumberingLevel`
- `replacePackageShell` (history and grafts; not a collab authoring primitive)

XML part rename has no API. It stays unsupported.

## Command exposure

55 chrome slots. 28 map through `commandForSlot`. 6 use
`chromeProbeForSlot`. Value-typed slots use `commandForSlotValue`.

Unwired command-shaped slots:

- `zoom.level` (view state)
- `contentControl.showAll`, `contentControl.formFill`, `contentControl.inspector`
- `insert.sectionBreakContinuous`

Non-mutating slots: undo, redo, review pane, open, save.

`EditorCommand` and `DocEdits` also expose table merge/split, watermark,
variables, and `replyComment`. Those have no authorable store path. See
unsupported rows.

Current collaboration `gateOperations` admits only untracked body
`insertText` and `deleteText`. That is the experimental proof subset. It is
not this freeze.

## Active OpenSpec dependencies

Mutation owners that can add authorable rows:

- `typed-ooxml-paragraph-editor`
- `typed-content-controls`
- `typed-revisions-and-comments`
- `typed-notes-footnotes-endnotes`
- `scoped-header-footer-editing`
- `typed-drawings-and-images`
- `typed-hyperlinks-and-bookmarks`
- `typed-toc-refresh`
- `structural-block-deletion`
- `custom-node-payload-write-lane`
- `pro-review-and-custom-nodes`
- `resolved-view-paragraph-merge`
- `word-like-field-rendering`

Incomplete mutation owners:

- `typed-vml-watermarks` (command, no op)
- `textbox-story-layout` (layout, no editable scope)

Collaboration:

- `peer-to-peer-yjs-collaboration-demo`
- `full-document-yjs-collaboration`

Independent of this freeze:

- `vue-composable-adapter-parity`
- `vue-drawing-authoring-parity`
- `fit-to-viewport-zoom`
- `sub-frame-large-document-typing`
- `document-navigation-pane`
- `text-field-instruction-rendering`

## Unsupported rows

| Id                                | What exists                                                  | Why it is not authorable                     |
| --------------------------------- | ------------------------------------------------------------ | -------------------------------------------- |
| repeating-section-item            | `TreeDocOp` kinds                                            | Validate and apply return `unsupported`      |
| table-merge-split                 | `mergeCells`, `splitCell`                                    | No `TreeDocOp`; table planner refuses        |
| table-properties-header-select    | `toggleHeaderRow`, `selectTableRegion`, `setTableProperties` | No `TreeDocOp`; tree editor refuses          |
| column-break                      | `insertBreak` kind `column`                                  | Support gate refuses                         |
| continuous-section-break          | chrome slot                                                  | `commandForSlot` is null                     |
| content-control-picture-repeating | control kinds                                                | Insert allowlist omits them                  |
| xml-part-rename                   | none                                                         | No API                                       |
| vml-watermark                     | `setWatermark`                                               | No support case, no op                       |
| tracked-drawing-delete            | `deleteDrawing.revision`                                     | Refused                                      |
| doctarget-insert-delete           | `DocTarget` on insert/delete                                 | Support gate refuses; selection path remains |
| textbox-story-scope               | text-box layout                                              | Not in `StoryScope`                          |
| bookmark-insert-op                | TOC bookmarks, hyperlink anchors                             | No `insertBookmark` kind                     |
| reply-comment                     | `DocEdits.replyComment`                                      | No store write                               |
| document-variables                | `setVariable`, `applyVariables`                              | No `TreeDocOp`                               |
| arbitrary-shape-authoring         | drawing wrap/crop/position                                   | D14 missing capability                       |
| tracked-move                      | none                                                         | D14 missing capability                       |

## Remaining ambiguity

- `replacePackageShell` is a production write and is forbidden during live
  collaboration except bootstrap, materialization, or generation replacement.
- Hyperlink relationship mint may still use `replacePackageShell` rather than
  `withRelationship`.
- Two `withContentTypeOverride` implementations exist.
- `withoutPart` is not on the public package barrel.
- One command can emit several ops. Slot mapping is not 1:1 with kinds.
- Generic OOXML has no dedicated op. Admitted ops must keep generic children.
- `openspec/changes/word-fidelity-review-findings.md` is not a change directory.

## Coverage

Exact authorable freeze:

- 67 of 69 `TreeDocOp` kinds have a commit path (57 single-part, 10 lifecycle).
- 2 kinds are explicit unsupported rows.
- 3 editable story scopes, plus documented body-only and furniture-only variants.
- 16 named package intents, including non-authorable `replacePackageShell`.
- 16 unsupported rows for missing editor capabilities and refused kinds.

This freeze does not claim current collaboration admits those 67 kinds. The
proof session still gates to untracked body text.
