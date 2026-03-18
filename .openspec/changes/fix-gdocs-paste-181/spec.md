# Technical Specification: Fix Google Docs Paste (#181)

## Overview

Fix three issues when pasting content from Google Docs into the docx-editor:

1. All text becomes bold (structural `<b>` wrapper)
2. Table borders are lost (inline CSS not parsed)
3. Font weight normalization (defense-in-depth for bold detection)

---

## File 1: `packages/core/src/prosemirror/extensions/features/PasteStyleInlinerExtension.ts`

### Change: Add Google Docs `<b>` wrapper unwrapping

**Current state**: The `transformPastedHTML` function only handles `<style>` block inlining. It returns early if no `<style>` tag is found.

**New behavior**: After style inlining, detect and unwrap Google Docs structural `<b>` wrappers.

#### New function: `unwrapGoogleDocsStructuralB(doc: Document): void`

```ts
/**
 * Google Docs wraps ALL clipboard content in a structural <b> tag:
 *   <b id="docs-internal-guid-XXXXX" style="font-weight:normal;">...content...</b>
 *
 * This is NOT a bold formatting tag -- it is a container for Google Docs' internal
 * tracking GUID. The actual bold status is on <span> elements via font-weight CSS.
 *
 * This function detects such wrappers and replaces them with their child nodes,
 * preventing ProseMirror's BoldExtension parseDOM from applying bold to all content.
 */
function unwrapGoogleDocsStructuralB(doc: Document): void {
  // Find all <b> elements whose id starts with 'docs-internal-guid-'
  const structuralBs = doc.body.querySelectorAll('b[id^="docs-internal-guid-"]');

  for (const b of structuralBs) {
    const parent = b.parentNode;
    if (!parent) continue;

    // Move all children of <b> to before the <b> in the parent
    while (b.firstChild) {
      parent.insertBefore(b.firstChild, b);
    }
    // Remove the now-empty <b>
    parent.removeChild(b);
  }
}
```

#### Modified function: `transformPastedHTML(html: string): string`

Change the early return and add the unwrap call:

```ts
function transformPastedHTML(html: string): string {
  // Quick check: determine if any processing is needed
  const hasStyleBlock = html.includes('<style');
  const hasGoogleDocsWrapper = html.includes('docs-internal-guid-');

  if (!hasStyleBlock && !hasGoogleDocsWrapper) return html;

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Step 1: Inline class-based CSS from <style> blocks (existing behavior)
    if (hasStyleBlock) {
      inlineStylesFromStyleBlocks(doc);

      // Remove the <style> elements to keep the HTML clean
      const styleElements = doc.querySelectorAll('style');
      for (const el of styleElements) {
        el.remove();
      }
    }

    // Step 2: Unwrap Google Docs structural <b> wrappers
    if (hasGoogleDocsWrapper) {
      unwrapGoogleDocsStructuralB(doc);
    }

    return doc.body.innerHTML;
  } catch {
    return html;
  }
}
```

**Why**: This is the primary fix for the bold-on-everything bug. By removing the structural `<b>` before ProseMirror's `parseDOM` runs, the `BoldExtension` tag rule for `<b>` is never triggered by the wrapper. Only `<span style="font-weight:700">` elements will trigger bold via the style rule.

---

## File 2: `packages/core/src/prosemirror/extensions/marks/BoldExtension.ts`

### Change: Add `getAttrs` to the `{ tag: 'b' }` parseDOM rule

**Current state**:

```ts
parseDOM: [
  { tag: 'strong' },
  { tag: 'b' }, // Matches ALL <b> tags unconditionally
  {
    style: 'font-weight',
    getAttrs: (value) => (/^(bold(er)?|[5-9]\d{2})$/.test(value as string) ? null : false),
  },
];
```

**New state**:

