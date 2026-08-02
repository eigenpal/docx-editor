---
'@docx-editor.dev/react': patch
---

The save/reopen check now covers what a document is made of, not just its paragraph text. It read one level into each property, so a paragraph could lose the list it belonged to, its borders or its tab stops and still be reported as unchanged; it collected paragraphs and nothing else, so every table property, cell span and page setup was unchecked and a table flattened into loose paragraphs looked identical to the table; and it skipped the numbering, styles and settings parts entirely, so a list definition could lose eight of its nine levels in silence. All of it is checked now, containment included.
