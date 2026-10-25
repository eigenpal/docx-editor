---
'@docx-editor.dev/core': patch
---

A click now selects a chart as an object without handles in every state, so Delete removes it, a chart whose fallback picture does not load shows a chart placeholder that says the chart is not shown, and copy or cut of a selection that includes a chart is refused. The editor and PDF export no longer wait for a drawn chart's fallback picture, and Markdown export leaves out a chart whose fallback picture does not load in time instead of failing.
