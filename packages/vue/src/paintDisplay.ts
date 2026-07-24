import { h, type VNode } from 'vue';
import type { DisplayItem, DisplayPage } from '@docx-editor.dev/core-contract/geometry';
import { runStyle, colorToCss, borderSegBox } from '@docx-editor.dev/engine-editor';

/**
 * Render a positioned `DisplayPage[]` to VNodes. The adapter paints items where
 * the engine placed them and computes no geometry of its own — styling decisions
 * come from the shared paint helpers so React and Vue paint identically.
 */
export function paintDisplay(pages: readonly DisplayPage[]): VNode[] {
  return pages.map((page) =>
    h(
      'div',
      {
        key: page.index,
        'data-page-index': page.index,
        style: { position: 'relative', width: `${page.box.width}px`, height: `${page.box.height}px` },
      },
      page.items.flatMap((item, i) => paintItem(item, i))
    )
  );
}

function paintItem(item: DisplayItem, key: number): VNode[] {
  switch (item.kind) {
    case 'text':
      return item.runs.map((run, r) => {
        const s = runStyle(run);
        return h(
          'div',
          {
            key: `${key}.${r}`,
            'data-doc-from': item.docFrom,
            'data-doc-to': item.docTo,
            style: {
              position: 'absolute',
              left: `${run.box.x}px`,
              top: `${run.box.y}px`,
              fontFamily: s.fontFamily,
              fontSize: `${s.fontSizePx}px`,
              fontWeight: s.fontWeight,
              fontStyle: s.fontStyle,
              color: s.color,
              whiteSpace: 'pre',
            },
          },
          run.text
        );
      });
    case 'image':
      return [
        h('img', {
          key,
          src: item.src.url,
          alt: item.src.altText ?? '',
          style: {
            position: 'absolute',
            left: `${item.box.x}px`,
            top: `${item.box.y}px`,
            width: `${item.box.width}px`,
            height: `${item.box.height}px`,
          },
        }),
      ];
    case 'fill':
      return [
        h('div', {
          key,
          style: {
            position: 'absolute',
            left: `${item.box.x}px`,
            top: `${item.box.y}px`,
            width: `${item.box.width}px`,
            height: `${item.box.height}px`,
            backgroundColor: colorToCss(item.color),
          },
        }),
      ];
    case 'tableBorder':
      return item.segments.map((seg, s) => {
        const b = borderSegBox(seg);
        return h('div', {
          key: `${key}.${s}`,
          style: {
            position: 'absolute',
            left: `${b.x}px`,
            top: `${b.y}px`,
            width: `${b.width}px`,
            height: `${b.height}px`,
            backgroundColor: b.color,
          },
        });
      });
    default:
      // decoration, custom, and any future kind: not painted by this renderer yet. The union is
      // intentionally non-exhaustive — unknown kinds are skipped, never crash.
      return [];
  }
}
