import { t as Document, D as DocumentBody, a9 as SectionProperties, T as TextFormatting, ae as StyleInfo, i as AgentContext, f as Position, a4 as Range, a0 as ParagraphFormatting, h as AgentCommand, aa as SelectionContext, aH as ThemeColorSlot, aI as ColorValue, aj as Theme, aE as ThemeColorScheme, d as Paragraph } from './types-BhDofcWh.mjs';

/**
 * Flexible input types for DOCX documents.
 *
 * Accepts any common binary format so consumers don't need to manually
 * convert before passing data to the editor or parser.
 */
/**
 * Any binary representation of a DOCX file that the editor can consume.
 *
 * - `ArrayBuffer` — from `FileReader.readAsArrayBuffer()` or `fetch().arrayBuffer()`
 * - `Uint8Array` — from Node.js `fs.readFile()` or streaming APIs
 * - `Blob` — from drag-and-drop or `<input type="file">`
 * - `File` — subclass of Blob, from `<input type="file">`
 */
type DocxInput = ArrayBuffer | Uint8Array | Blob | File;
/**
 * Normalize any {@link DocxInput} into an `ArrayBuffer` for internal use.
 */
declare function toArrayBuffer(input: DocxInput): Promise<ArrayBuffer>;

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
 * DOCX Repacker - Repack modified document into valid DOCX
 *
 * Takes a Document with modified content and creates a new DOCX file
 * by updating document.xml while preserving all other files from
 * the original ZIP archive.
 *
 * This ensures round-trip fidelity:
 * - styles.xml, theme1.xml, fontTable.xml remain untouched
 * - Media files preserved
 * - Relationships preserved
 * - Only document.xml is updated with new content
 *
 * OOXML Package Structure:
 * - [Content_Types].xml - Content type declarations
 * - _rels/.rels - Package relationships
 * - word/document.xml - Main document (modified)
 * - word/styles.xml - Styles (preserved)
 * - word/theme/theme1.xml - Theme (preserved)
 * - word/numbering.xml - Numbering (preserved)
 * - word/fontTable.xml - Font table (preserved)
 * - word/settings.xml - Settings (preserved)
 * - word/header*.xml - Headers (preserved)
 * - word/footer*.xml - Footers (preserved)
 * - word/footnotes.xml - Footnotes (preserved)
 * - word/endnotes.xml - Endnotes (preserved)
 * - word/media/* - Media files (preserved)
 * - word/_rels/document.xml.rels - Document relationships (preserved)
 * - docProps/* - Document properties (preserved)
 */

/**
 * Options for repacking DOCX
 */
interface RepackOptions {
    /** Compression level (0-9, default: 6) */
    compressionLevel?: number;
    /** Whether to update modification date in docProps/core.xml */
    updateModifiedDate?: boolean;
    /** Custom modifier name for lastModifiedBy */
    modifiedBy?: string;
}
/**
 * Repack a Document into a valid DOCX file
 *
 * @param doc - Document with modified content
 * @param options - Optional repack options
 * @returns Promise resolving to DOCX as ArrayBuffer
 * @throws Error if document has no original buffer for round-trip
 */
declare function repackDocx(doc: Document, options?: RepackOptions): Promise<ArrayBuffer>;
/**
 * Update multiple files in a DOCX buffer
 *
 * @param originalBuffer - Original DOCX as ArrayBuffer
 * @param updates - Map of path -> content for files to update
 * @param options - Optional repack options
 * @returns Promise resolving to DOCX as ArrayBuffer
 */
declare function updateMultipleFiles(originalBuffer: ArrayBuffer, updates: Map<string, string | ArrayBuffer>, options?: RepackOptions): Promise<ArrayBuffer>;
/**
 * Create a new DOCX from a Document (without requiring original buffer)
 *
 * @param doc - Document to serialize
 * @returns Promise resolving to DOCX as ArrayBuffer
 */
declare function createDocx(doc: Document): Promise<ArrayBuffer>;

/**
 * Selective Save Module
 *
 * Orchestrates selective XML patching for the save flow.
 * Serializes full document.xml, validates patch safety, builds patched XML,
 * and calls applyUpdatesToZip() to produce the final DOCX.
 *
 * Returns null on any failure, signaling the caller to fall back to full repack.
 */

