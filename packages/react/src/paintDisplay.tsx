import type { CSSProperties, ReactElement } from 'react';
import type { DisplayItem, DisplayPage } from '@docx-editor.dev/core-contract/geometry';
import type { FrameOverlays, OverlayBox } from '@docx-editor.dev/engine-editor';
import { runStyle, colorToCss, borderSegLine, cssMatrix } from '@docx-editor.dev/engine-editor';

/**
 * Render a positioned `DisplayPage[]` to DOM. The adapter paints items where the
 * engine placed them and computes no geometry of its own — styling decisions come
 * from the shared paint helpers so React and Vue paint identically.
 *
 * `overlays` are the engine's caret and selection rectangles, already converted
 * to page-local space by `overlaysForFrame`. They paint into a pointer-transparent
 * layer above the content so a click still reaches the page and resolves through
 * the engine hit test.
 */
export function paintDisplay(pages: readonly DisplayPage[], overlays?: FrameOverlays): ReactElement {
  return (
    <>
      {pages.map((page) => (
        <div
          key={page.index}
          data-page-index={page.index}
          className="ep-one-surface__page"
          style={{ position: 'relative', width: page.box.width, height: page.box.height }}
        >
          <div className="ep-one-surface__content">{page.items.flatMap((item, i) => paintItem(item, i))}</div>
          {overlays ? paintOverlayLayer(page.index, overlays) : null}
        </div>
      ))}
    </>
  );
}

function overlayStyle(box: OverlayBox): CSSProperties {
  return {
    left: box.rect.x,
    top: box.rect.y,
    width: box.rect.width,
    height: box.rect.height,
    ...(box.transform ? { transform: cssMatrix(box.transform), transformOrigin: '0 0' } : {}),
    ...(box.clip
      ? {
          clipPath: `inset(${box.clip.y - box.rect.y}px ${
            box.rect.x + box.rect.width - (box.clip.x + box.clip.width)
          }px ${box.rect.y + box.rect.height - (box.clip.y + box.clip.height)}px ${box.clip.x - box.rect.x}px)`,
        }
      : {}),
  };
}

function paintOverlayLayer(pageIndex: number, overlays: FrameOverlays): ReactElement {
  const caret = overlays.caret?.pageIndex === pageIndex ? overlays.caret : null;
  const rects = overlays.selection.filter((box) => box.pageIndex === pageIndex);
  return (
    <div className="ep-one-surface__overlay">
      {rects.map((box, i) => (
        <div key={`sel.${i}`} className="ep-one-surface__selection-rect" style={overlayStyle(box)} />
      ))}
      {caret ? (
        <div
          data-testid="one-surface-caret"
          className={`ep-one-surface__caret${caret.writingDirection === 'rtl' ? ' ep-one-surface__caret--rtl' : ''}`}
          style={overlayStyle(caret)}
        />
      ) : null}
    </div>
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
              textDecoration: s.textDecoration,
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
        const b = borderSegLine(seg);
        // A line: a zero-thickness div bordered on the running side, so the CSS border-style
        // (double/dotted/dashed) is honored rather than degraded to a solid fill.
        const border = `${b.widthPx}px ${b.cssStyle} ${b.color ?? 'currentColor'}`;
        return (
          <div
            key={`${key}.${s}`}
            style={{
              position: 'absolute',
              left: b.x,
              top: b.y,
              width: b.horizontal ? b.length : 0,
              height: b.horizontal ? 0 : b.length,
              borderTop: b.horizontal ? border : undefined,
              borderLeft: b.horizontal ? undefined : border,
            }}
          />
        );
      });
    default:
      // decoration, custom, and any future kind: not painted by this renderer yet. The union is
      // intentionally non-exhaustive — unknown kinds are skipped, never crash.
      return [];
  }
}
