# DOCX to Markdown for Python

Convert DOCX files to Markdown with the layout engine behind
[docx-editor.dev](https://docx-editor.dev). The result carries the document body, one
Markdown projection per printed page, headers and footers, comments, and tracked changes,
so page citations match Word.

The package wraps the [`@docx-editor.dev/docx-to-markdown`](https://www.npmjs.com/package/@docx-editor.dev/docx-to-markdown)
converter as a self-contained executable. No Node.js installation is required.

## Install

```sh
pip install docx-to-markdown
```

Wheels are platform-specific: Linux x64 and arm64, macOS x64 and arm64, and Windows x64.
Python 3.9 or later.

## Convert a file

```python
from docx_to_markdown import convert

result = convert("contract.docx")
print(result.markdown)

for page in result.pages:
    print(page.number, page.markdown[:80])
```

`convert` also accepts the file's bytes or a binary file object.

## Convert many files

Each `convert` call starts a converter process, which costs about half a second. A
`Converter` keeps one process warm, so each later conversion costs only the layout itself:

```python
from docx_to_markdown import Converter

with Converter() as converter:
    for path in paths:
        result = converter.convert(path)
```

Options given to `Converter` are defaults for every call. Pass the same keywords to
`converter.convert` to override them per file. One `Converter` is safe to share between
threads; use one per thread for parallelism.

## Command line

```sh
docx-to-markdown contract.docx                 # Markdown to stdout
docx-to-markdown contract.docx -o contract.md
docx-to-markdown contract.docx --json          # full result as JSON
docx-to-markdown *.docx --bundle out/ --images # document.md, document.json, media/ per file
docx-to-markdown contract.docx --font fonts/Aptos.ttf:Aptos --font fonts/Aptos-Bold.ttf:Aptos:700
```

`python -m docx_to_markdown` runs the same tool. Warnings go to stderr; `-q` hides them.

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
assert result.fonts_complete
```

Your fonts take precedence over the bundled substitutes. A font file the converter cannot
read is reported in `result.font_errors` and the conversion continues without it. Pass
`font_policy="strict"` to fail instead of approximating, or `google_fonts=True` to fetch
families the local fonts cannot serve from Google Fonts.

`result.font_resolution` reports which face measured each family. `result.fonts_complete`
is `True` when every family measured with all of its faces. Check it before you rely on
page numbers.

## Images

```python
result = convert("report.docx", images=True)
result.write("out/")   # document.md, document.json, media/
```

`result.media` holds each unique image with its bytes, pixel size, and page occurrences.
Pass `images="html"` to keep displayed sizes in `<img>` tags.

## Tracked changes

`display_mode` selects how tracked changes are projected. `"all-markup"` (the default)
keeps every insertion and deletion visible, `"proposed"` shows the document as if every
change were accepted, and `"original"` as if every change were rejected. Comments and
tracked changes with their Markdown offsets are in `result.review_artifacts` and
`result.review_bindings`.

## Result

| Field | Content |
| --- | --- |
| `markdown` | The full logical document |
| `pages` | `Page` objects: `number`, `markdown`, `header_markdown`, `footer_markdown`, `comments`, `tracked_changes` |
| `warnings` | `ExportWarning` objects with a stable `code`, a message, and a page number when known |
| `media` | `MediaAsset` objects with bytes and page occurrences |
| `font_resolution` | Which face measured each family |
| `font_errors` | Font files that could not be admitted |
| `raw` | The converter's complete JSON result |

`write(directory)` saves `document.md`, `document.json`, and `media/`, the same layout
as the Node.js package's `writeMarkdownBundle`.

## Errors

`ConversionError` carries a stable `code` such as `docx-unreadable`, `timeout`, or
`runtime-missing`, and a message. A missing input path raises `FileNotFoundError`.

## Build from source

The runtime is a Bun executable built from this repository. From the repository root:

```sh
bun install
bun run build:packages
cd python/docx-to-markdown
bun run typecheck:runtime
bun run build:runtime
uv build --wheel
```

`bun run build:runtime` compiles `runtime/main.ts` for the current machine and copies the
packaged fonts and license texts into `src/docx_to_markdown/_vendor/`. Pass
`--target bun-linux-x64` to cross-compile. Set `DOCX_TO_MARKDOWN_RUNTIME` to run the
package against an executable built elsewhere.

## License

Apache-2.0. The bundled fonts carry their own licenses, reproduced in the installed
`_vendor/licenses` directory.
