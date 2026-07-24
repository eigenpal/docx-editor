import type { ReactElement } from 'react';
import type { DisplayItem, DisplayPage } from '@docx-editor.dev/core-contract/geometry';
import { runStyle, colorToCss, borderSegBox } from '@docx-editor.dev/engine-editor';

/**
 * Render a positioned `DisplayPage[]` to DOM. The adapter paints items where the
 * engine placed them and computes no geometry of its own — styling decisions come
 * from the shared paint helpers so React and Vue paint identically.
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
          {page.items.flatMap((item, i) => paintItem(item, i))}
        </div>
      ))}
    </>
  );
}

function paintItem(item: DisplayItem, key: number): ReactElement[] {
  switch (item.kind) {
    case 'text':
      // A text item may carry several runs (different styles); paint each at its own box.
      return item.runs.map((run, r) => {
        const s = runStyle(run);
        return (
          <div
            key={`${key}.${r}`}
            data-doc-from={item.docFrom}
            data-doc-to={item.docTo}
            style={{
              position: 'absolute',
              left: run.box.x,
              top: run.box.y,
              fontFamily: s.fontFamily,
              fontSize: s.fontSizePx,
              fontWeight: s.fontWeight,
              fontStyle: s.fontStyle,
              color: s.color,
              whiteSpace: 'pre',
            }}
          >
            {run.text}
          </div>
        );
      });
    case 'image':
      return [
        <img
          key={key}
          src={item.src.url}
          alt={item.src.altText ?? ''}
          style={{ position: 'absolute', left: item.box.x, top: item.box.y, width: item.box.width, height: item.box.height }}
        />,
      ];
    case 'fill':
      return [
        <div
          key={key}
          style={{
            position: 'absolute',
            left: item.box.x,
            top: item.box.y,
            width: item.box.width,
            height: item.box.height,
            backgroundColor: colorToCss(item.color),
          }}
        />,
      ];
    case 'tableBorder':
      return item.segments.map((seg, s) => {
        const b = borderSegBox(seg);
        return (
          <div
            key={`${key}.${s}`}
            style={{ position: 'absolute', left: b.x, top: b.y, width: b.width, height: b.height, backgroundColor: b.color }}
          />
        );
      });
    default:
      // decoration, custom, and any future kind: not painted by this renderer yet. The union is
      // intentionally non-exhaustive — unknown kinds are skipped, never crash.
      return [];
  }
}
