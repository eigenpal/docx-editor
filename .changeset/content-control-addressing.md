---
'@eigenpal/docx-editor-core': minor
---

Add a content-control (SDT) addressing API to the headless surface. `findContentControls`/`findContentControl` discover block-level content controls by tag, alias, id, or type and read their text plus modeled state (`showingPlaceholder`, `checked`, `dateFormat`, `listItems`, `dataBinding`); `setContentControlContent` fills a control by tag (string or block content) and `removeContentControl` deletes or unwraps one. Edits preserve the control's identity and raw properties so the document still round-trips, clear the `w:showingPlcHdr` placeholder flag when writing real content, and refuse locked controls, typed controls (dropdown/date/…), and repeating-section unwraps unless forced. Makes content controls usable as stable anchors for templates and document automation.
