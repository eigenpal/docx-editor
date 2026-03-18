# Design: Fix Google Docs Paste -- Bold, Table Borders, Font Weight (#181)

## Root Cause Analysis

### 1. All Pasted Text Becomes Bold

**Root cause**: Google Docs wraps ALL clipboard content in a structural `<b>` tag:

```html
<b id="docs-internal-guid-XXXXX" style="font-weight:normal;">
  <h1>...</h1>
  <p><span style="font-weight:400">normal</span><span style="font-weight:700">bold</span></p>
  <table>
    ...
  </table>
</b>
```

The `<b>` is NOT a formatting tag -- it is a container Google Docs uses to hold its internal GUID. Note `style="font-weight:normal"`, which confirms it is not meant to indicate bold.

ProseMirror's mark parsing evaluates `parseDOM` rules top-to-bottom. In `BoldExtension.ts`:

```ts
parseDOM: [
  { tag: 'strong' },           // Rule 1: matches <strong>
  { tag: 'b' },                 // Rule 2: matches <b> -- THIS IS THE BUG
  { style: 'font-weight', ... } // Rule 3: matches font-weight >= 500
]
```

Rule 2 (`{ tag: 'b' }`) matches the structural `<b>` wrapper unconditionally, applying the bold mark to EVERY child node. The fact that the `<b>` has `style="font-weight:normal"` is irrelevant because `{ tag: 'b' }` has no `getAttrs` that checks the style.

Meanwhile, Rule 3 (`{ style: 'font-weight' }`) correctly identifies `font-weight:700` as bold. But since Rule 2 already applied bold to everything, the truly bold text just gets the mark redundantly.

**Result**: All text appears bold -- body text, table cells, everything.

### 2. Table Borders Disappear

**Root cause**: Google Docs table cells have borders as inline CSS:

```html
<td
  style="border-left:solid #000000 1pt;border-right:solid #000000 1pt;
           border-bottom:solid #000000 1pt;border-top:solid #000000 1pt;
           vertical-align:top;padding:5pt 5pt 5pt 5pt;"
></td>
```

But `TableExtension.ts`'s `tableCellSpec.parseDOM` only extracts:

```ts
getAttrs(dom): TableCellAttrs {
  const element = dom as HTMLTableCellElement;
  return {
    colspan: element.colSpan || 1,
    rowspan: element.rowSpan || 1,
    verticalAlign: element.dataset.valign as ...,    // only data-valign, NOT style
    backgroundColor: element.dataset.bgcolor || ...,  // only data-bgcolor, NOT style
  };
}
```

The `borders` attribute exists on `TableCellAttrs` but is never populated from inline CSS during paste. The `verticalAlign` and `backgroundColor` are also only read from `data-*` attributes, not from CSS.

**Result**: Table borders, vertical alignment, and padding are all lost.

### 3. Font Weight/Size Mismatch

**Root cause**: Two sub-issues:

a) **Font-weight normalization**: The BoldExtension's regex `^(bold(er)?|[5-9]\d{2})$` correctly matches `500`-`999` but the `{ tag: 'b' }` rule fires first, bypassing the weight check entirely. After fixing the `<b>` wrapper issue, the font-weight rule will work correctly since `400` will NOT match (it only matches `>=500`).

b) **The heading `<h1>` span has `font-weight:400`**: Google Docs puts `font-weight:400` on the span inside `<h1>` because the heading font-weight comes from the `<h1>` tag itself, not the span. Since the `<b>` wrapper currently makes everything bold, this isn't noticed -- but after fixing the `<b>` issue, heading text may appear non-bold. This is actually correct: the editor maps `<h1>` to `styleId: 'Heading1'`, which should carry its own formatting.

## Solution Architecture

### Approach: Modify `transformPastedHTML` to Neutralize Structural `<b>` Wrappers

Rather than changing BoldExtension's `parseDOM` (which could break regular bold parsing from other sources), we augment the `PasteStyleInlinerExtension` to detect and unwrap Google Docs structural `<b>` tags.

**Detection**: The structural `<b>` is identifiable by `id` starting with `docs-internal-guid-`.

**Strategy**:

1. **In `PasteStyleInlinerExtension.transformPastedHTML()`**:
   - After inlining `<style>` blocks (existing behavior)
   - Detect Google Docs paste by checking for `<b id="docs-internal-guid-..."`
   - Unwrap the structural `<b>` tag, replacing it with its children
   - This removes the false bold trigger while preserving all inner content and its `font-weight` inline styles

2. **In `BoldExtension.parseDOM`**:
   - Add a `getAttrs` to the `{ tag: 'b' }` rule to check for `font-weight:normal` or `font-weight:400` on the element's inline style, returning `false` (no match) in that case
   - This is a belt-and-suspenders approach: even if the structural `<b>` isn't stripped by `transformPastedHTML`, the bold mark won't apply if the `<b>` has explicit normal weight

