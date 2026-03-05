## Context

The Eigenpal DOCX Editor uses a dual-rendering architecture: a hidden ProseMirror instance handles editing state while a layout-painter system renders visible pages. The editor already has foundational infrastructure for comments and tracked changes:

- **CommentExtension** mark (yellow highlight, `commentId` attribute)
- **InsertionExtension** / **DeletionExtension** marks (green underline / red strikethrough, with `revisionId`, `author`, `date`)
- **Comment parser** (`commentParser.ts`) that reads DOCX `comments.xml`
- **Document types** (`Comment`, `CommentRangeStart`, `CommentRangeEnd`, `TrackedChangeInfo`)
- **Revision system** for baseline snapshots and diff-on-save

However, there is no interactive UI — no sidebar, no add-comment flow, no suggestion mode toggle, no accept/reject workflow. The document always renders centered with no awareness of sidebar panels.

Current layout: pages centered in a flex container at 816px width (US Letter), with 24px gap between pages.

## Goals / Non-Goals

**Goals:**

- Interactive comment sidebar with create, reply, resolve, delete operations
- Suggestion mode where all edits become tracked insertions/deletions
- Accept/reject UI for tracked changes (individual and bulk)
- Document shifts left when sidebar is active, with leader lines connecting comments to text
- Full DOCX round-trip for comments and tracked changes
- Keyboard shortcuts matching Google Docs conventions

**Non-Goals:**

- Real-time collaboration (multi-user simultaneous editing) — this is offline/single-user
- Comment notifications or email integration
- Track changes history/timeline view
- Granular per-user color coding for multiple authors (single author for now)
- Mobile/responsive sidebar (desktop only)
- Comment export to formats other than DOCX

## Decisions

### 1. Sidebar placement: Right side, absolute positioning

**Decision**: Place the comments/changes sidebar as an absolutely-positioned panel on the right side of the editor container, similar to how `DocumentOutline` works on the left.

**Alternatives considered**:

- **Floating popover per comment**: More like Google Docs, but complex to position across paginated layout, and becomes unmanageable with many comments
- **Bottom panel**: Doesn't match Word/Docs UX, poor for long comment threads

**Rationale**: Right-side sidebar is the standard pattern in both Word and Docs. The existing `DocumentOutline` component provides a proven pattern. Absolute positioning within the editor container keeps the sidebar scrollable with the document.

### 2. Document layout shift: CSS transform on pages container

**Decision**: When the sidebar opens, apply a CSS `transform: translateX(-<offset>px)` to the pages container, shifting all pages left by half the sidebar width. The sidebar width is 320px, so pages shift left by 160px.

**Alternatives considered**:

- **Reduce page scale**: Would break WYSIWYG fidelity
- **Shrink container width**: Would trigger re-layout of all content, expensive and changes text flow
- **Overlay sidebar on top of content**: Obscures document text, poor UX

**Rationale**: CSS transform preserves the exact page rendering (no re-layout) while centering the visual composition between document and sidebar. Smooth transition with CSS animation.

### 3. Leader lines: SVG overlay connecting comments to text

**Decision**: Render an SVG layer between the document and sidebar that draws connecting lines from commented text ranges to their corresponding sidebar cards. Use `RenderedDomContext.getRectsForRange()` to get text positions, and the sidebar card DOM position for endpoints.

**Alternatives considered**:

- **CSS borders/pseudo-elements**: Can't draw diagonal/curved lines
- **Canvas overlay**: Harder to integrate with React, no DOM events
- **No leader lines**: Confusing when many comments exist — user can't tell which comment belongs to which text

**Rationale**: SVG provides clean vector lines, integrates well with React, supports hover highlighting, and can be positioned absolutely over the editor.

### 4. Suggestion mode: ProseMirror appendTransaction plugin

**Decision**: Implement suggestion mode as a ProseMirror plugin that intercepts transactions via `appendTransaction`. When suggestion mode is active, the plugin wraps all text insertions in `insertion` marks and converts deletions to `deletion` marks (hiding text visually via strikethrough rather than removing it from the document).

**Alternatives considered**:

- **Override individual commands**: Fragile, would need to wrap every editing command
- **Custom input rules**: Only handles typing, not paste/delete/backspace
- **Separate PM state**: Two documents would be complex to sync

**Rationale**: `appendTransaction` is ProseMirror's standard pattern for transforming edits. It catches all input sources (typing, paste, commands) in one place. The insertion/deletion marks already exist in the schema.

### 5. Comment data storage: PM node attributes + document-level array

**Decision**: Store comment metadata (author, date, content, replies) in a document-level `comments` array (already exists in the Document type). Comment marks in PM reference comments by `commentId`. The sidebar reads from both sources.

**Alternatives considered**:

- **Store everything in PM marks**: Marks can't hold complex nested data (replies, paragraphs)
- **External state management (Redux/Zustand)**: Adds dependency, harder to serialize
- **PM plugin state**: Doesn't survive document reload

**Rationale**: This matches how DOCX stores comments (separate `comments.xml` + range markers in document). The existing `Comment` type already supports threading via `parentId`. Round-trip serialization is straightforward.

### 6. Accept/reject changes: Direct PM transactions

**Decision**: Accepting a tracked change removes the mark and keeps the content (for insertions) or removes both mark and content (for deletions). Rejecting does the inverse. Implement as PM commands dispatched from toolbar/sidebar buttons.

**Alternatives considered**:

- **Batch operations with undo grouping**: More complex, but "accept all" needs this — implement via a single transaction that processes all changes

**Rationale**: Simple transaction-based approach leverages PM's built-in undo history. Each accept/reject is one undoable step.

## Risks / Trade-offs

**[Performance with many comments]** → Leader line recalculation on every scroll/layout change could be expensive. **Mitigation**: Use `IntersectionObserver` to only compute lines for visible comments; debounce recalculation; use `requestAnimationFrame` for SVG updates.

**[Layout shift jank]** → Document shifting left on sidebar open could feel jarring. **Mitigation**: CSS transition (200ms ease) for smooth animation. Persist sidebar state so returning users don't get surprised.

**[Suggestion mode complexity]** → `appendTransaction` must correctly handle every edit type (typing, paste, delete, split, join). Edge cases with list items, tables, images. **Mitigation**: Start with text-only suggestion mode; defer complex structural changes. Add comprehensive E2E tests for each input type.

**[Comment positioning accuracy]** → Comments anchored to text ranges may drift if text is edited between the range boundaries. **Mitigation**: Use PM's mark-based tracking which automatically adjusts positions as the document changes. Marks move with their text content.

**[DOCX round-trip fidelity]** → Complex comment threading and tracked change nesting may not perfectly round-trip through all Word versions. **Mitigation**: Test with Word 365 and LibreOffice. Start with simple cases (single-level replies, non-overlapping changes).

## Open Questions

1. **Should suggestion mode be persisted in the DOCX file?** Word stores this in document settings. For MVP, keep it as editor-only UI state.
2. **How to handle overlapping comments?** Multiple comments on the same text range — stack highlights with different opacities? Defer to phase 2.
3. **Should resolved comments be hidden or shown dimmed?** Google Docs hides them; Word shows them dimmed. Start with a toggle to show/hide resolved.
