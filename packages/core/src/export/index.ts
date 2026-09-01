/**
 * `@docx-editor.dev/core/export` — DOM-free semantic export sessions and shared resources.
 *
 * Exporters consume the same published `SemanticLayout` records as the browser painter.
 * They do not parse OOXML or independently derive document semantics.
 *
 * @packageDocumentation
 * @public
 */

export {
  ExportResourceError,
  openDocumentForExport,
  type ExportDocumentSource,
  type ExportSemanticLayout,
  type ExportSession,
  type OpenDocumentForExportOptions,
  type OpenDocumentForExportResult,
} from './export-session.ts';
export {
  createNodeImageDecodePort,
  type PreservedImageConverter,
} from './node-image-decode-port.ts';
export {
  MAX_SHARED_EXPORT_SHAPING_CONFIGURATIONS,
  acquireSharedExportShaping,
  type SharedExportShaping,
} from './shared-export-shaping.ts';
export {
  openFontBackedDocumentForExport,
  type ExportFontFaceResolution,
  type ExportFontFamilyResolution,
  type ExportFontResolutionReport,
  type FontBackedExportSession,
  type OpenFontBackedDocumentForExportOptions,
  type OpenFontBackedDocumentForExportResult,
} from './document-export-shaping.ts';
export type { FontOrigin, FontOriginFailure } from '../editor/font-resolver.ts';
