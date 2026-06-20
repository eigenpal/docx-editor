---
'@eigenpal/docx-editor-core': patch
---

Chinese, Korean, and Japanese documents now render and measure with the matching Noto webfont instead of a system fallback. CJK theme typefaces — by their native or romanized name (e.g. SimSun, Malgun Gothic, PMingLiU, MS Mincho) — map to the corresponding Noto Sans/Serif SC/TC/KR/JP family, and the font loader fetches that family rather than the unresolvable raw name.
