# Happy path

This example uses the packaged `<DocxEditor>` component without custom
composition.

From the repository root, run:

```bash
bun install
bun run dev:happypath
```

Open `http://localhost:5175/`.

## Use the packaged editor

The component provides the title bar, menus, toolbar, rulers, navigation pane,
hyperlink popover, and context menu.

The example adds comments and tracked changes with `reviewModule()`.
It adds `<DocxEditorReview />` as a child.
The child slot stays in the viewport, so the review rail scrolls with the
document.

## Add host behavior

`src/HappyPath.tsx` adds the behavior that the host must control:

- **New** uses fresh bytes from `blankDocumentBytes()`.
- **Open** passes selected `.docx` bytes to the `document` prop.
- **Save** calls `ref.save()` and downloads the result.

The host also controls the title through `title` and `onTitleChange`.

## Understand loading

The `document` prop stays `undefined` until the demo bytes arrive.
The packaged loading screen displays during that time.

Use `document="blank"` when you need an empty document.
Do not reuse `"blank"` for a repeated **New** action because its identity never
changes.
This example passes fresh `blankDocumentBytes()` for each **New** action.

## Styling

`src/styles.css` styles only the host controls.
It uses the editor's `--doc-*` color tokens.

## Package resolution

`vite.config.ts` aliases `@docx-editor.dev/*` to workspace source.
The app therefore needs no package build.
It loads the demo document from `examples/vite/public/sample.docx`.

For a custom interface, compare this example with `examples/vite`.
