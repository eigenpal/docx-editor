---
'@docx-editor.dev/agents': patch
---

Add reference-only Office.js Word API compatibility infrastructure: an allowlisted `Word.*`/`OfficeExtension.*` subset manifest, an independently authored `DocxEditor` namespace of public interfaces, an offline conformance generator that strictly checks every selected overload against a normalized upstream reference fixture, and a scheduled drift-check workflow. No proxy runtime ships yet; this only freezes the contract future work will be built against.
