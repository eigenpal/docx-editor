# Unsupported content consumer trial

This demo uses public built React and Vue package exports. It displays custom XML as a legal approval card and an inline reference chip. It also replaces the document's unsupported drawing placeholder.

The custom components read labels and status from `element.source`. The approval card includes details and a local annotation input. Annotations stay in component state. They do not change the saved DOCX.

## Run the example

Build the packages from the repository root if needed:

```sh
bun run build:packages
cd examples/unsupported-content-trial
bun run dev
```

Open http://127.0.0.1:5199 for React. Select **Open Vue trial** for Vue.

- **Custom components** switches component content to built-in fallbacks.
- **Register custom XML** adds or removes projected custom XML layout boxes.
- **Change zoom** tests component state through a repaint.
- **Save DOCX** downloads the document through the public editor ref.

React and Vue register renderers through `DocxEditor.UnsupportedElement`. The approval uses a 420 × 118 point box. The reference uses a 112 × 22 point box. The source position determines block or inline placement. The drawing retains its authored layout box.

The checked-in fixture adds opaque XML in namespace `urn:consumer-review`. Run `python3 examples/unsupported-content-trial/generate-fixture.py` to regenerate it. The script retains the original DrawingML from the canonical fixture.

Run the browser checks from another terminal at the repository root:

```sh
node examples/unsupported-content-trial/browser-trial.mjs
```

The checks use the installed macOS Google Chrome application. They save and reopen the edited document and compare the opaque XML source trees. See [FEEDBACK.md](./FEEDBACK.md) for verified results and trial limits.

The Vite aliases choose built workspace packages without installing a second engine. Use application state keyed by `nodeId` when annotations must survive component unmounting.
