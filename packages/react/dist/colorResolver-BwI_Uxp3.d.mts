import { D as Document, d as DocumentBody, V as SectionProperties, A as AgentCommand, h as AgentContext, R as Range, W as SelectionContext, T as TextFormatting, ao as ColorValue, a3 as Theme, ap as ThemeColorSlot, al as ThemeColorScheme } from './agentApi-BVHzyk2l.mjs';
import { g as DocxInput } from './DocumentAgent-BqA9EJ3F.mjs';

/**
 * Main Parser Orchestrator - Unified parseDocx function
 *
 * Coordinates all sub-parsers to produce a complete Document model.
 * Handles loading order, dependency resolution, and font preloading.
 *
 * Parsing order:
 * 1. Unzip DOCX package
 * 2. Parse relationships
 * 3. Parse theme (needed for style color/font resolution)
 * 4. Parse styles (depends on theme)
 * 5. Parse numbering
 * 6. Parse document body (depends on styles, theme, numbering, rels)
 * 7. Parse headers/footers (depends on styles, theme, numbering, rels)
 * 8. Parse footnotes/endnotes (depends on styles, theme, numbering, rels)
 * 9. Extract and load fonts
 * 10. Build media file map
 * 11. Assemble final Document
 */

/**
 * Progress callback for tracking parsing stages
 */
type ProgressCallback = (stage: string, percent: number) => void;
/**
 * Parsing options
 */
interface ParseOptions {
    /** Progress callback for tracking parsing stages */
    onProgress?: ProgressCallback;
    /** Whether to preload fonts (default: true) */
    preloadFonts?: boolean;
    /** Whether to parse headers/footers (default: true) */
    parseHeadersFooters?: boolean;
    /** Whether to parse footnotes/endnotes (default: true) */
    parseNotes?: boolean;
    /** Whether to detect template variables (default: true) */
    detectVariables?: boolean;
}
/**
 * Parse a DOCX file into a complete Document model
 *
 * @param input - DOCX file as ArrayBuffer, Uint8Array, Blob, or File
 * @param options - Parsing options
 * @returns Promise resolving to Document
 * @throws Error if parsing fails
 */
declare function parseDocx(input: DocxInput, options?: ParseOptions): Promise<Document>;

/**
 * Document Serializer - Serialize complete document.xml
 *
 * Converts Document objects back to valid document.xml OOXML format.
 * Combines all content (paragraphs, tables) with section properties
 * and proper namespace declarations.
 *
 * OOXML Reference:
 * - Document root: w:document
 * - Document body: w:body
 * - Section properties: w:sectPr
 */

/**
 * Serialize section properties (w:sectPr)
 */
declare function serializeSectionProperties(props: SectionProperties | undefined): string;
/**
 * Serialize a DocumentBody to document.xml body content
 *
 * @param body - The document body to serialize
 * @returns XML string for the body element (without body tags)
 */
declare function serializeDocumentBody(body: DocumentBody): string;
/**
 * Serialize a complete Document to valid document.xml
 *
 * @param doc - The document to serialize
 * @returns Complete XML string for document.xml
 */
declare function serializeDocument(doc: Document): string;

/**
 * Template Processing Utility
 *
 * Uses docxtemplater to substitute template variables in DOCX documents:
 * - Processes {variable_name} patterns (docxtemplater default syntax)
 * - Preserves all formatting (fonts, styles, colors, tables)
 * - Error handling with useful messages
 */
/**
 * Options for template processing
 */
interface ProcessTemplateOptions {
    /** How to handle undefined variables */
    nullGetter?: 'keep' | 'empty' | 'error';
    /** Custom parser for variable names */
    parser?: (tag: string) => {
        get: (scope: Record<string, unknown>) => unknown;
    };
    /** Line breaks: keep raw \n or convert to w:br */
    linebreaks?: boolean;
    /** Delimiter settings */
    delimiters?: {
        start?: string;
        end?: string;
    };
}
/**
 * Result of template processing
 */
