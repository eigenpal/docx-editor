import type { ExportStatus } from './export-state';

export type PreviewMode = 'rendered' | 'source' | 'developer';

export function markdownPageToReveal(
  mode: PreviewMode,
  status: ExportStatus,
  hasResult: boolean,
  latestEditorPage: number
): number | null {
  return mode !== 'developer' && status === 'ready' && hasResult ? latestEditorPage : null;
}

export interface PreviewPosition {
  readonly pageId: string;
  readonly fraction: number;
  readonly gap: number;
}

/** Keep the visible page and approximate reading position when its rendered height changes. */
export function capturePreviewPosition(scroller: HTMLElement | null): PreviewPosition | null {
  if (!scroller) return null;
  const top = scroller.getBoundingClientRect().top;
  for (const page of scroller.querySelectorAll<HTMLElement>('.md-page-wrap')) {
    const bounds = page.getBoundingClientRect();
    if (bounds.height <= 0 || bounds.bottom <= top) continue;
    return {
      pageId: page.id,
      fraction: Math.max(0, (top - bounds.top) / bounds.height),
      gap: Math.max(0, bounds.top - top),
    };
  }
  return null;
}

export function restorePreviewPosition(
  scroller: HTMLElement | null,
  position: PreviewPosition
): void {
  if (!scroller) return;
  const page = Array.from(scroller.querySelectorAll<HTMLElement>('.md-page-wrap')).find(
    (candidate) => candidate.id === position.pageId
  );
  if (!page) return;
  const bounds = page.getBoundingClientRect();
  scroller.scrollTo({
    top:
      scroller.scrollTop +
      bounds.top -
      scroller.getBoundingClientRect().top +
      bounds.height * position.fraction -
      position.gap,
    behavior: 'instant',
  });
}
