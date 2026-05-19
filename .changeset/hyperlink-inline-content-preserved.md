---
'@eigenpal/docx-editor-core': patch
---

Render TOC entries with Word fidelity: preserve tabs inside `<w:hyperlink>` (dot leaders no longer collapse) and inherit the TOCx paragraph color instead of the Hyperlink character style's blue + underline. Right-aligned tabs at line edges promote the line to flex layout so trailing page numbers land flush against the right margin without canvas-vs-DOM measurement drift.

Also adjusts hyperlink anchor styling: anchors now inherit color and underline from the wrapping span (which `applyRunStyles` already styles from `run.color` / `run.underline`). The Word-default blue + underline fallback only fires when neither is resolved on the run. Documents with hyperlinks that explicitly set a non-default color or remove the underline will now reflect that, where previously the painter overrode them.
