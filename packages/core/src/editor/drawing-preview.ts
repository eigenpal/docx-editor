import type { UnsupportedElement } from '../layout/unsupported-content-types.ts';
import {
  createDrawingPreviewPackage,
  type DrawingPreviewPackageResult,
} from '../store/package/drawing-preview-package.ts';
import type { DocxEditorInstance } from './docx-editor-types.ts';

/**
 * A small DOCX that holds one drawing from the editor's current document, including unsaved
 * edits, and the parts it needs, for an external renderer. Pass an occurrence that an
 * `UnsupportedElement` component receives. The result equals `createDrawingPreviewPackage`
 * on the document as a save would write it now. The call is synchronous, so make it in an
 * effect keyed on `element.source`, not during render. Before the editor is attached, the
 * result is `drawing-not-found`.
 *
 * @public
 */
export function drawingPreviewDocx(
  editor: DocxEditorInstance,
  element: Pick<UnsupportedElement, 'ownerPartName' | 'nodeId'>
): DrawingPreviewPackageResult {
  const session = editor.surface?.session;
  if (!session) return { ok: false, reason: 'drawing-not-found' };
  return createDrawingPreviewPackage(session.currentPackage(), element);
}