interface SelectiveSaveOptions {
    /** Changed paragraph IDs to selectively patch */
    changedParaIds: Set<string>;
    /** Whether structural changes occurred (paragraph add/delete) */
    structuralChange: boolean;
    /** Whether any changes affected paragraphs without paraId */
    hasUntrackedChanges: boolean;
}
/**
 * Attempt a selective save — patch only changed paragraphs in document.xml.
 * Also updates comments, headers/footers, and core properties so that
 * all document parts stay in sync even when only paragraphs are patched.
 *
 * Returns the saved ArrayBuffer, or null if selective save is not possible
 * (caller should fall back to full repack).
 */
declare function attemptSelectiveSave(doc: Document, originalBuffer: ArrayBuffer, options: SelectiveSaveOptions): Promise<ArrayBuffer | null>;

interface PatchValidationResult {
    safe: boolean;
    reason?: string;
}
/**
 * Validate that a selective patch can be safely applied.
 *
 * Checks:
 * - All changed paraIds exist in original XML (exactly once)
 * - All changed paraIds exist in serialized XML (exactly once)
 * - Paragraph count matches between original and serialized
 */
declare function validatePatchSafety(originalXml: string, serializedXml: string, changedIds: Set<string>): PatchValidationResult;
/**
 * Build a patched document.xml by splicing new paragraph XML into
 * the original at the correct offsets. Only changed paragraphs
 * are replaced; everything else is preserved byte-for-byte.
 *
 * Returns null if any step fails.
 */
declare function buildPatchedDocumentXml(originalXml: string, serializedXml: string, changedIds: Set<string>): string | null;

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
 * DocumentAgent - High-level fluent API for programmatic document manipulation
 *
 * Provides a convenient interface for:
 * - Reading document content and metadata
 * - Editing text with formatting
 * - Inserting tables, images, and hyperlinks
 * - Managing template variables
 * - Exporting to DOCX buffer
 *
 * All operations are immutable - they return a new DocumentAgent instance
 * or don't modify the underlying document.
 */

/**
 * Options for inserting text
 */
interface InsertTextOptions {
    /** Text formatting */
    formatting?: TextFormatting;
}
/**
 * Options for inserting table
 */
interface InsertTableOptions {
    /** Table data (2D array of strings) */
    data?: string[][];
    /** Whether first row is a header */
    hasHeader?: boolean;
}
/**
 * Options for inserting image
 */
interface InsertImageOptions {
    /** Image width in pixels */
    width?: number;
    /** Image height in pixels */
    height?: number;
    /** Alt text for accessibility */
    alt?: string;
}
/**
 * Options for inserting hyperlink
 */
interface InsertHyperlinkOptions {
    /** Display text (overrides selected text) */
    displayText?: string;
    /** Tooltip on hover */
    tooltip?: string;
}
/**
 * Formatted text segment
 */
interface FormattedTextSegment {
    /** Text content */
    text: string;
    /** Applied formatting */
    formatting?: TextFormatting;
    /** Is part of a hyperlink */
    isHyperlink?: boolean;
    /** Hyperlink URL if applicable */
    hyperlinkUrl?: string;
}
/**
 * DocumentAgent provides a fluent API for document manipulation
 *
 * @example
 * ```ts
 * const agent = new DocumentAgent(buffer);
 *
 * // Read operations
 * const text = agent.getText();
 * const wordCount = agent.getWordCount();
 * const variables = agent.getVariables();
 *
 * // Write operations (returns new agent)
 * const newAgent = agent
 *   .insertText({ paragraphIndex: 0, offset: 0 }, 'Hello ', { formatting: { bold: true } })
 *   .applyStyle({ paragraphIndex: 0, offset: 0 }, { paragraphIndex: 0, offset: 5 }, 'Heading1');
 *
 * // Export
 * const newBuffer = await newAgent.toBuffer();
 * ```
 */
