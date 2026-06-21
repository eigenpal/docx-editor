---
'@eigenpal/docx-editor-react': patch
---

Remove two potential slow-input denial-of-service paths in the React adapter. The data URL MIME parser now uses index math instead of a backtracking regex, and the toolbar test-id helper no longer scans across unmatched parentheses, so neither degrades on long crafted input.