```ts
parseDOM: [
  { tag: 'strong' },
  {
    tag: 'b',
    getAttrs(dom) {
      // Reject <b> tags that explicitly declare a non-bold font-weight.
      // Google Docs uses <b id="docs-internal-guid-..." style="font-weight:normal">
      // as a structural wrapper -- these are NOT bold formatting.
      const element = dom as HTMLElement;
      const fontWeight = element.style?.fontWeight;
      if (fontWeight === 'normal' || fontWeight === '400') {
        return false; // Do not apply bold mark
      }
      return null; // Apply bold mark (default)
    },
  },
  {
    style: 'font-weight',
    getAttrs: (value) => (/^(bold(er)?|[5-9]\d{2})$/.test(value as string) ? null : false),
  },
];
```

**Why**: Defense-in-depth. Even if `transformPastedHTML` doesn't run (e.g., a plugin ordering issue, or content pasted via a different mechanism), a `<b style="font-weight:normal">` will never trigger bold. This is semantically correct: a `<b>` that says "my font-weight is normal" is not bold.

**Edge cases considered**:

- `<b>` with no style: `element.style.fontWeight` is `""` (empty string), which is neither `'normal'` nor `'400'`, so bold is correctly applied.
- `<b style="font-weight:bold">`: `fontWeight` is `'bold'`, not `'normal'` or `'400'`, so bold is correctly applied.
- `<b style="font-weight:700">`: `fontWeight` is `'700'`, not `'normal'` or `'400'`, so bold is correctly applied.
- `<b style="font-weight:300">`: `fontWeight` is `'300'`, rejected. Correct -- 300 is light, not bold.

---

## File 3: `packages/core/src/prosemirror/extensions/nodes/TableExtension.ts`

### Change: Extract inline CSS border, vertical-align, background-color, and padding from `<td>` and `<th>` during parseDOM

**Current `tableCellSpec.parseDOM`**:

```ts
parseDOM: [{
  tag: 'td',
  getAttrs(dom): TableCellAttrs {
    const element = dom as HTMLTableCellElement;
    return {
      colspan: element.colSpan || 1,
      rowspan: element.rowSpan || 1,
      verticalAlign: element.dataset.valign as ...,
      backgroundColor: element.dataset.bgcolor || undefined,
    };
  },
}]
```

**New `tableCellSpec.parseDOM`**:

```ts
parseDOM: [
  {
    tag: 'td',
    getAttrs(dom): TableCellAttrs {
      const element = dom as HTMLTableCellElement;
      const style = element.style;

      // Extract borders from inline CSS (Google Docs: "border-left:solid #000000 1pt")
      const borders = readBorderAttrsFromCSS(style);

      // Extract vertical alignment: prefer data-attribute, fall back to CSS
      const verticalAlign = (element.dataset.valign || mapCssVerticalAlign(style.verticalAlign)) as
        | TableCellAttrs['verticalAlign']
        | undefined;

      // Extract background color: prefer data-attribute, fall back to CSS
      const backgroundColor =
        element.dataset.bgcolor || parseCssColorToHex(style.backgroundColor) || undefined;

      // Extract cell padding from CSS padding property
      const margins = extractCellMarginsFromCSS(style);

      return {
        colspan: element.colSpan || 1,
        rowspan: element.rowSpan || 1,
        verticalAlign,
        backgroundColor,
        borders: borders || undefined,
        margins: margins || undefined,
      };
    },
  },
];
```

The same changes apply to `tableHeaderSpec.parseDOM` for `<th>` tags.

### New helper functions (in TableExtension.ts, before the specs)

#### `readBorderAttrsFromCSS(style: CSSStyleDeclaration)`

Parses CSS shorthand border properties and maps them to the internal `BorderSpec` format.