declare class DocumentAgent {
    private _document;
    private _pendingVariables;
    /**
     * Create a new DocumentAgent
     *
     * @param source - Document object or ArrayBuffer to parse
     */
    constructor(source: Document | ArrayBuffer);
    /**
     * Create a DocumentAgent from a DOCX buffer (async)
     *
     * @param buffer - DOCX file as ArrayBuffer, Uint8Array, Blob, or File
     * @returns Promise resolving to DocumentAgent
     */
    static fromBuffer(buffer: DocxInput): Promise<DocumentAgent>;
    /**
     * Create a DocumentAgent from a Document object
     *
     * @param document - Parsed Document
     * @returns DocumentAgent
     */
    static fromDocument(document: Document): DocumentAgent;
    /**
     * Get the underlying document
     */
    getDocument(): Document;
    /**
     * Get plain text content of the document
     *
     * @returns All document text concatenated
     */
    getText(): string;
    /**
     * Get formatted text segments
     *
     * @returns Array of text segments with formatting info
     */
    getFormattedText(): FormattedTextSegment[];
    /**
     * Get detected template variables
     *
     * @returns Array of variable names (without braces)
     */
    getVariables(): string[];
    /**
     * Get available styles from the document
     *
     * @returns Array of style info
     */
    getStyles(): StyleInfo[];
    /**
     * Get approximate page count
     *
     * Note: This is an estimate based on content length.
     * Actual page count requires full layout computation.
     *
     * @returns Estimated page count
     */
    getPageCount(): number;
    /**
     * Get word count
     *
     * @returns Number of words in the document
     */
    getWordCount(): number;
    /**
     * Get character count
     *
     * @param includeSpaces - Whether to include whitespace
     * @returns Number of characters
     */
    getCharacterCount(includeSpaces?: boolean): number;
    /**
     * Get paragraph count
     *
     * @returns Number of paragraphs
     */
    getParagraphCount(): number;
    /**
     * Get table count
     *
     * @returns Number of tables
     */
    getTableCount(): number;
    /**
     * Get document context for AI agents
     *
     * @param outlineMaxChars - Max characters per paragraph in outline
     * @returns Agent context
     */
    getAgentContext(outlineMaxChars?: number): AgentContext;
    /**
     * Insert text at a position
     *
     * @param position - Where to insert
     * @param text - Text to insert
     * @param options - Insert options
     * @returns New DocumentAgent with text inserted
     */
    insertText(position: Position, text: string, options?: InsertTextOptions): DocumentAgent;
    /**
     * Replace text in a range
     *
     * @param range - Range to replace
     * @param text - Replacement text
     * @param options - Replace options
     * @returns New DocumentAgent with text replaced
     */
    replaceRange(range: Range, text: string, options?: InsertTextOptions): DocumentAgent;
    /**
     * Delete text in a range
     *
     * @param range - Range to delete
     * @returns New DocumentAgent with text deleted
     */
    deleteRange(range: Range): DocumentAgent;
    /**
     * Apply text formatting to a range
     *
     * @param range - Range to format
     * @param formatting - Formatting to apply
     * @returns New DocumentAgent with formatting applied
     */
    applyFormatting(range: Range, formatting: Partial<TextFormatting>): DocumentAgent;
    /**
     * Apply a named style to a paragraph
     *
     * @param paragraphIndex - Index of the paragraph
     * @param styleId - Style ID to apply
     * @returns New DocumentAgent with style applied
     */
    applyStyle(paragraphIndex: number, styleId: string): DocumentAgent;
    /**
     * Apply paragraph formatting
     *
     * @param paragraphIndex - Index of the paragraph
     * @param formatting - Formatting to apply
     * @returns New DocumentAgent with formatting applied
     */
    applyParagraphFormatting(paragraphIndex: number, formatting: Partial<ParagraphFormatting>): DocumentAgent;
    /**
     * Insert a table at a position
     *
     * @param position - Where to insert the table
     * @param rows - Number of rows
     * @param cols - Number of columns
     * @param options - Table options
     * @returns New DocumentAgent with table inserted
     */
    insertTable(position: Position, rows: number, cols: number, options?: InsertTableOptions): DocumentAgent;
    /**
     * Insert an image at a position
     *
     * @param position - Where to insert the image
     * @param src - Image source (base64 data URL or URL)
     * @param options - Image options
     * @returns New DocumentAgent with image inserted
     */
    insertImage(position: Position, src: string, options?: InsertImageOptions): DocumentAgent;
    /**
     * Insert a hyperlink
     *
     * @param range - Range to make into a hyperlink
     * @param url - URL of the hyperlink
     * @param options - Hyperlink options
     * @returns New DocumentAgent with hyperlink inserted
     */
    insertHyperlink(range: Range, url: string, options?: InsertHyperlinkOptions): DocumentAgent;
    /**
     * Remove a hyperlink but keep the text
     *
     * @param range - Range containing the hyperlink
     * @returns New DocumentAgent with hyperlink removed
     */
    removeHyperlink(range: Range): DocumentAgent;
    /**
     * Insert a paragraph break
     *
     * @param position - Where to break the paragraph
     * @returns New DocumentAgent with paragraph broken
     */
    insertParagraphBreak(position: Position): DocumentAgent;
    /**
     * Merge consecutive paragraphs
     *
     * @param startParagraphIndex - First paragraph index
     * @param count - Number of paragraphs to merge with the first
     * @returns New DocumentAgent with paragraphs merged
     */
    mergeParagraphs(startParagraphIndex: number, count: number): DocumentAgent;
    /**
     * Set a template variable value
     *
     * Note: Variables are not applied until `applyVariables()` is called
     *
     * @param name - Variable name (without braces)
     * @param value - Variable value
     * @returns This DocumentAgent (for chaining)
     */
    setVariable(name: string, value: string): DocumentAgent;
    /**
     * Set multiple template variables
     *
     * @param variables - Map of variable names to values
     * @returns This DocumentAgent (for chaining)
     */
    setVariables(variables: Record<string, string>): DocumentAgent;
    /**
     * Get pending variable values
     *
     * @returns Map of pending variable values
     */
    getPendingVariables(): Record<string, string>;
    /**
     * Clear pending variables
     *
     * @returns This DocumentAgent (for chaining)
     */
    clearPendingVariables(): DocumentAgent;
    /**
     * Apply all pending template variables
     *
     * Uses docxtemplater to substitute variables while preserving formatting.
     *
     * @param variables - Optional additional variables (merged with pending)
     * @returns New DocumentAgent with variables applied
     */
    applyVariables(variables?: Record<string, string>): Promise<DocumentAgent>;
    /**
     * Export document to DOCX ArrayBuffer
     *
     * @returns Promise resolving to DOCX file as ArrayBuffer
     */
    toBuffer(options?: {
        selective?: SelectiveSaveOptions;
    }): Promise<ArrayBuffer>;
    /**
     * Export document to Blob
     *
     * @param mimeType - MIME type for the blob
     * @returns Promise resolving to DOCX file as Blob
     */
    toBlob(mimeType?: string): Promise<Blob>;
    /**
     * Execute multiple commands in sequence
     *
     * @param commands - Commands to execute
     * @returns New DocumentAgent with all commands applied
     */
    executeCommands(commands: AgentCommand[]): DocumentAgent;
    /**
     * Execute a single command and return new agent
     */
    private _executeCommand;
    /**
     * Get plain text from document body
     */
    private _getBodyText;
    /**
     * Get plain text from a paragraph
     */
    private _getParagraphText;
    /**
     * Get plain text from a run
     */
    private _getRunText;
    /**
     * Get plain text from a hyperlink
     */
    private _getHyperlinkText;
    /**
     * Get plain text from a table
     */
    private _getTableText;
    /**
     * Extract formatted text segments from a paragraph
     */
    private _extractParagraphSegments;
    /**
     * Parse heading level from style ID
     */
    private _parseHeadingLevel;
    /**
     * Check if document has images
     */
    private _hasImages;
    /**
     * Check if document has hyperlinks
     */
    private _hasHyperlinks;
}
/**
 * Create a DocumentAgent from a DOCX buffer
 *
 * @param buffer - DOCX file as ArrayBuffer
 * @returns Promise resolving to DocumentAgent
 */
