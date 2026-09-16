// TOC hover geometry for both authored content controls and plain complex fields.
import { contentControlsInLayout } from '../layout/semantic-interaction.ts';
import type { DetectedToc } from '../store/package/toc-detect.ts';
import { paragraphFragmentsOf } from '../layout/semantic-record-queries.ts';
import type { ContentControlBoundaryRecord, SemanticLayout } from '../layout/semantic-records.ts';
import { paragraphContentBounds } from '../layout/paragraph-content-bounds.ts';

export function tocBoundaryForLayout(
  toc: DetectedToc,
  currentLayout: SemanticLayout
): {
  readonly tocId: string;
  readonly boundary: ContentControlBoundaryRecord;
  readonly additional: boolean;
} | null {
  const existing = toc.contentControlId
    ? contentControlsInLayout(currentLayout).find((control) => control.id === toc.contentControlId)
    : undefined;
  if (existing) return { tocId: toc.id, boundary: existing, additional: false };

  const paragraphIds = new Set([
    toc.beginParagraphId,
    ...toc.resultParagraphIds,
    toc.endParagraphId,
  ]);
  const fragments = currentLayout.pages.flatMap((page) => {
    const boxes = paragraphFragmentsOf(page)
      .filter((fragment) => paragraphIds.has(fragment.paragraphId))
      .map(paragraphContentBounds);
    if (boxes.length === 0) return [];
    const left = Math.min(...boxes.map((box) => box.x));
    const top = Math.min(...boxes.map((box) => box.y));
    const right = Math.max(...boxes.map((box) => box.x + box.width));
    const bottom = Math.max(...boxes.map((box) => box.y + box.height));
    return [
      {
        pageIndex: page.index,
        box: { x: left, y: top, width: right - left, height: bottom - top },
      },
    ];
  });
  if (fragments.length === 0) return null;
  return {
    tocId: toc.id,
    additional: true,
    boundary: {
      id: `toc:${toc.id}`,
      controlType: 'richText',
      lock: 'unlocked',
      effectiveLock: 'unlocked',
      placeholder: false,
      bound: false,
      nestingDepth: 0,
      level: 'block',
      fragments,
    },
  };
}
