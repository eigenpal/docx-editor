import type { UnsupportedElement } from '../layout/unsupported-content-types.ts';
import {
  createDrawingPreviewPackage,
  type DrawingPreviewPackageLimits,
  type DrawingPreviewPackageResult,
} from '../store/package/drawing-preview-package.ts';
import type { DocxEditorInstance } from './docx-editor-types.ts';

/**
 * A small DOCX that holds one drawing from the editor's current document, including unsaved
 * edits, and the parts it needs, for an external renderer. Pass an occurrence that an
 * `UnsupportedElement` component receives. The result equals `createDrawingPreviewPackage`
 * on the document as a save would write it now. The call is synchronous, so make it in an
 * effect keyed on `element.source`, not during render. Get the editor with `useDocxEditor()`
 * and return early on `null`; inside a component that receives an occurrence, it is set. Each call serializes
 * the drawing's parts, so with many drawings, spread the calls out or queue them. By default
 * a package copies at most 64 parts and 64 MiB; pass `limits` to change that.
 *
 * @public
 */
export function drawingPreviewDocx(
  editor: DocxEditorInstance,
  element: Pick<UnsupportedElement, 'ownerPartName' | 'nodeId'>,
  limits?: DrawingPreviewPackageLimits
): DrawingPreviewPackageResult {
  const session = editor.surface?.session;
  if (!session) return { ok: false, reason: 'drawing-not-found' };
  return createDrawingPreviewPackage(session.currentPackage(), element, limits);
}
