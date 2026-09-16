---
'@docx-editor.dev/core': patch
---

Dashed and dotted borders now paint with visible gaps. The painted rule kept its solid ink fill under the pattern, so every gap showed the same colour and the rule looked solid. This affected paragraph borders (`w:pBdr`) as well as page frames.