interface ProcessTemplateResult {
    /** The processed document buffer */
    buffer: ArrayBuffer;
    /** Variables that were found and replaced */
    replacedVariables: string[];
    /** Variables that were not replaced (no value provided) */
    unreplacedVariables: string[];
    /** Any warnings during processing */
    warnings: string[];
}
/**
 * Error details from template processing
 */
interface TemplateError {
    /** Error message */
    message: string;
    /** Variable name that caused the error (if applicable) */
    variable?: string;
    /** Error type */
    type: 'parse' | 'render' | 'undefined' | 'unknown';
    /** Original error */
    originalError?: Error;
}
/**
 * Process a DOCX template with variable substitution
 *
 * @param buffer - The DOCX file as ArrayBuffer
 * @param variables - Map of variable names to values
 * @param options - Processing options
 * @returns Processed DOCX as ArrayBuffer
 */
declare function processTemplate(buffer: ArrayBuffer, variables: Record<string, string>, options?: ProcessTemplateOptions): ArrayBuffer;
/**
 * Process template with detailed result
 *
 * @param buffer - The DOCX file as ArrayBuffer
 * @param variables - Map of variable names to values
 * @param options - Processing options
 * @returns Detailed processing result
 */
declare function processTemplateDetailed(buffer: ArrayBuffer, variables: Record<string, string>, options?: ProcessTemplateOptions): ProcessTemplateResult;
/**
 * Process template and return as Blob
 *
 * @param buffer - The DOCX file as ArrayBuffer
 * @param variables - Map of variable names to values
 * @param options - Processing options
 * @returns Processed DOCX as Blob
 */
declare function processTemplateAsBlob(buffer: ArrayBuffer, variables: Record<string, string>, options?: ProcessTemplateOptions): Blob;
/**
 * Get all template tags in a document without processing
 *
 * @param buffer - The DOCX file as ArrayBuffer
 * @returns List of tag names found
 */
declare function getTemplateTags(buffer: ArrayBuffer): string[];
/**
 * Validate that a document is a valid docxtemplater template
 *
 * @param buffer - The DOCX file as ArrayBuffer
 * @returns Validation result
 */
declare function validateTemplate(buffer: ArrayBuffer): {
    valid: boolean;
    errors: TemplateError[];
    tags: string[];
};
/**
 * Check if all required variables have values
 *
 * @param tags - List of template tags
 * @param variables - Provided variable values
 * @returns Missing variable names
 */
declare function getMissingVariables(tags: string[], variables: Record<string, string>): string[];
/**
 * Preview what the document will look like after processing
 * Returns the document text with variables replaced (for preview purposes)
 *
 * @param buffer - The DOCX file as ArrayBuffer
 * @param variables - Map of variable names to values
 * @returns Preview text
 */
declare function previewTemplate(buffer: ArrayBuffer, variables: Record<string, string>): string;
/**
 * Process template with conditional sections
 * Supports #if, #unless, #each loops
 *
 * @param buffer - The DOCX file as ArrayBuffer
 * @param data - Full data object (can include arrays, nested objects)
 * @param options - Processing options
 * @returns Processed DOCX as ArrayBuffer
 */
declare function processTemplateAdvanced(buffer: ArrayBuffer, data: Record<string, unknown>, options?: ProcessTemplateOptions): ArrayBuffer;
/**
 * Create a template processor with preset options
 */
declare function createTemplateProcessor(defaultOptions?: ProcessTemplateOptions): (buffer: ArrayBuffer, variables: Record<string, string>) => ArrayBuffer;

/**
 * Create Document Utility
 *
 * Provides functions to create new documents programmatically.
 */

/**
 * Options for creating an empty document
 */
