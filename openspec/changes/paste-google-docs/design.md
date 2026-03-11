# Design: Google Docs Paste Formatting

## How Google Docs clipboard works

Google Docs puts HTML on the clipboard with inline styles on `<p>` and `<td>` elements. It does NOT use semantic HTML for most formatting — instead relies on CSS properties.

### Typical Google Docs HTML

```html
<p style="text-align: center; line-height: 1.8; margin-top: 12pt; margin-left: 30pt">
  <span style="font-size: 24pt; font-weight: 700">Heading text</span>
</p>

<table>
  <tr>
    <td
      style="background-color: rgb(255, 255, 0); vertical-align: top; padding: 5pt; border: 0.68pt solid rgb(128, 128, 128)"
    >
      Cell content
    </td>
  </tr>
</table>
```

## Implementation approach

Intercept the paste event and pre-process the HTML before ProseMirror parses it. This runs in the paste handler (or `transformPastedHTML` hook).

### Text alignment

Read `node.style.textAlign` from `<p>` elements → map to `paragraphProperties.justification`.

### Line spacing

Read `node.style.lineHeight` → convert to `paragraphProperties.spacing.line`:

- `"1.2"` → single (240 twips, lineRule: auto)
- `"1.8"` → 1.5x (360 twips)
- `"2.4"` → double (480 twips)
- Other values → calculate proportionally

### Indentation

Read `node.style.marginLeft` → convert pt to twips → `paragraphProperties.indent.left`.

### Heading detection

Detect headings by `font-size` + `font-weight`:

- 24pt bold → H1
- 18pt bold → H2
- 14pt bold → H3
- 12pt bold → H4
- 10pt bold → H5
- 8pt bold → H6

Convert `<p>` with matching styles to `<h1>`-`<h6>` before PM parsing.

### Table cell styles

Extract from `<td>` inline CSS:

- `backgroundColor` → cell shading/fill
- `verticalAlign` → cell vertical alignment
- `padding` → cell margins
- `border` → cell borders (parse width, style, color)

## Key files

| File                                                     | Change                                 |
| -------------------------------------------------------- | -------------------------------------- |
| `src/prosemirror/extensions/`                            | Paste handler or `transformPastedHTML` |
| `src/prosemirror/extensions/nodes/ParagraphExtension.ts` | parseDOM for styled `<p>`              |
| `src/prosemirror/extensions/nodes/TableExtension.ts`     | parseDOM for styled `<td>`             |
