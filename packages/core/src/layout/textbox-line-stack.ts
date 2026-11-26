// Vertical shape text whose lines stack from left to right.
//
// `wps:bodyPr/@vert` (ST_TextVerticalType, ECMA-376 Part 1, 20.1.10.83) values `wordArtVert`,
// `wordArtVertRtl` and `mongolianVert` lay out as text turned a quarter clockwise, like
// `vert`, with the first line at the left of the text area instead of the right. A story turned
// a quarter clockwise puts its top at the right, so the lines stack from the bottom of the
// unturned story: each line keeps its own geometry and takes the mirrored place in the flow.
// `mongolianVert` lines flow top down, then left to right, as the standard defines. The
// standard describes `wordArtVert` as letters stacked one on top of another; this layout does
// not stack letters.

import { shiftInlineDrawingRecord } from './drawing-layout.ts';
import type { BlockFragmentRecord, LayoutBox } from './semantic-records.ts';

/**
 * `fragments` with their lines stacked from the bottom of a flow `flowHeight` tall. A story
 * that holds a table keeps its order: a table has no line stack to mirror.
 */
export function stackLinesFromBottom(
  fragments: readonly BlockFragmentRecord[],
  flowHeight: number
): readonly BlockFragmentRecord[] {
  if (fragments.some((fragment) => fragment.kind !== 'paragraph')) return fragments;
  const mirror = (box: LayoutBox): LayoutBox => ({
    ...box,
    y: flowHeight - box.y - box.height,
  });
  return fragments.map((fragment) => {
    if (fragment.kind !== 'paragraph') return fragment;
    const shift = (box: LayoutBox): number => flowHeight - 2 * box.y - box.height;
    // The marker stays beside the paragraph's first line.
    const first = fragment.lines[0];
    const markerShift = first ? shift(first.box) : 0;
    const move = (box: LayoutBox, dy: number): LayoutBox => ({ ...box, y: box.y + dy });
    return {
      ...fragment,
      box: mirror(fragment.box),
      ...(fragment.shadingBox ? { shadingBox: mirror(fragment.shadingBox) } : {}),
      ...(fragment.bottomBorder
        ? { bottomBorder: { ...fragment.bottomBorder, box: mirror(fragment.bottomBorder.box) } }
        : {}),
      ...(fragment.borders
        ? { borders: fragment.borders.map((border) => ({ ...border, box: mirror(border.box) })) }
        : {}),
      ...(fragment.marker
        ? {
            marker: {
              ...fragment.marker,
              box: move(fragment.marker.box, markerShift),
              ...(fragment.marker.picture
                ? {
                    picture: {
                      ...fragment.marker.picture,
                      box: move(fragment.marker.picture.box, markerShift),
                    },
                  }
                : {}),
            },
          }
        : {}),
      lines: fragment.lines.map((line) => {
        const dy = shift(line.box);
        return {
          ...line,
          box: move(line.box, dy),
          spans: line.spans.map((span) => ({ ...span, box: move(span.box, dy) })),
          ...(line.drawings
            ? {
                drawings: line.drawings.map((drawing) => shiftInlineDrawingRecord(drawing, 0, dy)),
              }
            : {}),
        };
      }),
    };
  });
}
