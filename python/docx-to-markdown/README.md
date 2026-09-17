# DOCX to Markdown for Python

Convert Word documents to Markdown with individual pages, headers, footers, comments, and tracked changes. Use the full document for text processing or attach page references to search results and AI answers.

The package wraps the [`@docx-editor.dev/docx-to-markdown`](https://www.npmjs.com/package/@docx-editor.dev/docx-to-markdown) converter as a self-contained executable. No Node.js installation is required.

[PyPI](https://pypi.org/project/docx-to-markdown/) · [Documentation](https://www.docx-editor.dev/docs/2.x/export/markdown) · [Changelog](https://github.com/eigenpal/docx-editor/blob/main/packages/docx-to-markdown/CHANGELOG.md) · [Try the demo](https://docx-to-markdown.docx-editor.dev/)

## Install

```sh
pip install docx-to-markdown
```

Requires **Python 3.11 or later**. Wheels include the converter and bundled fonts.

| Platform | Supported systems |
| --- | --- |
| Linux | x64 and arm64, glibc 2.17 or newer |
| macOS | x64 and arm64, macOS 13 or later |
| Windows | x64 |

x64 CPUs must support SSE4.2. The package version matches the `@docx-editor.dev/docx-to-markdown` npm release it wraps.

## Convert a file

```python
from docx_to_markdown import convert

result = convert("contract.docx")
print(result.markdown)

for page in result.pages:
    print(f"Page {page.number}", page.markdown)
    print(page.header_markdown, page.footer_markdown)
```

`result.markdown` contains the continuous document body. Headers and footers stay in `result.pages`. `convert` also accepts bytes, `pathlib.Path` objects, and binary file objects:

```python
with open("contract.docx", "rb") as source:
    result = convert(source)
```

Page breaks depend on fonts, document features, and revision mode, so they can differ from Microsoft Word. Store the document version with page citations and inspect `result.warnings` for omitted or approximated content.

## Convert many files

Each `convert` call starts a converter process. Use `Converter` to reuse one process across a batch of files:

```python
from pathlib import Path

from docx_to_markdown import Converter

with Converter() as converter:
    for path in Path("contracts").glob("*.docx"):
        result = converter.convert(path)
        result.write(Path("output") / path.stem)
```

Options given to `Converter` are defaults for every call. Pass the same keywords to `converter.convert` to override them per file. One `Converter` is safe to share between threads; use one per thread for parallelism.

## Command line

```sh
docx-to-markdown contract.docx                 # Markdown to stdout
docx-to-markdown contract.docx -o contract.md
docx-to-markdown contract.docx --json          # full result as JSON
docx-to-markdown *.docx --bundle out/ --images # document.md, document.json, media/ per file
docx-to-markdown contract.docx --font fonts/            # family, weight, style read from each file
docx-to-markdown contract.docx --font carlito/Carlito-Regular.ttf:Calibri
```

`python -m docx_to_markdown` runs the same tool. Warnings go to stderr; `-q` hides them.

## Fonts

Page breaks depend on font metrics. The package ships metric-compatible substitutes for Word's default fonts: Calibri, Cambria, Times New Roman, Arial, Courier New, and Century Gothic. Documents that use other fonts paginate approximately unless you supply the font files.

Point `fonts` at a directory or file. Family, weight, and style are read from each file, so a folder of licensed fonts is one argument:

```python
from docx_to_markdown import convert

result = convert("contract.docx", fonts="fonts/")
```

Pass a list to combine several families or sources. Entries can be folders, files, or faces, and the first entry that serves a face wins:

```python
from docx_to_markdown import convert, font_family

result = convert(
    "contract.docx",
    fonts=["brand-fonts/", "extra/Roboto-Bold.ttf", *font_family("Aptos", "Aptos.ttf")],
)
```

When the file's own family name differs from the name the document uses, register it under the document's name:

```python
from docx_to_markdown import convert, font_files

result = convert("contract.docx", fonts=font_files("carlito/", family="Calibri"))
```

Or name each face yourself:

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

Your fonts take precedence over the bundled substitutes. A font file the converter cannot read is reported in `result.font_errors` and the conversion continues without it. Pass `font_policy="strict"` to fail instead of approximating.

### Google Fonts fallback

`google_fonts=True` fetches families the local fonts cannot serve from a pinned Google Fonts catalog. It needs network access. The catalog is a closed set of families that ship four static faces, so it does not include variable-only families such as Roboto, Open Sans, or Lato. `google_font_families()` returns the list, and `result.missing_fonts` tells you what a document still needs:

```python
from docx_to_markdown import convert, google_font_families

result = convert("report.docx", google_fonts=True)
still_missing = [f for f in result.missing_fonts if f not in google_font_families()]
```

Supply anything still missing as font files.

`result.font_resolution` reports which face measured each family. `result.fonts_complete` is `True` when every family measured with all of its faces. Check it before you rely on page numbers.

## Images

Enable image extraction and save a folder with Markdown, JSON, and image files:

```python
from docx_to_markdown import convert

result = convert("report.docx", images=True)
result.write("out/")   # document.md, document.json, media/
```

`result.media` holds each unique image with its bytes, pixel size, and page occurrences. Pass `images="html"` to keep displayed sizes in `<img>` tags.

## Comments and tracked changes

Use `display_mode="proposed"` when indexing the document's proposed text:

```python
from docx_to_markdown import convert

result = convert("contract.docx", display_mode="proposed")
for comment in result.comments:
    print(comment.author, comment.text)
```

`display_mode` selects how tracked changes are projected. `"all-markup"` (the default) keeps every insertion and deletion visible, `"proposed"` shows the document as if every change were accepted, and `"original"` as if every change were rejected. Comments and tracked changes with their Markdown offsets are in `result.review_artifacts` and `result.review_bindings`.

This setting changes the exported view; it does not accept or reject changes in the source DOCX file.

## Typed end to end

Every argument and every field of the result is typed, and the package ships `py.typed`. Pages, warnings, images, font resolution, comments, tracked changes, and Markdown bindings are frozen dataclasses with snake_case fields, so your editor can complete and check calls like these:

```python
from docx_to_markdown import PageProjection

for change in result.tracked_changes:  # list[TrackedChange]
    print(change.change, change.author, change.text)
for binding in result.review_bindings:  # list[ReviewBinding]
    if isinstance(binding.projection, PageProjection):
        print(binding.projection.page_number, binding.ranges[0].start)
```

`result.raw` keeps the converter's complete JSON for anything the records do not carry.

## Result

| Field              | Content                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| `markdown`         | The full logical document                                                                         |
| `pages`            | `Page`: `number`, `markdown`, `header_markdown`, `footer_markdown`, `comments`, `tracked_changes` |
| `warnings`         | `ExportWarning` with a stable `code`, a message, and a page number when known                     |
| `media`            | `MediaAsset` with bytes, pixel size, and `ImageOccurrence` placements                             |
| `font_resolution`  | `FontResolution`: which face measured each family, with `missing` and `complete`                  |
| `font_errors`      | Font files that could not be admitted                                                             |
| `review_artifacts` | `Comment` and `TrackedChange` records, also split as `comments` and `tracked_changes`             |
| `review_bindings`  | `ReviewBinding`: where each artifact sits in the Markdown, in UTF-16 offsets                      |
| `pagination`       | `Pagination`: layout revision and display mode                                                    |
| `raw`              | The converter's complete JSON result                                                              |

`write(directory)` saves `document.md`, `document.json`, and `media/`, the same layout as the Node.js package's `writeMarkdownBundle`.

## Errors

`ConversionError` carries a stable `code` such as `docx-unreadable`, `timeout`, or `runtime-missing`, and a message. A missing input path raises `FileNotFoundError`.

## Build from source

Versions and the [shared changelog](https://github.com/eigenpal/docx-editor/blob/main/packages/docx-to-markdown/CHANGELOG.md) are managed by Changesets. For Python package changes, select `@docx-editor.dev/docx-to-markdown` when running `bun changeset` and describe the Python behavior in the release note. The release workflow builds and publishes Python wheels from the same version tag as the npm packages. See the [release guide](https://github.com/eigenpal/docx-editor/blob/main/docs/RELEASING.md#python-pypi-releases) for the publishing flow.

The runtime is a Bun executable built from this repository. From the repository root:

```sh
bun install
bun run build:packages
cd python/docx-to-markdown
bun run typecheck:runtime
bun run build:runtime
uv build --wheel
```

`bun run build:runtime` compiles `runtime/main.ts` for the current machine and copies the packaged fonts and license texts into `src/docx_to_markdown/_vendor/`. Pass `--target bun-linux-x64` to cross-compile. Set `DOCX_TO_MARKDOWN_RUNTIME` to run the package against an executable built elsewhere.

## License

The package is licensed under the Apache License, Version 2.0. `LICENSE` and `NOTICE` ship in the wheel's metadata.

The executable is a compiled bundle. Everything it contains keeps its own license, and every text travels with the wheel in `docx_to_markdown/_vendor/licenses/`:

- `THIRD_PARTY_NOTICES.md` lists each bundled npm package with its license text. The list is generated from the bundle graph at build time, and a package without a license text fails the build.
- `bun-LICENSE.md` covers the Bun runtime (MIT) and the libraries it links, including JavaScriptCore under the LGPL.
- `harfbuzz-COPYING.txt` covers the HarfBuzz text shaper.
- `OFL-*.txt`, `LICENSE-Liberation.txt`, `GUST-FONT-LICENSE.txt`, and `LPPL-1.3c.txt` cover the bundled font files.
