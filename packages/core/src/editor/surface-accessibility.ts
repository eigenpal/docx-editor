import { en } from '@docx-editor.dev/i18n';
import type { PaginatedSurfaceOptions } from './paginated-surface-options.ts';

export function setSurfaceAccessibleLabel(
  pages: HTMLElement,
  translate: PaginatedSurfaceOptions['translate']
): void {
  pages.setAttribute(
    'aria-label',
    translate?.('editor.documentContent') ?? en.editor.documentContent
  );
}
