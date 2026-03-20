import { D as Document, T as TextFormatting, _ as StyleInfo, h as AgentContext, P as Position, R as Range, K as ParagraphFormatting, A as AgentCommand } from './agentApi-BVHzyk2l.mjs';

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

export { DocumentAgent as D, type FormattedTextSegment as F, type InsertHyperlinkOptions as I, type InsertImageOptions as a, type InsertTableOptions as b, type InsertTextOptions as c, attemptSelectiveSave as d, createAgent as e, createAgentFromDocument as f, type DocxInput as g, toArrayBuffer as t };
