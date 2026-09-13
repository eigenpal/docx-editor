---
'@docx-editor.dev/core': patch
---

Resolve empty East Asian theme fonts through inherited CJK language hints and supplemental theme faces. Honor the document theme language before run proofing language. Request the selected CJK candidates in live editors and exports before shaping so Chinese, Japanese, and Korean text does not measure in the Latin default face.