interface CreateEmptyDocumentOptions {
    /** Page width in twips (default: 12240 = 8.5 inches) */
    pageWidth?: number;
    /** Page height in twips (default: 15840 = 11 inches) */
    pageHeight?: number;
    /** Page orientation (default: 'portrait') */
    orientation?: 'portrait' | 'landscape';
    /** Top margin in twips (default: 1440 = 1 inch) */
    marginTop?: number;
    /** Bottom margin in twips (default: 1440 = 1 inch) */
    marginBottom?: number;
    /** Left margin in twips (default: 1440 = 1 inch) */
    marginLeft?: number;
    /** Right margin in twips (default: 1440 = 1 inch) */
    marginRight?: number;
    /** Initial text content (default: empty string) */
    initialText?: string;
}
/**
 * Create an empty document with a single paragraph
 *
 * @param options - Optional configuration for the document
 * @returns A new empty Document object
 *
 * @example
 * ```ts
 * // Create a blank document
 * const doc = createEmptyDocument();
 *
 * // Create with custom margins
 * const doc = createEmptyDocument({
 *   marginTop: 720,  // 0.5 inch
 *   marginBottom: 720,
 * });
 *
 * // Create with initial text
 * const doc = createEmptyDocument({
 *   initialText: 'Hello, World!'
 * });
 * ```
 */
declare function createEmptyDocument(options?: CreateEmptyDocumentOptions): Document;
/**
 * Create a document with a single paragraph containing the given text
 *
 * @param text - The text content for the document
 * @param options - Optional configuration for the document
 * @returns A new Document object with the specified text
 */
declare function createDocumentWithText(text: string, options?: Omit<CreateEmptyDocumentOptions, 'initialText'>): Document;

/**
 * Command Executor
 *
 * Executes agent commands on a document immutably:
 * - Handles all command types from AgentCommand
 * - Preserves surrounding formatting
 * - Returns new document (immutable updates)
 */

/**
 * Execute an agent command on a document
 * Returns a new document with the command applied (immutable)
 *
 * Dispatch order:
 * 1. Try plugin handlers first (allows plugins to override built-in commands)
 * 2. Fall back to built-in handlers
 *
 * @param doc - The document to modify
 * @param command - The command to execute
 * @returns New document with command applied
 */
declare function executeCommand(doc: Document, command: AgentCommand): Document;
/**
 * Execute multiple commands in sequence
 *
 * @param doc - The document to modify
 * @param commands - Commands to execute in order
 * @returns New document with all commands applied
 */
declare function executeCommands(doc: Document, commands: AgentCommand[]): Document;

/**
 * Agent Context Builder
 *
 * Generates context objects for AI/LLM consumption from DOCX documents.
 * The context provides a structured summary of the document that can be
 * used by AI agents to understand the document structure and content.
 *
 * All outputs are JSON serializable for easy transmission to AI backends.
 */

/**
 * Options for building agent context
 */
interface AgentContextOptions {
    /** Maximum characters per paragraph in outline (default: 100) */
    outlineMaxChars?: number;
    /** Maximum paragraphs to include in outline (default: 50) */
    maxOutlineParagraphs?: number;
    /** Include table content in context (default: false) */
    includeTableContent?: boolean;
    /** Include detailed formatting info (default: false) */
    includeFormatting?: boolean;
}
/**
 * Options for building selection context
 */
interface SelectionContextOptions$1 {
    /** Characters of context before/after selection (default: 200) */
    contextChars?: number;
    /** Include suggested actions (default: true) */
    includeSuggestions?: boolean;
}
/**
 * Build agent context from a document
 *
 * @param doc - The parsed document
 * @param options - Context building options
 * @returns AgentContext object (JSON serializable)
 */
declare function getAgentContext(doc: Document, options?: AgentContextOptions): AgentContext;
/**
 * Build selection context for AI operations
 *
 * @param doc - The parsed document
 * @param range - The selected range
 * @param options - Selection context options
 * @returns SelectionContext object (JSON serializable)
 */
declare function buildSelectionContext$1(doc: Document, range: Range, options?: SelectionContextOptions$1): SelectionContext;
/**
 * Get a simple document summary for quick context
 *
 * @param doc - The parsed document
 * @returns Summary string
 */
declare function getDocumentSummary(doc: Document): string;

/**
 * Selection Context Builder
 *
 * Builds rich context objects from document selections for AI operations.
 * Includes selected text, formatting, surrounding context, and suggested actions.
 */

