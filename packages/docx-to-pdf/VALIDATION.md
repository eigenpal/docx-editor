# PDF validation

The native exporter remains in this private package under the EigenPal Pro License. LibreOffice runs only in the comparison script. No conversion implementation was moved into an open-source adapter or demo.

## Comprehensive editor sample

Input: `examples/vite/public/sample.docx`, unchanged. The PDF demo now serves the same bytes. It is the 50-category element test document, not a simplified fixture.

Cross-checked against LibreOffice 26.2.3.2 on macOS, which produces the same 27 pages. Native strict export completes with no unsupported-content diagnostics. A separate test turns off installed fonts and verifies the packaged-font path also produces 27 pages.

The regression checks searchable small caps, font variants, checkbox glyphs, Japanese, Chinese, Korean, Arabic, note text, equations, native comments, and the final document marker. Core receives glyph fallback before measuring, so the PDF writer does not change fonts after pagination. The installed-face path prefers actual Word fonts from known OS filenames. Packaged substitutes remain available.

The comparison report renders every page through Poppler and records both text streams. Its HTML view offers paired pages and an overlay. It does not turn a matching page count into a pixel-fidelity claim.

## Known differences worth investigating

- Renderers differ in super/subscript sizing and paragraph-mark rules. Core's explicit paragraph-mark and superscript behaviour stays covered by its own regression tests.
- Packaged Georgia/Verdana substitutes, CJK/Arabic fallback faces, and the math face can have different outlines and metrics from a particular office installation.
- Emoji use searchable monochrome Noto glyphs. LibreOffice can use color system emoji.
- Core's structured equation layout differs from LibreOffice's math typesetting.
- The TOC's authored cached page numbers are preserved; this exporter does not rebuild it.

These are the areas where renderers legitimately disagree, recorded so a difference found here is not mistaken for a defect. Pixel fidelity is not claimed. Unsupported structural content still fails strict export, including textboxes, rotated table-cell text, advanced image effects, and unmodeled equation fallbacks.

## Reproduce

From this package, with LibreOffice and Poppler installed:

```sh
bun run compare:libreoffice
bun test test
```

The report is written to `.cache/pdf/libreoffice-comparison/` at the repository root. The comparison script accepts a DOCX path and an output-directory path. It uses an isolated temporary LibreOffice profile and preserves the input bytes.

## Checks completed

- Native exporter regression tests, including the real demo without installed fonts.
- 283 Core layout/export and Markdown test files. One expected pagination golden changed with the cell-height correction; its body line count and text length stayed unchanged, and its updated check passed.
- Node worker conversion, malformed input, cancellation, busy handling, and recovery.
- Browser conversion and download of the actual editor demo.
- Poppler review of every page; PDF.js review of equations, international text, and the final table/endnotes page.
- ESM/CJS builds, types, lint (no errors), API checks, neutral-lane boundaries, license headers, binary asset hashes, third-party notices, and workspace lockfile.

## PR #707 comparison tooling

On 2026-09-18, we ran `scripts/pdf-visual-diff.py` from PR #707, commit `2ce89f6e7`, against the LibreOffice reference and native sample export. This reuses Timur's comparison method without merging the PDFKit exporter.

At 96 DPI, both files have 27 pages. The strong pixel difference (threshold 28) covers 3.1437% of all page pixels. This denominator includes blank margins. It is not a fidelity percentage. The report is `.cache/pdf/pr707-libreoffice-diff/report.json`; each page has a reference/candidate/difference montage.

The script's word-movement metrics are not reliable for this output yet. Poppler groups our line-level `ActualText` into larger text units, so the script matches only 186 units. Its unmatched-word totals must not be treated as missing rendered content. Pixel differences remain useful.

The first Word export attempt timed out. The later benchmark below obtained a clean Word reference. A direct comparison against PR #707's exporter remains pending.

## Expanded fidelity benchmark (2026-09-18)

The benchmark covers 99 top-level E2E DOCX fixtures and the real editor demo: 100 inputs total.

- 71 strict exports completed, producing 1,705 pages. All input file hashes stayed unchanged.
- 28 inputs were refused for unsupported content or unavailable fonts. One malformed XML input was rejected.
- 65 LibreOffice comparisons cover 215 native pages at 96 DPI. Two documents differ in page count: `float-wrap-comprehensive-test` (5 versus 6) and `issue-319-sections` (4 versus 8).
- Five large documents passed export stress checks but exceeded the 30-page raster comparison budget. This includes the 521-page fixture.
- LibreOffice failed to convert `images-compatibility-malformed`. Each reference now runs in an isolated process/profile, so that failure cannot hide later fixtures.
- Successful export time: median 132 ms, 95th percentile 3.16 seconds in the two-worker run. The 521-page fixture took 22.44 seconds and peaked near 5.44 GiB RSS under Bun 1.3.14. Large-document memory use needs more work.

Artifacts: `.cache/pdf/benchmark-v2/index.html` and `report.json`. The report identifies skips, refusals, source hashes, elapsed time, memory, fonts, and per-page montages. Successful measurement is not a fidelity pass.

Microsoft Word 16.113 produced a separate 27-page reference through local Print → PDF with No Markup. The first print with markup shrank the content for the comment margin and was rejected as an invalid comparison. The clean reference is `.cache/pdf/word-reference/sample-clean.pdf`. Word updated fields during printing; date/time, cached fields, and annotation presentation can differ from the exporter.

The clean Word comparison at 144 DPI shows about 3.02% strong changed pixels, including blank margins. This is not 96.98% fidelity. Physical-glyph extraction matches 2,496 words in the initial run, versus only 186 under Poppler's line-level ActualText grouping. Repeated words and tab leaders can still create false text matches. Inspect the montages before diagnosing a reported move.

Verified remaining Word differences include oversized superscripts, different justification wrapping, a TOC entry crossing a page boundary, equation geometry, and some vertical positions. Pixel-perfect fidelity is **not achieved**.

This pass fixed discovery of Word's local Calibri faces and the correct Cambria Math TTC face. These fonts are read locally and never redistributed. It also fixed omitted `w:noBreakHyphen` glyphs in shared layout. Tests preserve the zero-width canonical range, keep the word unbroken, and verify strict PDF extraction. The Markdown fixture contains two such glyphs; its text golden gains exactly those two characters without a pagination change.

## Run the corpus benchmark

With Bun, LibreOffice, Poppler, Python, and `uv` available, run from the repository root:

```sh
uv run --with pillow --with pymupdf python packages/docx-to-pdf/scripts/benchmark.py \
  --output .cache/pdf/benchmark-new
uv run --with pillow --with pymupdf python packages/docx-to-pdf/scripts/test/pdf-visual-diff.test.py
```

The output directory must be empty. Add explicit DOCX paths to test a selected corpus. Use `--max-reference-pages` to raise the raster budget. Every conversion has a hard subprocess deadline. Memory is measured, not capped by this developer harness.

For an existing clean Word PDF:

```sh
uv run --with pillow --with pymupdf python packages/docx-to-pdf/scripts/pdf-visual-diff.py \
  reference.pdf native.pdf --output .cache/pdf/word-new --dpi 144 --text-backend mupdf
```

The pixel comparator and its original tests come from PR #707, commit `2ce89f6e7`. This package adds physical-glyph text extraction and corpus orchestration. Benchmark tooling stays under the EigenPal Pro License. Pillow and PyMuPDF are development tools, not production converter dependencies.

### Verification after the hyphen fix

The corrected native demo remains 27 pages. Its clean Word comparison is `.cache/pdf/word-hyphen-diff/`: 3.015508% strong changed pixels at 144 DPI. The corrected PDF is `.cache/pdf/native-hyphen.pdf`.

Checks passed: 23 exporter tests, 55 isolated Core layout test files, six Markdown tests, 14 comparison-tool tests, and two Node server tests. ESM/CJS builds, types, license headers, formatting, and root lint also passed. Root lint has 94 existing warnings and no errors.

The affected-corpus rerun lives in `.cache/pdf/benchmark-hyphen-final/`. It includes the 521-page stress fixture and four reference comparisons. Main remains unchanged; development stays in the separate `feat/pdf-exporter` worktree.

## Selected fixes from PR #707

Reviewed PR #707 at `2ce89f6e7` in `/tmp/docx-pdf-pr707-comparison`. Kept our positioned-glyph writer and Pro package.

- Adapted the missing paragraph-mark font guard from `cac0249b7`. Core now exposes optional `TextMeasurer.hasResolvedFont`. Approximate metrics from an unavailable mark face no longer enlarge a visible text line. Empty paragraphs still receive fallback height; existing custom measurers keep their previous behavior. This is shared layout behavior, not a second PDF layout engine.
- Adapted the underline gap absorption idea from #707's `pdf-underline-absorption-plan.ts`. Compatible single underlines now cover inter-word justification gaps. Text positions remain unchanged. Color, font, baseline, link, revision, tab, drawing, and float boundaries prevent unsafe joins. The implementation stays in the private Pro package.
- Evaluated Word's 300 dpi text grid without changing pagination. The complete text-grid experiment increased strong changed pixels from 3.015508% to 3.063703% on the clean Word demo reference. Font-size-only snapping gave 3.017435%. Removed both experiments from the implementation. Evidence remains in `.cache/pdf/word-grid-diff/` and `.cache/pdf/word-fontsize-diff/`.

