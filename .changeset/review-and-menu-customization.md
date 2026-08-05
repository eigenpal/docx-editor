---
'@docx-editor.dev/react': minor
---

Five additions to the customization surface, each one a gap a host had to work around:

- `DocxEditor.Review` takes a `t` label resolver, like every other compound, and a `card={{ className }}` for the card box itself.
- `DocxEditor.Review` accepts a render prop as its children, replacing the packaged card while keeping the rail's anchoring, stacking and virtualization.
- A custom node's review card honours the same part overrides as every other kind, and carries `data-node-name` so a theme can tell one definition's cards from another's.
- `DocxEditor.Menu.Group` and `DocxEditor.ContextMenu.Group` — a named section of rows with a real `role="group"` taking its heading as the accessible name.
- `useEditorCaret()` returns the caret as `{ paragraphId, offset }` — the shape the write APIs take as their `at`, and reference-stable so it can be captured in a handler.

An avatar with no author renders nothing rather than a blank disc, and rail `furniture` unmounts when the pane is shut — a closed rail is a 32px marker strip, and content laid out for the open column has nowhere to go in it.
