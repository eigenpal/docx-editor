# DOCX to Markdown demo

Convert a DOCX in your browser and compare the document with its Markdown output.

## Run

From the repository root:

```bash
bun dev:markdown
```

Open [localhost:5177](http://localhost:5177). Drop a `.docx` or edit the sample.
Markdown updates after you pause typing.

## Use

- **Preview** renders Markdown by page.
- **Source** shows the page Markdown.
- **API** shows a Node.js example and the live JSON response. Click the install command to copy it.
- **Copy** copies the active code, JSON, or full-document Markdown.
- **Download** saves the full-document Markdown as a `.md` file.

Preview settings select which page fields to show. They don't change the API response.
Full-document Markdown excludes repeated headers and footers.

## Output details

Fonts use packaged substitutes, then Google Fonts, which requires network access.
Images affect pagination but are omitted from Markdown. Nested tables use inline HTML.
The preview sanitizes HTML before rendering it.
