import { d as DocumentBody, a as Paragraph, T as TextFormatting, H as Hyperlink, b as Run, e as Table, P as Position } from './agentApi-BVHzyk2l.mjs';
export { f as AIAction, g as AIActionRequest, A as AgentCommand, h as AgentContext, i as AgentResponse, j as ApplyStyleCommand, k as ApplyVariablesCommand, l as BlockContent, C as Comment, m as CommentRangeEnd, n as CommentRangeStart, o as DEFAULT_AI_ACTIONS, p as DeleteTextCommand, q as Deletion, D as Document, r as DocxPackage, E as Endnote, F as Footnote, s as FormatParagraphCommand, t as FormatTextCommand, I as Image, u as InsertHyperlinkCommand, v as InsertImageCommand, w as InsertTableCommand, x as InsertTextCommand, y as Insertion, L as ListLevel, M as MoveFrom, z as MoveTo, N as NumberingDefinitions, G as ParagraphContent, J as ParagraphContext, K as ParagraphFormatting, O as ParagraphOutline, R as Range, Q as Relationship, S as ReplaceTextCommand, c as RunContent, U as SectionInfo, V as SectionProperties, W as SelectionContext, X as SetVariableCommand, Y as Style, Z as StyleDefinitions, _ as StyleInfo, $ as SuggestedAction, a0 as TableCell, a1 as TableRow, a2 as TextContent, a3 as Theme, a4 as TrackedChangeInfo, a5 as TrackedRunChange, a6 as comparePositions, a7 as createCollapsedRange, a8 as createCommand, a9 as createRange, aa as getActionDescription, ab as getActionLabel, ac as isPositionInRange } from './agentApi-BVHzyk2l.mjs';
export { A as AgentContextOptions, S as ContextSelectionOptions, C as CreateEmptyDocumentOptions, E as ExtendedSelectionContext, F as FormattingSummary, P as ProcessTemplateOptions, a as ProcessTemplateResult, b as SelectionContextOptions, T as TemplateError, c as blendColors, d as buildExtendedSelectionContext, e as buildSelectionContext, f as buildSelectionContextFromContext, g as colorsEqual, h as createDocumentWithText, i as createEmptyDocument, j as createRgbColor, k as createTemplateProcessor, l as createThemeColor, m as darkenColor, n as emuToPixels, o as emuToTwips, p as executeCommand, q as executeCommands, r as formatPx, s as getAgentContext, t as getContrastingColor, u as getDocumentSummary, v as getMissingVariables, w as getSelectionFormattingSummary, x as getTemplateTags, y as halfPointsToPixels, z as isBlack, B as isWhite, D as lightenColor, G as parseColorString, H as parseDocx, I as pixelsToEmu, J as pixelsToTwips, K as pointsToPixels, L as previewTemplate, M as processTemplate, N as processTemplateAdvanced, O as processTemplateAsBlob, Q as processTemplateDetailed, R as resolveColor, U as resolveHighlightColor, V as resolveShadingColor, W as serializeDocumentBody, X as serializeDocx, Y as serializeSectionProperties, Z as twipsToEmu, _ as twipsToPixels, $ as validateTemplate } from './colorResolver-BwI_Uxp3.mjs';
export { b as CommandHandler, d as CommandResult, C as CorePlugin, J as JsonSchema, L as LoadedDocument, e as McpSession, f as McpToolAnnotations, g as McpToolContent, h as McpToolContext, M as McpToolDefinition, i as McpToolHandler, j as McpToolResult, C as Plugin, k as PluginCommand, b as PluginCommandHandler, l as PluginEvent, c as PluginEventListener, P as PluginOptions, a as PluginRegistrationResult, M as ToolDefinition, i as ToolHandler, j as ToolResult, Z as ZodSchemaLike, m as isZodSchema } from './types-B3LkfO0u.mjs';
export { D as DocumentAgent, F as FormattedTextSegment, I as InsertHyperlinkOptions, a as InsertImageOptions, b as InsertTableOptions, c as InsertTextOptions, d as attemptSelectiveSave, e as createAgent, f as createAgentFromDocument } from './DocumentAgent-BqA9EJ3F.mjs';
export { P as PluginRegistry, c as createPluginRegistrar, p as pluginRegistry, r as registerPlugins } from './registry-DyIMyB-0.mjs';
export { V as VariableDetectionResult, a as VariableOccurrence, b as buildPatchedDocumentXml, c as createDocx, d as detectVariables, e as detectVariablesDetailed, f as detectVariablesInBody, g as detectVariablesInParagraph, h as documentHasVariables, i as extractVariablesFromText, j as formatVariable, k as hasTemplateVariables, l as isValidVariableName, p as parseVariable, r as removeVariables, m as repackDocx, n as replaceVariables, s as sanitizeVariableName, u as updateMultipleFiles, v as validatePatchSafety } from './variableDetector-CIqTek7A.mjs';

/**
 * Shared Text Utilities for Agent Module
 *
 * Common text extraction and manipulation utilities used by
 * context.ts, selectionContext.ts, and other agent-related code.
 *
 * Consolidates duplicated helper functions into a single location.
 */

/**
 * Get plain text from a paragraph
 */
declare function getParagraphText(paragraph: Paragraph): string;
/**
 * Get plain text from a run
 */
declare function getRunText(run: Run): string;
/**
 * Get plain text from a hyperlink
 */
declare function getHyperlinkText(hyperlink: Hyperlink): string;
/**
 * Get plain text from a table
 */
declare function getTableText(table: Table): string;
/**
 * Get plain text from document body
 */
