# DOCX Fixtures

This directory retains reusable DOCX fixtures and supporting source assets that
exercise OOXML import, export, layout, pagination, headers/footers, floating
objects, tables, notes, content controls, and related document behaviors.

The files fall into three broad groups:

- Minimal synthetic fixtures such as `empty.docx`, `styled-content.docx`, and
  `with-tables.docx`.
- Regression-oriented documents covering specific OOXML structures such as
  floating text boxes, footnotes/endnotes, tracked changes, header/footer
  variants, image layout modes, TOC tabs, and content controls.
- Supporting source assets used to regenerate fixtures, including
  `generate-fixtures.ts`, `build-embedded-font-fixture.mjs`, and the image
  assets in `demo/`, `test-image.png`, and `wide-test-image.png`.

## Regenerating Fixtures

Some fixtures can be regenerated directly from this directory:

```bash
bun run e2e/fixtures/generate-fixtures.ts
bun e2e/fixtures/build-embedded-font-fixture.mjs
```

Additional fixture builders live under `scripts/`:

```bash
bun scripts/create-issue-472-floating-textbox-fixture.mjs
bun scripts/create-footnote-bottom-overflow-fixture.mjs
bun scripts/create-footnote-overlap-regression-fixture.mjs
bun scripts/create-empty-table-row-vmerge-fixture.mjs
bun scripts/create-table-cell-selection-drag-fixture.mjs
bun scripts/create-toc-hyperlink-fixture.mjs
bun scripts/create-inline-checkbox-controls-fixture.mjs e2e/fixtures/inline-checkbox-controls.docx
```

If a fixture does not have a checked-in generator, preserve the document and any
adjacent source assets so its OOXML structure remains inspectable.
