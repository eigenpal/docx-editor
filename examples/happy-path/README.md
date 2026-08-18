# Happy path

The packaged `<DocxEditor>` component, with nothing composed by hand.

```bash
bun install
bun run dev:happypath   # http://localhost:5175/
```

The app opens the demo document, and you get the full editor: title bar, menu bar,
toolbar, rulers, navigation pane, hyperlink popover, and context menu. None of that is in
this app's source. It arrives with the component.

## What the component gives you

Everything above, from one element. Two more lines add comments and tracked changes:
`modules={[reviewModule()]}` from `@docx-editor.dev/pro`, and `<DocxEditorReview />` as a
child. `children` is the component's in-viewport slot, so the review rail scrolls with
the document and you never drop to the primitives. Without the module, the Comments &
Changes control and suggesting mode stay disabled and say why.

## What the host owns

`src/HappyPath.tsx` is one component, and it adds only what a library cannot decide for
you:

- **New** — `blankDocumentBytes()` from `@docx-editor.dev/core/editor`, which is Word's
  blank template with its Calibri 11pt defaults authored.
- **Open** — a `.docx` file picker whose bytes go to the `document` prop. The menu's
  File › Open row points at the same picker through `onOpen`.
- **Save** — `ref.save()` through `DocxEditorRef`, downloaded as a `.docx`.

The document title is host state too, through `title` and `onTitleChange`.

## Saved state

Only the host knows whether a document is saved, because only the host knows where it
went. `onChange` reports the store revision after every edit, and the app records which
revision it last wrote out. Equal means the file matches the page.

That drives two things: the **Save** button, which is the only filled control on the strip
and goes quiet when there is nothing to commit, and the paper mark beside the document's
name, whose folded corner fills in while there are unsaved edits.

`onSave` reads the revision _before_ serializing. An edit that lands during `save()`
belongs to the next save, and marking it clean would lose it with no warning.

## Styling

`src/styles.css` styles the host strip and nothing else. Every color is a `--doc-*` token
from the editor's own stylesheet, so the strip follows the editor into dark mode if you
pass `colorMode`. The example itself stays in light mode, because the document canvas is
Word-faithful rather than themed.

## The other end of the same API

`examples/vite` drives `DocxEditor.Root` / `.Viewport` / `.Content` and builds its own
chrome over the hooks. Compare the two files to see what the packaged component does for
you, and what you give up when you replace it.

## Loading

`document` is `undefined` until the bytes arrive, and the packaged loading screen holds
that window. `undefined` is not an empty document: it means no document. Press **New**
for an empty one.

## Package resolution

`vite.config.ts` aliases `@docx-editor.dev/*` to package SOURCE, so the app runs the
working tree and needs no build step. The demo document is served from
`examples/vite/public/sample.docx` at request time, so there is one copy of those bytes
in the repo.
