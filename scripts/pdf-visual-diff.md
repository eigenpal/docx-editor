# PDF visual diff

`pdf-visual-diff.py` renders two PDFs with Poppler and compares their lossless PNG pixels.
It does not use a browser, Microsoft Word automation, or a vision model.

## Requirements

- Python 3
- [Pillow](https://pypi.org/project/pillow/)
- Poppler commands `pdfinfo` and `pdftoppm`

On macOS, install the command-line requirements with Homebrew:

```bash
brew install poppler
python3 -m pip install Pillow
```

## Run a comparison

Use the Word PDF as the reference:

```bash
python3 scripts/pdf-visual-diff.py \
  path/to/word.pdf \
  path/to/docx-editor.pdf \
  --output tmp/pdf-diff \
  --dpi 150
```

The output contains:

- `report.json`: aggregate and per-page pixel metrics.
- `pages/page-0001/reference.png`: the rendered reference page.
- `pages/page-0001/candidate.png`: the rendered candidate page.
- `pages/page-0001/diff-amplified.png`: the absolute RGB difference at 8× intensity.
- `pages/page-0001/diff-overlay.png`: the candidate page with all differences in red.
- `pages/page-0001/diff-overlay-strong.png`: the candidate with strong differences in red.
- `pages/page-0001/montage.png`: reference, candidate, and amplified difference side by side.

The script compares matching page numbers without automatic alignment. A moved line must remain
visible as a difference. A missing page compares against a white page.

## Interpret the report

`changedFractionByThreshold` gives several deterministic views of the same pixel difference:

- `0` counts every changed pixel.
- `8` and `16` reduce small raster differences.
- `28` is the default strong-difference threshold.
- `64` keeps only high-contrast differences.

Use the strict values to track renderer changes. Use the strong values to find layout and missing
content. Font hinting can still create strong edge differences, so a nonzero score does not prove a
layout defect.

`strongDifferenceBoundsPt` gives the full changed region. `strongDifferenceBandsPt` gives the
vertical bands that contain differences. Open `diff-overlay.png` or `montage.png` to inspect each
band.

Use `--fail-above-percent N` in an automated gate. The command exits with status `2` when the
strong changed percentage exceeds `N`.

The script checks page and total pixel limits before rasterization. It also applies a timeout to
each Poppler command. Change these limits only for trusted inputs:

```bash
python3 scripts/pdf-visual-diff.py reference.pdf candidate.pdf \
  --output tmp/pdf-diff \
  --max-pages 500 \
  --max-pixels 40000000 \
  --max-total-pixels 250000000 \
  --timeout-seconds 120
```

## Replace generated output

The script refuses to replace a nonempty directory by default. Add `--force` to replace a directory
that the script created. It refuses to remove an unmarked directory.

```bash
python3 scripts/pdf-visual-diff.py reference.pdf candidate.pdf \
  --output tmp/pdf-diff \
  --force
```

## Run the tests

Run the focused Python tests after you install Pillow and Poppler:

```bash
python3 scripts/test/pdf-visual-diff.test.py
```
