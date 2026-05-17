---
'@eigenpal/docx-editor-react': patch
---

Preserve fields, nested SDTs, and math inside inline SDT content on save. Completes #482 by mirroring its parser-side widening in the serializer and PM → Document converter so docProps-bound title fields survive a full load → edit → save round-trip.
