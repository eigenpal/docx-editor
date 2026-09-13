# Tasks

## 1. Plan and baseline

- [x] 1.1 Validate OpenSpec and complete documented self-review. See `review.md`; strict validation passes.
- [x] 1.2 Capture pinned signatures and runtime domains for all 81 members. Live-export report: 81/81 exact; endpoint runtime notes are separate.
- [x] 1.3 Run existing behavior tests and record baseline evidence; see `evidence.md` and consumer feedback.

## 2. Member verification checklist

Each item requires implementation, positive behavior, refusal/preservation checks, and runtime notes.

### Text and links (7)

- [x] 2.1 `Body.insertParagraph()` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.2 `Body.insertText()` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.3 `Range.insertText()` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.4 `Range.delete()` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.5 `Paragraph.delete()` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.6 `Range.insertParagraph()` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.7 `Range.hyperlink [write]` — implemented, tested, and documented; see `evidence.md`.

### Formatting (18)

- [x] 2.8 `Paragraph.style [write]` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.9 `Font.bold [write]` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.10 `Font.italic [write]` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.11 `Font.underline [write]` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.12 `Font.strikeThrough [write]` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.13 `Font.name [write]` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.14 `Font.size [write]` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.15 `Font.color [write]` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.16 `Font.highlightColor [write]` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.17 `Font.subscript [write]` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.18 `Font.superscript [write]` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.19 `Paragraph.alignment [write]` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.20 `Paragraph.leftIndent [write]` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.21 `Paragraph.rightIndent [write]` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.22 `Paragraph.firstLineIndent [write]` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.23 `Paragraph.lineSpacing [write]` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.24 `Paragraph.spaceBefore [write]` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.25 `Paragraph.spaceAfter [write]` — implemented, tested, and documented; see `evidence.md`.

### Review (10)

- [x] 2.26 `Document.changeTrackingMode [write]` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.27 `Range.insertComment()` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.28 `Comment.reply()` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.29 `Comment.resolved [write]` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.30 `Comment.delete()` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.31 `CommentReply.delete()` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.32 `Revision.accept()` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.33 `Revision.reject()` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.34 `RevisionCollection.acceptAll()` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.35 `RevisionCollection.rejectAll()` — implemented, tested, and documented; see `evidence.md`.

### Lists (8)

- [x] 2.36 `Paragraph.startNewList()` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.37 `Paragraph.attachToList()` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.38 `Paragraph.detachFromList()` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.39 `List.setLevelBullet()` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.40 `List.setLevelNumbering()` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.41 `List.setLevelStartingNumber()` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.42 `List.setLevelIndents()` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.43 `ListItem.level [write]` — implemented, tested, and documented; see `evidence.md`.

### Tables (13)

- [x] 2.44 `Range.insertTable()` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.45 `Table.values [write]` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.46 `Table.addRows()` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.47 `Table.deleteRows()` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.48 `Table.addColumns()` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.49 `Table.deleteColumns()` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.50 `Table.delete()` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.51 `Table.headerRowCount [write]` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.52 `Table.style [write]` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.53 `TableCell.value [write]` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.54 `TableCell.columnWidth [write]` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.55 `TableCell.shadingColor [write]` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.56 `TableCell.verticalAlignment [write]` — implemented, tested, and documented; see `evidence.md`.

### Page layout (8)

- [x] 2.57 `Range.insertBreak()` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.58 `PageSetup.orientation [write]` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.59 `PageSetup.pageWidth [write]` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.60 `PageSetup.pageHeight [write]` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.61 `PageSetup.leftMargin [write]` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.62 `PageSetup.rightMargin [write]` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.63 `PageSetup.topMargin [write]` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.64 `PageSetup.bottomMargin [write]` — implemented, tested, and documented; see `evidence.md`.

### Template fields (7)

- [x] 2.65 `Range.insertContentControl()` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.66 `ContentControl.tag [write]` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.67 `ContentControl.title [write]` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.68 `ContentControl.insertText()` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.69 `ContentControl.delete()` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.70 `ContentControl.cannotEdit [write]` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.71 `ContentControl.cannotDelete [write]` — implemented, tested, and documented; see `evidence.md`.

### Images (6)

- [x] 2.72 `Range.insertInlinePictureFromBase64()` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.73 `InlinePicture.delete()` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.74 `InlinePicture.width [write]` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.75 `InlinePicture.height [write]` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.76 `InlinePicture.lockAspectRatio [write]` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.77 `InlinePicture.altTextDescription [write]` — implemented, tested, and documented; see `evidence.md`.

### Dynamic fields (4)

- [x] 2.78 `Range.insertField()` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.79 `Field.code [write]` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.80 `Field.updateResult()` — implemented, tested, and documented; see `evidence.md`.
- [x] 2.81 `Field.delete()` — implemented, tested, and documented; see `evidence.md`.

