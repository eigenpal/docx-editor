# DOCX to Markdown for Python

Convert DOCX files to Markdown with the same layout engine that powers
[docx-editor.dev](https://docx-editor.dev). The result carries the document body,
one Markdown projection per printed page, headers and footers, comments, and tracked
changes, so page citations match Word.

The package wraps the `@docx-editor.dev/docx-to-markdown` npm package as a
self-contained executable. No Node.js installation is required.

## Install

```sh
pip install docx-to-markdown
```

Wheels are platform-specific. Supported platforms are Linux x64 and arm64, macOS x64 and
arm64, and Windows x64.

## Convert a file

```python
from docx_to_markdown import convert

result = convert("contract.docx")
print(result.markdown)

for page in result.pages:
    print(page["pageNumber"], page["markdown"][:80])
```

`convert` also accepts the file's bytes.

## Fonts

Page breaks depend on font metrics. The package ships metric-compatible substitutes for
Word's default fonts: Calibri, Cambria, Times New Roman, Arial, Courier New, and Century
Gothic. Documents that use other fonts paginate approximately unless you supply the font
files.

Register a family under the name the document uses:

```python
from docx_to_markdown import convert, font_family

aptos = font_family(
    "Aptos",
    "fonts/Aptos.ttf",
    bold="fonts/Aptos-Bold.ttf",
    italic="fonts/Aptos-Italic.ttf",
    bold_italic="fonts/Aptos-BoldItalic.ttf",
)
result = convert("contract.docx", fonts=aptos)
```

Your fonts take precedence over the bundled substitutes. A font file the converter cannot
read is reported in `result.font_errors` and the conversion continues without it. Pass
`font_policy="strict"` to fail instead of approximating, or `google_fonts=True` to fetch
families the local fonts cannot serve from Google Fonts.

`result.font_resolution` reports which face measured each family. Check it before you rely
on page numbers.

## Images

```python
result = convert("report.docx", images=True)
for asset in result.media:
    with open(asset.path, "wb") as f:
        f.write(asset.bytes)
```

Pass `images="html"` to keep displayed sizes in `<img>` tags.

## Tracked changes

`display_mode` selects how tracked changes are projected: `"all-markup"` (the default)
keeps every insertion and deletion visible, `"proposed"` shows the document as if every
change were accepted, and `"original"` as if every change were rejected.

## Result fields

| Field                                 | Content                                                            |
| ------------------------------------- | ------------------------------------------------------------------ |
| `markdown`                            | The full logical document                                          |
| `pages`                               | One entry per printed page with its Markdown, headers, and footers |
| `warnings`                            | Omitted content and font problems                                  |
| `media`                               | Extracted images with bytes and page occurrences                   |
| `font_resolution`                     | Which face measured each family                                    |
| `font_errors`                         | Font files that could not be admitted                              |
| `review_artifacts`, `review_bindings` | Comments and tracked changes with Markdown offsets                 |
| `raw`                                 | The converter's complete JSON result                               |

## Build from source

The runtime is a Bun executable built from this repository. From the repository root:

```sh
bun install
bun run build:packages
cd python/docx-to-markdown
bun run build:runtime
uv build --wheel
```

`bun run build:runtime` compiles `runtime/main.ts` for the current machine and copies the
packaged fonts and license texts into `src/docx_to_markdown/_vendor/`. Pass
`--target bun-linux-x64` to cross-compile.

## License

Apache-2.0. The bundled fonts carry their own licenses, reproduced in the installed
`_vendor/licenses` directory.
