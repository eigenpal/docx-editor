---
'@eigenpal/docx-editor-react': patch
---

Fix `generateHexId` producing `w14:paraId` / `w14:textId` / comment `paraId` / `w16cid:durableId` values above their OOXML `ST_LongHexNumber` caps.

`paraId` / `textId` are capped at `< 0x80000000`; `durableId` is capped at the stricter `< 0x7FFFFFFF`. Half of generated IDs previously landed in `[0x80000000, 0x100000000)` (paraId/textId/comment-paraId violations) and `0x7FFFFFFF` itself was also reachable (durableId violation). Word silently recovers these as "Document Recovery — Table Properties" on open and strict OOXML validators reject them.

The generator now draws from `[0, 0x7FFFFFFE]` — the strictest bound across all consumers — so every ID is valid for every field that uses `generateHexId`.
