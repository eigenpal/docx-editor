---
'@eigenpal/docx-editor-react': minor
'@eigenpal/docx-editor-vue': minor
---

Add `commentsSidebarOpen` and `onCommentsSidebarOpenChange` to `<DocxEditor>` for controlling the comments sidebar's visibility. When `commentsSidebarOpen` is set it becomes the source of truth; `onCommentsSidebarOpenChange` (React prop / Vue `comments-sidebar-open-change` event) fires whenever the editor wants to open or close it. Lets consumers that hide or replace the toolbar (`showToolbar={false}`) toggle the sidebar themselves, or open it programmatically. Omit both to keep the default self-managed behavior.