```ts
/**
 * Extract cell borders from inline CSS style (for paste from Google Docs, etc.)
 *
 * Google Docs uses shorthand: "border-left:solid #000000 1pt"
 * The CSSStyleDeclaration splits this into:
 *   style.borderLeftStyle = 'solid'
 *   style.borderLeftColor = 'rgb(0, 0, 0)'
 *   style.borderLeftWidth = '1pt'
 */
function readBorderAttrsFromCSS(style: CSSStyleDeclaration): TableCellAttrs['borders'] | null {
  const parseSide = (
    cssStyle: string,
    cssColor: string,
    cssWidth: string
  ): BorderSpec | undefined => {
    if (!cssStyle || cssStyle === 'none' || cssStyle === 'hidden') return undefined;

    const ooxmlStyle = cssBorderKindToOoxml(cssStyle);
    const color = parseCssColorToColorValue(cssColor);
    const size = cssBorderWidthToEighths(cssWidth);

    return {
      style: ooxmlStyle,
      color: color || undefined,
      size: size || 8, // default 1pt = 8 eighths
    };
  };

  const top = parseSide(style.borderTopStyle, style.borderTopColor, style.borderTopWidth);
  const bottom = parseSide(
    style.borderBottomStyle,
    style.borderBottomColor,
    style.borderBottomWidth
  );
  const left = parseSide(style.borderLeftStyle, style.borderLeftColor, style.borderLeftWidth);
  const right = parseSide(style.borderRightStyle, style.borderRightColor, style.borderRightWidth);

  if (!top && !bottom && !left && !right) return null;

  return { top, bottom, left, right };
}
```

#### `cssBorderKindToOoxml(cssStyle: string): BorderSpec['style']`

Maps CSS `border-style` values to OOXML border style names.

```ts
/**
 * Map CSS border-style to OOXML border style.
 * CSS: solid, double, dotted, dashed, groove, ridge, inset, outset
 * OOXML: single, double, dotted, dashed, threeDEngrave, threeDEmboss, inset, outset
 */
function cssBorderKindToOoxml(cssStyle: string): BorderSpec['style'] {
  switch (cssStyle.toLowerCase()) {
    case 'solid':
      return 'single';
    case 'double':
      return 'double';
    case 'dotted':
      return 'dotted';
    case 'dashed':
      return 'dashed';
    case 'groove':
      return 'threeDEngrave';
    case 'ridge':
      return 'threeDEmboss';
    case 'inset':
      return 'inset';
    case 'outset':
      return 'outset';
    case 'none':
    case 'hidden':
      return 'none';
    default:
      return 'single'; // Default to solid/single for unknown styles
  }
}
```

#### `cssBorderWidthToEighths(cssWidth: string): number`

Converts CSS border width to OOXML eighths-of-a-point.

```ts
/**
 * Convert CSS border width to OOXML size (eighths of a point).
 * 1pt = 8 eighths. Supports pt, px, and keyword values.
 */
function cssBorderWidthToEighths(cssWidth: string): number {
  if (!cssWidth) return 8; // default 1pt

  const trimmed = cssWidth.trim().toLowerCase();

  // Keyword values
  if (trimmed === 'thin') return 4; // 0.5pt
  if (trimmed === 'medium') return 8; // 1pt
  if (trimmed === 'thick') return 16; // 2pt

  const num = parseFloat(trimmed);
  if (isNaN(num)) return 8;

  if (trimmed.endsWith('pt')) return Math.round(num * 8);
  if (trimmed.endsWith('px')) return Math.round(num * 6); // 1px ~ 0.75pt ~ 6 eighths
  if (trimmed.endsWith('em')) return Math.round(num * 96); // 1em ~ 12pt ~ 96 eighths

  // Bare number: treat as px
  return Math.round(num * 6);
}
```

#### `parseCssColorToColorValue(cssColor: string): ColorValue | null`

Parses CSS color values (hex, rgb(), named) to the internal `ColorValue` type.

```ts
/**
 * Parse a CSS color string to an OOXML ColorValue { rgb: 'RRGGBB' }.
 * Handles:
 *   - Hex: #000000, #000
 *   - rgb(): rgb(0, 0, 0)
 *   - Named: black, white, red, etc. (common subset)
 */
function parseCssColorToColorValue(cssColor: string): ColorValue | null {
  if (!cssColor || cssColor === 'transparent' || cssColor === 'inherit') return null;

  // Hex color
  const hexMatch = cssColor.match(/#([0-9a-fA-F]{6})/);
  if (hexMatch) {
    return { rgb: hexMatch[1].toUpperCase() };
  }

  // Short hex
  const shortHexMatch = cssColor.match(/#([0-9a-fA-F]{3})$/);
  if (shortHexMatch) {
    const r = shortHexMatch[1][0],
      g = shortHexMatch[1][1],
      b = shortHexMatch[1][2];
    return { rgb: (r + r + g + g + b + b).toUpperCase() };
  }

  // rgb(r, g, b)
  const rgbMatch = cssColor.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
  if (rgbMatch) {
    const hex = [rgbMatch[1], rgbMatch[2], rgbMatch[3]]
      .map((v) => parseInt(v).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
    return { rgb: hex };
  }

  return null;
}
```

