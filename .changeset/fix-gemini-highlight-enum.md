---
'@eigenpal/docx-js-editor': patch
---

Fix `apply_formatting` tool schema rejection by Gemini. The `marks.highlight` enum no longer contains an empty string, which Gemini's `GenerateContentRequest` rejects. Pass `"none"` to clear the highlight.
