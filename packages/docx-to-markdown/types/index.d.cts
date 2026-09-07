// CommonJS uses the same contracts as ESM. Explicit type-only import resolution
// supports TypeScript's Node16 module mode with Core's shared ESM declarations.
import type * as API from '../dist/index.js' with { 'resolution-mode': 'import' };
export type * from '../dist/index.js' with { 'resolution-mode': 'import' };

export declare const exportMarkdown: typeof API.exportMarkdown;
export declare const exportMarkdownFrom: typeof API.exportMarkdownFrom;
export declare const exportMarkdownLayout: typeof API.exportMarkdownLayout;
export declare const openDocumentForExport: typeof API.openDocumentForExport;
export declare const createFontSource: typeof API.createFontSource;
export declare const defineFontResolver: typeof API.defineFontResolver;
export declare const forEachSemanticDrawing: typeof API.forEachSemanticDrawing;
export declare const HARD_MAX_AGGREGATE_FONT_BYTES: typeof API.HARD_MAX_AGGREGATE_FONT_BYTES;
export declare const HARD_MAX_FONT_BYTES: typeof API.HARD_MAX_FONT_BYTES;
export declare const HARD_MAX_FONT_SOURCES: typeof API.HARD_MAX_FONT_SOURCES;
export declare const DocumentOpenError: typeof API.DocumentOpenError;
export type DocumentOpenError = API.DocumentOpenError;
export declare const ExportResourceError: typeof API.ExportResourceError;
export type ExportResourceError = API.ExportResourceError;
