# DOCX editor pop-out window example

Move the editor into its own browser window and back. The document, undo history, selection, and comments stay the same across each move. The example uses the Pro review module, so you can comment and suggest changes in either window.

## Run the example

From the repository root, run:

```bash
bun install
bun run build:packages
bun run dev:popout
```

Open `http://127.0.0.1:5182`.

## Try it

1. Type some text, and then select **Pop out**. The editor opens in a new window with the same text and caret.
2. Keep typing in the new window, and then press Ctrl+Z (Cmd+Z on macOS). Undo removes text that you typed in either window.
3. Select some text, right-click, and select **Add a comment**. Comments and suggestions work in the pop-out like in the main window.
4. Select **Bring back**, or close the pop-out window. The editor returns to the main window with its history and comments.

## How it works

`DocxEditor.Root` owns the editor and stays mounted in the main window. `DocxEditor.Window` opens a pop-out, copies this page's stylesheets into it, and renders its children there while `open` is `true`. When the user closes the pop-out, it renders the children in place again and calls `onClose`.

For more information, see [Pop-out windows and iframes](../../docs/site/content/guides/pop-out-windows.mdx).
