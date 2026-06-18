---
'@eigenpal/docx-editor-react': patch
---

Fix React toolbar toggle buttons losing their color on hover. The active (selected) button now keeps its dark fill on hover instead of showing a white icon over a near-transparent background, and inactive buttons get a visible hover background. These states are now owned by editor.css tokens rather than Tailwind utilities, which did not dedupe (cn is clsx-only).
