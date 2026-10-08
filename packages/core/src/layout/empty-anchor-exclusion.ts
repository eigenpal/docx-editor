import type { OoxmlElement } from '../store/package/ooxml-tree.ts';
import { paragraphOffsetIndex } from '../store/store/tree-op-segments.ts';
import type { bodyAnchorFrameBase } from './body-flow-helpers.ts';
import { hasCompatibilityRule } from './compatibility/compatibility-rules.ts';
import {
  anchoredDrawingAtomsInParagraph,
  drawingModelOffsetsInParagraph,
} from './drawing-atom-walk.ts';
import type { InlineDrawingLayoutContext } from './drawing-layout.ts';
import type { TextboxStoryLayouter } from './inline-textbox-flow.ts';
import { synthesizeParagraphWrapExclusionZones, type ExclusionZone } from './drawing-exclusion.ts';
import type { RevisionDisplayMode, RevisionAuthorFilter } from './revision-projection.ts';

/** Resolve an empty paragraph's own bands on the prospective sheet, including before a page move. */
export function withOwnAnchorOnlyZones(
  zones: readonly ExclusionZone[],
  paragraph: OoxmlElement,
  drawings: InlineDrawingLayoutContext | undefined,
  frameBase: () => ReturnType<typeof bodyAnchorFrameBase>,
  top: number,
  left: number,
  right: number,
  columnIndex: number,
  compatibilityMode: number | undefined,
  displayMode: RevisionDisplayMode,
  revisionAuthorFilter?: RevisionAuthorFilter,
  layoutTextboxStory?: TextboxStoryLayouter
): readonly ExclusionZone[] {
  if (
    !drawings ||
    paragraph.kind !== 'paragraph' ||
    !hasCompatibilityRule(compatibilityMode, 'anchorOnlyParagraphWrapExclusion')
  )
    return zones;
  const atoms = anchoredDrawingAtomsInParagraph(paragraph, drawings);
  if (!atoms.length || paragraphOffsetIndex(paragraph).length !== atoms.length) return zones;
  const own = synthesizeParagraphWrapExclusionZones({
    paragraph,
    paragraphId: paragraph.id,
    drawingLayout: drawings,
    frameBase: frameBase(),
    contentLeft: left,
    contentRight: right,
    paragraphStartY: top,
    anchorLineTopByModelStart: new Map(
      [...drawingModelOffsetsInParagraph(paragraph).values()].map((offset) => [offset, 0])
    ),
    displayMode,
    revisionAuthorFilter,
    ...(layoutTextboxStory ? { layoutTextboxStory } : {}),
  });
  return [
    ...zones.filter(
      (zone) => zone.anchorParagraphId !== paragraph.id || zone.input.mode === 'topAndBottom'
    ),
    ...own.map((zone) => ({ ...zone, columnIndex })),
  ];
}
