/_ Copyright (c) 2026 EigenPal, Inc. All rights reserved. Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md. Production use requires a commercial agreement: licensing@eigenpal.com _/

# PDF shaping fixtures

These subsets retain shaping features for the test strings. They are test assets, not bundled application fonts. Their SIL Open Font License is in `OFL.txt`.

Sources downloaded September 18, 2026:

- [Noto Sans Devanagari](https://github.com/notofonts/noto-fonts/blob/main/hinted/ttf/NotoSansDevanagari/NotoSansDevanagari-Regular.ttf)
- [Noto Sans CJK JP](https://github.com/notofonts/noto-cjk/blob/main/Sans/OTF/Japanese/NotoSansCJKjp-Regular.otf)

Reproduce using FontTools `pyftsubset` with `--name-IDs='*' --name-languages='*' --name-legacy`, retaining the test strings from `glyphs.test.ts`. Set the CJK subset's CFF FDSelect format to 3 before saving. Fontkit 2.0.4 cannot parse the format-0 FDSelect emitted by FontTools; the source font uses format 3.

The DejaVu tests reuse Core's existing licensed fixtures. Tests do not fetch fonts.

`Collection.ttc` contains regular and bold DejaVu Sans subsets for `Selected face`. It exercises nonzero face selection and retains the license in `DejaVu-LICENSE.txt`.
