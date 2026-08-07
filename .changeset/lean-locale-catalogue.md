---
'@docx-editor.dev/i18n': minor
---

The catalogue drops 456 keys nothing renders, mostly strings for dialogs that no longer ship, and every community locale is pruned to match. `TranslationKey` and `LocaleStrings` narrow accordingly, so naming a removed key is now a type error rather than a lookup that returned nothing visible.
