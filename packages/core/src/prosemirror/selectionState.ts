/**
 * Selection State Utilities
 *
 * Extracts selection state from ProseMirror for toolbar integration.
 */

import type { EditorState } from 'prosemirror-state';
import type { TextFormatting, ParagraphFormatting } from '../types/document';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Selection state for toolbar integration
 */
export interface SelectionState {
  /** Whether there's an active selection (not just cursor) */
  hasSelection: boolean;
  /** Whether selection spans multiple paragraphs */
  isMultiParagraph: boolean;
  /** Current text formatting at selection/cursor */
  textFormatting: TextFormatting;
  /** Current paragraph formatting */
  paragraphFormatting: ParagraphFormatting;
  /** Current paragraph style ID (e.g., 'Heading1', 'Normal') */
  styleId: string | null;
  /** Start paragraph index */
  startParagraphIndex: number;
  /** End paragraph index */
  endParagraphIndex: number;
}

// ============================================================================
// FUNCTIONS
// ============================================================================

/**
 * Extract selection state from editor state.
 * Used by PagedEditor integration in DocxEditor for toolbar state.
 */
export function extractSelectionState(state: EditorState): SelectionState | null {
  const { selection, doc } = state;
  const { from, to, empty } = selection;

  // Find containing paragraphs
  const $from = doc.resolve(from);

  // Get paragraph indices
  let startParagraphIndex = 0;
  let endParagraphIndex = 0;

  doc.forEach((_node, offset, index) => {
    if (offset <= from) {
      startParagraphIndex = index;
    }
    if (offset <= to) {
      endParagraphIndex = index;
    }
  });

  // Get current text formatting from marks at selection
  let textFormatting: TextFormatting = {};

  // Check paragraph for default text formatting (for empty paragraphs)
  const paragraph = $from.parent;
  const isEmptyParagraph =
    paragraph.type.name === 'paragraph' && paragraph.textContent.length === 0;
  const paragraphDefaultFormatting = paragraph.attrs?.defaultTextFormatting as
    | TextFormatting
    | undefined;

  // For empty selection (cursor), use stored marks or marks at cursor position
  // For non-empty selection, check marks at the start of selection
  const marks = state.storedMarks || selection.$from.marks();

  // If in empty paragraph with no marks but has defaultTextFormatting, use that
  if (isEmptyParagraph && marks.length === 0 && paragraphDefaultFormatting) {
    textFormatting = { ...paragraphDefaultFormatting };
  }

  // Override with actual marks if present
  for (const mark of marks) {
    switch (mark.type.name) {
      case 'bold':
        textFormatting.bold = true;
        break;
      case 'italic':
        textFormatting.italic = true;
        break;
      case 'underline':
        textFormatting.underline = {
          style: mark.attrs.style || 'single',
          color: mark.attrs.color,
        };
        break;
      case 'strike':
        if (mark.attrs.double) {
          textFormatting.doubleStrike = true;
        } else {
          textFormatting.strike = true;
        }
        break;
      case 'textColor':
        textFormatting.color = {
          rgb: mark.attrs.rgb,
          themeColor: mark.attrs.themeColor,
        };
        break;
      case 'highlight':
        textFormatting.highlight = mark.attrs.color;
        break;
      case 'fontSize':
        textFormatting.fontSize = mark.attrs.size;
        break;
      case 'fontFamily':
        textFormatting.fontFamily = {
          ascii: mark.attrs.ascii,
          hAnsi: mark.attrs.hAnsi,
        };
        break;
      case 'superscript':
        textFormatting.vertAlign = 'superscript';
        break;
      case 'subscript':
        textFormatting.vertAlign = 'subscript';
        break;
    }
  }

  // Get paragraph formatting and styleId from current paragraph
  const paragraphFormatting: ParagraphFormatting = {};
  let styleId: string | null = null;

  if (paragraph.type.name === 'paragraph') {
    if (paragraph.attrs.alignment) {
      paragraphFormatting.alignment = paragraph.attrs.alignment;
    }
    if (paragraph.attrs.lineSpacing) {
      paragraphFormatting.lineSpacing = paragraph.attrs.lineSpacing;
      paragraphFormatting.lineSpacingRule = paragraph.attrs.lineSpacingRule;
    }
    if (paragraph.attrs.numPr) {
      paragraphFormatting.numPr = paragraph.attrs.numPr;
    }
    if (paragraph.attrs.indentLeft) {
      paragraphFormatting.indentLeft = paragraph.attrs.indentLeft;
    }
    if (paragraph.attrs.indentRight) {
      paragraphFormatting.indentRight = paragraph.attrs.indentRight;
    }
    if (paragraph.attrs.indentFirstLine) {
      paragraphFormatting.indentFirstLine = paragraph.attrs.indentFirstLine;
    }
    if (paragraph.attrs.hangingIndent) {
      paragraphFormatting.hangingIndent = paragraph.attrs.hangingIndent;
    }
    if (paragraph.attrs.tabs) {
      paragraphFormatting.tabs = paragraph.attrs.tabs;
    }
    if (paragraph.attrs.styleId) {
      styleId = paragraph.attrs.styleId;
    }
  }

  return {
    hasSelection: !empty,
    isMultiParagraph: startParagraphIndex !== endParagraphIndex,
    textFormatting,
    paragraphFormatting,
    styleId,
    startParagraphIndex,
    endParagraphIndex,
  };
}
