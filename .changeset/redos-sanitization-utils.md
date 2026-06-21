---
'@eigenpal/docx-editor-core': patch
'@eigenpal/docx-editor-i18n': patch
---

Make regular expressions over file- and library-supplied strings run in linear time and escape quoted font names completely. The variable-detection, plural-message, and core-properties date regexes no longer backtrack polynomially on hostile input, and font family names are now backslash-escaped before being wrapped in a quoted CSS string so a crafted DOCX font name cannot break out of it.
