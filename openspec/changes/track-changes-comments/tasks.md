## 1. Document Layout Shift

- [x] 1.1 Add sidebar open/close state to `DocxEditor.tsx` (boolean + toggle callback)
- [x] 1.2 Add CSS transition to pages container in `PagedEditor.tsx` for `transform: translateX()` shift when sidebar is active
- [x] 1.3 Create `CommentsSidebar` shell component (320px fixed-width, absolutely positioned right, full height below toolbar, independently scrollable)
- [x] 1.4 Integrate sidebar into `DocxEditor.tsx` layout (render alongside PagedEditor, pass toggle state)
- [ ] 1.5 Handle narrow container case (< 1200px): overlay mode with semi-transparent backdrop instead of shift
- [ ] 1.6 Add E2E test: sidebar opens/closes, document shifts left and re-centers

## 2. Comment Data Layer

- [x] 2.1 Add `comments` array to editor state/context (loaded from parsed DOCX, mutable during editing)
- [x] 2.2 Create `useComments` hook: CRUD operations (add, delete, reply, resolve, reopen) that update both comments array and PM marks
- [x] 2.3 Extend `selectionTracker` plugin to detect `comment` marks at cursor and expose `activeCommentIds` in `SelectionFormatting`
- [x] 2.4 Add `addComment` PM command: wraps selection in `comment` mark with generated `commentId`, creates `Comment` object
- [x] 2.5 Add `removeComment` PM command: removes `comment` mark for a given `commentId`

## 3. Comment Sidebar UI

- [x] 3.1 Create `CommentCard` component: displays author, date, comment text, reply button, resolve button, delete in overflow menu
- [x] 3.2 Create `CommentThread` component: parent comment + nested replies, reply input
- [x] 3.3 Populate `CommentsSidebar` with comment cards positioned vertically near their anchored text (using `RenderedDomContext.getRectsForRange()`)
- [x] 3.4 Implement comment card spacing/overlap avoidance (push lower cards down when they collide)
- [x] 3.5 Add "New comment" input card: appears when user triggers add-comment, auto-focused, submit on Enter, cancel on Escape
- [x] 3.6 Add resolved comments toggle in sidebar header (show/hide resolved)
- [ ] 3.7 Add E2E test: add comment, reply, resolve, delete comment

## 4. Leader Lines

- [ ] 4.1 Create `LeaderLines` SVG overlay component positioned between document and sidebar
- [ ] 4.2 Compute line endpoints: from right edge of highlighted text rect → left edge of corresponding sidebar card
- [ ] 4.3 Update leader line positions on document scroll (debounced with `requestAnimationFrame`)
- [ ] 4.4 Highlight active comment's leader line (darker/thicker) when comment is selected
- [ ] 4.5 Add E2E test: leader lines render and connect correct elements

## 5. Comment Navigation & Interaction

- [ ] 5.1 Click comment card → scroll document to commented text, select the range
- [ ] 5.2 Click highlighted text in document → scroll sidebar to corresponding comment, highlight the card
- [x] 5.3 Add "Add comment" button to toolbar (icon + Ctrl+Alt+M / Cmd+Alt+M shortcut)
- [x] 5.4 Add comments toggle button to toolbar
- [ ] 5.5 Add E2E test: bidirectional navigation between sidebar and document

## 6. Suggestion Mode

- [x] 6.1 Add editing mode state to editor context: "editing" | "suggesting"
- [x] 6.2 Create `SuggestionModePlugin` (ProseMirror `appendTransaction`): intercept text insertions → wrap in `insertion` mark; intercept deletions → wrap in `deletion` mark instead of removing
- [x] 6.3 Handle text replacement in suggestion mode: mark original as deletion + new text as insertion
- [x] 6.4 Add author and timestamp metadata to all tracked change marks created in suggestion mode
- [x] 6.5 Add mode toggle dropdown to toolbar ("Editing" / "Suggesting") with Ctrl+Shift+E shortcut
- [x] 6.6 Add visual mode indicator in toolbar when suggestion mode is active
- [ ] 6.7 Add E2E test: type text in suggestion mode → insertion mark applied; delete text → deletion mark applied

## 7. Track Changes Review

- [x] 7.1 Create `acceptChange` PM command: for insertions remove mark (keep text), for deletions remove mark + text
- [x] 7.2 Create `rejectChange` PM command: for insertions remove mark + text, for deletions remove mark (keep text)
- [x] 7.3 Create `acceptAllChanges` PM command: single transaction processing all tracked changes
- [x] 7.4 Create `rejectAllChanges` PM command: single transaction processing all tracked changes
- [x] 7.5 Create `nextChange` / `previousChange` navigation commands (with wrap-around)
- [ ] 7.6 Add review toolbar controls: Accept, Reject, Accept All, Reject All, Previous, Next buttons
- [ ] 7.7 Disable individual Accept/Reject when cursor is not in a tracked change
- [x] 7.8 Add tracked change cards to sidebar: type indicator, text preview, author, date, accept/reject buttons
- [ ] 7.9 Add E2E test: accept insertion, accept deletion, reject insertion, reject deletion, accept all, reject all

## 8. DOCX Round-Trip Serialization

- [ ] 8.1 Verify comment parser (`commentParser.ts`) correctly loads comments with threading and range markers
- [ ] 8.2 Implement comment serializer: write `comments.xml` with comment content, author, date; write `commentRangeStart`/`commentRangeEnd` in document body
- [ ] 8.3 Verify tracked changes parser loads `w:ins`/`w:del` elements with author and date metadata
- [ ] 8.4 Implement tracked changes serializer: write `w:ins`/`w:del` revision markup to document XML
- [ ] 8.5 Add round-trip E2E test: load DOCX with comments → save → reload → verify comments preserved
- [ ] 8.6 Add round-trip E2E test: load DOCX with tracked changes → save → reload → verify changes preserved

## 9. Visual Polish & Edge Cases

- [x] 9.1 Enhance comment text highlighting in `renderParagraph.ts`: yellow/amber background with data-comment-id attribute
- [x] 9.2 Ensure insertion mark renders with green color + underline in layout-painter
- [x] 9.3 Ensure deletion mark renders with red color + strikethrough in layout-painter
- [ ] 9.4 Handle overlapping comments (multiple comments on same text): stack highlights with different opacities
- [x] 9.5 Prevent PM focus stealing from sidebar interactions (`onMouseDown` stopPropagation on sidebar)
- [x] 9.6 Add smooth CSS transitions for sidebar open/close animation (200ms ease)
