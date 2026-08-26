---
'@docx-editor.dev/core': minor
---

Add continuous section breaks. `insertBreak` takes a new `sectionContinuous` kind, the Insert > Break > Section break (continuous) menu row is live, and a next-page break cut from a continuous section now really starts a page. A break that changes where the next section starts is refused while suggesting, because that change cannot be proposed as a tracked one.
