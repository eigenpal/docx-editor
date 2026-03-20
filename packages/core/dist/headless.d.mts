export { A as AgentContextOptions, S as ContextSelectionOptions, C as CreateEmptyDocumentOptions, D as DocumentAgent, E as ExtendedSelectionContext, F as FormattedTextSegment, a as FormattingSummary, I as InsertHyperlinkOptions, b as InsertImageOptions, c as InsertTableOptions, d as InsertTextOptions, P as ProcessTemplateOptions, e as ProcessTemplateResult, f as SelectionContextOptions, T as TemplateError, V as VariableDetectionResult, g as VariableOccurrence, h as attemptSelectiveSave, i as blendColors, j as buildExtendedSelectionContext, k as buildPatchedDocumentXml, l as buildSelectionContext, m as buildSelectionContextFromContext, n as colorsEqual, o as createAgent, p as createAgentFromDocument, q as createDocumentWithText, r as createDocx, s as createEmptyDocument, t as createRgbColor, u as createTemplateProcessor, v as createThemeColor, w as darkenColor, x as detectVariables, y as detectVariablesDetailed, z as detectVariablesInBody, B as detectVariablesInParagraph, G as documentHasVariables, H as emuToPixels, J as emuToTwips, K as executeCommand, L as executeCommands, M as extractVariablesFromText, N as formatPx, O as formatVariable, Q as getAgentContext, R as getContrastingColor, U as getDocumentSummary, W as getMissingVariables, X as getSelectionFormattingSummary, Y as getTemplateTags, Z as halfPointsToPixels, _ as hasTemplateVariables, $ as isBlack, a0 as isValidVariableName, a1 as isWhite, a2 as lightenColor, a3 as parseColorString, a4 as parseDocx, a5 as parseVariable, a6 as pixelsToEmu, a7 as pixelsToTwips, a8 as pointsToPixels, a9 as previewTemplate, aa as processTemplate, ab as processTemplateAdvanced, ac as processTemplateAsBlob, ad as processTemplateDetailed, ae as removeVariables, af as repackDocx, ag as replaceVariables, ah as resolveColor, ai as resolveHighlightColor, aj as resolveShadingColor, ak as sanitizeVariableName, al as serializeDocumentBody, am as serializeDocx, an as serializeSectionProperties, ao as twipsToEmu, ap as twipsToPixels, aq as updateMultipleFiles, ar as validatePatchSafety, as as validateTemplate } from './variableDetector-BscpvKxr.mjs';
import { D as DocumentBody, d as Paragraph, T as TextFormatting, H as Hyperlink, R as Run, e as Table, f as Position } from './types-BhDofcWh.mjs';
export { A as AIAction, g as AIActionRequest, h as AgentCommand, i as AgentContext, j as AgentResponse, k as ApplyStyleCommand, l as ApplyVariablesCommand, B as BlockContent, b as CommandHandler, m as CommandResult, n as Comment, o as CommentRangeEnd, p as CommentRangeStart, C as CorePlugin, q as DEFAULT_AI_ACTIONS, r as DeleteTextCommand, s as Deletion, t as Document, u as DocxPackage, E as Endnote, F as Footnote, v as FormatParagraphCommand, w as FormatTextCommand, I as Image, x as InsertHyperlinkCommand, y as InsertImageCommand, z as InsertTableCommand, G as InsertTextCommand, J as Insertion, K as JsonSchema, L as ListLevel, N as LoadedDocument, O as McpSession, Q as McpToolAnnotations, S as McpToolContent, U as McpToolContext, M as McpToolDefinition, V as McpToolHandler, W as McpToolResult, X as MoveFrom, Y as MoveTo, Z as NumberingDefinitions, _ as ParagraphContent, $ as ParagraphContext, a0 as ParagraphFormatting, a1 as ParagraphOutline, C as Plugin, a2 as PluginCommand, b as PluginCommandHandler, a3 as PluginEvent, c as PluginEventListener, P as PluginOptions, a as PluginRegistrationResult, a4 as Range, a5 as Relationship, a6 as ReplaceTextCommand, a7 as RunContent, a8 as SectionInfo, a9 as SectionProperties, aa as SelectionContext, ab as SetVariableCommand, ac as Style, ad as StyleDefinitions, ae as StyleInfo, af as SuggestedAction, ag as TableCell, ah as TableRow, ai as TextContent, aj as Theme, M as ToolDefinition, V as ToolHandler, W as ToolResult, ak as TrackedChangeInfo, al as TrackedRunChange, am as ZodSchemaLike, an as comparePositions, ao as createCollapsedRange, ap as createCommand, aq as createRange, ar as getActionDescription, as as getActionLabel, at as isPositionInRange, au as isZodSchema } from './types-BhDofcWh.mjs';
export { P as PluginRegistry, c as createPluginRegistrar, p as pluginRegistry, r as registerPlugins } from './registry-BqJilp0u.mjs';

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
