---
'@docx-editor.dev/react': patch
---

Bold, italic and underline now work on documents Word wrote. The editor merged a toggle over the run's *cascaded* properties rather than its own, and Word's `styles.xml` puts `w:lang` and `w:noProof` in `docDefaults` — names the run-properties edit does not accept — so the whole change was refused and the button did nothing at all, silently. A formatting change is now written per run, merged over that run's own properties, which also stops a mixed selection being flattened onto the first run's font.
