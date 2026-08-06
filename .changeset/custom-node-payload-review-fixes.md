---
'@docx-editor.dev/pro': patch
---

Fixes three ways a custom node's payload could be lost: exporting a node with `preserveOnExport: false` no longer leaves its payload in a store a surviving node keeps alive, the open-time orphan sweep no longer collects a payload a header or footer still binds, and `updateCustomNode` without `data` now carries the existing payload forward instead of dropping it (pass `data: null` to remove one). A definition no longer needs a `reviewCard` for its nodes to carry `data`, and a binding naming a payload the document does not hold is reported through `onDiagnostic` rather than arriving as silence.