declare function createAgent(buffer: ArrayBuffer): Promise<DocumentAgent>;
/**
 * Create a DocumentAgent from a parsed Document
 *
 * @param document - Parsed Document
 * @returns DocumentAgent
 */
declare function createAgentFromDocument(document: Document): DocumentAgent;

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

/**
 * Variable Detector Utility
 *
 * Scans a DOCX document for template variables in the format {variable_name}
 * (standard docxtemplater syntax).
 * Returns a unique, sorted list of variable names found in the document.
 */

/**
 * Result of variable detection
 */
interface VariableDetectionResult {
    /** Unique variable names sorted alphabetically */
    variables: string[];
    /** Total count of variable occurrences */
    totalOccurrences: number;
    /** Variables by location */
    byLocation: {
        body: string[];
        headers: string[];
        footers: string[];
        footnotes: string[];
        endnotes: string[];
        textBoxes: string[];
    };
    /** Variable occurrences with positions */
    occurrences: VariableOccurrence[];
}
/**
 * A single variable occurrence with location info
 */
interface VariableOccurrence {
    /** Variable name (without braces) */
    name: string;
    /** Location type */
    location: 'body' | 'header' | 'footer' | 'footnote' | 'endnote' | 'textBox';
    /** Paragraph index within location */
    paragraphIndex?: number;
    /** Section index (for headers/footers) */
    sectionIndex?: number;
}
/**
 * Detect all template variables in a document
 *
 * @param doc - The parsed document
 * @returns Array of unique variable names sorted alphabetically
 */
