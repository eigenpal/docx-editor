## Why

The editor currently parses DOCX comments and tracked changes (insertions/deletions) from files but provides no interactive UI for viewing, creating, or managing them. Users need a full commenting and suggestion workflow — identical to MS Word and Google Docs — to collaborate on documents. Without this, the editor is limited to solo editing and cannot serve team document workflows.

## What Changes

- **Comments sidebar panel** — right-side panel displaying all comments anchored to their text ranges, with threading (replies), resolve/reopen, and delete capabilities
- **Add comment flow** — select text → add comment via toolbar button or keyboard shortcut, with author metadata
- **Suggestion mode (track changes)** — toggle between "Editing" and "Suggesting" modes; in suggesting mode, all edits become tracked insertions/deletions with author+date metadata
- **Track changes review UI** — accept/reject individual changes or all changes, with visual indicators (green underline for insertions, red strikethrough for deletions)
- **Document layout shift** — when comments or tracked changes are present, shift the document left and display the comments/changes panel on the right, connected to their anchored text via leader lines
- **Comment highlighting** — enhanced visual indicators on commented text ranges in the document
- **Keyboard shortcuts** — Ctrl+Alt+M to add comment (matching Google Docs), Ctrl+Shift+E to toggle suggestion mode
- **Round-trip serialization** — save comments and tracked changes back to DOCX format (comments.xml, comment ranges, revision markup)

## Capabilities

### New Capabilities

- `comment-sidebar`: Right-side panel for viewing, creating, replying to, and resolving comments with leader lines connecting to anchored text
- `suggestion-mode`: Toggle between Editing and Suggesting modes; in Suggesting mode all edits produce tracked insertions/deletions
- `track-changes-review`: UI for accepting/rejecting individual or all tracked changes
- `document-layout-shift`: Responsive layout that shifts document left when sidebar is active, maintaining WYSIWYG page rendering

### Modified Capabilities

<!-- No existing specs to modify -->

## Impact

- **Layout system** (`PagedEditor.tsx`, `renderPage.ts`) — must support dynamic width/position changes when sidebar opens
- **ProseMirror extensions** — enhance `CommentExtension`, `InsertionExtension`, `DeletionExtension` with commands; add suggestion-mode input rules
- **Toolbar** (`Toolbar.tsx`) — add comment button, suggestion mode toggle, accept/reject controls
- **Selection tracker** (`selectionTracker.ts`) — detect comment/change marks at cursor for sidebar highlighting
- **Components** — new `CommentsSidebar`, `CommentThread`, `TrackChangesBar` components
- **Serialization** (`fromProseDoc.ts`, serializer/) — round-trip comments and tracked changes to DOCX XML
- **CSS** — new sidebar styles, leader line rendering, document shift animations
