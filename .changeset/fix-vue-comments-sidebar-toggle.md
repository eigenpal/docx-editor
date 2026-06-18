---
'@eigenpal/docx-editor-vue': patch
---

Fix the Vue comments-sidebar toggle being stuck closed. The new `commentsSidebarOpen` prop is a Boolean, and Vue casts an absent Boolean prop to `false`, so the editor read it as controlled-closed and the toolbar button could never open the sidebar. It now defaults to `undefined` (uncontrolled), matching React.
