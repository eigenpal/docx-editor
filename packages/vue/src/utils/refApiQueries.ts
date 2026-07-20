/**
 * Pure ref-API query helpers — read-only inspectors over the PM document
 * and the paginated layout. Used by DocxEditor's `defineExpose` ref API
 * (`findInDocument`, `getSelectionInfo`, `getPageContent`).
 *
 * Lifted to `@docx-editor.dev/core/prosemirror/queries` and shared
 * with the React adapter; re-exported here to keep existing import sites stable.
 */

export {
  findInDocument,
  getSelectionInfo,
  getPageContent,
} from '@docx-editor.dev/core/prosemirror/queries';
export type {
  FindInDocumentMatch,
  SelectionInfo,
  PageContent,
} from '@docx-editor.dev/core/prosemirror/queries';