/**
 * Options for building selection context
 */
interface SelectionContextOptions {
    /** Characters of context before selection (default: 200) */
    contextCharsBefore?: number;
    /** Characters of context after selection (default: 200) */
    contextCharsAfter?: number;
    /** Include suggested actions (default: true) */
    includeSuggestions?: boolean;
    /** Include document summary (default: true) */
    includeDocumentSummary?: boolean;
    /** Maximum suggested actions (default: 8) */
    maxSuggestions?: number;
}
/**
 * Extended selection context with additional details
 */
interface ExtendedSelectionContext extends SelectionContext {
    /** Document summary for additional context */
    documentSummary?: string;
    /** Selection word count */
    wordCount?: number;
    /** Selection character count */
    characterCount?: number;
    /** Is selection multi-paragraph */
    isMultiParagraph?: boolean;
    /** Selected paragraph indices */
    paragraphIndices?: number[];
    /** Language detection hint */
    detectedLanguage?: string;
    /** Content type hints */
    contentType?: 'prose' | 'list' | 'heading' | 'table' | 'mixed';
}
/**
 * Selection formatting summary
 */
interface FormattingSummary {
    /** Predominant formatting */
    predominant: Partial<TextFormatting>;
    /** Is formatting consistent across selection */
    isConsistent: boolean;
    /** All formatting found */
    allFormatting: Partial<TextFormatting>[];
}
/**
 * Build selection context for AI operations
 *
 * @param doc - The parsed document
 * @param range - The selected range
 * @param options - Selection context options
 * @returns SelectionContext object
 */
declare function buildSelectionContext(doc: Document, range: Range, options?: SelectionContextOptions): SelectionContext;
/**
 * Build extended selection context with additional details
 *
 * @param doc - The parsed document
 * @param range - The selected range
 * @param options - Selection context options
 * @returns ExtendedSelectionContext object
 */
declare function buildExtendedSelectionContext(doc: Document, range: Range, options?: SelectionContextOptions): ExtendedSelectionContext;
/**
 * Get formatting summary for a selection
 *
 * @param doc - The parsed document
 * @param range - The selected range
 * @returns FormattingSummary object
 */
declare function getSelectionFormattingSummary(doc: Document, range: Range): FormattingSummary;

/**
 * Convert twips to pixels (at 96 DPI)
 *
 * 1 inch = 1440 twips = 96 pixels
 * → 1 twip = 96/1440 pixels = 1/15 pixels
 */
declare function twipsToPixels(twips: number): number;
/**
 * Convert pixels to twips
 */
declare function pixelsToTwips(px: number): number;
/**
 * Convert EMUs to pixels (at 96 DPI)
 *
 * 1 inch = 914400 EMUs = 96 pixels
 * Returns 0 for null/undefined/NaN inputs.
 */
declare function emuToPixels(emu: number | undefined | null): number;
/**
 * Convert pixels to EMUs
 */
declare function pixelsToEmu(px: number): number;
/**
 * Convert EMUs to twips
 */
declare function emuToTwips(emu: number): number;
/**
 * Convert twips to EMUs
 */
declare function twipsToEmu(twips: number): number;
/**
 * Convert points to pixels (at 96 DPI)
 *
 * 1 inch = 72 points = 96 pixels
 * → 1 point = 96/72 pixels = 4/3 pixels
 */
declare function pointsToPixels(points: number): number;
/**
 * Convert half-points to pixels (at 96 DPI)
 *
 * Half-points are commonly used for font sizes in OOXML (w:sz).
 */
declare function halfPointsToPixels(halfPoints: number): number;
/**
 * Format a pixel value as CSS string
 */
declare function formatPx(px: number): string;

