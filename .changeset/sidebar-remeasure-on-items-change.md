---
'@eigenpal/docx-js-editor': patch
---

Fix comments sidebar not repositioning when comments are added programmatically (e.g. via the agent `addComment` ref). Cards no longer overlap until you click one — heights are now re-measured whenever the items list changes, mirroring the existing re-measure pass that runs on expand/collapse.
