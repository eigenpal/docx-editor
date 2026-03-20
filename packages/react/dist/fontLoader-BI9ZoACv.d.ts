import {
  D as Document,
  B as BreakContent,
  a as Paragraph,
  b as Run,
  c as RunContent,
} from './agentApi-BVHzyk2l.js';

/**
 * Insert Operations Utility
 *
 * Utility functions for inserting content into the document.
 * Provides functions for inserting page breaks, horizontal rules, and other elements.
 */

/**
 * Insert position in the document
 */
interface InsertPosition {
  /** Paragraph index in the document body */
  paragraphIndex: number;
  /** Run index within the paragraph (optional) */
  runIndex?: number;
  /** Character offset within the run (optional) */
  offset?: number;
}
/**
 * Create a page break content element
 */
declare function createPageBreak(): BreakContent;
/**
 * Create a column break content element
 */
declare function createColumnBreak(): BreakContent;
/**
 * Create a text wrapping break (line break)
 */
declare function createLineBreak(clear?: 'none' | 'left' | 'right' | 'all'): BreakContent;
/**
 * Create a run containing a page break
 */
declare function createPageBreakRun(): Run;
/**
 * Create an empty paragraph with a page break before it
 */
declare function createPageBreakParagraph(): Paragraph;
/**
 * Insert a page break at a position in the document
 * This inserts a new paragraph with pageBreakBefore: true
 */
declare function insertPageBreak(doc: Document, position: InsertPosition): Document;
/**
 * Create a horizontal rule paragraph
 * Uses a paragraph with bottom border to simulate horizontal rule
 */
declare function createHorizontalRule(): Paragraph;
/**
 * Insert a horizontal rule at a position in the document
 */
declare function insertHorizontalRule(doc: Document, position: InsertPosition): Document;
/**
 * Check if content is a page break
 */
declare function isPageBreak(content: RunContent): boolean;
/**
 * Check if content is a column break
 */
declare function isColumnBreak(content: RunContent): boolean;
/**
 * Check if content is a line break
 */
declare function isLineBreak(content: RunContent): boolean;
/**
 * Check if content is any type of break
 */
declare function isBreakContent(content: RunContent): content is BreakContent;
/**
 * Check if a paragraph has pageBreakBefore
 */
declare function hasPageBreakBefore(paragraph: Paragraph): boolean;
/**
 * Count page breaks in a document
 */
declare function countPageBreaks(doc: Document): number;
/**
 * Find all page break positions in a document
 */
declare function findPageBreaks(doc: Document): InsertPosition[];
/**
 * Remove a page break at a specific position
 */
declare function removePageBreak(doc: Document, position: InsertPosition): Document;

/**
 * Google Fonts Loader
 *
 * Dynamically loads fonts from Google Fonts API with:
 * - Loading state tracking
 * - Duplicate prevention
 * - Callback notifications
 * - Font availability detection
 */
/**
 * Load a font from Google Fonts
 *
 * @param fontFamily - The font family name to load
 * @param options - Optional configuration
 * @returns Promise resolving to true if font loaded successfully, false otherwise
 */
declare function loadFont(
  fontFamily: string,
  options?: {
    weights?: number[];
    styles?: ('normal' | 'italic')[];
  }
): Promise<boolean>;
/**
 * Load multiple fonts from Google Fonts
 *
 * @param families - Array of font family names to load
 * @param options - Optional configuration
 * @returns Promise resolving when all fonts are loaded (or failed)
 */
declare function loadFonts(
  families: string[],
  options?: {
    weights?: number[];
    styles?: ('normal' | 'italic')[];
  }
): Promise<void>;
/**
 * Check if a font is loaded
 *
 * @param fontFamily - The font family name to check
 * @returns true if the font is loaded, false otherwise
 */
declare function isFontLoaded(fontFamily: string): boolean;
/**
 * Check if any fonts are currently loading
 *
 * @returns true if any fonts are loading, false otherwise
 */
declare function isLoading(): boolean;
/**
 * Get list of all loaded fonts
 *
 * @returns Array of loaded font family names
 */
declare function getLoadedFonts(): string[];
/**
 * Register a callback to be notified when fonts are loaded
 *
 * @param callback - Function to call when fonts are loaded
 * @returns Cleanup function to remove the callback
 */
declare function onFontsLoaded(callback: (fonts: string[]) => void): () => void;
/**
 * Check if a font is available on the system using canvas measurement
 *
 * This uses the technique of comparing text width with the target font
 * vs a known fallback font. If they differ, the font is available.
 *
 * @param fontFamily - The font family name to check
 * @param fallbackFont - Fallback font to compare against
 * @returns true if font is available, false otherwise
 */
declare function canRenderFont(fontFamily: string, fallbackFont?: string): boolean;
/**
 * Load a font from a raw buffer (e.g., embedded in DOCX)
 *
 * @param fontFamily - The font family name
 * @param buffer - Font file buffer (TTF, OTF, WOFF, WOFF2)
 * @param options - Font options
 * @returns Promise resolving when font is loaded
 */
declare function loadFontFromBuffer(
  fontFamily: string,
  buffer: ArrayBuffer,
  options?: {
    weight?: number | string;
    style?: 'normal' | 'italic';
  }
): Promise<boolean>;
/**
 * Preload a list of common document fonts
 *
 * This preloads fonts commonly used in DOCX documents that have
 * Google Fonts equivalents.
 */
declare function preloadCommonFonts(): Promise<void>;

export {
  type InsertPosition as I,
  countPageBreaks as a,
  createColumnBreak as b,
  canRenderFont as c,
  createHorizontalRule as d,
  createLineBreak as e,
  createPageBreak as f,
  createPageBreakParagraph as g,
  createPageBreakRun as h,
  findPageBreaks as i,
  getLoadedFonts as j,
  hasPageBreakBefore as k,
  insertHorizontalRule as l,
  insertPageBreak as m,
  isBreakContent as n,
  isColumnBreak as o,
  isFontLoaded as p,
  isLoading as q,
  isLineBreak as r,
  isPageBreak as s,
  loadFont as t,
  loadFontFromBuffer as u,
  loadFonts as v,
  onFontsLoaded as w,
  preloadCommonFonts as x,
  removePageBreak as y,
};
