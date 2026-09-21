# PDF validation

This document records what the PDF exporter is tested against, how to reproduce the results, and what the measurements show. The exporter is in this private package under the EigenPal Pro License. LibreOffice runs only in the comparison script. No conversion implementation is in an open-source adapter or demo.

Pixel fidelity with any other renderer is not claimed. The numbers here are measurements, not a fidelity guarantee.

## Method

Fidelity is measured by rendering both PDFs to images and counting pixels that differ by more than a fixed threshold. The denominator is the whole page, blank margins included, so a percentage here is not a "fidelity score" and small values are not directly comparable across documents with different amounts of ink.

Two reference sets are used. One comes from LibreOffice, which the comparison script drives in an isolated profile. The other comes from Microsoft Word on a developer machine, exported without markup. Reference PDFs are hash-bound to their source so a stale reference cannot be compared by accident.

Renderer choice changes the result on some pages, so a page is not declared fixed on the strength of one rasteriser.

## Reproduce

From this package, with LibreOffice and Poppler installed:

```sh
bun run compare:libreoffice
bun test test
```

The report is written to `.cache/pdf/libreoffice-comparison/` at the repository root. The script takes a DOCX path and an output directory, uses an isolated temporary LibreOffice profile, and preserves the input bytes.

For the full corpus, with Bun, LibreOffice, Poppler, Python and `uv` available, run from the repository root:

```sh
uv run --with pillow --with pymupdf python packages/docx-to-pdf/scripts/benchmark.py \
  --output .cache/pdf/benchmark-new
```

The output directory must be empty. Add explicit DOCX paths to test a selected corpus. Use `--max-reference-pages` to raise the raster budget. Every conversion has a hard subprocess deadline. Memory is measured, not capped, by this developer harness.

To compare against an existing reference PDF:

```sh
uv run --with pillow --with pymupdf python packages/docx-to-pdf/scripts/pdf-visual-diff.py \
  reference.pdf native.pdf --output .cache/pdf/word-new --dpi 144 --text-backend mupdf
```

Benchmark tooling stays under the EigenPal Pro License. Pillow and PyMuPDF are development tools, not production converter dependencies.

## Coverage: what converts, and what does not

A strict export of the 99 `e2e/fixtures` documents plus the editor sample, 100 inputs and 1,722 pages, splits as follows.

| Result                           | Inputs |
| -------------------------------- | ------ |
| Exported under the strict policy | 73     |
| Refused as unsupported           | 26     |
| Could not be opened              | 1      |

Every one of the 26 refusals produces a PDF under `fidelityPolicy: 'best-effort'`, with the dropped content named in `result.diagnostics`. None of them fails a second time. The refusal is a policy, not a limit: strict export declines to approximate, and best-effort reports what it approximated.

Five kinds of content block a strict export. A document can carry more than one.

| Blocking content                               | Inputs | Only blocker |
| ---------------------------------------------- | ------ | ------------ |
| `drawing`, a shape the writer cannot paint     | 18     | 3            |
| `textbox`, whose paint order is not reproduced | 13     | 0            |
| `unshaped-text`, a span Core could not shape   | 8      | 5            |
| `core-legacy-drawing`, VML                     | 2      | 2            |
| `image-effects`                                | 1      | 1            |

Textboxes never block alone; every textbox document also carries a drawing the writer refuses. The exported 73 raise one non-blocking note between them, an `information` diagnostic for a picture bullet.

The single input that does not open is `textbox-test.docx`. Its `/word/document.xml` is well-formed, and `xmllint` accepts it, but its `mc:Ignorable` names two prefixes the file never declares, which Part 3 requires to resolve. Word refuses the same file: driven through the same automation that opens a valid fixture and reads its text, Word opens no document for it. The reader's refusal matches Word, so this is a malformed fixture rather than a defect.

## Corpus results

Twenty corpus documents have a Word reference. Against them:

| Measure                            | Count |
| ---------------------------------- | ----- |
| Documents under 1% overall         | 18    |
| Documents with every page under 1% | 16    |

The four documents that still exceed 1% on their worst page are `issue-740-header-zero-distance.docx`, `issue-483-firstline-marker.docx`, `float-wrap-comprehensive-test.docx` and `footnote-overlap-regression.docx`. Their remaining differences are characterised in the team's engineering record and are tracked separately.

## Comprehensive editor sample

Input: `examples/vite/public/sample.docx`, unchanged. The PDF demo serves the same bytes. It is the 50-category element test document, not a simplified fixture.

Cross-checked against LibreOffice on macOS, which produces the same 27 pages. Native strict export completes with no unsupported-content diagnostics. A separate test turns off installed fonts and verifies the packaged-font path also produces 27 pages.

The regression checks searchable small caps, font variants, checkbox glyphs, Japanese, Chinese, Korean, Arabic, note text, equations, native comments, and the final document marker. Core receives glyph fallback before measuring, so the PDF writer does not change fonts after pagination. The installed-face path prefers Word fonts from known OS filenames; these are read locally and never redistributed. Packaged substitutes remain available.

## Output size and memory

Glyphs on one baseline travel in a single text-showing array after one matrix, rather than one matrix per glyph. On the 521-page fixture the export falls from 6,447,033 to 4,835,882 bytes, and its peak JavaScript heap from 460 to 378 MB. The change is fidelity-neutral: a full corpus pass at that revision reproduced every measured comparison exactly.

The demo server gives its conversion worker a bounded heap, default 512 MiB and settable with `WORKER_HEAP_MB`. The 521-page document succeeds at 512 MiB and fails at 384 and 320. A worker out-of-memory condition answers 507 with a message naming the limit, rather than a generic failure. This was verified end to end at a 64 MiB ceiling.

## Known differences worth investigating

- Renderers differ in super/subscript sizing and paragraph-mark rules. Core's explicit paragraph-mark and superscript behaviour stays covered by its own regression tests.
- Packaged Georgia/Verdana substitutes, CJK/Arabic fallback faces, and the math face can have different outlines and metrics from a particular office installation.
- Emoji use searchable monochrome Noto glyphs. LibreOffice can use color system emoji.
- Core's structured equation layout differs from LibreOffice's math typesetting.
- The TOC's authored cached page numbers are preserved; this exporter does not rebuild it.
- Some line-breaking differences remain where a table's column widths are resolved by the autofit algorithm rather than taken from the authored grid.

These are areas where renderers legitimately disagree, recorded so a difference found here is not mistaken for a defect. Unsupported structural content still fails strict export, including textboxes, rotated table-cell text, advanced image effects, and unmodeled equation fallbacks.

## Checks completed

- Native exporter regression tests, including the real demo without installed fonts.
- Core layout/export and Markdown test files across the workspace suite.
- Node worker conversion, malformed input, cancellation, busy handling, and recovery.
- Browser conversion and download of the editor demo.
- Poppler review of every page; PDF.js review of equations, international text, and the final table/endnotes page.
- ESM/CJS builds, types, lint, API checks, neutral-lane boundaries, license headers, binary asset hashes, third-party notices, and the workspace lockfile.