3. **In `TableExtension.tableCellSpec.parseDOM`**:
   - Extract `border-*` CSS properties from inline styles and map to `BorderSpec` attributes
   - Extract `vertical-align` from inline styles (fallback when `data-valign` is absent)
   - Extract `background-color` from inline styles (fallback when `data-bgcolor` is absent)
   - Extract `padding` from inline styles and map to `margins` (cell padding in twips)

### Why This Approach

- **Minimal blast radius**: The `transformPastedHTML` change is scoped to Google Docs detection. Other paste sources (Word, plain HTML) are unaffected.
- **Defense in depth**: The `BoldExtension` `getAttrs` change provides a safety net even without the `transformPastedHTML` fix. Any `<b style="font-weight:normal">` from any source will correctly not trigger bold.
- **Extensible**: The table cell CSS extraction can be reused for paste from Word Online, Notion, and other web apps that use inline CSS.

## Data Flow

```
User copies from Google Docs
  -> Clipboard contains HTML with structural <b> wrapper
  -> User pastes into editor
  -> PasteStyleInlinerExtension.transformPastedHTML() fires first (Priority.High)
     -> Inlines any <style> blocks (existing behavior)
     -> Detects docs-internal-guid <b> wrapper
     -> Unwraps the <b>, preserving child elements
     -> Returns modified HTML string
  -> ProseMirror parseDOM processes the cleaned HTML
     -> BoldExtension.parseDOM sees <span style="font-weight:700"> -> bold mark applied
     -> BoldExtension.parseDOM sees <span style="font-weight:400"> -> no bold mark (400 < 500)
     -> TableExtension.parseDOM sees <td style="border-left:solid #000000 1pt;...">
        -> Extracts border CSS -> maps to BorderSpec { style: 'single', size: 8, color: { rgb: '000000' } }
     -> ParagraphExtension.parseDOM sees <h1> -> maps to styleId: 'Heading1'
  -> ProseMirror document built with correct formatting
  -> Layout painter renders visible pages with correct bold/normal and table borders
```

## Actual Google Docs Clipboard HTML (captured 2026-03-15)

```
<b id="docs-internal-guid-XXXX" style="font-weight:normal;">
  <h1 style="line-height:1.38;margin-top:20pt;margin-bottom:6pt;">
    <span style="font-size:20pt;font-family:Arial,sans-serif;color:#000000;
                  background-color:transparent;font-weight:400;font-style:normal;...">
      Test Heading
    </span>
  </h1>
  <p style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;">
    <span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;
                  background-color:transparent;font-weight:400;...">
      This is normal body text...
    </span>
    <span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;
                  background-color:transparent;font-weight:700;...">
      bold
    </span>
    <span style="font-size:11pt;...;font-weight:400;...">
       in this sentence.
    </span>
  </p>
  <div>
    <table style="border:none;border-collapse:collapse;">
      <tbody>
        <tr>
          <td style="border-left:solid #000000 1pt;border-right:solid #000000 1pt;
                      border-bottom:solid #000000 1pt;border-top:solid #000000 1pt;
                      vertical-align:top;padding:5pt 5pt 5pt 5pt;...">
            <p><span style="font-weight:400;font-size:11pt;...">Product</span></p>
          </td>
          ...
        </tr>
      </tbody>
    </table>
  </div>
</b>
```

Key observations:

- `<b>` wrapper has `style="font-weight:normal;"` and `id="docs-internal-guid-..."`
- No `<style>` block -- all CSS is inline (2026 behavior; older Docs versions used `<style>` blocks)
- Bold text indicated by `font-weight:700` on `<span>`, normal by `font-weight:400`
- Headings use semantic `<h1>` tag but span inside has `font-weight:400`
- Table borders are CSS shorthand: `border-left:solid #000000 1pt`
- Table cell padding: `padding:5pt 5pt 5pt 5pt`
- Vertical alignment: `vertical-align:top`

## Files to Modify

| File                            | Change                                                                                        |
| ------------------------------- | --------------------------------------------------------------------------------------------- |
| `PasteStyleInlinerExtension.ts` | Add Google Docs `<b>` wrapper detection and unwrapping in `transformPastedHTML`               |
| `BoldExtension.ts`              | Add `getAttrs` to `{ tag: 'b' }` rule to reject `font-weight:normal/400`                      |
| `TableExtension.ts`             | Extract border, vertical-align, background-color, padding from inline CSS in `td/th` parseDOM |

## Risk Assessment

- **Low risk**: BoldExtension change is additive (adds `getAttrs` to existing rule). Only affects `<b>` tags that explicitly set `font-weight:normal` or `font-weight:400` -- these would never be legitimate bold tags.
- **Low risk**: PasteStyleInlinerExtension change is paste-only, scoped to Google Docs detection via `docs-internal-guid` prefix.
- **Medium risk**: TableExtension parseDOM change needs careful CSS parsing. Border shorthand `solid #000000 1pt` must be parsed correctly into the OOXML `BorderSpec` format (style, size in eighths-of-a-point, color as ColorValue).
