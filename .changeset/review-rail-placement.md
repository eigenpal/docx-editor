---
'@docx-editor.dev/react': patch
---

The review rail now measures its position from client rects, so a host that positions its own page wrapper no longer lands the cards on top of the document. Rail furniture no longer pushes every card down by its own height, a custom node's context-menu card wraps instead of stretching the whole menu, the editing-mode menu right-aligns to its pill so a toolbar-end control no longer opens off-screen, and submenu panels place themselves in client space rather than being clipped by the context menu's own scroller.
