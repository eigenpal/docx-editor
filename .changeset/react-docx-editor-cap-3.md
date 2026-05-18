---
'@eigenpal/docx-editor-react': patch
---

Internal refactor: continue the DocxEditor.tsx cap effort, mirroring Vue's hook decomposition. Three more domain hooks extracted: useContextMenus (right-click text + image menus, contextMenuItems memo, handleContextMenuAction switch — comment-state writes routed through an onAddComment callback), useCommentManagement (controlled/uncontrolled comments routing, floating add-comment button position, new-comment workflow state, commentsRef mirror, orphaned-comments debouncer), and useCommentLifecycle (thread comments under overlapping tracked changes, auto-open sidebar on documents with existing tracked changes). DocxEditor.tsx 2634 → 2234 LOC. No public API change.
