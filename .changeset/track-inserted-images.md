---
'@eigenpal/docx-editor-core': minor
---

Track inserted and deleted images as real tracked changes in suggesting mode. A picture added (or removed) while suggesting now carries the insertion/deletion mark, paints with a revision outline, shows a review card, and is accepted/rejected with the rest of the change — and round-trips to `<w:ins>`/`<w:del>` like Word. The mechanism is generic to inline atom nodes, so other elements (shapes, …) plug in the same way.
