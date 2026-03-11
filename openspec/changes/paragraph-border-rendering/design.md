# Design: Paragraph Border Rendering

## Architecture

Both border types flow through the same pipeline:

1. **Parser** (`docx/paragraphParser.ts`) — already parses `between` and `bar` from `w:pBdr`
2. **ProseMirror schema** (`ParagraphExtension`) — already stores borders in paragraph attrs
3. **Layout-painter** (`renderParagraph.ts`) — currently only renders `top/right/bottom/left` borders

### `w:bar` implementation

Simple: render a vertical CSS border on the left edge of the paragraph div.

```
border-left: <width> <style> <color>
```

This is independent of adjacent paragraphs — just render it whenever `borders.bar` exists.

### `w:between` implementation

More complex: requires knowledge of adjacent paragraphs.

**Rule:** Draw a horizontal line at the bottom of each paragraph in a border group _except_ the last one. Two consecutive paragraphs are in the same "border group" if they share identical border definitions.

**Approach:** In `renderParagraph.ts`, when rendering a paragraph with `borders.between`:

1. Check if the next sibling paragraph also has `borders.between` with matching properties
2. If yes, render a bottom border using the `between` border properties
3. If no (last in group), skip the between border

## Key files

| File                                    | Change                                         |
| --------------------------------------- | ---------------------------------------------- |
| `src/layout-painter/renderParagraph.ts` | Add `bar` and `between` border rendering       |
| `src/types/formatting.ts`               | Verify `between` and `bar` are in border types |