declare function getBodyText(body: DocumentBody): string;
/**
 * Count words in text
 */
declare function countWords(text: string): number;
/**
 * Count characters in text
 */
declare function countCharacters(text: string, includeSpaces?: boolean): number;
/**
 * Get word count from document body
 */
declare function getBodyWordCount(body: DocumentBody): number;
/**
 * Get character count from document body
 */
declare function getBodyCharacterCount(body: DocumentBody): number;
/**
 * Get text before a position
 *
 * @param paragraphs - Array of paragraphs
 * @param position - Position to get text before
 * @param maxChars - Maximum characters to return
 * @returns Text before the position
 */
declare function getTextBefore(paragraphs: Paragraph[], position: Position, maxChars: number): string;
/**
 * Get text after a position
 *
 * @param paragraphs - Array of paragraphs
 * @param position - Position to get text after
 * @param maxChars - Maximum characters to return
 * @returns Text after the position
 */
declare function getTextAfter(paragraphs: Paragraph[], position: Position, maxChars: number): string;
/**
 * Get formatting at a specific position in a paragraph
 *
 * @param paragraph - The paragraph to check
 * @param offset - Character offset in the paragraph
 * @returns Formatting at that position
 */
declare function getFormattingAtPosition(paragraph: Paragraph, offset: number): Partial<TextFormatting>;
/**
 * Check if position is within a hyperlink
 *
 * @param paragraph - The paragraph to check
 * @param offset - Character offset in the paragraph
 * @returns True if position is in a hyperlink
 */
declare function isPositionInHyperlink(paragraph: Paragraph, offset: number): boolean;
/**
 * Get hyperlink at position
 *
 * @param paragraph - The paragraph to check
 * @param offset - Character offset in the paragraph
 * @returns The hyperlink at that position, or undefined
 */
declare function getHyperlinkAtPosition(paragraph: Paragraph, offset: number): Hyperlink | undefined;
/**
 * Check if style ID represents a heading
 *
 * @param styleId - Style ID to check
 * @returns True if it's a heading style
 */
declare function isHeadingStyle(styleId?: string): boolean;
/**
 * Parse heading level from style ID
 *
 * @param styleId - Style ID to parse
 * @returns Heading level (1-9) or undefined
 */
declare function parseHeadingLevel(styleId?: string): number | undefined;
/**
 * Check if document body has images
 *
 * @param body - Document body to check
 * @returns True if contains images
 */
declare function hasImages(body: DocumentBody): boolean;
/**
 * Check if document body has hyperlinks
 *
 * @param body - Document body to check
 * @returns True if contains hyperlinks
 */
declare function hasHyperlinks(body: DocumentBody): boolean;
/**
 * Check if document body has tables
 *
 * @param body - Document body to check
 * @returns True if contains tables
 */
declare function hasTables(body: DocumentBody): boolean;
/**
 * Get all paragraphs from document body
 *
 * @param body - Document body
 * @returns Array of paragraphs
 */
declare function getParagraphs(body: DocumentBody): Paragraph[];
/**
 * Get paragraph at index from document body
 *
 * @param body - Document body
 * @param index - Paragraph index (0-indexed)
 * @returns Paragraph or undefined
 */
declare function getParagraphAtIndex(body: DocumentBody, index: number): Paragraph | undefined;
/**
 * Get block index for a paragraph index
 *
 * @param body - Document body
 * @param paragraphIndex - Paragraph index
 * @returns Block index or -1 if not found
 */
declare function getBlockIndexForParagraph(body: DocumentBody, paragraphIndex: number): number;

/**
 * Headless API Entry Point
 *
 * Provides document manipulation functionality without React/DOM dependencies.
 * Suitable for Node.js scripts, CLI tools, and server-side processing.
 *
 * @example
 * ```ts
 * import { DocumentAgent, parseDocx, pluginRegistry } from '@eigenpal/docx-editor/headless';
 * import { docxtemplaterPlugin } from '@eigenpal/docx-editor/core-plugins';
 *
 * // Register plugins
 * pluginRegistry.register(docxtemplaterPlugin);
 *
 * // Load and manipulate document
 * const buffer = fs.readFileSync('template.docx');
 * const agent = await DocumentAgent.fromBuffer(buffer);
 *
 * // Get document info
 * console.log('Word count:', agent.getWordCount());
 * console.log('Variables:', agent.getVariables());
 *
 * // Edit document
 * const newAgent = agent
 *   .insertText({ paragraphIndex: 0, offset: 0 }, 'Hello ')
 *   .applyStyle(0, 'Heading1');
 *
 * // Apply template variables
 * const finalAgent = await newAgent.applyVariables({
 *   customer_name: 'Jane Doe',
 *   date: '2024-02-15',
 * });
 *
 * // Export
 * const output = await finalAgent.toBuffer();
 * fs.writeFileSync('output.docx', Buffer.from(output));
 * ```
 */
declare const VERSION = "0.0.2";

export { DocumentBody, Hyperlink, Paragraph, Position, Run, Table, TextFormatting, VERSION, countCharacters, countWords, getBlockIndexForParagraph, getBodyCharacterCount, getBodyText, getBodyWordCount, getFormattingAtPosition, getHyperlinkAtPosition, getHyperlinkText, getParagraphAtIndex, getParagraphText, getParagraphs, getRunText, getTableText, getTextAfter, getTextBefore, hasHyperlinks, hasImages, hasTables, isHeadingStyle, isPositionInHyperlink, parseHeadingLevel };
