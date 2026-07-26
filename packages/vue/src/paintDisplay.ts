import { h, type VNode } from 'vue';
import type { DisplayItem, DisplayPage } from '@docx-editor.dev/core-contract/geometry';
import type { FrameOverlays, GlyphClickTarget, OverlayBox } from '@docx-editor.dev/engine-editor';
import {
  runStyle,
  colorToCss,
  borderSegLine,
  cssMatrix,
  ONE_SURFACE_CLICK_TARGET,
} from '@docx-editor.dev/engine-editor';

/**
 * Render a positioned `DisplayPage[]` to VNodes. The adapter paints items where
 * the engine placed them and computes no geometry of its own — styling decisions
 * come from the shared paint helpers so React and Vue paint identically.
 *
 * `overlays` are the engine's caret and selection rectangles, already converted
 * to page-local space by `overlaysForFrame`. They paint into a pointer-transparent
 * layer above the content so a click still reaches the page and resolves through
 * the engine hit test.
 */
export function paintDisplay(
  pages: readonly DisplayPage[],
  overlays?: FrameOverlays,
  clickTarget?: GlyphClickTarget | null
): VNode[] {
  return pages.map((page) =>
    h(
      'div',
      {
        key: page.index,
        'data-page-index': page.index,
        class: 'ep-one-surface__page',
        style: {
          position: 'relative',
          width: `${page.box.width}px`,
          height: `${page.box.height}px`,
        },
      },
      [
        h(
          'div',
          { class: 'ep-one-surface__content' },
          page.items.flatMap((item, i) =>
            paintItem(
              item,
              i,
              clickTarget?.pageIndex === page.index && clickTarget.itemIndex === i
                ? clickTarget
                : null
            )
          )
        ),
        ...(overlays ? [paintOverlayLayer(page.index, overlays)] : []),
      ]
    )
  );
}

function overlayStyle(box: OverlayBox): Record<string, string> {
  return {
    left: `${box.rect.x}px`,
    top: `${box.rect.y}px`,
    width: `${box.rect.width}px`,
    height: `${box.rect.height}px`,
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

function paintOverlayLayer(pageIndex: number, overlays: FrameOverlays): VNode {
  const caret = overlays.caret?.pageIndex === pageIndex ? overlays.caret : null;
  const rects = overlays.selection.filter((box) => box.pageIndex === pageIndex);
  return h('div', { class: 'ep-one-surface__overlay' }, [
    ...rects.map((box, i) =>
      h('div', {
        key: `sel.${i}`,
        class: 'ep-one-surface__selection-rect',
        style: overlayStyle(box),
      })
    ),
    ...(caret
      ? [
          h('div', {
            // Keyed on position so the vnode is replaced when the caret moves and the blink
            // restarts from its ON phase. See the React counterpart for why: a free-running
            // cycle that is invisible for half its period makes a click landing in the OFF
            // half look like a missing caret.
            key: `caret.${caret.pageIndex}.${caret.rect.x}.${caret.rect.y}`,
            'data-testid': 'one-surface-caret',
            class: `ep-one-surface__caret${caret.writingDirection === 'rtl' ? ' ep-one-surface__caret--rtl' : ''}`,
            style: overlayStyle(caret),
          }),
        ]
      : []),
  ]);
}

function paintItem(
  item: DisplayItem,
  key: number,
  clickTarget: GlyphClickTarget | null = null
): VNode[] {
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
            'data-testid': clickTarget?.runIndex === r ? ONE_SURFACE_CLICK_TARGET : undefined,
            style: {
              position: 'absolute',
              left: `${run.box.x}px`,
              top: `${run.box.y}px`,
              fontFamily: s.fontFamily,
              fontSize: `${s.fontSizePx}px`,
              fontWeight: s.fontWeight,
              fontStyle: s.fontStyle,
              color: s.color,
              textDecoration: s.textDecoration,
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
        const b = borderSegLine(seg);
        // A line: a zero-thickness div bordered on the running side, honoring the CSS border-style.
        const border = `${b.widthPx}px ${b.cssStyle} ${b.color ?? 'currentColor'}`;
        return h('div', {
          key: `${key}.${s}`,
          style: {
            position: 'absolute',
            left: `${b.x}px`,
            top: `${b.y}px`,
            width: `${b.horizontal ? b.length : 0}px`,
            height: `${b.horizontal ? 0 : b.length}px`,
            borderTop: b.horizontal ? border : undefined,
            borderLeft: b.horizontal ? undefined : border,
          },
        });
      });
    default:
      // decoration, custom, and any future kind: not painted by this renderer yet. The union is
      // intentionally non-exhaustive — unknown kinds are skipped, never crash.
      return [];
  }
}
