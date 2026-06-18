---
'@eigenpal/docx-editor-react': patch
---

Fix severe typing and undo/redo latency when editing large documents that contain many comments and tracked changes. Sidebar anchor positions were resolved with a full page scan per comment/suggestion, so an edit near the start of a long review document spent seconds remapping every anchor. The scan now resumes from the previously matched page, cutting start-of-document keystroke latency from seconds to well under the responsiveness budget. Fixes #896.
