---
'@eigenpal/docx-editor-core': patch
---

Footnote and endnote reference marks are now superscript only when their character style (or run) actually specifies it, matching Word. Previously every anchor was force-raised, so an unstyled anchor (e.g. Pandoc output with a bare `<w:r><w:footnoteReference/></w:r>`) rendered superscript in the editor while Word showed it at the baseline. Superscript now flows solely from the resolved `FootnoteReference`/`EndnoteReference` style chain or the run's own `vertAlign`.
