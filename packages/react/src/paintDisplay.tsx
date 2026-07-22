import type { ReactElement } from 'react';
import type { DisplayItem, DisplayPage } from '@docx-editor.dev/core-contract/geometry';

/**
 * Render a positioned `DisplayPage[]` to DOM. The adapter paints items where
 * the engine placed them and computes no geometry of its own.
 */
export function paintDisplay(pages: readonly DisplayPage[]): ReactElement {
  return (
    <>
      {pages.map((page) => (
        <div
          key={page.index}
          data-page-index={page.index}
          style={{ position: 'relative', width: page.box.width, height: page.box.height }}
        >
          {page.items.map((item, i) => paintItem(item, i))}
        </div>
      ))}
    </>
  );
}

function paintItem(item: DisplayItem, key: number): ReactElement | null {
  switch (item.kind) {
    case 'text':
      return (
        <div
          key={key}
          data-doc-from={item.docFrom}
          data-doc-to={item.docTo}
          style={{ position: 'absolute', left: item.box.x, top: item.box.y }}
        >
          {item.runs.map((run) => run.text).join('')}
        </div>
      );
    case 'image':
      return (
        <img
          key={key}
          src={item.src.url}
          alt={item.src.altText ?? ''}
          style={{
            position: 'absolute',
            left: item.box.x,
            top: item.box.y,
            width: item.box.width,
            height: item.box.height,
          }}
        />
      );
    case 'fill':
      return (
        <div
          key={key}
          style={{
            position: 'absolute',
            left: item.box.x,
            top: item.box.y,
            width: item.box.width,
            height: item.box.height,
            backgroundColor: item.color.kind === 'hex' ? item.color.value : undefined,
          }}
        />
      );
    default:
      // tableBorder, decoration, custom, and any future kind: not painted by
      // this minimal renderer. The union is intentionally non-exhaustive.
      return null;
  }
}
