/**
 * Text Box Parser - Parse floating text box containers
 *
 * Text boxes in DOCX are implemented as shapes (wps:wsp) with text body content (wps:txbx).
 * The text body contains w:txbxContent which holds paragraphs and tables like the main document.
 *
 * OOXML Structure:
 * w:drawing
 *   └── wp:inline or wp:anchor
 *       └── a:graphic
 *           └── a:graphicData
 *               └── wps:wsp (shape)
 *                   ├── wps:cNvSpPr (non-visual properties)
 *                   ├── wps:spPr (shape properties)
 *                   │   ├── a:xfrm (transform: position, size)
 *                   │   ├── a:prstGeom (preset geometry - typically "rect" for text boxes)
 *                   │   ├── a:solidFill / a:noFill (fill)
 *                   │   └── a:ln (outline)
 *                   ├── wps:txbx (text box container)
 *                   │   └── w:txbxContent (text content)
 *                   │       ├── w:p (paragraphs)
 *                   │       └── w:tbl (tables)
 *                   └── wps:bodyPr (body properties - margins, text direction, etc.)
 *
 * EMU (English Metric Units): 914400 EMU = 1 inch
 */

import type {
  TextBox,
  Paragraph,
  Table,
  ImageSize,
  ImagePosition,
  ImageWrap,
  Theme,
  RelationshipMap,
  MediaFile,
} from '../types/document';
import type { StyleMap } from './styleParser';
import type { NumberingMap } from './numberingParser';
import {
  getChildElements,
  getAttribute,
  parseNumericAttribute,
  findByFullName,
  findChildrenByLocalName,
  type XmlElement,
} from './xmlParser';
import {
  parseFill,
  parseOutline,
  parseAnchorPosition,
  parseAnchorWrap,
  resolveColorValueToHex,
} from './drawingUtils';
import { emuToPixels } from '../utils/units';

// Re-export emuToPixels for backwards compatibility
export { emuToPixels } from '../utils/units';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Default text box margins in EMUs (0.1 inch) */
const DEFAULT_MARGIN_EMU = 91440;

// ============================================================================
// BODY PROPERTIES PARSING
// ============================================================================

/**
 * Parse text body properties from wps:bodyPr
 * Returns margins/insets for the text box
 */
function parseBodyProperties(bodyPr: XmlElement | null): {
  margins?: TextBox['margins'];
} {
  if (!bodyPr) {
    return {};
  }

  const result: { margins?: TextBox['margins'] } = {};

  // Margins (insets) in EMUs
  const lIns = parseNumericAttribute(bodyPr, null, 'lIns');
  const rIns = parseNumericAttribute(bodyPr, null, 'rIns');
  const tIns = parseNumericAttribute(bodyPr, null, 'tIns');
  const bIns = parseNumericAttribute(bodyPr, null, 'bIns');

  if (lIns !== undefined || rIns !== undefined || tIns !== undefined || bIns !== undefined) {
    result.margins = {
      left: lIns,
      right: rIns,
      top: tIns,
      bottom: bIns,
    };
  }

  return result;
}

// ============================================================================
// CONTENT EXTRACTION
// ============================================================================

/**
 * Extract raw paragraph elements from w:txbxContent
 * Actual parsing happens via document parser to avoid circular dependencies
 */
export function extractTextBoxContentElements(txbxContent: XmlElement | null): {
  paragraphElements: XmlElement[];
  tableElements: XmlElement[];
} {
  if (!txbxContent) {
    return { paragraphElements: [], tableElements: [] };
  }

  const paragraphElements = findChildrenByLocalName(txbxContent, 'p');
  const tableElements = findChildrenByLocalName(txbxContent, 'tbl');

  return { paragraphElements, tableElements };
}

/**
 * Type for the paragraph parser function to avoid circular imports
 */
export type ParagraphParserFn = (
  node: XmlElement,
  styles: StyleMap | null,
  theme: Theme | null,
  numbering: NumberingMap | null,
  rels?: RelationshipMap | null
) => Paragraph;

/**
 * Type for the table parser function to avoid circular imports
 */
export type TableParserFn = (
  node: XmlElement,
  styles: StyleMap | null,
  theme: Theme | null,
  numbering: NumberingMap | null,
  rels?: RelationshipMap | null,
  media?: Map<string, MediaFile>
) => Table;

/**
 * Parse text box content with provided parser functions
 * This avoids circular dependencies by accepting parser functions as parameters
 */