/**
 * Color Resolver - Convert OOXML colors to CSS
 *
 * Handles:
 * - Theme color references (accent1, dk1, etc.)
 * - RGB hex values
 * - "auto" colors (context-dependent)
 * - Tint/shade modifications
 *
 * OOXML Color References:
 * - w:color/@w:val - RGB hex or "auto"
 * - w:color/@w:themeColor - Theme color slot
 * - w:color/@w:themeTint - Tint modifier (0-255, hex)
 * - w:color/@w:themeShade - Shade modifier (0-255, hex)
 *
 * Tint/Shade Calculations:
 * - Tint makes color lighter (blend with white)
 * - Shade makes color darker (blend with black)
 * - Value is in hex (00-FF), converted to 0-1 for calculation
 */

/**
 * Resolve a ColorValue to a CSS color string
 *
 * @param color - ColorValue object with rgb, themeColor, tint/shade, or auto
 * @param theme - Theme for resolving theme colors
 * @param defaultColor - Default color if auto or undefined (default: black)
 * @returns CSS color string (e.g., "#FF0000" or "inherit")
 */
declare function resolveColor(color: ColorValue | undefined | null, theme: Theme | null | undefined, defaultColor?: string): string;
/**
 * Resolve a highlight color name to CSS
 *
 * @param highlight - Highlight color name (e.g., "yellow", "cyan")
 * @returns CSS color string or empty string for "none"
 */
declare function resolveHighlightColor(highlight: string | undefined): string;
/**
 * Resolve a shading fill or pattern color to CSS
 *
 * @param color - ColorValue for fill
 * @param theme - Theme for resolving theme colors
 * @returns CSS color string
 */
declare function resolveShadingColor(color: ColorValue | undefined | null, theme: Theme | null | undefined): string;
/**
 * Check if a color is effectively black
 *
 * @param color - ColorValue object
 * @param theme - Theme for resolving theme colors
 * @returns True if color resolves to black or very dark
 */
declare function isBlack(color: ColorValue | undefined | null, theme: Theme | null | undefined): boolean;
/**
 * Check if a color is effectively white
 *
 * @param color - ColorValue object
 * @param theme - Theme for resolving theme colors
 * @returns True if color resolves to white or very light
 */
declare function isWhite(color: ColorValue | undefined | null, theme: Theme | null | undefined): boolean;
/**
 * Get contrasting text color for a background
 *
 * @param backgroundColor - Background ColorValue
 * @param theme - Theme for resolving theme colors
 * @returns Black or white hex color for best contrast
 */
declare function getContrastingColor(backgroundColor: ColorValue | undefined | null, theme: Theme | null | undefined): string;
/**
 * Parse a color string (various formats) to ColorValue
 *
 * @param colorString - Color string like "FF0000", "auto", or theme color name
 * @returns ColorValue object
 */
declare function parseColorString(colorString: string | undefined): ColorValue | undefined;
/**
 * Create a ColorValue from theme color reference
 *
 * @param themeColor - Theme color slot name
 * @param tint - Optional tint modifier
 * @param shade - Optional shade modifier
 * @returns ColorValue object
 */
declare function createThemeColor(themeColor: ThemeColorSlot, tint?: number, shade?: number): ColorValue;
/**
 * Create a ColorValue from RGB hex
 *
 * @param hex - 6-character hex color (no #)
 * @returns ColorValue object
 */
declare function createRgbColor(hex: string): ColorValue;
/**
 * Darken a color by a percentage
 *
 * @param color - ColorValue to darken
 * @param theme - Theme for resolving
 * @param percent - Percentage to darken (0-100)
 * @returns CSS color string
 */
declare function darkenColor(color: ColorValue | undefined | null, theme: Theme | null | undefined, percent: number): string;
/**
 * Lighten a color by a percentage
 *
 * @param color - ColorValue to lighten
 * @param theme - Theme for resolving
 * @param percent - Percentage to lighten (0-100)
 * @returns CSS color string
 */
declare function lightenColor(color: ColorValue | undefined | null, theme: Theme | null | undefined, percent: number): string;
/**
 * Blend two colors together
 *
 * @param color1 - First color
 * @param color2 - Second color
 * @param ratio - Blend ratio (0 = all color1, 1 = all color2)
 * @param theme - Theme for resolving
 * @returns CSS color string
 */
