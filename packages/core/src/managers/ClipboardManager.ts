/**
 * ClipboardManager
 *
 * Framework-agnostic class for clipboard operations in the editor.
 * Extracted from the React `useClipboard` hook.
 *
 * Handles:
 * - DOM selection traversal and run extraction
 * - Formatting extraction from computed styles
 * - Clipboard read/write operations
 */

import type { Run } from '../types/document';

// ============================================================================
// TYPES
// ============================================================================

/** Selection data for clipboard operations */
export interface ClipboardSelection {
  text: string;
  runs: Run[];
  startParagraphIndex: number;
  startRunIndex: number;
  startOffset: number;
  endParagraphIndex: number;
  endRunIndex: number;
  endOffset: number;
  isMultiParagraph: boolean;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Convert a CSS color string (rgb/rgba/hex) to a 6-char uppercase hex string.
 *
 * NOTE: This differs from `colorResolver.rgbToHex(r, g, b)` which takes
 * numeric components. This function parses CSS color strings.
 */
export function cssColorToHex(color: string): string | null {
  if (!color || color === 'transparent' || color === 'inherit') return null;

  if (color.startsWith('#')) {
    return color.slice(1).toUpperCase();
  }

  const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1]).toString(16).padStart(2, '0');
    const g = parseInt(rgbMatch[2]).toString(16).padStart(2, '0');
    const b = parseInt(rgbMatch[3]).toString(16).padStart(2, '0');
    return (r + g + b).toUpperCase();
  }

  return null;
}

/** Extract formatting from an HTML element's computed styles. */
export function extractFormattingFromElement(element: HTMLElement): Run['formatting'] {
  const style = window.getComputedStyle(element);
  const formatting: Run['formatting'] = {};

  // Bold
  if (style.fontWeight === 'bold' || parseInt(style.fontWeight) >= 700) {
    formatting.bold = true;
  }

  // Italic
  if (style.fontStyle === 'italic') {
    formatting.italic = true;
  }

  // Underline
  const textDecoration = style.textDecoration || style.textDecorationLine;
  if (textDecoration && textDecoration.includes('underline')) {
    formatting.underline = { style: 'single' };
  }

  // Strikethrough
  if (textDecoration && textDecoration.includes('line-through')) {
    formatting.strike = true;
  }

  // Font size (convert px to half-points)
  const fontSize = parseFloat(style.fontSize);
  if (!isNaN(fontSize) && fontSize > 0) {
    formatting.fontSize = Math.round((fontSize / 1.333) * 2);
  }

  // Font family
  const fontFamily = style.fontFamily.replace(/["']/g, '').split(',')[0].trim();
  if (fontFamily) {
    formatting.fontFamily = { ascii: fontFamily };
  }

  // Color
  const color = style.color;
  if (color && color !== 'rgb(0, 0, 0)') {
    const hex = cssColorToHex(color);
    if (hex) {
      formatting.color = { rgb: hex };
    }
  }

  // Background color
  const bgColor = style.backgroundColor;
  if (bgColor && bgColor !== 'transparent' && bgColor !== 'rgba(0, 0, 0, 0)') {
    const hex = rgbToHex(bgColor);
    if (hex) {
      formatting.shading = { fill: { rgb: hex } };
    }
  }

  return Object.keys(formatting).length > 0 ? formatting : undefined;
}

/** Get selected text from a run element, considering partial selection. */
function getSelectedTextFromRun(runEl: Node, range: Range): string {
  const runRange = document.createRange();
  runRange.selectNodeContents(runEl);

  const startInRun =
    range.compareBoundaryPoints(Range.START_TO_START, runRange) >= 0 &&
    range.compareBoundaryPoints(Range.START_TO_END, runRange) <= 0;
  const endInRun =
    range.compareBoundaryPoints(Range.END_TO_START, runRange) >= 0 &&
    range.compareBoundaryPoints(Range.END_TO_END, runRange) <= 0;

  if (startInRun && endInRun) {
    return range.toString();
  } else if (startInRun) {
    const tempRange = document.createRange();
    tempRange.setStart(range.startContainer, range.startOffset);
    tempRange.selectNodeContents(runEl);
    tempRange.setEnd(runRange.endContainer, runRange.endOffset);
    return tempRange.toString();
  } else if (endInRun) {
    const tempRange = document.createRange();
    tempRange.selectNodeContents(runEl);
    tempRange.setEnd(range.endContainer, range.endOffset);
    tempRange.setStart(runRange.startContainer, runRange.startOffset);
    return tempRange.toString();
  } else if (range.intersectsNode(runEl)) {
    return runEl.textContent || '';
  }

  return '';
}

/** Find the paragraph element containing a node. */
function findParagraphElement(node: Node): HTMLElement | null {
  let current: Node | null = node;
  while (current) {
    if (current.nodeType === Node.ELEMENT_NODE) {
      const element = current as HTMLElement;
      if (element.hasAttribute('data-paragraph-index')) {
        return element;
      }
    }
    current = current.parentNode;
  }
  return null;
}

/** Get selected runs from the current DOM selection. */
export function getSelectionRuns(): Run[] {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return [];

  const runs: Run[] = [];
  const range = selection.getRangeAt(0);

  const container = range.commonAncestorContainer;
  const containerElement =
    container.nodeType === Node.ELEMENT_NODE ? (container as HTMLElement) : container.parentElement;

  if (!containerElement) return runs;

  const runElements = containerElement.querySelectorAll('.docx-run');

  runElements.forEach((runEl) => {
    if (range.intersectsNode(runEl)) {
      const text = getSelectedTextFromRun(runEl, range);
      if (text) {
        const formatting = extractFormattingFromElement(runEl as HTMLElement);
        runs.push({
          type: 'run',
          formatting,
          content: [{ type: 'text', text }],
        });
      }
    }
  });

  if (runs.length === 0) {
    const selectedText = selection.toString();
    if (selectedText) {
      runs.push({
        type: 'run',
        content: [{ type: 'text', text: selectedText }],
      });
    }
  }

  return runs;
}

/** Create a ClipboardSelection from the current DOM selection. */
export function createSelectionFromDOM(): ClipboardSelection | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return null;

  const runs = getSelectionRuns();
  if (runs.length === 0) return null;

  const text = selection.toString();
  const range = selection.getRangeAt(0);
  const startPara = findParagraphElement(range.startContainer);
  const endPara = findParagraphElement(range.endContainer);

  const startParagraphIndex = startPara
    ? parseInt(startPara.getAttribute('data-paragraph-index') || '0', 10)
    : 0;
  const endParagraphIndex = endPara
    ? parseInt(endPara.getAttribute('data-paragraph-index') || '0', 10)
    : 0;

  return {
    text,
    runs,
    startParagraphIndex,
    startRunIndex: 0,
    startOffset: range.startOffset,
    endParagraphIndex,
    endRunIndex: 0,
    endOffset: range.endOffset,
    isMultiParagraph: startParagraphIndex !== endParagraphIndex,
  };
}

// Backwards-compatible alias
export const rgbToHex = cssColorToHex;
