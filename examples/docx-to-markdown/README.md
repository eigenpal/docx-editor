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
- **Download** saves a ZIP with Markdown, image files, and JSON metadata when images are present. Otherwise, it saves Markdown.

Preview settings select which page fields to show. They don't change the API response.
Full-document Markdown excludes repeated headers and footers.

## Output details

Fonts use packaged substitutes, then Google Fonts, which requires network access.
Images use `images: { syntax: 'html' }` to preserve each occurrence's displayed size.
The preview keeps inline images beside their surrounding text and shrinks oversized images to fit.
Image metadata includes intrinsic pixel dimensions and each occurrence's displayed dimensions in CSS pixels.
See the [image API guide](../../packages/docx-to-markdown/docs/images.md) for custom previews and server delivery.
Comments and tracked changes appear outside the paper, in a sidebar on wide previews or a collapsible panel on narrow previews.
Nested tables use inline HTML. Cropping, rotation, and floating text wrapping are not reproduced.
The preview sanitizes HTML before rendering it.
