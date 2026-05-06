---
'@eigenpal/docx-js-editor': patch
---

Translate the floating page indicator (the "current of total" widget that appears next to the scrollbar while scrolling a multi-page document). It was rendering the literal string `" of "` regardless of the active locale. Fixes #399. New `viewer.pageIndicator` translation key (`"{current} of {total}"`) routes through the same `i18n` prop as the rest of the UI. Also fills in the four remaining `null` keys in `he.json` (`toolbar.open`, `toolbar.openShortcut`, `toolbar.save`, `toolbar.saveShortcut`) so all six shipped locales (de, en, he, pl, pt-BR, zh-CN) are at 100% coverage.
