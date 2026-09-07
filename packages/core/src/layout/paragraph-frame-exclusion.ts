// Text frames share bounded scanline reflow with drawings and floating tables.
import type { OoxmlElement } from '@docx-editor.dev/core/store';
import type { ExclusionColumnLayout, ExclusionZone } from './drawing-exclusion.ts';
import type { PageRecord } from './semantic-records.ts';
import type { StyleCascadeTable } from './style-cascade.ts';

const styleFrames = new WeakMap<StyleCascadeTable, boolean>();

/** Cheap admission check; unsupported frames produce no zones during collection. */
export function hasParagraphFrames(
  blocks: readonly OoxmlElement[],
  styles: StyleCascadeTable | undefined
): boolean {
  if (styles) {
    let hasStyleFrame = styleFrames.get(styles);
    if (hasStyleFrame === undefined) {
      hasStyleFrame = styles.docDefaultsParagraph.some(
        (property) => property.localName === 'framePr'
      );
      for (const style of styles.styles.values()) {
        if (style.paragraphProperties.some((property) => property.localName === 'framePr')) {
          hasStyleFrame = true;
          break;
        }
      }
      styleFrames.set(styles, hasStyleFrame);
    }
    if (hasStyleFrame) return true;
  }
  return blocks.some(
    (block) =>
      block.kind === 'paragraph' &&
      block.children.some(
        (child) =>
          child.kind === 'paragraphProperties' &&
          child.children.some((property) => property.localName === 'framePr')
      )
  );
}

/** Each shared frame contributes one exclusion, regardless of its paragraph count. */
export function addParagraphFrameExclusions(
  pages: readonly PageRecord[],
  existing: ReadonlyMap<number, readonly ExclusionZone[]>,
  columns: ExclusionColumnLayout
): ReadonlyMap<number, readonly ExclusionZone[]> {
  let result: Map<number, readonly ExclusionZone[]> | undefined;
  for (const [pageIndex, page] of pages.entries()) {
    const groups = new Set<string>();
    let zones: ExclusionZone[] | undefined;
    for (const block of page.fragments) {
      if (block.kind !== 'paragraph') continue;
      const frame = block.positionedFrame;
      if (!frame || groups.has(frame.groupId)) continue;
      groups.add(frame.groupId);
      const box = frame.box;
      const column = frame.columnIndex;
      const left = columns.columnLefts?.[column] ?? 0;
      const width = columns.columnWidths?.[column] ?? columns.contentWidth;
      const distances = {
        left: frame.hSpace,
        right: frame.hSpace,
        top: frame.vSpace,
        bottom: frame.vSpace,
      };
      const fullWidth =
        box.x - frame.hSpace <= left && box.x + box.width + frame.hSpace >= left + width;
      const zone: ExclusionZone = {
        sourceKind: 'frame',
        sourceOrder: frame.sourceOrder,
        drawingNodeId: `frame:${frame.groupId}`,
        anchorParagraphId: frame.anchorId,
        anchorModelStart: 0,
        paintLayer: 'inFront',
        relativeHeight: 0,
        allowOverlap: true,
        columnIndex: column,
        y: box.y,
        verticalBand: {
          x: box.x - frame.hSpace,
          y: box.y - frame.vSpace,
          width: box.width + 2 * frame.hSpace,
          height: box.height + 2 * frame.vSpace,
        },
        input: {
          mode:
            frame.wrap === 'none' || frame.wrap === 'notBeside' || fullWidth
              ? 'topAndBottom'
              : 'square',
          contentBounds: box,
          polygon: null,
          clipPolygon: null,
          wrapDistances: distances,
          effectInsets: { left: 0, right: 0, top: 0, bottom: 0 },
          textSide: 'bothSides',
          contentLeft: left,
          contentRight: left + width,
        },
      };
      zones ??= [...(existing.get(pageIndex) ?? [])];
      zones.push(zone);
    }
    if (zones) {
      result ??= new Map(existing);
      result.set(pageIndex, zones);
    }
  }
  return result ?? existing;
}

/** A full-width exclusion must leave some vertical room for its anchor on a fresh page. */
export function unplaceableParagraphFrameIds(
  pages: readonly PageRecord[],
  allFrames = false
): ReadonlySet<string> {
  const refused = new Set<string>();
  for (const page of pages) {
    const groups = new Set<string>();
    for (const block of page.fragments) {
      if (block.kind !== 'paragraph' || !block.positionedFrame) continue;
      const frame = block.positionedFrame;
      const blocking =
        frame.wrap !== 'around' ||
        (frame.box.x - frame.hSpace <= 0 &&
          frame.box.x + frame.box.width + frame.hSpace >= page.contentBox.width);
      const top = frame.box.y - frame.vSpace;
      const bottom = frame.box.y + frame.box.height + frame.vSpace;
      if (
        allFrames ||
        (blocking &&
          bottom > 0 &&
          top < page.contentBox.height &&
          frame.box.height + 2 * frame.vSpace >= page.contentBox.height - 0.001)
      )
        groups.add(frame.groupId);
    }
    for (const block of page.fragments) {
      if (
        block.kind === 'paragraph' &&
        block.positionedFrame &&
        groups.has(block.positionedFrame.groupId)
      )
        refused.add(block.paragraphId);
    }
  }
  return refused;
}
