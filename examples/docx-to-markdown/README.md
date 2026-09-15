# DOCX to Markdown demo

Convert a DOCX in your browser and compare the document with its Markdown output.

## Run the demo

Install the workspace dependencies with `bun install` from the repository root, then start the demo:

```bash
bun dev:markdown
```

Open [localhost:5177](http://localhost:5177). Drop a `.docx` or edit the sample.
Markdown updates after you pause typing.

## Use the demo

- **Preview** renders Markdown by page.
- **Source** shows the page Markdown. Switching between **Preview** and **Source** keeps your current page and approximate reading position.
- **API** shows a Node.js example and the live JSON response. Click the install command to copy it.
- **Copy** copies the active code, JSON, or full-document Markdown.
- **Download** saves a ZIP with Markdown, image files, and JSON metadata when images are present. Otherwise, it saves Markdown.

Preview settings select which page fields to show. They don't change the API response.
Full-document Markdown excludes repeated headers and footers.

Click a Markdown page to reveal the corresponding Word page, or use **View in DOCX** with the keyboard. Links, modified clicks, and text selections keep their normal behavior. On narrow screens, page navigation switches back to the Word pane.

## Embed the converter

Add `?embed=1` to the demo URL when the host page supplies its own branding. Embedded mode removes the duplicate logo and Reset button and centers a lighter **Open DOCX** button above the Word pane. Standalone mode retains the original header and Reset control.

## Output details

Fonts use packaged substitutes, then Google Fonts, which requires network access.
Images use `images: { syntax: 'html' }` to preserve each occurrence's displayed size.
The preview keeps inline images beside their surrounding text and shrinks oversized images to fit.
Image metadata includes intrinsic pixel dimensions and each occurrence's displayed dimensions in CSS pixels.
See the [image API guide](../../packages/docx-to-markdown/docs/images.md) for custom previews and server delivery.
Use **See comments** or **See tracked changes** beside a page number to expand its review panel.
Panels start closed and appear outside the paper in both **Preview** and **Source** views.
Nested tables use inline HTML. Cropping, rotation, and floating text wrapping are not reproduced.
The preview sanitizes HTML before rendering it.

## Check preview layout

Run `bun run --filter './examples/docx-to-markdown' check:preview` from the repository root.
The check starts its own Vite server and uses Playwright Chromium.
It verifies all sample pages, review controls, and content containment at desktop and mobile widths in **Preview** and **Source** views.
CI runs this check after the demo builds.

## Next steps

- [Install the converter in your application](../../packages/docx-to-markdown/README.md).
- [Read the Markdown export guide](https://www.docx-editor.dev/docs/2.x/export/markdown).
