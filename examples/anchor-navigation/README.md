# DOCX paragraph reference example

Use a React panel to scroll to a paragraph reference, highlight it, or both. Choose the reference, effect, highlight style, duration, and scroll settings to see the result in the document.

## Run the example

From the repository root, run:

```bash
bun install
bun run build:packages
bun run dev:anchors
```

Open `http://localhost:5181`.

## Try it

1. In **Reference**, select a finding, and then select **Show reference**. The editor scrolls to the paragraph and highlights it.
2. In **Effect**, select **Scroll only** or **Highlight only** to see each method alone.
3. In **Highlight style**, select a preset. The **Green glow (CSS class)** preset adds a glow through a CSS class.
4. In **Highlight duration**, select **Until cleared**. The highlight stays until you select **Clear highlight**.
5. Select the header reference or the missing paragraph to see an unavailable result.

The panel shows the `scrollToAnchor` and `highlightAnchor` calls for the current settings.

## How it works

Each reference is a `DocAnchor`: a paragraph's `w14:paraId`, with optional `search` text and `occurrence`. A review tool or server stores this reference with its finding. The example builds a sample agreement in the browser without a server.

`editor.scrollToAnchor(anchor, options)` moves the viewport. `editor.highlightAnchor(anchor, options)` adds a temporary highlight to the paragraph. Both methods preserve selection, focus, document content, and undo history.

Headers, footers, and notes support scrolling but not highlights. When you select the header reference, the editor scrolls to it. The panel reports that the highlight is unavailable.

For more information, see [Navigate a document](https://docx-editor.dev/docs/2.x/guides/navigation).
