---
'@eigenpal/docx-editor-vue': patch
---

More React parity for the Vue editor: clicking the empty sidebar background now collapses an expanded comment/tracked-change card (it previously stayed open); the zoom control offers the same 50%–200% range and presets as React (was 25%–400%); and the toolbar dropdown triggers expose `aria-haspopup`/`aria-expanded` for screen readers.
