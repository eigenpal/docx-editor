import { getVisualScrollHeight } from '@docx-editor.dev/core/flow-model';

const PAGE_GAP_PX = 24;
const VIEWPORT_PADDING_PX = 48;

/** Zoomed scroll height for the Vue page stack wrapper (React `visualHeight` parity). */
export function computeVisualPagesHeight(
  pages: ReadonlyArray<{ size: { h: number } }> | null | undefined,
  zoom: number
): number {
  if (!pages || pages.length === 0) return 0;
  const pagesHeight = pages.reduce((sum, page) => sum + page.size.h, 0);
  const layoutHeight =
    pagesHeight + Math.max(0, pages.length - 1) * PAGE_GAP_PX + VIEWPORT_PADDING_PX;
  return getVisualScrollHeight(layoutHeight, zoom);
}