export function parseTextBoxContent(
  txbxContent: XmlElement | null,
  parseParagraph: ParagraphParserFn,
  parseTable: TableParserFn | null,
  styles: StyleMap | null,
  theme: Theme | null,
  numbering: NumberingMap | null,
  rels?: RelationshipMap | null,
  _media?: Map<string, MediaFile>
): Paragraph[] {
  if (!txbxContent) {
    return [];
  }

  const paragraphs: Paragraph[] = [];
  const children = getChildElements(txbxContent);

  for (const child of children) {
    const name = child.name || '';
    const colonIdx = name.indexOf(':');
    const localName = colonIdx >= 0 ? name.substring(colonIdx + 1) : name;

    if (localName === 'p') {
      // Parse paragraph
      const paragraph = parseParagraph(child, styles, theme, numbering, rels);
      paragraphs.push(paragraph);
    } else if (localName === 'tbl' && parseTable) {
      // Tables in text boxes - we can't directly include them in paragraphs array
      // but we could store them separately. For now, skip (most text boxes don't have tables)
      // Future enhancement: support BlockContent[] instead of just Paragraph[]
    }
  }

  return paragraphs;
}

// ============================================================================
// TEXT BOX DETECTION
// ============================================================================

/**
 * Check if a drawing element contains a text box
 * Text boxes are shapes with wps:txbx content
 */
export function isTextBoxDrawing(drawingEl: XmlElement): boolean {
  const children = getChildElements(drawingEl);
  const container = children.find((el) => el.name === 'wp:inline' || el.name === 'wp:anchor');

  if (!container) return false;

  const graphic = findByFullName(container, 'a:graphic');
  if (!graphic) return false;

  const graphicData = findByFullName(graphic, 'a:graphicData');
  if (!graphicData) return false;

  // Check for wps:wsp (shape) with text box content
  const wsp = findByFullName(graphicData, 'wps:wsp');
  if (!wsp) return false;

  // Check for text box element
  const txbx = findByFullName(wsp, 'wps:txbx');
  return txbx !== null;
}

/**
 * Check if a wps:wsp element is a text box
 */
export function isShapeTextBox(wsp: XmlElement): boolean {
  const txbx = findByFullName(wsp, 'wps:txbx');
  return txbx !== null;
}

// ============================================================================
// MAIN PARSING FUNCTIONS
// ============================================================================

/**
 * Parse a text box from a w:drawing element
 *
 * This creates a TextBox object with placeholder content.
 * The actual content parsing requires paragraph/table parsers which
 * creates a circular dependency. The document parser should call
 * parseTextBoxContent() separately with the required parsers.
 *
 * @param drawingEl - The w:drawing XML element
 * @returns TextBox object with placeholder content, or null if not a text box
 */
export function parseTextBox(drawingEl: XmlElement): TextBox | null {
  const children = getChildElements(drawingEl);

  // Find wp:inline or wp:anchor
  const container = children.find((el) => el.name === 'wp:inline' || el.name === 'wp:anchor');

  if (!container) return null;

  const isAnchor = container.name === 'wp:anchor';

  // Navigate to graphic data
  const graphic = findByFullName(container, 'a:graphic');
  if (!graphic) return null;

  const graphicData = findByFullName(graphic, 'a:graphicData');
  if (!graphicData) return null;

  // Check for wps:wsp (shape)
  const wsp = findByFullName(graphicData, 'wps:wsp');
  if (!wsp) return null;

  // Check for text box
  const txbx = findByFullName(wsp, 'wps:txbx');
  if (!txbx) return null;

  const wspChildren = getChildElements(wsp);

  // Get shape properties
  const spPr = wspChildren.find((el) => el.name === 'wps:spPr');

  // Get body properties
  const bodyPr = wspChildren.find((el) => el.name === 'wps:bodyPr');

  // Parse size from extent
  const extent = findByFullName(container, 'wp:extent');
  const cx = parseNumericAttribute(extent, null, 'cx') ?? 0;
  const cy = parseNumericAttribute(extent, null, 'cy') ?? 0;
  const size: ImageSize = { width: cx, height: cy };

  // Get document properties
  const docPr = findByFullName(container, 'wp:docPr');
  const id = docPr ? (getAttribute(docPr, null, 'id') ?? undefined) : undefined;

  // Parse fill
  const fill = parseFill(spPr ?? null);

  // Parse outline
  const outline = parseOutline(spPr ?? null);

  // Parse body properties (margins)
  const bodyProps = parseBodyProperties(bodyPr ?? null);

  // Build text box object with placeholder content
  const textBox: TextBox = {
    type: 'textBox',
    size,
    content: [], // Placeholder - will be filled by document parser
  };

  // Add optional properties
  if (id) textBox.id = id;
  if (fill) textBox.fill = fill;
  if (outline) textBox.outline = outline;
  if (bodyProps.margins) textBox.margins = bodyProps.margins;

  // Parse position for anchored text boxes
  if (isAnchor) {
    const position = parseAnchorPosition(container);
    if (position) {
      textBox.position = position;
    }

    const wrap = parseAnchorWrap(container);
    if (wrap) {
      textBox.wrap = wrap;
    }
  }

  return textBox;
}

/**
 * Parse text box content XML element
 * @param wsp - The wps:wsp element containing the text box
 * @returns The w:txbxContent element or null
 */
