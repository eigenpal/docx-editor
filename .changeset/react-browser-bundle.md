---
'@docx-editor.dev/react': patch
---

The published React bundle no longer crashes browsers on load. The build resolved a bundled dependency through its Node entry, which called `createRequire` at module top level — fatal in any browser without Node shims. The bundle now targets the browser platform; the CommonJS output still loads in Node for SSR.