Validation includes real PDF stream geometry for joined underlines, missing-font and empty-paragraph layout cases, and admitted-face availability. The 56-file Core regression run had one 5-second corpus-test timeout under concurrent benchmark load. Its separate rerun passed in 3.21 seconds with a 30-second deadline. All 26 exporter tests pass. Build, types, API extraction, license checks, and lint pass; lint retains 94 existing warnings.

The new full corpus report is `.cache/pdf/benchmark-pr707-ports/index.html`. Benchmark results remain measurements, not a claim of perfect Word fidelity.

The completed rerun took 202.90 seconds: 100 inputs, 71 strict exports, 1,705 pages, and 65 visual comparisons. The 28 unsupported inputs and one malformed XML input remain. There are no new status or page-count changes. The same two LibreOffice page-count mismatches remain. All source hashes stayed unchanged. The real demo PDF is byte-identical to `native-hyphen.pdf`; its measured Word gap remains 3.015508%. These selected fixes address targeted cases and do not reduce that demo's overall gap.

## Shared-engine spacing and memory improvements (2026-09-18)

Modern Word-compatible justified paragraphs can now compress ordinary inter-word spaces to 75% of their natural width. This requires explicit compatibility mode 15. Weighted expansion selection avoids greedily moving extra words onto a line. Legacy modes, paragraph-final lines, tabs, equations, and constrained drawing layouts retain existing behavior. Measurement and painting share the adjusted spacing, including caret advances.

The approach follows the spacing behavior investigated in PR #707, with a stricter floor and expansion preference. Primary implementation references are LibreOffice's [paragraph layout](https://github.com/LibreOffice/core/blob/master/sw/source/core/text/portxt.cxx) and [DOCX compatibility import](https://github.com/LibreOffice/core/blob/master/sw/source/writerfilter/dmapper/DomainMapper.cxx). This is a compatibility improvement, not a universal Word-layout guarantee.

All six lines of the demo's page-22 justified paragraph now match the clean Word reference. Strong changed pixels on that page fell from 4.599405% to 3.305471%. Across all 27 pages, the measurement fell from 3.015508% to 2.967584%, at 144 DPI and threshold 28. The report is `.cache/pdf/word-space-smart-diff/report.json`. Superscript sizing, equation geometry, TOC pagination, and vertical positioning still differ. Pixel-perfect fidelity is not achieved.

The final full-corpus rerun is `.cache/pdf/benchmark-engine-final/index.html`. It took 209.11 seconds: 100 inputs, 71 strict exports, 1,705 pages, and 65 visual comparisons. There were no new failures or page-count changes. The 28 unsupported inputs, malformed XML input, five large raster-budget skips, and LibreOffice conversion failure remain. The same two LibreOffice page-count mismatches remain. All input hashes stayed unchanged.

### Why memory was large

The production HarfBuzz cache previously retained only four font faces. Mixed-font documents repeatedly evicted and reloaded faces. HarfBuzz copies font bytes into WebAssembly memory, and its JavaScript wrappers defer native cleanup to finalization. Reloading fonts faster than collection increased transient memory. Parsed document and layout objects also contributed: the 426 KB stress DOCX expands to roughly 6 MB of document XML before object construction.

The production cache now retains up to 32 faces, subject to a 64 MiB font-byte budget. This preserves the previous effective production byte ceiling. The additive `maxCachedFontBytes` option bounds retention separately from face count. Oversized faces can still shape text without being retained. No private HarfBuzz destruction APIs or forced production garbage collection are used.

A controlled 521-page run changed only the face-count policy. Peak process RSS fell from **4.96 GiB to 2.75 GiB**, about 45%. Both runs produced byte-identical PDFs. Evidence: `.cache/pdf/cache4-control.json` and `.cache/pdf/benchmark-engine-final/typing-perf-521pp-f99292ba/result.json`. The earlier 5.44 GiB result came from a separate benchmark run and is not the controlled baseline.

Two successive real API exports produced identical PDFs. After each export returned, diagnostic garbage collection left approximately 115 MiB and 118 MiB in the JavaScript heap. RSS remained higher because it also includes native allocations and memory retained by allocators. This supports collection of most document objects; it does not prove leak freedom. Evidence: `.cache/pdf/memory-repeat.jsonl`.

To inspect phases:

```sh
bun packages/docx-to-pdf/scripts/profile-memory.ts input.docx
bun packages/docx-to-pdf/scripts/profile-memory.ts input.docx --collect
```

The profiler reports process memory, peak RSS, and JavaScriptCore heap statistics. Its disposed-phase scope still retains the opened handle, so that measurement cannot establish post-API retention. `--collect` is diagnostic only.

The PDF writer also omits repeated font-size operators between unchanged glyph sizes. All 27 demo pages remain pixel-identical to the improved-spacing PDF at every tested threshold. The PDF shrank from 557,934 to 550,563 bytes. Evidence: `.cache/pdf/compact-text-diff/report.json`.

Validation passed: 57 isolated Core layout test files, four focused spacing tests, 41 shaping/cache tests, 26 PDF tests, and six Markdown tests. Core and PDF builds and types pass. API extraction, license headers, line caps, and root lint pass; lint retains 94 existing warnings. New tests cover byte-budget eviction, oversized uncached faces, invalid budgets, and compatibility changes with retained layout caches.

## Broader-document fixes and corrected reference views (2026-09-18)

Three additional defects were identified outside the original demo comparison:

