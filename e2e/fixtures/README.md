# Test Fixtures

This directory contains DOCX test fixtures for the Playwright test suite.

## Files

### empty.docx

An empty DOCX document with default Word settings.
Used for testing baseline document state.

### styled-content.docx

A document containing styled content:

- Bold, italic, and underlined text
- Different font sizes
- Paragraph with alignment variations
- Mixed formatting

### with-tables.docx

A document containing tables:

- Simple 3x3 table
- Table with merged cells
- Table with formatted content

### complex-styles.docx

A document with complex styling:

- Custom styles
- Theme colors
- Headers/footers
- Multiple sections

### wrap-none-positioned-image-demo.docx

A synthetic document containing a positioned image anchored with `wp:wrapNone`.
Used to reproduce anchored images that should paint independently without adding
paragraph flow height or text-wrap margins.

### wrap-none-two-seals-title-box-demo.docx

A synthetic title-page document containing two `behindDoc` `wp:wrapNone` images
aligned to the left and right margins around a centered title box. Used to
reproduce multiple non-wrapping anchored images on the same page.

## Generating Fixtures

To regenerate fixtures, run:

```bash
bun run e2e/fixtures/generate-fixtures.ts
```

Or manually create them using Microsoft Word or another DOCX editor.
