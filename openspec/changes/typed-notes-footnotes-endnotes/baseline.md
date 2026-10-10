# Baseline — typed notes foundation slice

Recorded after landing the canonical/package/store foundation for footnotes and
endnotes on `feat/scoped-header-footer-editing` (layout/surface deferred).

## Focused notes tests (this slice)

```
bun test \
  packages/core/src/store/__tests__/typed-note-nodes.test.ts \
  packages/core/src/store/__tests__/note-lifecycle.test.ts \
  packages/core/src/layout/__tests__/note-numbering.test.ts
```

**26 pass, 0 fail** (canonical parse/serialize/fingerprint, UTF-16 atoms,
dangling diagnostics, insert/delete/convert/cascade/undo, properties,
numbering, TreePackageStore coexistence).

Also green with adjacent store suites:

```
bun test \
  packages/core/src/store/__tests__/typed-field-nodes.test.ts \
  packages/core/src/store/__tests__/tree-package-store.test.ts \
  packages/core/src/store/__tests__/hf-lifecycle.test.ts
```

**74 pass, 0 fail** across those six files combined.

## Gates

- `openspec validate typed-notes-footnotes-endnotes --strict`: valid
- eslint on touched note/package/store files: clean after lifecycle split
- Core `tsc`: notes modules clean; pre-existing HF surface errors in
  `paginated-surface.ts` / `surface-hf-editing.ts` are outside this slice

## Compare with paragraph-editor baseline

`openspec/changes/typed-ooxml-paragraph-editor/baseline.md` last recorded
**2682 pass**. This slice adds focused note foundation coverage without claiming
full-repo no-regression until a fresh full `bun test` is re-measured on a clean
tree after HF+notes land together.

## Explicitly not claimed done

Layout (`note-layout.ts`, story roots for notes, paint, surface scope binding),
chrome slots, React/Vue adapter, and Vue parity remain open (tasks §3 / §5 / §7.1).