- Shared Core applied retained floating-wrap distances to inline images. ECMA-376 Part 1 §20.4.2.8 requires ignoring these attributes during inline layout. Core now ignores all four distances while preserving the source attributes and effect extents. The six-page `header-inline-image-dist` fixture improves from 13.855830% to 4.250800% strong changed pixels against LibreOffice at 96 DPI. Its header image previously pushed the body downward. The specification was checked against the [official ECMA-376 Part 1 download](https://ecma-international.org/publications-and-standards/standards/ecma-376/).
- PDF cell backgrounds and nested paragraph shading could cover table borders. Table decoration now paints backgrounds and nested content before the table's owned edges. A PDF geometry test samples the final paint at every border center; the paragraph-shading case fails before this fix.
- PDF text applied insertion/deletion decoration in clean revision views. Revision colors, insertion underlines, and deletion strikes now require `all-markup`. Proposed and original views retain authored colors, underlines, and strikes. Tests compare actual PDF commands against equivalent plain text in both modes, with and without authored formatting.

The border fix exposes existing border-position differences in the clean Word demo. Its overall strong pixel difference rises from 2.967584% to **3.049421%**, while every extracted text dictionary remains unchanged. The final demo PDF is byte-identical to `.cache/pdf/native-table-layer.pdf`; its Word comparison is `.cache/pdf/word-table-layer-diff/`. Restoring missing borders is a correctness fix, not a demonstrated reduction of the overall Word pixel gap.

### Reference correctness

The longer-document inspection found that default LibreOffice CLI export displayed revision markup. Native export uses the proposed view. Earlier measurements of tracked documents therefore mixed display modes and must not be interpreted as layout-only differences.

`libreoffice_reference.py` now opens the original DOCX read-only through Writer's UNO API. It sets `ShowChanges=false` and `RedlineDisplayType=0`, then exports PDF without saving the source. The helper installs its developer module only in a disposable profile; source-document macros are disabled. No DOCX-to-ODT intermediate conversion is used. Integration tests verify inserted/deleted content, unchanged source bytes, refusal to overwrite reference evidence, and cleanup of child processes after timeouts.

An initial rerun encountered a macOS window-recovery dialog, including in headless processes. The stalled workers were stopped and the recovery dialog was dismissed. The harness now terminates the entire worker process group on timeout. The recovery problem recurred while another task ran LibreOffice workers. `.cache/pdf/benchmark-proposed-final/`, `.cache/pdf/benchmark-revision-paint/`, and `.cache/pdf/benchmark-clean-final/` are incomplete intermediate runs, not final evidence. Other tasks' processes and personal application profiles were left unchanged.

Font differences also matter. LibreOffice substitutes Carlito for Calibri in the two synthetic long documents; native export reads the local Word Calibri faces. Reference font names and PDF hashes are now recorded alongside native font resolution. Do not attribute all pixel or baseline differences to layout until the fonts match.

The completed pre-reference-correction corpus is `.cache/pdf/benchmark-inline-table/`: 100 inputs, 71 strict exports, 1,705 pages, and 65 comparisons. No native status or page-count changes occurred. All input hashes stayed unchanged. The earlier unsupported and malformed inputs remain. The corrected-view final reports follow below.

For longer visual comparisons, explicitly raise the page budget and deadline:

```sh
uv run --with pillow --with pymupdf python packages/docx-to-pdf/scripts/benchmark.py \
  --output .cache/pdf/long-comparison-new --jobs 1 --dpi 48 \
  --max-reference-pages 250 --comparison-timeout 600 \
  e2e/fixtures/synthetic-long-edit.docx e2e/fixtures/synthetic-tracked-numbered.docx
```

The low-resolution run checks full-document drift and pagination. It is not a substitute for high-resolution typography checks.

New Word captures could not be completed because another active task controlled Word and changed its dialogs. The existing clean Word reference remains the only completed direct Word PDF comparison. LibreOffice results are explicitly secondary evidence.

### Final native and extended visual checks

After all three fixes, `.cache/pdf/benchmark-native-final/report.json` completed all 100 inputs in 117.56 seconds: 71 strict exports, 1,705 pages, 28 unsupported documents, and one malformed XML document. There were no benchmark worker failures or changes in export status or page counts. Every input remained unchanged. This run deliberately launched no reference application.

The two previously skipped synthetic documents now have complete clean-view visual comparisons, covering 356 additional pages at 48 DPI:

| Document | Native/reference pages | Strong changed pixels | Evidence |
| --- | --- | --- | --- |
| `synthetic-long-edit` | 204 / 204 | 15.1145% | `.cache/pdf/long-clean-final/synthetic-long-edit-diff/report.json` |
| `synthetic-tracked-numbered` | 152 / 152 | 7.7728% | `.cache/pdf/long-clean-final/synthetic-tracked-numbered-diff/report.json` |

These are substantial remaining differences, with the Calibri/Carlito substitution described above. They are not measurements against Word. Identical page counts do not establish matching layout.

The final corpus comparison reuses captured references through `.cache/pdf/clean-reference-manifest.json`. References bind the exact source DOCX hash to the reference PDF hash and recorded provenance. Clean-view captures take priority. Older default-view captures are reused only where scanning every `word/*.xml` found no tracked revisions. Tracked documents without clean references remain unmeasured. A corrupt PDF hash was explicitly tested: the benchmark refused comparison. A missing source entry was also tested: no application fallback occurred.

Validation: 30 PDF tests with 141 assertions, 187 Markdown tests with 965 assertions, and 63 isolated Core layout test files pass. The focused drawing suite passes 46 tests, including ignored wrap distances and preserved effect extents. Two reference integration tests and 14 comparator tests pass. Core/PDF builds and types, changed-file lint, license headers, and line caps pass. Root lint has no errors and 92 existing warnings.

Visual triage of the larger remaining short-document gaps found row-height/baseline drift in `floating-table-full-width-paginates` (Arial on both sides), and nested numbering indentation differences in `issue-740-header-zero-distance` (Times New Roman on both sides). The latter's header aligns visually; its filename does not identify the cause of the measured gap. These deserve fresh Word references before changing shared layout to match LibreOffice. `float-wrap-comprehensive-test` also retains a 5-versus-6-page mismatch.

The completed final corpus comparison is `.cache/pdf/benchmark-verified-final/index.html` (204.65 seconds): 100 inputs, 71 strict exports, 1,705 native pages, and 64 comparisons at 96 DPI. Five documents exceed this run's 30-page raster budget. Two lack usable references: `images-compatibility-malformed` and `reviewer-filter`. The two long synthetic documents have the separate completed comparisons above. All input hashes, export statuses, and native page counts match the final native-only run. No worker errors occurred. One reference page-count mismatch remains in these corrected-view comparisons: `float-wrap-comprehensive-test`, with five native pages versus six reference pages. This is not a perfect-fidelity result.

## Saved-reference script sizing pass (2026-09-18)

This pass did not control Word or launch LibreOffice. The user's instruction to leave Word alone remains in effect. The existing clean Word PDF and hash-bound LibreOffice references provided all comparison evidence.

Core's superscript/subscript glyph scale was 75%, duplicated between measurers and painters. The shared `glyphSizeFactorOf` now uses 65% for script text. Canvas, HarfBuzz, deterministic fallback, browser paint, and native PDF paint consume the same policy. The deterministic fallback also now shrinks script advances; previously it shrank only line metrics. Authored character spacing remains an absolute addition.

This is an empirical compatibility improvement, not a universal per-font model. The local Arial, Calibri, and Times New Roman fonts all report `ySuperscriptYSize` and `ySubscriptYSize` of 1331 with 2048 units per em, approximately 65%. The field semantics are documented in Microsoft's [OpenType OS/2 specification](https://learn.microsoft.com/en-us/typography/opentype/otspec190/os2). Core does not yet select different script scales per face or emulate Word's output-device rounding.

The saved Word demo emits 6.96pt for its 11pt super/subscript text and 6.48pt for 10pt note markers. Native output changes from 8.25pt to 7.15pt and from 7.5pt to 6.5pt. Thus the remaining size differences are 0.19pt and 0.02pt. Tests parse real PDF text transforms, compare these sizes within 0.24pt, and ensure following text starts at the painted script end.

The 27-page Word comparison improves from **3.049421% to 3.025923%** strong changed pixels at 144 DPI. Only pages containing script text changed. Page 12, containing footnotes, improves from **1.608507% to 1.240551%**. Page 27 improves from **7.740291% to 7.501176%**. Evidence: `.cache/pdf/native-script65.pdf` and `.cache/pdf/word-script65-diff/`. This remains a measurable gap, not perfect fidelity.

The table and tab investigations did not justify further layout changes. The labels in `issue-740-header-zero-distance` are typed text followed by tabs, not automatic numbering. Its source contains explicit hanging indents. Differences from LibreOffice alone do not establish that Word would place them differently. No speculative indentation or table-height adjustment was added.

The final rerun is `.cache/pdf/benchmark-script65/index.html`: 100 inputs, 71 strict exports, 1,705 pages, and 64 saved-reference comparisons, completed in 173.72 seconds. Export statuses, native page counts, and source hashes are unchanged. The same 28 unsupported inputs, one malformed XML input, five page-budget skips, and two missing references remain. The final demo PDF is byte-identical to the candidate measured against Word above.

Changed LibreOffice measurements at 96 DPI:

| Document                                          |     Before |      After |
| ------------------------------------------------- | ---------: | ---------: |
| `comprehensive-word-element-test.docx`            |  2.613780% |  2.600430% |
| `endnotes-tracked-changes.docx`                   |  0.490080% |  0.495534% |
| `footnote-bottom-overflow.docx`                   |  6.806229% |  6.689192% |
| `footnote-overlap-regression.docx`                | 12.455089% | 12.396150% |
| `issue-319-sections.docx`                         |  4.282228% |  4.256462% |
| `paragraph-acceptance.docx`                       | 15.006859% | 15.005089% |
| `sample.docx`                                     |  3.191879% |  3.186038% |
| `sdt-custom-node-databinding-word-roundtrip.docx` |  2.667409% |  2.654059% |
| `sdt-custom-node-databinding.docx`                |  2.667409% |  2.654059% |

The tracked-endnote regression is retained explicitly; smaller scripts do not improve every secondary-reference pixel score. Calibri/Carlito font differences still limit those comparisons.

Validation passes: 33 PDF tests (153 assertions), 187 Markdown tests (965 assertions), 46 isolated Core layout test files, and 136 focused measurement/paint tests. Core/PDF types and builds pass. API extraction reports zero errors, with existing documentation warnings. Changed-file lint, line caps, license headers, and `git diff --check` pass. No native application was controlled during this pass.

## TOC and section-spacing pass (2026-09-18)

This pass used saved references and never controlled Word or launched LibreOffice.

Two shared-engine defects contributed to the demo's TOC mismatch:

- A TOC field separator in the opening paragraph makes its paragraph mark part of the cached result. Core previously suppressed that empty result line along with instruction-only field chrome. It now preserves the line. Instruction-only opening paragraphs remain suppressed. A refreshed TOC that places its first entry in the opening paragraph still starts flush, with no extra line.
- A new-page section reset the paragraph spacing-collapse budget. Core now carries the previous paragraph's after-spacing across the boundary, while resetting the vertical cursor. In the demo, 18pt before-spacing correctly collapses against the prior 8pt after-spacing to leave 10pt. Continuous sections retain their existing behavior.

Against the saved Word PDF, the TOC heading baseline changes from 106.295pt to 98.295pt (Word: 98.880pt). Its first entry changes from 130.656pt to 143.305pt (Word: 143.760pt). The continuation entry `10.1 Inline Images` now starts on page 3, matching Word, at 81.958pt versus Word's 82.320pt. The unmodified source and overall 27-page count are preserved.

The combined Word comparison improves from **3.025923% to 2.519373%** strong changed pixels at 144 DPI, threshold 28. The opening-line fix alone measured 3.062606%; both independent spacing defects needed correction. Evidence: `.cache/pdf/word-toc-opening-diff/`, `.cache/pdf/word-toc-carry-diff/`, and `.cache/pdf/native-toc-carry.pdf`.

| Word demo page           |    Before |     After |
| ------------------------ | --------: | --------: |
| 2 — TOC start            | 9.280974% | 5.628126% |
| 3 — TOC continuation     | 5.412633% | 3.716237% |
| 23 — two-column section  | 2.968358% | 1.252259% |
| 24 — landscape section   | 5.170372% | 1.564254% |
| 25 — final section start | 5.881992% | 2.876601% |

All other demo pages have unchanged pixel measurements. The small table-row drift remains under investigation; this pass does not change table border clearances or row heights.

Regression tests distinguish a separator in the opening paragraph from a separator in the first entry. They preserve empty-TOC handling and refreshed entries. New section tests vary preceding after-spacing and verify warm/cold layout equality and unchanged source XML. Existing document-first, hard-page-break, natural-pagination, and section-start spacing tests still pass.

Final corpus evidence: `.cache/pdf/benchmark-toc-carry/index.html`, completed in 252.83 seconds. All 100 inputs retain their prior statuses and page counts: 71 strict exports, 1,705 pages, 28 unsupported documents, and one malformed XML document. There are 64 saved-reference visual comparisons, five raster-budget skips, and two missing references. All source hashes remain unchanged and no benchmark worker errors occurred.

The editor demo and the 521-page stress PDF change; the other 69 strict exports are byte-identical to the prior run. The stress document retains its page count. The final demo is byte-identical to `.cache/pdf/native-toc-carry.pdf`, so the direct Word measurements above describe the final code. Its secondary LibreOffice pixel score changes from 3.186038% to 3.124635%. The known floating-wrap pagination mismatch remains.

Validation passes: 35 isolated Core layout test files, the 36-test focused TOC/spacing run, the additional zero-clamp/cache test, 33 PDF tests, and 187 Markdown tests. Core/PDF builds and types pass. API extraction reports zero errors with existing documentation warnings. Changed-file lint, line caps, and `git diff --check` pass.

Stress readback: the 40 changed pages in the 521-page fixture form 20 repeated TOC page pairs. Each pair preserves its complete body text in order, normalized only for whitespace. Header/footer text geometry on those pages remains identical; drawing geometry across all pages remains identical. Text geometry on the other 481 pages remains identical. Concatenating full-page extraction directly changes where repeated headers/footers interrupt the body stream, so the preservation check separates those regions. Evidence: `.cache/pdf/toc-carry-stress-readback.json`. No matching Word reference exists for the full stress document; this verifies content preservation rather than full Word fidelity.

## Text metrics, tables, notes, and kerning pass (2026-09-18)

The target remains **below 1% strong changed pixels**, excluding only verified font differences. The target is not met. No native application was controlled during this pass.

The shared engine now combines the greatest ascent and descent on mixed-face lines. Previously, independent maximum heights could discard one face's descent. Arial external leading now precedes the baseline. Collapsed table rows reserve half the shared border width. Border spacing converts authored eighth-points to integral twips before reserving space; paint retains the authored stroke width. Border conflicts use the documented weighted widths and color tie-breaks.

Nonempty body paragraphs no longer inherit a larger implicit paragraph-mark floor. Explicit mark formatting, empty paragraphs, and script runs retain their metrics. Marker-only note separators now measure their authored line and paragraph spacing. Their rules use a 144pt width, or the full band for continuation separators. The demo's endnote rule changes from gray, 156pt wide, and 0.75pt thick to black, 144pt wide, and 0.5pt thick.

Fallback glyph faces now contribute their actual ascent and descent. Measurement passes each placed text segment, including chopped and carried words. This fixes a Core mismatch between fallback paint and primary-face line metrics. It does not make different fallback fonts identical. The saved Word demo uses Apple Color Emoji for one ballot-box symbol; our admitted fallback differs.

Run kerning now follows `w:kern` and its font-size threshold. Absent kerning stays disabled. An explicit zero threshold enables kerning at every supported size. The shared shaper, canvas adapter, and browser painter use the same selection. Width caches distinguish the selection. Previously, the shared shaper enabled font kerning by default, despite resolving `w:kern` separately.

Direct Word comparisons use the unchanged demo and saved Word PDF at 144 DPI, threshold 28:

| Candidate                                   | Strong changed pixels |
| ------------------------------------------- | --------------------: |
| TOC and section-spacing baseline            |             2.519373% |
| Mixed-face metrics                          |             2.450533% |
| External leading                            |             1.985066% |
| Collapsed row borders                       |             1.776445% |
| Implicit paragraph marks                    |             1.743189% |
| Integral border twips and separator metrics |             1.599281% |
| Actual fallback-face metrics                |             1.618953% |
| Authored kerning selection                  |               1.2966% |

The fallback fix remains despite its small pixel regression: primary-face metrics must not describe different painted faces. All candidates retain 27 pages. Evidence includes `.cache/pdf/word-note-metrics/`, `.cache/pdf/word-fallback-metrics/`, and `.cache/pdf/word-kerning/`.

The last completed stable full-corpus run before integral border twips, paragraph-mark, separator, fallback, and kerning changes is `.cache/pdf/benchmark-leading-table/`. It contains 100 inputs: 71 strict exports, 1,705 pages, 28 unsupported documents, and one malformed document. All prior export statuses and page counts remain unchanged. It includes 64 saved-reference visual comparisons and confirms unchanged engine inputs. Later changes require a fresh full-corpus run.

Self-review rejected these probes:

- Preserving `nil` and `none` as separate border states added visible edges to the saved Word demo's borderless tables. The change was reverted.
- Earlier paint-only size and baseline rounding produced inconsistent gains. Those probes did not change production geometry.
- Installed Arial versions differ, but decomposed outlines match every tested glyph from three saved Word subsets. Font version alone is not an acceptable exclusion.

At the end of this pass, review items included the TOC leader grid, small baseline differences, table paint, marker-rule color, multiple-marker stories, and strict multi-face glyph fallback. The next pass resolves several of these items. The single marker-rule position still uses a quarter-em approximation. The known floating-wrap pagination mismatch remains. No claim of complete fidelity or zero P2 issues is made.

## Symbol fallback, leaders, and wrapped alignment (2026-09-18)

The saved Word comparison now reports **1.016281%** strong pixel difference at 144 DPI. All 27 pages match. This is an all-pixel raster measure, not a document-feature coverage percentage. No font exclusions apply. The result remains above the requested 1% threshold. The report is `.cache/pdf/word-wrapped-alignment/report.json`. Both DOCX inputs retain SHA-256 `d7b856ff4232c5bb455924bdb45f8d90ac9d90895b59512521a844e7f3f06e5b`.

| Change                                                      | Saved Word strong pixel difference |
| ----------------------------------------------------------- | ---------------------------------: |
| Installed Segoe UI Symbol coverage                          |                          1.153405% |
| Preserve supported primary glyphs around fallback clusters  |                          1.152553% |
| Reserve inherited table border clearance                    |                          1.142769% |
| Shared leader grid and primary-face nonbreaking hyphens     |                          1.039344% |
| Exclude wrapped trailing spaces from center/right alignment |                      **1.016281%** |

Core now composes admitted faces within supported nonjoining script runs. Supported primary glyphs retain their face; missing clusters use admitted fallback faces. Joining scripts retain whole-run fallback to preserve joining context. PDF font selection follows each Core font span. Missing glyphs remain strict-export failures. Fallback work is bounded to 2,048 clusters and 16 requested faces. A missing nonbreaking hyphen can use the primary face's ordinary hyphen glyph. The source Unicode and no-break behavior remain unchanged. Installed symbol fonts are optional trusted inputs; they are not bundled with the exporter.

Browser and PDF painters share Core's tab-leader grid and complete-glyph count. Wrapped center/right alignment retains source ranges and caret advances for trailing spaces. Inherited table borders now reserve space without changing authored border provenance. A follow-up review also fixed partial suppression beside vertically merged cells. That correction checks every adjacent row before removing the inherited clearance. Tests cover LTR and RTL merges with partial and complete suppression.

The completed corpus run is `.cache/pdf/benchmark-alignment/report.json`: 100 inputs, 71 strict exports, 1,705 pages, 28 unsupported inputs, one malformed input, and 64 saved LibreOffice comparisons. It took 158.47 seconds. The engine fingerprint remained unchanged throughout the run: `dba119a620de0f4e2abdb17d3877e7702cd348dfc847ae6f7e3bb159163d9d5c`. Export statuses and page counts match the previous `benchmark-multiface` run. The merged-neighbor follow-up was applied after this full-corpus measurement. Its demo PDF is byte-identical to the measured candidate: `ec4d9c388558ee4fe05c7f7f6ef74e8b5bc0c7a568a4e801439a3f6ea012b621`. All 34 isolated table/RTL regression files pass after that correction. Core type checking, builds, ESLint, license headers, and third-party notices also pass. Core API snapshots were refreshed with zero extraction errors; existing API warnings remain.

Changes above 0.1 percentage points in those LibreOffice comparisons were:

| Fixture                            | Previous error | Current error |
| ---------------------------------- | -------------: | ------------: |
| Form025U                           |        4.9777% |       4.8192% |
| block-sdt-comprehensive            |        9.7481% |      10.3816% |
| empty-table-row-vmerge             |        1.9122% |       2.1946% |
| repeated-table-header              |       13.5017% |      13.3730% |
| vmerge-row-span                    |        5.9721% |       5.7901% |
| wrap-none-two-seals-title-box-demo |        1.4726% |       0.9043% |

The two worsened comparisons both contain inherited table borders. The new clearance increases their row heights. These differences remain under review. They are not classified as font exceptions. Existing floating-table and repeated-header regressions from the earlier terminal-margin change also remain documented.

The latest Word candidate passes Core/PDF builds, type checks, and changed-source ESLint. PDF tests pass (39 tests, 167 assertions). Markdown tests pass (187 tests, 965 assertions). The isolated 86-file Core pass found one expected pagination change in a merged-header fixture. Its corrected test passes all 12 cases and checks containment and complete content.

Remaining issues include table paint/clearance, small baseline differences, script placement, multiple separator markers, mixed text/marker separator stories, and floating-wrap pagination. The requested corpus-wide error threshold and zero-P2 review state are not achieved.

## Inline separator stories and border experiment (2026-09-18)

Core now retains all authored separator markers in mixed text/marker stories and repeated-marker paragraphs. Each marker reserves its own advance and retains its canonical one-unit range. Ordinary markers use the existing 144pt width, capped to the available story band. Continuation markers use the available width. The marker element determines this behavior, independently of the note type. This follows the distinction between [separator marks](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.separatormark?view=openxml-3.0.1) and [continuation separator marks](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.continuationseparatormark?view=openxml-3.0.1).

One Core helper supplies the rule box to the browser and PDF painters. Both painters retain the resolved run color. The single-marker record remains compatible with existing note-area consumers. The PDF rectangle utility now lives with the shared PDF coordinate helpers, removing the equation painter's import cycle.

Validation: 18 isolated note regression files pass. The PDF suite passes 40 tests with 177 assertions. The Markdown suite passes 187 tests with 965 assertions. New tests cover mixed text, repeated markers, narrow-band wrapping, element-specific widths, source preservation, colors, and fresh/retained browser paint. A Chromium render confirms both rules appear beside their text. The measured vertical position differs by less than 0.02pt. Its fixed text measurer is not a browser-font oracle, so this render does not establish horizontal font fidelity. Artifacts: `.cache/pdf/inline-note-browser.png` and the corresponding expected/actual geometry JSON files.

The demo PDF remains byte-identical to the 1.016281% Word candidate. No claim below 1% or of corpus-wide 99% fidelity follows from this correctness fix. The completed `benchmark-inline-note-rules` run covered the same 100 inputs in 172.43 seconds. All 71 exported PDFs are SHA-256-identical to `benchmark-alignment`; statuses and page counts are unchanged. The source fingerprint remained unchanged during the benchmark.

An experimental centered horizontal-border model was rejected. It reduced the Word sample error to 1.009853%, but increased Form025U's LibreOffice difference from 4.819203% to 5.124363%. It did not resolve both table regressions. Production retains the prior border geometry and clearance model. Probe artifacts remain in `.cache/pdf/word-centered-horizontal/` and `.cache/pdf/benchmark-centered-horizontal/`.

The subsequent empty-separator correction removes the unwanted legacy rule from explicit empty stories, empty paragraphs, and hidden markers. Missing separator stories still receive the default rule. Regression tests also cover deleted markers in proposed view, warm layout caches, source preservation, fresh/retained browser painting, and actual PDF stream commands. The regression failed in three cases before the correction. It now passes. All 13 isolated note test files pass; PDF tests pass 44 cases with 189 assertions. Core/PDF builds, type checks, changed-file ESLint, and whitespace checks pass. The demo PDF remains SHA-256-identical to the measured 1.016281% Word candidate. The broad `benchmark-empty-separators` run completed in 167.59 seconds with an unchanged source fingerprint. Its 100 inputs retain the same 71 exports, 1,705 pages, 28 unsupported inputs, and one malformed input. All 71 exported PDFs are SHA-256-identical to the preceding corpus run. Table clearance, script baselines, table paint, and the floating-wrap page mismatch also remain under review.

## Empty merged rows (2026-09-18)

A vertically merged continuation cell skips its own paragraph content, but row layout still charged it a default line. An automatic row containing only such cells therefore added blank height to the merged cell. Core now takes that row's height from the merged content span and explicit row constraints. Explicit `atLeast`/`exact` heights remain intact, and tall merged content still grows the span. This is consistent with [automatic row sizing from content](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.tablerowheight?view=openxml-3.0.1). The saved LibreOffice fixture supplies the concrete rendering evidence; no new Word reference was generated.

The new regression failed at 12.727pt before the correction and now adds no phantom line. The saved LibreOffice comparison for `empty-table-row-vmerge` improves from 2.194625% to 1.364402%. Its montage confirms that the extra blank table band is gone. Remaining offsets are still included in the metric. The Word sample remains at 1.016281% error with all 27 pages, without font exclusions.

All 33 isolated table regression files pass. Another 27-file pagination/border/header/RTL pass exposed two failures: `rtl-list-marker.test.ts` and `rtl-selection-rects.test.ts`. A baseline check before the table correction reproduces all 13 failing cases across those two RTL files. The RTL correction keeps the visible text aligned after bidi moves trailing spaces to the left. All 29 focused cases pass, including new center/right RTL wrap cases that preserve the source ranges. All 52 isolated RTL/alignment/table/spacing regression files pass after the RTL correction. The latest Word export (`native-rtl-alignment.pdf`) remains byte-identical to the prior 27-page candidate. Its fresh 144-DPI comparison reports 1.016281% error. Core/PDF builds, type checks, and ESLint pass. PDF tests pass 44 cases/189 assertions; Markdown passes 187 cases/965 assertions. The final `benchmark-rtl-alignment` run completed in 168.70 seconds with an unchanged source fingerprint. It covers 100 inputs: 71 strict exports, 1,705 pages, 28 unsupported inputs, one malformed input, and 64 saved LibreOffice comparisons. Statuses and page counts match the last successful broad run. Only Form025U and the empty merged-row fixture change PDF bytes. Both improve against their saved references. The 521-page input completes in 33.746 seconds in this run, with 4,113,432,576-byte peak RSS. The PDF suite passes 44 tests/189 assertions, and Markdown passes 187 tests/965 assertions. Core/PDF builds, type checks, changed-file ESLint, and whitespace checks pass. The full `benchmark-vmerge-empty` run took 233.34 seconds with an unchanged source fingerprint. It exported 70 inputs (1,184 pages), refused 28 unsupported inputs, and reported two errors. One error is the known malformed fixture; the 521-page input hit the existing 45-second export deadline. That timeout remains a validation failure pending a separate rerun, not an accepted status change. The 70 completed PDFs differ from the previous run only in Form025U (4.819203% → 4.811801%) and the empty merged-row fixture (2.194625% → 1.364402%).

## Stress-export memory probe (2026-09-18)

A separate 521-page export with the same 45-second deadline succeeded in 37.747 seconds. Its 6,105,338-byte PDF is SHA-256-identical to the previous successful stress result: `e42db3a1b8538edb637e5ec20452205df64efaad241ce510047063687a63cff8`. The prior corpus timeout is retained in its report; this independent success does not rewrite that run.

A cache-only instrumented copy of the exporter records memory at phase boundaries (`profile-521.log`). It uses the same source implementation, fonts, and limits, with additional diagnostic logging. Reported RSS/JavaScript heap after opening: 1,216,610,304 / 563,039,949 bytes. After Core layout: 3,802,611,712 / 2,073,394,733 bytes. After PDF painting: 3,350,249,472 / 1,435,434,601 bytes. After saving: 3,328,524,288 / 903,358,901 bytes. Process peak RSS was 3,876,880,384 bytes. These are phase observations, not sampled heap maxima. The largest observed increase precedes PDF painting, so attributing the whole peak to PDF embedding is unsupported. A separate forced-GC probe returned inconsistent Bun `heapUsed`/`heapTotal` values; it does not establish live retained heap. No forced collection was added to production.

A follow-up GC probe yields consistent `bun:jsc` and process heap readings after allowing an event-loop turn. After collection, both report 859,098,708 bytes, while process RSS remains 4,223,074,304 bytes. This separates the approximately 0.80GiB remaining JavaScript heap from the process footprint and transient allocation peak. The probe exits after layout; it is diagnostic evidence, not a production performance result. Artifact: `.cache/pdf/profile-521-jsc-gc.log`. No forced collection or instrumentation entered production.

Further review reproduced an open border-clearance defect with a 0.5pt cell edge opposed by a 6pt neighbor. Paint correctly selects the 6pt shared rule, while the first cell's content width still reserves only 0.5pt. A right-aligned glyph ends at 119.5pt inside a 120pt cell and can overlap the rule. The minimal reproducer and measured boxes are `.cache/pdf/border-conflict-probe.ts` and `.cache/pdf/border-conflict-probe.json`. The next correction must share border-conflict winners with measurement, including merged intervals and explicit suppression. The <1% objective and zero-P2 review state remain unachieved.

## Shared border geometry and clearance (2026-09-18)

Core now derives cell clearance from resolved border-conflict winners, including merged intervals and opposing authored edges. A page's first row drops clearance from a stronger neighbor that remains on the previous page. Repeated headers and continuation rows use the same occurrence-specific clearance. Authored border provenance remains intact for conflict resolution and serialization.

The initial full-inward model passed 59 isolated regression files but worsened Form025U's saved LibreOffice pixel comparison. `benchmark-border-conflict` completed in 174.54 seconds with an unchanged source fingerprint. Its 100 inputs retained 71 exports, 28 unsupported inputs, and one malformed input. The Word demo remained at 1.016281% error with 27 pages.

Combining incident-edge measurement with centered simple horizontal strokes changes the evidence from the earlier rejected isolated experiment. The candidate `native-centered-conflict.pdf` measures 0.976713% error against the saved Word PDF at 144 DPI, without font exclusions. All 27 pages remain. Only pages 10, 25, and 27 change their pixel-error score; all three improve. Page 27 improves from 3.543709% to 2.937360%, but still exceeds 1% individually. Simple horizontal borders reserve half their thickness on each incident row. Separated and compound borders retain their independent geometry.

The four-document saved LibreOffice probe has mixed pixel results: Form025U is 5.090232%, empty-table-row-vmerge is 1.324017%, generic-render-regression is 6.991999%, and generic-header-footer-horizontal-regression is 7.705618%. Form025U's misplaced page-break word returns to the correct page; matched words displaced beyond 8pt decrease from 93 to 10. Its second-page pixel error improves from 0.975257% to 0.173608%, while first- and third-page errors worsen. These regressions remain included and require further investigation. A lower demo average does not prove corpus-wide fidelity.

Review also reproduced duplicate browser painting when a simple edge has explicit stroke geometry. Browser paint now gives published strokes precedence over the CSS convenience border, matching PDF paint. Published dashed and dotted segments retain their patterns instead of becoming solid rectangles. Six targeted browser cases fail before that correction and pass afterward. Full/partial centered strokes, conflicting cell borders, merged intervals, separate cell borders, warm caches, source preservation, repeated headers, and narrow-page admission have focused coverage. Further corpus validation follows below. The full goal and zero-P2 review requirement remain unachieved.

The finalized Word rerun measures 0.975777% error, with 27/27 pages and no font exclusions. It also applies the shared inset helper to repeated-header margins and row continuations. Artifacts: `.cache/pdf/word-centered-shared-final/report.json` and `.cache/pdf/native-centered-shared-final.pdf`. Candidate SHA-256: `92ecf1e84454eb37c95e728bba01b7e7984d6eb98255cf5f6e2ad3b12ec80d0a`. The earlier 0.976713% candidate remains archived as separate evidence.

The isolated layout/output regression run covers 61 files. Three files initially retained full-inward spacing expectations. Those expectations now follow centered stroke geometry, while retaining the admission, containment, and source-preservation assertions. All eight affected/final files pass on rerun, including the two additional stroke tests. Browser border tests pass 20 cases/327 assertions; PDF passes 44 cases/189 assertions; Markdown passes 187 cases/965 assertions. Core/PDF builds and type checks pass. Changed-source ESLint, formatting checks, and whitespace checks pass. Core API extraction scans 15 entries with zero errors and 1,959 existing warnings.

Further self-review confirms an open page-end clearance discrepancy. A 0.5pt bottom edge above a 6pt next-row top edge retains 3pt bottom clearance when the next row moves to another page. The final first-page paint uses the row's own 0.5pt edge, whose inward half is only 0.25pt. Cache-only reproducer: `.cache/pdf/page-end-border-probe.ts`, with measured boxes in the adjacent JSON file. A correction must account for page-local edges before admission and final vertical alignment, including merged and repeated rows. The demo average is below 1%; individual pages, broader document comparisons, and the review goal still need work.

The final `benchmark-centered-shared-final` run completes in 162.77 seconds with an unchanged source fingerprint. All 100 statuses and exported page counts match `benchmark-rtl-alignment`: 71 strict exports, 1,705 pages, 28 unsupported inputs, one malformed input, and 64 saved LibreOffice comparisons. The 521-page stress export takes 33.132 seconds with 4,199,170,048-byte peak RSS. Several additional documents improve, including `with-tables` (0.750845% → 0.304516%), `header-with-table-and-paragraphs` (1.260305% → 0.936061%), and `repeated-table-header` (13.373046% → 11.926973%). Regressions remain visible, including Form025U (4.811801% → 5.090232%), `vmerge-row-span` (5.790093% → 6.008267%), and `wrap-none-two-seals-title-box-demo` (0.904263% → 1.136132%). This is a completed benchmark with mixed outcomes, not evidence of universal improvement or finished fidelity work.

## Terminal row border measurement (2026-09-18)

Core now probes the final complete text row with its page-local bottom edge before correcting the fragment height. It preserves the incoming boundary, row-height constraints, vertical alignment, published content, and source provenance. A row that fits only with its terminal edge stays on the current page; its successor starts a new fragment. This fixes a concrete 3pt-versus-0.25pt bottom-clearance discrepancy and a three-page-versus-two-page admission case. Existing published paragraph records retain their identities; rejected probes cannot publish anchors, spend live identifiers, consume ownership/merge budgets, or mutate the paragraph cache.

The bounded probe eligibility logic is shared with repeated-header measurement. It excludes vertical merges, floating/excluded regions, complex/non-text rows, and partial row continuations. Those paths still require page-local border planning. A terminal edge that grows beyond the remaining page also needs replanning. The correction does not establish a zero-P2 review state.

Seven targeted tests pass with 56 assertions, covering auto/atLeast/exact rows, preserved vertical alignment, terminal admission after body content, repeated headers, wider patterned edges that fit, warm caches, and probe side effects. All 64 isolated table/pagination/RTL/output regression files pass. PDF passes 44 tests/189 assertions. Core/PDF builds and type checks pass. Changed-source ESLint, formatting, and whitespace checks pass; Core API extraction reports zero errors across 15 entries. The fresh native demo PDF is byte-identical to the measured 0.975777% Word candidate. Artifacts: `.cache/pdf/page-end-border-fixed.json`, `.cache/pdf/terminal-regressions.json`, `.cache/pdf/terminal-new-tests.log`, and `.cache/pdf/native-terminal-borders.pdf`.

A separate diagnostic experiment traced Form025U's two approximately 5pt vertical jumps to mixed-size table paragraphs with 10pt formatted paragraph marks and 5.5pt text on their final lines. Suppressing the mark-height contribution in all cell paragraphs reduces the saved LibreOffice pixel difference from 5.090232% to 4.806081%, without changing the Word demo bytes. The experiment was reverted because it also removes required height constraints from explicitly formatted cell markers. The [Open XML end-of-cell marker rule](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.hidemark?view=openxml-3.0.1) requires marker participation in row sizing unless excluded; it does not justify globally ignoring formatted markers. A further correction needs to distinguish the cell-height floor from ordinary paragraph line-height contribution. Probe evidence remains in `.cache/pdf/benchmark-cell-mark-probe/`; that experiment kept the original mark behavior. The subsequent row-floor correction below replaces that experimental approach.

The final `benchmark-terminal-borders` run completes in 159.18 seconds with an unchanged source fingerprint. All 100 statuses and page counts match the preceding run: 71 strict exports, 1,705 pages, 28 unsupported inputs, one malformed input, and 64 saved LibreOffice comparisons. All 71 exported PDFs are byte-identical to `benchmark-centered-shared-final`. The new terminal-boundary regressions cover cases absent from this archived corpus; no corpus improvement is claimed. The 521-page stress input completes in 31.871 seconds with 4,134,944,768-byte peak RSS. The Word demo remains at 0.975777%; wider document fidelity and the remaining review issues are not complete. The Form025U diagnostic preserves identical font resolution while shifting the two affected row labels by 5.174pt and 10.348pt. Evidence: `.cache/pdf/form-cell-mark-displacement.json`. This is a layout hypothesis for further correction, not a font exclusion.

## Cell-end marker row floor (2026-09-18)

Core now distinguishes a horizontal cell's final marker from an ordinary paragraph marker. The final marker reserves a minimum cell height without enlarging the last printable line. Earlier paragraphs retain their marker contribution. Empty paragraphs retain their own metrics. The row-floor interpretation is an inference from the end-of-cell rule and the saved Form025U comparison, not an assertion that all Word marker behavior has been verified.

Review corrected two hazards before the complete benchmark: a collapsed nested-table terminator must not restore its oversized marker floor, and vertical cells must retain their existing rotated line geometry. Final-line admission reserves the cell minimum before a page cut. Exact rows still clip to their authored height. Paragraph break cache keys include the terminal-cell role so the same source paragraph cannot reuse the wrong break.

The new regression file covers short and wrapped text, multiple paragraphs, bottom alignment, exact and minimum row heights, page moves and row splits, nested-table terminators, vertical text, and cached role changes. All 65 isolated regression files pass. The PDF suite passes 44 tests and 189 assertions. Core and PDF type checking and builds pass. Linting and formatting of the changed files pass. API extraction reports zero errors, 1,959 existing Core warnings, and zero PDF warnings.

The complete `benchmark-cell-end-reviewed` run has an unchanged engine fingerprint and takes 171.314 seconds. It retains 71 strict exports, 1,705 pages, 28 unsupported inputs, one malformed input, and 64 saved LibreOffice comparisons. Form025U improves from **5.090232% to 4.806081%** at 96 DPI, with three pages and unchanged font resolution. The other 70 exported PDFs are byte-identical to `benchmark-terminal-borders`. The separately exported Word demo is byte-identical to the measured **0.975777%** candidate, with 27 pages at 144 DPI. No font differences are excluded. Only 31 of 64 LibreOffice comparisons remain below 1%.

The 521-page stress export takes 36.395 seconds and records 3,892,641,792-byte peak RSS. This is one concurrent benchmark observation, not proof of a memory or speed improvement.

At this stage, `w:hideMark` was not modeled in table layout, including its style cascade and empty-cell behavior. Four archived inputs contain this property; their PDFs were unchanged in this run. The following correction addresses this gap. Vertical-marker semantics, the outstanding terminal-border cases above, floating-wrap pagination, and unsupported inputs also remain unresolved. The broader fidelity target and the absence of P2+ issues are **not established**.

Evidence: `.cache/pdf/benchmark-cell-end-reviewed/report.json`, `.cache/pdf/cell-end-model-corpus-audit.json`, `.cache/pdf/cell-end-model-regressions.json`, `.cache/pdf/cell-end-model-pdf-tests.log`, `.cache/pdf/native-cell-end-reviewed.pdf`, and the existing `.cache/pdf/word-centered-shared-final/report.json`.

## Hidden cell-marker correction (2026-09-18)

Core now resolves `w:hideMark` from whole-table cell styles, conditional styles, and direct cell properties. Explicit false values override inherited true values. Derived conditional formatting retains omitted properties from base styles. The style producer fingerprint includes whole-table cell properties, so style-only edits invalidate layout caches.

An excluded terminal marker no longer supplies a row-height minimum. Empty terminal lines keep their source position with zero height. Earlier paragraph marks, printable text, list markers, inline pictures, paragraph borders, spacing, margins, and authored row limits remain active. Placement copies empty-line metrics without changing shared paragraph break cache entries. All Markup retains visible tracked-marker geometry.

Review found and corrected two additional interactions: zero-height merged cells must be admitted into a zero-height span, and a centered empty line in a vertical cell must not count its caret position as printable width. The new suite passes 23 tests and 126 assertions. All 70 isolated regression files pass. The PDF suite passes 44 tests and 189 assertions. Core type checking and changed-file linting pass.

The complete `benchmark-hide-mark-final` run finishes in 171.683 seconds with an unchanged engine fingerprint. It retains 71 strict exports, 1,705 pages, 28 unsupported inputs, one malformed input, and 64 saved LibreOffice comparisons. `issue-319-sections.docx` improves from **4.640155% to 4.544071%**, retaining four pages. Its second page improves from 10.386895% to 10.002557%; the remaining three pages are unchanged. The other 70 PDFs are byte-identical to `benchmark-cell-end-reviewed`. The Word demo remains byte-identical to the measured **0.975777%** candidate, with 27 pages and no font exclusions. Only 31 of 64 LibreOffice comparisons are below 1%; the overall target remains unmet.

The 521-page stress export takes 32.061 seconds and records 4,107,206,656-byte peak RSS. This observation does not establish a memory or speed improvement.

Evidence: `.cache/pdf/benchmark-hide-mark-final/report.json`, `.cache/pdf/hide-mark-corpus-audit.json`, `.cache/pdf/hide-mark-tests.log`, `.cache/pdf/hide-mark-regressions.json`, `.cache/pdf/hide-mark-pdf-tests.log`, and `.cache/pdf/native-hide-mark-final.pdf`.

The next measured discrepancy is table width in the section document. Its authored `w:tblW` and grid total are 510.3pt. The available text width is 476.3pt. Core reduces the autofit table to 476.3pt and starts it at x=56.7pt. The saved LibreOffice reference retains approximately 510.3pt, centered at x=39.7pt. This changes column text wrapping and table height. It is a layout discrepancy, not a font exclusion. `resolveColumnWidthsPt` clamps autofit widths to the text extent, and `tableOriginX` discards negative centering slack. Further correction must validate both decisions against authored widths and varied saved references. Evidence: `.cache/pdf/issue-319-width-diagnostic.json` and the page-two montage in `benchmark-hide-mark-probe`. No claim of a clean P2+ review or complete Word fidelity is made.

## Authored table overflow and reference-process cleanup (2026-09-18)

Core now retains positive authored table widths beyond the text column, including autofit tables. Centered and right-aligned tables preserve their alignment when the remaining width is negative. Unstated autofit widths remain bounded by the text column. Numeric allocation and width limits are unchanged. Six new regressions cover fixed/autofit layout, all three alignments, wrapping, hit testing in margins, source preservation, and warm-cache equivalence. All 71 isolated Core regression files pass. Core type checking, changed-file linting, formatting, and whitespace checks pass.

The complete `benchmark-overflow-width-final` run takes 147.032 seconds with an unchanged engine fingerprint. It retains 71 strict exports, 1,705 pages, 28 unsupported inputs, one malformed input, and 64 saved LibreOffice comparisons. `issue-319-sections.docx` improves from **4.544071% to 4.280798%**. `vmerge-row-span.docx` improves from **6.008267% to 4.126745%**. The other 69 exported PDFs are byte-identical to `benchmark-hide-mark-final`. The separately exported Word demo is byte-identical to the measured **0.975777%** candidate. Only 31 of 64 LibreOffice comparisons are below 1%; no font exclusions were applied. The 521-page stress export takes 28.808 seconds and records 4,875,403,264-byte peak RSS. This does not establish a memory improvement; RSS is not JavaScript heap usage.

The reference helper now cleans up its private process group after cancellation, timeout, and successful launcher exit. Its disposable profile and new process session isolate each conversion from unrelated LibreOffice sessions. Three fake-launcher tests prove child termination and preservation of an unrelated process. The success case also covers children that close their inherited pipes before the launcher exits. These process tests run without requiring LibreOffice. The real read-only proposed-content integration test also passes. No LibreOffice processes remained after that test. Word was not controlled. The preceding hidden-marker correction also completed Core/PDF builds, PDF type checking, and API extraction: zero errors, 1,959 existing Core warnings, and zero PDF warnings.

Evidence: `.cache/pdf/overflow-width-corpus-audit.json`, `.cache/pdf/benchmark-overflow-width-final/report.json`, `.cache/pdf/overflow-width-regressions.json`, `.cache/pdf/native-overflow-width-final.pdf`, `.cache/pdf/libreoffice-cleanup-tests.log`, and `.cache/pdf/libreoffice-reference-integration.log`. The broader fidelity target and absence of P2+ issues remain unproven.

Final review: Core/PDF builds, PDF type checking, and API extraction pass with zero errors. Core API extraction reports 1,959 existing warnings; PDF reports none. The PDF suite passes 44 tests and 189 assertions. All four reference-process and integration tests pass. The post-build `benchmark-overflow-cleanup-reviewed` run completes in 149.554 seconds with an unchanged engine fingerprint. All 71 PDFs are byte-identical to `benchmark-overflow-width-final`; statuses, page counts, and comparison metrics are unchanged. All 100 input hashes remain unchanged. No LibreOffice processes remain after validation. Evidence: `.cache/pdf/overflow-cleanup-reviewed-audit.json`, `.cache/pdf/libreoffice-all-cleanup-tests.log`, `.cache/pdf/overflow-width-build.log`, `.cache/pdf/overflow-width-api.log`, and `.cache/pdf/overflow-width-pdf-tests.log`.

A rejected probe raised sub-quarter-point table border widths to 0.25pt during layout. It worsened the Word demo from 0.975777% to 1.468582%, so the change was reverted. The saved Word PDF paints many thin borders on a 0.24pt coordinate grid, while native layout uses continuous points. Matching its painted stroke width by increasing layout width incorrectly increased row heights. For example, the summary table's final border starts near y=712.08pt in Word and y=712.07pt natively; the rejected probe moved it to y=716.51pt. This evidence does not justify changing layout dimensions. Probe evidence remains in `.cache/pdf/word-min-table-border-probe/report.json`.

Further triage found automatic text-color differences on shaded cells in `vmerge-row-span.docx`. The saved LibreOffice reference chooses white on the first two cell fills; native output defaults to black. This needs a shared Core color-resolution model, with explicit colors, nested backgrounds, and highlights preserved. The exact Word automatic-color threshold has not been verified; no speculative threshold was introduced.

## Compact text streams and a bounded demo worker (2026-09-20)

The writer emitted one absolute text matrix for every glyph, about 40 bytes a character. Glyphs on one baseline now travel in a single `TJ` array after one matrix: the viewer advances by the width this PDF declares for the code, and each number in the array carries only the remainder, so the written positions are the same. A face change, a size change, a new baseline, or an adjustment outside the writer's number range ends the batch and starts a new matrix. The 521-page fixture export falls from 6,447,033 to 4,835,882 bytes, 12,374 to 9,282 bytes a page, and its peak JavaScript heap from 460 to 378 MB. Page 1 of that document falls from 9,598 to 5,612 bytes of decoded content stream, and from 195 `Tm`/`Tj` pairs to 29 `Tm`/`TJ` pairs.

The change is fidelity-neutral. A full corpus pass at this revision reproduces every measured comparison exactly: 65 exported documents, zero metric changes against the cached exports. Against Word references, 17 of 20 documents are below 1%, median 0.464%. Against LibreOffice references, 30 of 65 are below 1%, median 1.357%. The three Word comparisons above 1% are `issue-740-header-zero-distance.docx` at 3.463%, `issue-483-firstline-marker.docx` at 2.635%, and `float-wrap-comprehensive-test.docx` at 1.017%, all previously recorded. Evidence: `.cache/pdf/sweep-head/report.json`.

Two positions tests were rewritten rather than deleted. They read glyph x positions out of the content stream with a regular expression over per-glyph matrices, which the batch no longer writes. They now walk the pdfjs operator list the way a viewer does — advance by the declared width, apply the adjustment — through one shared helper, so they assert placement without depending on how a run is cut into batches. A new test counts `setTextMatrix` and `showText` operators to hold the batching itself.

The demo server gives its conversion worker `resourceLimits.maxOldGenerationSizeMb`, default 512 and settable with `WORKER_HEAP_MB`. The 521-page document succeeds at 512 MiB and fails at 384 and 320. `ERR_WORKER_OUT_OF_MEMORY` and a non-zero worker exit now answer 507 with a message naming the limit, instead of a generic failure. Verified end to end at a 64 MiB ceiling.

## Device-grid geometry and the font the reference embeds (2026-09-20)

Four corrections landed, each derived from documents rendered in Word on this machine and each measured on the whole corpus before and after.

**The paragraph's left edge rounds onto the 0.24pt grid.** The reference rounds a paragraph's content origin, then advances every glyph from there by exact widths. `issue-483-firstline-marker.docx` is authored with a 63.8pt margin and the reference starts its body text at 63.84pt. Alignment is measured from the rounded edge and is not rounded again: the same page centres its title at 190.733pt, which is off the grid. Against Word this improved twelve of twenty documents and moved one by 0.005%; `header-with-table.docx` became an exact match, and two documents brought every page under 1%.

**A script run reduces in half points.** `w:sz` is authored in half points and the reference reduces in that unit: an 11pt superscript is `round(22 * 0.65) = 14` half points, which is 7pt and draws at 6.96pt. Eleven Word-rendered base sizes from 8pt to 24pt fit this and fit no rule applied to points. The same controls show the reference also advances at 7pt, measured from the pen position of the run that follows, but applying the reduction to layout made `footnote-overlap-regression.docx` worse against its Word reference, from 0.906% to 2.160%, so this is paint only and layout keeps its own script scale.

**An underline hangs from its top, on the grid.** `post.underlinePosition` is the top of the stroke, not its centre. Times New Roman at 10.5pt suggests 1.1433pt and 0.5127pt; the reference draws 1.200pt below the baseline at 0.480pt thick, which are 5 and 2 units, and both ends land on the grid as well. All three underlines in `issue-483-firstline-marker.docx` now match exactly, including the ends of one rule split across runs.

**The page box rounds onto the grid.** A4 is 11906 x 16838 twips, or 595.30 x 841.90pt, and the reference writes 595.20 x 841.92. Twenty-three reference documents agree, Letter included, where the authored size already sits on the grid.

### Rejected after measuring

Rounding the float exclusion band explains every line start on page 5 of `float-wrap-comprehensive-test.docx` — 381.00, 177.00 and 171.00 are exact half units and the reference paints 381.12, 177.12 and 171.12 — and improves that document from 1.017% to 0.729%. It regressed every table document, taking pages above 1% from four to six, because `contentX` carries the indent, the exclusion and the alignment together and a cell origin cannot be separated from a band. Not landed.

### A one-pixel band on `issue-483`, cause not identified

The reference embeds Word's own Times New Roman, fontRevision 0x00070000 with `hhea` lineGap 0, from `Microsoft Word.app/Contents/Resources/DFonts/times.ttf`. We embed the macOS system face, fontRevision 0x0005028f with lineGap 87. The outlines are identical — same glyph ids, contour counts and bounding boxes — and the hinting programs differ, 1585 against 2649 bytes of `fpgm`. Word lays out with the system face regardless: its pitch of 13.7988pt at 12pt requires lineGap 87, which its embedded copy does not have.

That difference was recorded here as a rasteriser ceiling. **It is not.** Embedding each build whole into a page of identical text at 10.56, 11.04, 12 and 13.92pt and rendering both with `pdftoppm` at 96dpi gives zero differing pixels. The hinting programs do not change the raster.

The band remains unexplained. On page 1 four consecutive lines render one pixel lower than the reference under `pdftoppm`, while three of the four have byte-identical baselines: pdfY 313.91998, 301.91998 and 289.91998 in both files, the same 10.56pt size and the same outlines. Three candidate causes are ruled out by measurement. The page boxes now match exactly. The hinting builds render identically. The coordinate form does not matter either: the reference writes text in a 0.24-scaled space, `0.24 0 0 0.24 0 640.08 cm` with `/TT2 1 Tf` and a size of 44, which is Word laying out in whole device units, and writing the same baseline both that way and directly gives an identical raster.

Rasteriser choice changes this page but does not rescue the others, so it is not a general excuse. The worst page of each remaining document, compared under both:

| document                              | page | pdftoppm | MuPDF  |
| ------------------------------------- | ---- | -------- | ------ |
| `float-wrap-comprehensive-test.docx`  | 4    | 1.315%   | 1.586% |
| `footnote-overlap-regression.docx`    | 4    | 1.222%   | 1.398% |
| `issue-483-firstline-marker.docx`     | 1    | 2.032%   | 0.844% |
| `issue-740-header-zero-distance.docx` | 1    | 5.423%   | 8.548% |

Only `issue-483` is flattered by a different rasteriser. The other three are worse under MuPDF, so their error is geometry, not rasterisation.

### One trailing space short at a line end

On page 1 of `issue-740-header-zero-distance.docx` the reference ends a line with `'ttttttttttttttttttt  '`, two trailing spaces, and we end it with one. The nineteen glyphs occupy the same width in both, 63.346pt, so nothing visible moves; the line box is 3.0pt narrower, which is one space at 12pt Times. Another line is 9.0pt narrower, three spaces. A trailing space carries no ink, so this does not show in a pixel comparison, but it is a real difference in what the line contains. It is not a writer bug: the layout span already ends with one space, so the second is dropped when Core breaks the line. Keeping it is a change to how many trailing spaces hang past a wrap point, which affects every document and the editor, for no visible gain, so it belongs in its own change with its own corpus run rather than here.

The heavy pixel difference on that page is not this. It is the vertical rule below, a 0.24pt shift on most lines, and the page's text is almost entirely `t`, whose crossbar and serifs are horizontal strokes that a third of a pixel moves visibly. That is why the page reads worse under MuPDF, 8.548%, than under `pdftoppm`, 5.423%: hinting snaps some lines back onto the same pixel row and hides part of it.

### What Word itself reports

Word's own scripting interface answers `get selection information` with `vertical position relative to page`, which is a second observation channel independent of the PDF. Two things come out of it.

The line top is exactly 36.000000 for every control, at 8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 22 and 24pt. So the whole per-size variation sits in the ascent, not in where the line starts, which removes the last alternative explanation.

Word's internal positions are not on the device grid. A stack of page-broken paragraphs reports 45.450001, 46.400002, 47.349998 and so on, none of them a multiple of 0.24. Word lays out in continuous points and quantises only when it writes the PDF, which is the same split this engine uses: device-independent layout, grid at paint.

The interface exposes no baseline, ascent or font-metric query, so it cannot answer where the ascent comes from. Core Text was checked earlier and returns our values, not Word's.

### The implemented rule is the best available

A brute force over rule families against all thirty-three dense controls settles what to do about this. The families cover the quantity (ascent, ascent plus gap, ascent plus half the gap, ascent plus twice the gap, `winAscent`), the size it is taken at (authored or rounded onto the grid), five rounding modes, and every pairing of two rounding modes applied separately to the ascent and the gap. Forty-plus rules in all.

The best score is 28 of 33, and it belongs to the rule already implemented: round the sum of ascent and line gap, taken at the authored size. Nothing beats it, and taking the quantity at the gridded size scores 25.

The five it misses cannot be separated by a threshold. Their fractional parts are 0.24, 0.414, 0.570, 0.579 and 0.680 units. The reference rounds 0.24 and 0.414 UP, and rounds 0.570, 0.579 and 0.680 DOWN. Any threshold that takes 0.24 upward must also take 0.57 upward, and any that takes 0.68 downward must also take 0.414 downward. No monotone rounding rule on this quantity can produce the observed sequence.

So the residual is irreducible from the published metrics, and the writer already does the best that evidence supports. Closing it needs a metric source this machine does not expose, not a different rounding choice.

### Not understood

A dense sweep settles what this is not. Thirty-three Times New Roman controls at half-point steps from 8pt to 24pt, each on its own page with the body top at a whole 150 units, give these first baselines in device units below that top:

```
8.0/31 8.5/33 9.0/35 9.5/37 10.0/39 10.5/41 11.0/43 11.5/45 12.0/46 12.5/49 13.0/50 13.5/53 14.0/54 14.5/56 15.0/58 15.5/60 16.0/63 16.5/64 17.0/66 17.5/68 18.0/70 18.5/72 19.0/74 19.5/76 20.0/78 20.5/80 21.0/82 21.5/84 22.0/85 22.5/88 23.0/89 23.5/92 24.0/93
```

The steps are mostly two units per half point, with the sequence sticking at 11.5/12.0, 12.5/13.0, 13.5/14.0, 16.0/16.5, 21.5/22.0 and 22.5/23.0 and jumping three elsewhere. No function of the point size reproduces it. Rounding the sum of ascent and line gap from the authored size matches 8 of 12 whole sizes; from the drawn size, 9 of 12, and it breaks Arial at 14pt, which the authored size gets right. A fixed fraction of the em is impossible outright: 12pt requires an ascent below 1904.7 font units and 16pt requires above 1920.0, and those ranges are disjoint. Neither font build's VDMX `yMax` reproduces the sequence either, with or without a rounded line gap.

`issue-740-header-zero-distance.docx` remains at 5.219% on its first page. Times New Roman at 12pt places its first baseline one device unit low. Twenty Word-rendered controls bound the problem: the line model is exact for Arial at 10, 11, 12, 14, 16 and 20pt and for Times at 8, 9, 10, 11, 14, 18, 20 and 24pt, and one unit out at Times 12, 13, 16 and 22pt. Rounding the sum of ascent and line gap, flooring the ascent, flooring the sum, rounding each separately, and both fonts' VDMX yMax each fit some controls and fail others. No rule is established, so nothing was changed for it.
