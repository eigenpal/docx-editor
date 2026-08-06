---
'@docx-editor.dev/core': patch
---

Review and navigation now land in the story they name: accepting or rejecting a header or footer card leaves the caret inside that story instead of throwing it into the body (after which every keystroke was silently refused), replying to a header or footer card writes into that part instead of being refused, and jumping to a body search hit or outline heading leaves an open header or note first.
