---
'@docx-editor.dev/pro': patch
---

Preserve text and run formatting after repeated concurrent formatting, typing, deletion, and undo. Translate edits through hidden split branches and retain shared character identities across replacement runs.

Full-document collaboration now uses shared schema version 3. Upgrade all participants together. Export older persisted rooms to DOCX with the previous release, then seed new rooms after upgrading. New clients reject incompatible room schemas.