export function getTextBoxContentElement(wsp: XmlElement): XmlElement | null {
  const txbx = findByFullName(wsp, 'wps:txbx');
  if (!txbx) return null;

  return findByFullName(txbx, 'w:txbxContent');
}

/**
 * Parse text box from a wps:wsp element directly
 * Useful when you already have the shape element
 */
export function parseTextBoxFromShape(
  wsp: XmlElement,
  size: ImageSize,
  position?: ImagePosition,
  wrap?: ImageWrap
): TextBox | null {
  const txbx = findByFullName(wsp, 'wps:txbx');
  if (!txbx) return null;

  const wspChildren = getChildElements(wsp);

  // Get shape properties
  const spPr = wspChildren.find((el) => el.name === 'wps:spPr');

  // Get body properties
  const bodyPr = wspChildren.find((el) => el.name === 'wps:bodyPr');

  // Get non-visual properties for ID
  const cNvPr = wspChildren.find((el) => el.name === 'wps:cNvPr');
  const id = cNvPr ? (getAttribute(cNvPr, null, 'id') ?? undefined) : undefined;

  // Parse fill
  const fill = parseFill(spPr ?? null);

  // Parse outline
  const outline = parseOutline(spPr ?? null);

  // Parse body properties (margins)
  const bodyProps = parseBodyProperties(bodyPr ?? null);

  // Build text box object
  const textBox: TextBox = {
    type: 'textBox',
    size,
    content: [], // Placeholder
  };

  if (id) textBox.id = id;
  if (fill) textBox.fill = fill;
  if (outline) textBox.outline = outline;
  if (bodyProps.margins) textBox.margins = bodyProps.margins;
  if (position) textBox.position = position;
  if (wrap) textBox.wrap = wrap;

  return textBox;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get text box width in pixels
 */
export function getTextBoxWidthPx(textBox: TextBox): number {
  return emuToPixels(textBox.size.width);
}

/**
 * Get text box height in pixels
 */
export function getTextBoxHeightPx(textBox: TextBox): number {
  return emuToPixels(textBox.size.height);
}

/**
 * Get text box dimensions in pixels
 */
export function getTextBoxDimensionsPx(textBox: TextBox): { width: number; height: number } {
  return {
    width: emuToPixels(textBox.size.width),
    height: emuToPixels(textBox.size.height),
  };
}

/**
 * Get text box margins in pixels
 */
export function getTextBoxMarginsPx(textBox: TextBox): {
  top: number;
  bottom: number;
  left: number;
  right: number;
} {
  const margins = textBox.margins;
  return {
    top: emuToPixels(margins?.top ?? DEFAULT_MARGIN_EMU),
    bottom: emuToPixels(margins?.bottom ?? DEFAULT_MARGIN_EMU),
    left: emuToPixels(margins?.left ?? DEFAULT_MARGIN_EMU),
    right: emuToPixels(margins?.right ?? DEFAULT_MARGIN_EMU),
  };
}

/**
 * Check if text box is floating (anchored)
 */
export function isFloatingTextBox(textBox: TextBox): boolean {
  return textBox.position !== undefined || textBox.wrap !== undefined;
}

/**
 * Check if text box has fill
 */
export function hasTextBoxFill(textBox: TextBox): boolean {
  return textBox.fill !== undefined && textBox.fill.type !== 'none';
}

/**
 * Check if text box has outline
 */
export function hasTextBoxOutline(textBox: TextBox): boolean {
  return textBox.outline !== undefined;
}

/**
 * Check if text box has content
 */
export function hasTextBoxContent(textBox: TextBox): boolean {
  return textBox.content.length > 0;
}

/**
 * Get plain text from text box (helper for search/indexing)
 */
export function getTextBoxText(textBox: TextBox): string {
  // This would require getParagraphText utility
  // For now, just join paragraph content
  const parts: string[] = [];

  for (const paragraph of textBox.content) {
    const runTexts: string[] = [];
    for (const item of paragraph.content) {
      if (item.type === 'run') {
        for (const content of item.content) {
          if (content.type === 'text') {
            runTexts.push(content.text);
          }
        }
      }
    }
    parts.push(runTexts.join(''));
  }

  return parts.join('\n');
}

/**
 * Resolve fill color to CSS color string
 */
export function resolveTextBoxFillColor(textBox: TextBox): string | undefined {
  if (!textBox.fill || textBox.fill.type !== 'solid') return undefined;
  return resolveColorValueToHex(textBox.fill.color);
}

/**
 * Resolve outline color to CSS color string
 */
export function resolveTextBoxOutlineColor(textBox: TextBox): string | undefined {
  if (!textBox.outline?.color) return undefined;
  return resolveColorValueToHex(textBox.outline.color);
}

/**
 * Get outline width in pixels
 */
export function getTextBoxOutlineWidthPx(textBox: TextBox): number {
  if (!textBox.outline?.width) return 0;
  return emuToPixels(textBox.outline.width);
}