#### `parseCssColorToHex(cssColor: string): string | undefined`

Simplified version that returns just the hex string (for `backgroundColor`).

```ts
/**
 * Parse CSS color to hex string (without '#' prefix) for backgroundColor attr.
 */
function parseCssColorToHex(cssColor: string): string | undefined {
  const colorValue = parseCssColorToColorValue(cssColor);
  return colorValue?.rgb;
}
```

#### `mapCssVerticalAlign(cssValue: string): string | undefined`

Maps CSS `vertical-align` to the editor's `verticalAlign` attribute values.

```ts
/**
 * Map CSS vertical-align to editor's verticalAlign attr.
 */
function mapCssVerticalAlign(cssValue: string): 'top' | 'center' | 'bottom' | undefined {
  if (!cssValue) return undefined;
  switch (cssValue.toLowerCase()) {
    case 'top':
      return 'top';
    case 'middle':
      return 'center';
    case 'bottom':
      return 'bottom';
    default:
      return undefined;
  }
}
```

#### `extractCellMarginsFromCSS(style: CSSStyleDeclaration)`

Extracts cell padding from CSS and converts to twips.

```ts
/**
 * Extract cell padding from inline CSS and convert to twips.
 * Google Docs uses: "padding:5pt 5pt 5pt 5pt"
 */
function extractCellMarginsFromCSS(style: CSSStyleDeclaration): TableCellAttrs['margins'] | null {
  const toTwips = (cssValue: string): number | undefined => {
    if (!cssValue || cssValue === '0px') return undefined;
    const num = parseFloat(cssValue);
    if (isNaN(num) || num === 0) return undefined;
    if (cssValue.endsWith('pt')) return Math.round(num * 20);
    if (cssValue.endsWith('px')) return Math.round(num * 15);
    // Computed styles are often in px
    return Math.round(num * 15);
  };

  const top = toTwips(style.paddingTop);
  const right = toTwips(style.paddingRight);
  const bottom = toTwips(style.paddingBottom);
  const left = toTwips(style.paddingLeft);

  if (top === undefined && right === undefined && bottom === undefined && left === undefined) {
    return null;
  }

  return { top, right, bottom, left };
}
```

### Import needed

Add to the top of `TableExtension.ts`:

```ts
import type { ColorValue, BorderSpec } from '../../../types/colors';
```

The `BorderSpec` type is already used in the file via `TableCellAttrs` which has `borders?: { top?: BorderSpec; ... }`. We just need to import it directly for the helper function's return type annotation.

---

## Interaction Between Changes

The three changes work together but are also independently valuable:

1. **PasteStyleInlinerExtension** removes the structural `<b>` before parseDOM runs -- this is the primary fix for the bold bug.

2. **BoldExtension** rejects `<b style="font-weight:normal">` -- this is a safety net. Even without (1), bold won't be falsely applied. This also fixes any future case where `<b>` tags with explicit normal weight appear from other sources.

3. **TableExtension** extracts borders from inline CSS -- this is independent of (1) and (2). It fixes table border loss regardless of the bold fix.

## Backward Compatibility

- **Internal copy/paste**: The editor's own copy/paste uses `data-*` attributes (`data-valign`, `data-bgcolor`, etc.) on table cells. The new CSS extraction is a fallback -- `data-*` values take precedence. No regression.

- **Word paste**: Microsoft Word puts HTML on the clipboard with `mso-*` CSS properties and sometimes `<b>` tags. The `<b>` won't have `docs-internal-guid` IDs, so the unwrap won't trigger. The BoldExtension `getAttrs` check only rejects `font-weight:normal/400`, which is a correct rejection regardless of source.

- **Plain HTML paste**: Standard HTML `<b>` tags don't have inline `font-weight:normal`, so they correctly trigger bold as before.
