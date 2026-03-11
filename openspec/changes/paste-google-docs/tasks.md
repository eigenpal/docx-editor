# Tasks: Paste from Google Docs

## Investigation

- [ ] Test current paste behavior: copy formatted text from Google Docs → paste into editor
- [ ] Inspect clipboard HTML from Google Docs (check inline styles on `<p>`, `<td>`)
- [ ] Identify paste handling entry point in our ProseMirror setup
- [ ] Check if `transformPastedHTML` hook is already used

## Text alignment

- [ ] Extract `textAlign` from pasted `<p>` elements
- [ ] Map to `paragraphProperties.justification` (left, center, right, both)
- [ ] Test with centered and right-aligned paragraphs

## Line spacing

- [ ] Extract `lineHeight` from pasted `<p>` elements
- [ ] Convert to spacing values: 1.2→single, 1.8→1.5x, 2.4→double
- [ ] Extract `marginTop`/`marginBottom` for spacing before/after
- [ ] Test with different spacing values

## Indentation

- [ ] Extract `marginLeft` from pasted `<p>` elements
- [ ] Convert pt to twips for `indent.left`
- [ ] Handle nested indentation levels
- [ ] Test with indented paragraphs

## Heading detection

- [ ] Detect heading-like paragraphs by font-size + font-weight
- [ ] Convert matching `<p>` elements to `<h1>`-`<h6>` tags before PM parsing
- [ ] Map Google Docs font sizes to heading levels
- [ ] Test with all heading levels (H1-H6)

## Table cell styles

- [ ] Extract `backgroundColor` from `<td>` → cell fill
- [ ] Extract `verticalAlign` from `<td>` → cell vertical alignment
- [ ] Extract `padding` from `<td>` → cell margins
- [ ] Extract `border` from `<td>` → cell borders (parse width, style, color)
- [ ] Test with colored and bordered table cells

## Testing

- [ ] E2E test: paste centered text from Google Docs
- [ ] E2E test: paste text with 1.5x line spacing
- [ ] E2E test: paste indented paragraph
- [ ] E2E test: paste H1/H3 headings
- [ ] E2E test: paste table with colored cells
- [ ] Run `bun run typecheck`
