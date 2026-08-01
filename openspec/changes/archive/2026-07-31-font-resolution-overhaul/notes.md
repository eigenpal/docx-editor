# Implementation notes

## Perf gate (task 5.3)

`createLayoutShaping` over the full substitute set (20 faces, 7.1 MB), bun on Apple
Silicon, 2026-07-31:

- load 0: 547.9 ms (includes one-time HarfBuzz wasm init)
- loads 1–3: 42.0 / 42.2 / 41.5 ms (per-load SHA-256 + sfnt validation, ~6 ms/MB)

All of it runs OFF the interactive path: the document opens on the fixed measurer
immediately and swaps via one tree-preserving remount when shaping lands. A cross-load
admission cache (hash → validated face) would shave the ~42 ms repeat cost; not needed
at current sizes.

In-browser verification (vite demo, comprehensive-word-element-test.docx): fonts HUD row
reports `shaped`, full-document layout 105 ms placed 258/258, incremental keystroke
layout 0.1 ms placed 37/258, zero console errors. All 20 substitute faces registered
via `installDefaultFontFaces` under the Word family names and marked `loaded`.

## Post-implementation review round (2026-07-31)

Two independent reviews ran after the tasks completed; every accepted finding is fixed
in this change.

Code review — fixed:

- CRITICAL: `check:fonts-manifest` compared raw text and prettier re-wraps the
  generated manifest, so the new CI step failed on its own PR → check now compares
  parsed (file, byteLength, hash) entries.
- MAJOR: an embedded face with a whitespace-only family name (attacker-controlled)
  threw out of `fontRequestKey` during composition and killed the WHOLE resolution,
  explicit fonts included → such faces now drop per-face with a typed `malformed`
  report (regression test added).
- MAJOR: `load()` superseding an in-flight resolution with a document that starts no
  font work left `fontMeasurement().resolving` stuck true forever → `loadBytes` resets
  the flag (regression test added).
- MAJOR: the fonts package was configured as publishable but unbuildable/ignored →
  marked `private` until the v2 publish cutover; changeset wording adjusted.
- MINOR: `installDefaultFontFaces` overlapping-call race (StrictMode double effect)
  → per-FontFaceSet started-keys guard. Stale `parseError` surviving a
  load-while-detached → cleared when stashing pending bytes. Embedded faces shadowed
  by explicit sources no longer spend budget or hashing time.
- Deferred (bounded, pre-existing caps): a crafted file can still cost up to
  64×16 MB deobfuscation copies plus ≤128 MiB synchronous hashing on open, and
  admitted bytes are hashed twice (once here, once at snapshot admission). Follow-up:
  thread the precomputed hash through, consider a tighter embedded aggregate default.

DX review — applied: `fonts` prop (core config + both adapters) now accepts a bare
`FontConfigurationFragment`; Vue's `fonts` prop was wrongly `required: true` → optional
like React's; `composeFontConfiguration`/`loadFonts` + types re-exported from both
adapter barrels; empty-but-present configuration now reports a clear `missing` error
instead of a nonsense byte-limit one; JSDoc on the prop in all three places; demo wires
`onFontError` and logs `loadDefaultFonts` failures; guide gained an "Observing font
state" section, the hash-verification claim was corrected to pinned-hash-only, and the
`{}` base boilerplate was dropped everywhere. Deferred: `getFontMeasurement` naming
alignment, folding `{measurer, resolving}` into `EditorSnapshot`, a `useDefaultFonts`
React hook, per-family requested-but-uncovered coverage reporting, and the
docs-vs-workspace import-specifier unification (docs say `@docx-editor.dev/core/editor`,
the workspace package is the private `@docx-editor.dev/core-contract` until the core
migration renames it).

## Deviations from tasks.md

- 4.1 said "fixed-version release group membership": the package is instead added to
  the changesets IGNORE list, alongside `@docx-editor.dev/core-contract` — on this
  branch core itself is unpublished, and `@docx-editor.dev/fonts`' engine-facing tests
  devDepend on it. Joining the fixed release group is part of the v2 publish cutover.
- 2.5's "checked-in fixture" is instead built in-memory by the test
  (`embedded-font-autowire.test.ts` obfuscates the DejaVu test fonts per §2.8.1 at
  runtime), so no binary fixture enters the repo and the obfuscation path itself is
  exercised.
- 2.2's docDefaults-derived `defaultFont` is deferred (open question in design.md):
  the zero-config synthesized configuration uses Calibri/22 (`WORD_DEFAULT_FONT`).