## 3. Mandatory dependencies

- [x] 3.1 Table/row/cell, picture, and field traversal; load, returned proxies, and stable identities.
- [x] 3.2 Missing primary header/footer creation and section inheritance behavior.
- [x] 3.3 Same-sync and separate-sync object creation/configuration; alias conflicts; batch atomicity; stale handles.
- [x] 3.4 Core protocol/capabilities, tracking policy, locks, package relations, and resource bounds.

## 4. Workflow evidence

- [x] 4.1. Replace one intended occurrence among duplicate phrases without touching the others. Headless/browser evidence is linked in `evidence.md`.
- [x] 4.2. Insert and delete paragraphs while preserving adjacent styles and bookmarks. Headless/browser evidence is linked in `evidence.md`.
- [x] 4.3. Apply headings, emphasis, alignment, spacing, and hyperlinks to selected text. Headless/browser evidence is linked in `evidence.md`.
- [x] 4.4. Create a nested bullet/numbered list, restart numbering, then remove one item's list formatting. Headless/browser evidence is linked in `evidence.md`.
- [x] 4.5. Create a table, populate cells, add/remove rows and columns, and format its header. Headless/browser evidence is linked in `evidence.md`.
- [x] 4.6. Fill tagged template fields, preserve surrounding content, and respect edit locks. Headless/browser evidence is linked in `evidence.md`.
- [x] 4.7. Propose tracked text changes, add/reply/resolve comments, and accept/reject selected changes. Headless/browser evidence is linked in `evidence.md`.
- [x] 4.8. Insert an inline image, resize it, set alt text, and remove it. Headless/browser evidence is linked in `evidence.md`.
- [x] 4.9. Set page layout, create/edit a header and footer, and insert page-number fields. Headless/browser evidence is linked in `evidence.md`.
- [x] 4.10. Save and reopen each result; validate the intended semantic change and preservation of untouched content. Headless/browser evidence is linked in `evidence.md`.

## 5. Review and delivery

- [x] 5.1 Local Word verification for ambiguous semantics and generated document rendering; record evidence.
- [x] 5.2 Fixed subset metrics and per-member notes; informational CI integration with the exhaustive checker.
- [x] 5.3 Public API/reference fixtures, examples, CLAUDE guidance, and changeset.
- [x] 5.4 Required tests, build/API, typecheck, lint, formatting, license and parity checks.
- [x] 5.5 After implementation, launch multiple independent subagents to build and run real agent apps using only public editor-api imports and documented host APIs.
- [x] 5.6 Cover contract/template review, report authoring with lists/tables/images, and page layout/fields across those apps. Save/reopen outputs and record concrete failures and awkward API gaps.
- [x] 5.7 Combine feedback in one issue log with reproduction, expected/actual behavior, severity, source fix, and regression evidence. Fix required workflow failures in the API; do not hide them with private imports or browser fallbacks.
- [x] 5.8 Rerun consumer apps after fixes, then run an independent reviewer loop over implementation, public contract, preservation, and evidence. Repeat until required findings are resolved.
- [x] 5.9 Run final gates, reconcile all evidence/checklists, and open the single PR only when ready. Delivered in [PR #811](https://github.com/eigenpal/docx-editor/pull/811).

## 6. Fresh developer review follow-up

- [x] 6.1 Launch two new high-reasoning consumers without implementation or review history. Record blind findings before source inspection.
- [x] 6.2 Add dedicated topic pages and a complete public API member directory. Typecheck examples and execute representative save/reopen workflows. See `docs-coverage.md`.
- [x] 6.3 Fix concrete consumer failures and add regression tests. Combine findings in `high-reasoning-review.md`.
- [x] 6.4 Complete cross-review of the final text, placeholder, and runtime fixes with no open concrete P2-or-higher finding in the reviewed scope.
- [x] 6.5 Run both fresh apps under Node against built package exports and keep them in CI after the build. Keep signature percentages informational.
- [x] 6.6 Run final repository gates and update PR #811 with the reviewed fixes, docs, and evidence.

## 7. Second extensive review

- [x] 7.1 Independently review structural preservation, protection, malformed topology, and browser undo/redo.
- [x] 7.2 Review text and Unicode edits with exact preservation and save/reopen assertions.
- [x] 7.3 Fix sync capture timing and independently test delayed setters and failed-batch recovery.
- [x] 7.4 Extend local Word checks to report layout, landscape sections, page fields, and review objects.
- [x] 7.5 Complete native Word edit/undo/redo/save, then API edit/save and Word reopen.
- [x] 7.6 Complete final repository gates and update PR #811 with the second review evidence.
