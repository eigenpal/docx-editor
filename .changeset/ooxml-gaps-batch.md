---
'@eigenpal/docx-js-editor': minor
---

Close 16 OOXML rendering gaps from the post-PR-#421 audit (#423): vertical anchor `align`, the six unhandled `relativeFrom` variants, bare `wp:positionH/V`, image crop (`wp:srcRect`), transparency (`a:alphaModFix`), `wp:effectExtent` shadow padding, rotation pivot, `layoutInCell` / `allowOverlap` round-trip, `w:vanish` / `w:rtl` / `w:effect` per-run, `w:trHeight hRule="exact"` enforcement, and `w:noWrap` on cells. `w:framePr` and `w:cols`-with-anchored-images are preserved on round-trip; visual rendering of those is left as a documented follow-up.
