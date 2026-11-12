---
'@docx-editor.dev/core': minor
---

Add a Format shape pane in React and Vue that sets the fill, transparency, outline color, and outline width of the selected shape or of one shape inside a group, with `useSelectedShape` for custom panes and theme colors that save as theme references. `EditorPaneId` gains `'shape'`, so add a default branch to exhaustive switches over it, and pass `{ panes: ['chart', 'shape'] }` to `usePaneRequest` to receive Format shape requests.
