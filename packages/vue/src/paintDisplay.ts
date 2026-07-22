import { h, type VNode } from 'vue';
import type { DisplayItem, DisplayPage } from '@docx-editor.dev/core-contract/geometry';

/**
 * Render a positioned `DisplayPage[]` to VNodes. The adapter paints items
 * where the engine placed them and computes no geometry of its own.
 */
export function paintDisplay(pages: readonly DisplayPage[]): VNode[] {
  return pages.map((page) =>
    h(
      'div',
      {
        key: page.index,
        'data-page-index': page.index,
        style: {
          position: 'relative',
          width: `${page.box.width}px`,
          height: `${page.box.height}px`,
        },
      },
      page.items.map((item, i) => paintItem(item, i))
    )
  );
}

function paintItem(item: DisplayItem, key: number): VNode | null {
  switch (item.kind) {
    case 'text':
      return h(
        'div',
        {
          key,
          'data-doc-from': item.docFrom,
          'data-doc-to': item.docTo,
          style: { position: 'absolute', left: `${item.box.x}px`, top: `${item.box.y}px` },
        },
        item.runs.map((run) => run.text).join('')
      );
    case 'image':
      return h('img', {
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
      });
    case 'fill':
      return h('div', {
        key,
        style: {
          position: 'absolute',
          left: `${item.box.x}px`,
          top: `${item.box.y}px`,
          width: `${item.box.width}px`,
          height: `${item.box.height}px`,
          backgroundColor: item.color.kind === 'hex' ? item.color.value : undefined,
        },
      });
    default:
      // tableBorder, decoration, custom, and any future kind: not painted by
      // this minimal renderer. The union is intentionally non-exhaustive.
      return null;
  }
}
