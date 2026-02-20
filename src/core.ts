/**
 * @eigenpal/docx-js-editor/core
 *
 * Core entry point — types, parser, serializer, and utilities.
 * No React or ProseMirror dependencies.
 *
 * @example
 * ```ts
 * import { parseDocx, serializeDocx, resolveColor } from '@eigenpal/docx-js-editor/core';
 * ```
 */

// ============================================================================
// VERSION
// ============================================================================

export const VERSION = '0.0.2';

// ============================================================================
// PARSER / SERIALIZER
// ============================================================================

export { parseDocx } from './docx/parser';
export {
  serializeDocument as serializeDocx,
  serializeDocumentBody,
  serializeSectionProperties,
} from './docx/serializer/documentSerializer';
export { repackDocx, createDocx } from './docx/rezip';

// ============================================================================
// TEMPLATE PROCESSING
// ============================================================================

export {
  processTemplate,
  processTemplateDetailed,
  processTemplateAsBlob,
  getTemplateTags,
  validateTemplate,
  type ProcessTemplateOptions,
  type ProcessTemplateResult,
} from './utils/processTemplate';

// ============================================================================
// DOCUMENT CREATION
// ============================================================================

export {
  createEmptyDocument,
  createDocumentWithText,
  type CreateEmptyDocumentOptions,
} from './utils/createDocument';

// ============================================================================
// AGENT API
// ============================================================================

export { DocumentAgent } from './agent/DocumentAgent';
export { executeCommand, executeCommands } from './agent/executor';
export { getAgentContext, getDocumentSummary, type AgentContextOptions } from './agent/context';
export {
  buildSelectionContext,
  buildExtendedSelectionContext,
  type SelectionContextOptions,
  type ExtendedSelectionContext,
} from './agent/selectionContext';

// ============================================================================
// UTILITIES
// ============================================================================

export {
  twipsToPixels,
  pixelsToTwips,
  formatPx,
  emuToPixels,
  pointsToPixels,
  halfPointsToPixels,
  pixelsToEmu,
  emuToTwips,
  twipsToEmu,
} from './utils/units';

export {
  resolveColor,
  resolveHighlightColor,
  resolveShadingColor,
  parseColorString,
  createThemeColor,
  createRgbColor,
  darkenColor,
  lightenColor,
  blendColors,
  getContrastingColor,
  isBlack,
  isWhite,
  colorsEqual,
} from './utils/colorResolver';

export {
  createPageBreak,
  createColumnBreak,
  createLineBreak,
  createPageBreakRun,
  createPageBreakParagraph,
  insertPageBreak,
  createHorizontalRule,
  insertHorizontalRule,
  isPageBreak,
  isColumnBreak,
  isLineBreak,
  isBreakContent,
  hasPageBreakBefore,
  countPageBreaks,
  findPageBreaks,
  removePageBreak,
  type InsertPosition,
} from './utils/insertOperations';

export { type DocxInput, toArrayBuffer } from './utils/docxInput';

// ============================================================================
// FONT LOADER
// ============================================================================

export {
  loadFont,
  loadFonts,
  loadFontFromBuffer,
  isFontLoaded,
  isLoading as isFontsLoading,
  getLoadedFonts,
  onFontsLoaded,
  canRenderFont,
  preloadCommonFonts,
} from './utils/fontLoader';

// ============================================================================
// VARIABLE DETECTION
// ============================================================================

export {
  detectVariables,
  detectVariablesDetailed,
  detectVariablesInBody,
  detectVariablesInParagraph,
  extractVariablesFromText,
  hasTemplateVariables,
  isValidVariableName,
  sanitizeVariableName,
  formatVariable,
  parseVariable,
  replaceVariables,
  removeVariables,
  documentHasVariables,
  type VariableDetectionResult,
  type VariableOccurrence,
} from './utils/variableDetector';

// ============================================================================
// TYPES
// ============================================================================

export type {
  Document,
  DocxPackage,
  DocumentBody,
  BlockContent,
  Paragraph,
  Run,
  RunContent,
  TextContent,
  Table,
  TableRow,
  TableCell,
  Image,
  Shape,
  TextBox,
  Hyperlink,
  BookmarkStart,
  BookmarkEnd,
  Field,
  Theme,
  ThemeColorScheme,
  ThemeFont,
  ThemeFontScheme,
  Style,
  StyleDefinitions,
  TextFormatting,
  ParagraphFormatting,
  SectionProperties,
  HeaderFooter,
  HeaderReference,
  FooterReference,
  Footnote,
  Endnote,
  ListLevel,
  NumberingDefinitions,
  Relationship,
} from './types/document';

export type {
  AIAction,
  AIActionRequest,
  AgentResponse,
  AgentContext,
  SelectionContext,
  Range,
  Position,
  ParagraphContext,
  SuggestedAction,
  AgentCommand,
  InsertTextCommand,
  ReplaceTextCommand,
  DeleteTextCommand,
  FormatTextCommand,
  InsertTableCommand,
  InsertImageCommand,
  InsertHyperlinkCommand,
  SetVariableCommand,
  ApplyStyleCommand,
} from './types/agentApi';

// ============================================================================
// CORE PLUGIN SYSTEM
// ============================================================================

export {
  pluginRegistry,
  PluginRegistry,
  registerPlugins,
  docxtemplaterPlugin,
  type CorePlugin,
  type McpToolDefinition,
  type McpToolHandler,
  type McpToolResult,
  type McpSession,
} from './core-plugins';
