---
'@docx-editor.dev/core': patch
---

Rapid typing no longer reorders characters when a deferred paint leaves the DOM caret behind the model. Native and touch carets that return to that leftover offset still edit there.
