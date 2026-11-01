---
'@docx-editor.dev/core': patch
---

Documents that turn off automatic paragraph spacing now keep each paragraph's own space before and space after, including list items and paragraphs at the edges of table cells, headers, footers, and notes. An empty paragraph with a hidden mark before a table no longer keeps a blank line because of automatic space before alone.
