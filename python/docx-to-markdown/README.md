# DOCX to Markdown for Python

Convert Word documents to Markdown, with individual pages, headers, footers, comments, and tracked changes.

## Install

Use Python 3.11 or later. Install the package with pip:

```sh
pip install docx-to-markdown
```

## Usage

Convert a file and read its document and page output:

```python
from docx_to_markdown import convert

result = convert("contract.docx")
print(result.markdown)

for page in result.pages:
    print(f"Page {page.number}", page.markdown)
    print(page.header_markdown, page.footer_markdown)
```

`result.markdown` contains the document body; headers and footers stay in `result.pages`. Input can be a file path, bytes, or a binary file object.

## Options

Enable images, supply font files, and choose a tracked-change view:

```python
result = convert(
    "contract.docx",
    images=True,
    fonts="fonts/",
    google_fonts=True,
    display_mode="proposed",
)
result.write("out/")  # document.md, document.json, media/
```

- `images=True` extracts images; `images="html"` also preserves displayed sizes.
- `fonts` accepts font files or directories. Common Word font substitutes are bundled.
- `google_fonts=True` fetches missing fonts from a pinned Google Fonts catalog (requires network access). Use `google_font_families()` to list supported families and `result.missing_fonts` to check what still needs local font files.
- `display_mode` selects tracked changes: `"all-markup"` (default), `"proposed"` (accepted view), or `"original"` (rejected view).

Comments and tracked changes are available in `result.comments` and `result.tracked_changes`. Page breaks can differ from Word; check `result.warnings` for conversion issues.

## Batch conversion

Reuse one converter process for multiple files:

```python
from pathlib import Path
from docx_to_markdown import Converter

with Converter() as converter:
    for path in Path("contracts").glob("*.docx"):
        result = converter.convert(path)
        result.write(Path("output") / path.stem)
```

## Command line

Write Markdown to standard output, save a file, or export a bundle:

```sh
docx-to-markdown contract.docx                 # Markdown to stdout
docx-to-markdown contract.docx -o contract.md
docx-to-markdown contract.docx --json
docx-to-markdown *.docx --bundle out/ --images
```

[Documentation](https://www.docx-editor.dev/docs/2.x/export/markdown) · [Try the demo](https://docx-to-markdown.docx-editor.dev/) · [PyPI](https://pypi.org/project/docx-to-markdown/) · [Changelog](https://github.com/eigenpal/docx-editor/blob/main/packages/docx-to-markdown/CHANGELOG.md)

## License

Apache 2.0. Bundled dependencies and fonts retain their own licenses; notices are included in the package.
