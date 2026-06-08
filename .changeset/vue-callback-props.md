---
'@eigenpal/docx-editor-vue': patch
---

Add React-parity callback props to the Vue editor: `onChange`, `onError`, `onSelectionChange`, `onEditorViewReady`, and the comment lifecycle callbacks `onCommentAdd`, `onCommentResolve`, `onCommentDelete`, `onCommentReply`, and `onCommentsChange`. Hosts can now observe document, selection, and comment changes via props alongside the existing Vue events. Part of #720.