declare function detectVariables(doc: Document): string[];
/**
 * Detect variables with detailed information
 *
 * @param doc - The parsed document
 * @returns Detailed detection result
 */
declare function detectVariablesDetailed(doc: Document): VariableDetectionResult;
/**
 * Detect variables in document body
 */
declare function detectVariablesInBody(body: DocumentBody): string[];
/**
 * Detect variables in a paragraph
 */
declare function detectVariablesInParagraph(paragraph: Paragraph): string[];
/**
 * Extract variable names from text
 *
 * @param text - The text to search
 * @returns Array of variable names (without braces)
 */
declare function extractVariablesFromText(text: string): string[];
/**
 * Check if text contains template variables
 */
declare function hasTemplateVariables(text: string): boolean;
/**
 * Check if a variable name is valid
 */
declare function isValidVariableName(name: string): boolean;
/**
 * Sanitize a variable name
 */
declare function sanitizeVariableName(name: string): string;
/**
 * Format a variable name with braces (standard docxtemplater syntax)
 */
declare function formatVariable(name: string): string;
/**
 * Parse a variable string to get the name
 */
declare function parseVariable(variable: string): string | null;
/**
 * Replace variables in text with values
 *
 * @param text - The text containing variables
 * @param values - Map of variable name to replacement value
 * @returns Text with variables replaced
 */
declare function replaceVariables(text: string, values: Record<string, string>): string;
/**
 * Replace all variables in text with a placeholder
 *
 * @param text - The text containing variables
 * @param placeholder - Placeholder to use (default: empty string)
 * @returns Text with variables replaced
 */
declare function removeVariables(text: string, placeholder?: string): string;
/**
 * Check if document has any template variables
 */
declare function documentHasVariables(doc: Document): boolean;

export { isBlack as $, type AgentContextOptions as A, detectVariablesInParagraph as B, type CreateEmptyDocumentOptions as C, DocumentAgent as D, type ExtendedSelectionContext as E, type FormattedTextSegment as F, documentHasVariables as G, emuToPixels as H, type InsertHyperlinkOptions as I, emuToTwips as J, executeCommand as K, executeCommands as L, extractVariablesFromText as M, formatPx as N, formatVariable as O, type ProcessTemplateOptions as P, getAgentContext as Q, getContrastingColor as R, type SelectionContextOptions$1 as S, type TemplateError as T, getDocumentSummary as U, type VariableDetectionResult as V, getMissingVariables as W, getSelectionFormattingSummary as X, getTemplateTags as Y, halfPointsToPixels as Z, hasTemplateVariables as _, type FormattingSummary as a, isValidVariableName as a0, isWhite as a1, lightenColor as a2, parseColorString as a3, parseDocx as a4, parseVariable as a5, pixelsToEmu as a6, pixelsToTwips as a7, pointsToPixels as a8, previewTemplate as a9, processTemplate as aa, processTemplateAdvanced as ab, processTemplateAsBlob as ac, processTemplateDetailed as ad, removeVariables as ae, repackDocx as af, replaceVariables as ag, resolveColor as ah, resolveHighlightColor as ai, resolveShadingColor as aj, sanitizeVariableName as ak, serializeDocumentBody as al, serializeDocument as am, serializeSectionProperties as an, twipsToEmu as ao, twipsToPixels as ap, updateMultipleFiles as aq, validatePatchSafety as ar, validateTemplate as as, type DocxInput as at, type ThemeMatrixCell as au, ensureHexPrefix as av, generateThemeTintShadeMatrix as aw, getThemeTintShadeHex as ax, resolveHighlightToCss as ay, toArrayBuffer as az, type InsertImageOptions as b, type InsertTableOptions as c, type InsertTextOptions as d, type ProcessTemplateResult as e, type SelectionContextOptions as f, type VariableOccurrence as g, attemptSelectiveSave as h, blendColors as i, buildExtendedSelectionContext as j, buildPatchedDocumentXml as k, buildSelectionContext as l, buildSelectionContext$1 as m, colorsEqual as n, createAgent as o, createAgentFromDocument as p, createDocumentWithText as q, createDocx as r, createEmptyDocument as s, createRgbColor as t, createTemplateProcessor as u, createThemeColor as v, darkenColor as w, detectVariables as x, detectVariablesDetailed as y, detectVariablesInBody as z };