declare function blendColors(color1: ColorValue | undefined | null, color2: ColorValue | undefined | null, ratio: number, theme: Theme | null | undefined): string;
/**
 * Ensure a hex color string has a '#' prefix.
 */
declare function ensureHexPrefix(hex: string): string;
/**
 * Resolve a highlight color value to a CSS-ready string.
 * Tries OOXML named highlight first, then ensures hex prefix.
 */
declare function resolveHighlightToCss(value: string): string;
/**
 * Theme color matrix cell
 */
interface ThemeMatrixCell {
    /** Resolved hex color (6 chars, no #) */
    hex: string;
    /** Theme color slot */
    themeSlot: ThemeColorSlot;
    /** Tint hex modifier if applicable (e.g., "CC") */
    tint?: string;
    /** Shade hex modifier if applicable (e.g., "BF") */
    shade?: string;
    /** Human-readable label (e.g., "Accent 1, Lighter 60%") */
    label: string;
}
/**
 * Compute a single tinted or shaded hex color from a base color.
 *
 * @param baseHex - 6-character hex color (no #)
 * @param type - 'tint' to lighten, 'shade' to darken
 * @param fraction - Amount (0-1). For tint: 0=no change, 1=white. For shade: 0=black, 1=no change.
 * @returns 6-character hex color (no #)
 */
declare function getThemeTintShadeHex(baseHex: string, type: 'tint' | 'shade', fraction: number): string;
/**
 * Generate the 10×6 theme color matrix for an advanced color picker.
 *
 * Columns: lt1, dk1, lt2, dk2, accent1-6 (matches Word's order)
 * Rows: base, 80% tint, 60% tint, 40% tint, 25% shade, 50% shade
 *
 * @param colorScheme - Theme color scheme (falls back to Office 2016 defaults)
 * @returns 6 rows × 10 columns of ThemeMatrixCell
 */
declare function generateThemeTintShadeMatrix(colorScheme?: ThemeColorScheme | null): ThemeMatrixCell[][];
/**
 * Check if two colors are equal
 *
 * @param color1 - First color
 * @param color2 - Second color
 * @param theme - Theme for resolving
 * @returns True if colors resolve to the same value
 */
declare function colorsEqual(color1: ColorValue | undefined | null, color2: ColorValue | undefined | null, theme: Theme | null | undefined): boolean;

export { validateTemplate as $, type AgentContextOptions as A, isWhite as B, type CreateEmptyDocumentOptions as C, lightenColor as D, type ExtendedSelectionContext as E, type FormattingSummary as F, parseColorString as G, parseDocx as H, pixelsToEmu as I, pixelsToTwips as J, pointsToPixels as K, previewTemplate as L, processTemplate as M, processTemplateAdvanced as N, processTemplateAsBlob as O, type ProcessTemplateOptions as P, processTemplateDetailed as Q, resolveColor as R, type SelectionContextOptions$1 as S, type TemplateError as T, resolveHighlightColor as U, resolveShadingColor as V, serializeDocumentBody as W, serializeDocument as X, serializeSectionProperties as Y, twipsToEmu as Z, twipsToPixels as _, type ProcessTemplateResult as a, type ThemeMatrixCell as a0, ensureHexPrefix as a1, generateThemeTintShadeMatrix as a2, getThemeTintShadeHex as a3, resolveHighlightToCss as a4, type SelectionContextOptions as b, blendColors as c, buildExtendedSelectionContext as d, buildSelectionContext as e, buildSelectionContext$1 as f, colorsEqual as g, createDocumentWithText as h, createEmptyDocument as i, createRgbColor as j, createTemplateProcessor as k, createThemeColor as l, darkenColor as m, emuToPixels as n, emuToTwips as o, executeCommand as p, executeCommands as q, formatPx as r, getAgentContext as s, getContrastingColor as t, getDocumentSummary as u, getMissingVariables as v, getSelectionFormattingSummary as w, getTemplateTags as x, halfPointsToPixels as y, isBlack as z };
