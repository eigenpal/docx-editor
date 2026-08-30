/**
 * `@docx-editor.dev/core/export` — DOM-free semantic export sessions and translators.
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
  type ExportSession,
  type OpenDocumentForExportOptions,
  type OpenDocumentForExportResult,
} from './export-session.ts';
export {
  exportMarkdown,
  exportMarkdownFrom,
  type MarkdownExportOptions,
  type MarkdownExportResult,
  type MarkdownImageResult,
  type MarkdownPage,
  type MarkdownTranslationOptions,
} from './markdown.ts';
export {
  createNodeImageDecodePort,
  type PreservedImageConverter,
} from './node-image-decode-port.ts';
export {
  MAX_SHARED_EXPORT_SHAPING_CONFIGURATIONS,
  acquireSharedExportShaping,
  type SharedExportShaping,
  type SharedExportShapingProvider,
} from './shared-export-shaping.ts';
