/**
 * Image Parser - Parse embedded images from w:drawing elements
 *
 * DOCX images are contained in <w:drawing> elements with either:
 * - wp:inline - Inline images that flow with text
 * - wp:anchor - Floating/anchored images with text wrapping
 *
 * OOXML Structure:
 * w:drawing
 *   ├── wp:inline or wp:anchor
 *   │   ├── wp:extent (size: cx, cy in EMUs)
 *   │   ├── wp:effectExtent (effect margins)
 *   │   ├── wp:docPr (document properties: id, name, descr, title)
 *   │   ├── wp:positionH / wp:positionV (for anchor only)
 *   │   ├── wp:wrap* (wrapping mode for anchor: wrapNone, wrapSquare, etc.)
 *   │   └── a:graphic
 *   │       └── a:graphicData
 *   │           └── pic:pic
 *   │               ├── pic:nvPicPr (non-visual properties)
 *   │               ├── pic:blipFill
 *   │               │   └── a:blip (r:embed = rId)
 *   │               └── pic:spPr
 *   │                   └── a:xfrm (transform: rotation, flip)
 *
 * EMU (English Metric Units): 914400 EMU = 1 inch
 * Conversion: pixels = (emu * 96) / 914400
 */

import type {
  Image,
  ImageSize,
  ImageWrap,
  ImagePosition,
  ImageTransform,
  ImagePadding,
  RelationshipMap,
  MediaFile,
} from '../types/document';
import {
  findChild,
  getChildElements,
  getAttribute,
  parseNumericAttribute,
  findByFullName,
  type XmlElement,
} from './xmlParser';
import { resolveTarget } from './relsParser';
import { isTextBoxDrawing } from './textBoxParser';
import { emuToPixels } from '../utils/units';
import {
  parsePositionH,
  parsePositionV,
  WRAP_ELEMENT_NAMES as WRAP_ELEMENTS,
  parseWrapElement,
} from './drawingUtils';

// Re-export for backwards compatibility
export { emuToPixels, pixelsToEmu } from '../utils/units';

// ============================================================================
// ROTATION CONVERSION
// ============================================================================

/**
 * Convert rotation value (1/60000 of a degree) to degrees
 *
 * @param rot - Rotation in 60000ths of a degree
 * @returns Rotation in degrees
 */
function rotToDegrees(rot: string | null | undefined): number | undefined {
  if (!rot) return undefined;
  const val = parseInt(rot, 10);
  if (isNaN(val)) return undefined;
  return val / 60000;
}

// ============================================================================
// ELEMENT FINDERS
// ============================================================================

/**
 * Find any of the specified elements
 */
function findAnyOf(parent: XmlElement, names: string[]): XmlElement | null {
  const children = getChildElements(parent);
  for (const child of children) {
    if (names.includes(child.name || '')) {
      return child;
    }
  }
  return null;
}

// ============================================================================
// SIZE PARSING
// ============================================================================

/**
 * Parse extent element for image size
 *
 * @param extent - wp:extent element
 * @returns ImageSize in EMUs
 */
function parseExtent(extent: XmlElement | null): ImageSize {
  if (!extent) {
    return { width: 0, height: 0 };
  }

  const cx = parseNumericAttribute(extent, null, 'cx') ?? 0;
  const cy = parseNumericAttribute(extent, null, 'cy') ?? 0;

  return { width: cx, height: cy };
}

/**
 * Parse effect extent for shadow/effect margins
 *
 * @param effectExtent - wp:effectExtent element
 * @returns Padding for effects
 */
function parseEffectExtent(effectExtent: XmlElement | null): ImagePadding | undefined {
  if (!effectExtent) return undefined;

  const l = parseNumericAttribute(effectExtent, null, 'l') ?? 0;
  const t = parseNumericAttribute(effectExtent, null, 't') ?? 0;
  const r = parseNumericAttribute(effectExtent, null, 'r') ?? 0;
  const b = parseNumericAttribute(effectExtent, null, 'b') ?? 0;

  if (l === 0 && t === 0 && r === 0 && b === 0) {
    return undefined;
  }

  return {
    left: l,
    top: t,
    right: r,
    bottom: b,
  };
}

// ============================================================================
// DOCUMENT PROPERTIES PARSING
// ============================================================================

/**
 * Parse document properties (wp:docPr)
 *
 * @param docPr - wp:docPr element
 * @returns Object with id, name, description, title
 */
function parseDocProps(docPr: XmlElement | null): {
  id?: string;
  name?: string;
  alt?: string;
  title?: string;
  decorative?: boolean;
  hlinkRId?: string;
} {
  if (!docPr) return {};

  const id = getAttribute(docPr, null, 'id') ?? undefined;
  const name = getAttribute(docPr, null, 'name') ?? undefined;
  const descr = getAttribute(docPr, null, 'descr') ?? undefined;
  const title = getAttribute(docPr, null, 'title') ?? undefined;

  // Check for decorative flag (accessibility)
  // In newer OOXML, this is indicated by a:decorative element or attribute
  const decorative = getAttribute(docPr, null, 'decorative') === '1';

  // Check for hyperlink (a:hlinkClick) — clickable image
  const hlinkClickEl = findChild(docPr, 'a', 'hlinkClick');
  const hlinkRId = hlinkClickEl ? (getAttribute(hlinkClickEl, 'r', 'id') ?? undefined) : undefined;

  return {
    id,
    name,
    alt: descr,
    title,
    decorative: decorative || undefined,
    hlinkRId,
  };
}

// ============================================================================
// TRANSFORM PARSING
// ============================================================================

/**
 * Parse transform properties from a:xfrm
 */
function parseTransform(xfrm: XmlElement | null): ImageTransform | undefined {
  if (!xfrm) return undefined;

  const rot = getAttribute(xfrm, null, 'rot');
  const flipH = getAttribute(xfrm, null, 'flipH') === '1';
  const flipV = getAttribute(xfrm, null, 'flipV') === '1';

  const rotation = rotToDegrees(rot);

  if (rotation === undefined && !flipH && !flipV) {
    return undefined;
  }

  const transform: ImageTransform = {};
  if (rotation !== undefined) transform.rotation = rotation;
  if (flipH) transform.flipH = true;
  if (flipV) transform.flipV = true;

  return transform;
}

// ============================================================================
// BLIP EXTRACTION (image relationship ID)
// ============================================================================

/**
 * Find the a:blip element and extract the relationship ID
 *
 * Path: a:graphic > a:graphicData > pic:pic > pic:blipFill > a:blip
 */
function findBlipElement(container: XmlElement): XmlElement | null {
  // Find a:graphic
  const graphic = findByFullName(container, 'a:graphic');
  if (!graphic) return null;

  // Find a:graphicData
  const graphicData = findByFullName(graphic, 'a:graphicData');
  if (!graphicData) return null;

  // Find pic:pic
  const pic = findByFullName(graphicData, 'pic:pic');
  if (!pic) return null;

  // Find pic:blipFill
  const blipFill = findByFullName(pic, 'pic:blipFill');
  if (!blipFill) return null;

  // Find a:blip
  const blip = findByFullName(blipFill, 'a:blip');
  return blip;
}

/**
 * Extract rId from a:blip element
 */
function extractBlipRId(blip: XmlElement | null): string {
  if (!blip) return '';

  // The rId is in r:embed attribute
  const rEmbed = getAttribute(blip, 'r', 'embed');
  if (rEmbed) return rEmbed;

  // Sometimes it's just "embed" without namespace
  const embed = getAttribute(blip, null, 'embed');
  if (embed) return embed;

  // Check r:link for linked (not embedded) images
  const rLink = getAttribute(blip, 'r', 'link');
  if (rLink) return rLink;

  return '';
}

/**
 * Find transform (a:xfrm) from picture shape properties
 *
 * Path: a:graphic > a:graphicData > pic:pic > pic:spPr > a:xfrm
 */
function findPictureTransform(container: XmlElement): XmlElement | null {
  const graphic = findByFullName(container, 'a:graphic');
  if (!graphic) return null;

  const graphicData = findByFullName(graphic, 'a:graphicData');
  if (!graphicData) return null;

  const pic = findByFullName(graphicData, 'pic:pic');
  if (!pic) return null;

  const spPr = findByFullName(pic, 'pic:spPr');
  if (!spPr) return null;

  const xfrm = findByFullName(spPr, 'a:xfrm');
  return xfrm;
}

// ============================================================================
// MEDIA RESOLUTION
// ============================================================================

/**
 * Normalize a target path to the standard word/media/... format
 */
function normalizeMediaPath(targetPath: string): string {
  if (!targetPath) return targetPath;

  // Remove leading slashes
  let normalized = targetPath.replace(/^\/+/, '');

  // Ensure word/ prefix for media files
  if (normalized.startsWith('media/')) {
    normalized = `word/${normalized}`;
  } else if (!normalized.startsWith('word/')) {
    normalized = `word/${normalized}`;
  }

  return normalized;
}

/**
 * Get MIME type from file extension
 */
function getMimeType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';

  const mimeTypes: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    bmp: 'image/bmp',
    tiff: 'image/tiff',
    tif: 'image/tiff',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    emf: 'image/x-emf',
    wmf: 'image/x-wmf',
  };

  return mimeTypes[ext] ?? 'application/octet-stream';
}

/**
 * Resolve image data from relationships and media map
 *
 * @param rId - Relationship ID (e.g., "rId1")
 * @param rels - Relationship map
 * @param media - Media files map
 * @returns Object with src (data URL or blob), mimeType, and filename
 */
function resolveImageData(
  rId: string,
  rels: RelationshipMap | undefined,
  media: Map<string, MediaFile> | undefined
): { src?: string; mimeType?: string; filename?: string } {
  if (!rId || !rels) {
    return {};
  }

  const rel = rels.get(rId);
  if (!rel) {
    return {};
  }

  // Get the target path
  const targetPath = rel.target;
  if (!targetPath) {
    return {};
  }

  // Normalize the path
  const normalizedPath = normalizeMediaPath(targetPath);
  const filename = targetPath.split('/').pop();

  // Case-insensitive lookup helper for media map
  const findMediaCaseInsensitive = (
    map: Map<string, MediaFile>,
    searchPath: string
  ): MediaFile | undefined => {
    const lowerPath = searchPath.toLowerCase();
    for (const [key, value] of map.entries()) {
      if (key.toLowerCase() === lowerPath) {
        return value;
      }
    }
    return undefined;
  };

  // Try to find the media file (case-insensitive)
  if (media) {
    // Try normalized path first
    const mediaFile = findMediaCaseInsensitive(media, normalizedPath);
    if (mediaFile) {
      return {
        src: mediaFile.dataUrl || mediaFile.base64, // Use data URL or base64
        mimeType: mediaFile.mimeType,
        filename,
      };
    }

    // Try without word/ prefix
    const altPath = targetPath.replace(/^\/+/, '');
    const altMediaFile = findMediaCaseInsensitive(media, altPath);
    if (altMediaFile) {
      return {
        src: altMediaFile.dataUrl || altMediaFile.base64,
        mimeType: altMediaFile.mimeType,
        filename,
      };
    }

    // Try with word/ prefix added
    const withWordPrefix = `word/${altPath}`;
    const prefixedMediaFile = findMediaCaseInsensitive(media, withWordPrefix);
    if (prefixedMediaFile) {
      return {
        src: prefixedMediaFile.dataUrl || prefixedMediaFile.base64,
        mimeType: prefixedMediaFile.mimeType,
        filename,
      };
    }
  }

  // Return at least the MIME type based on extension
  return {
    mimeType: getMimeType(targetPath),
    filename,
  };
}

// ============================================================================
// MAIN PARSING FUNCTIONS
// ============================================================================

/**
 * Parse a wp:inline element (inline image)
 *
 * @param inlineEl - The wp:inline element
 * @param rels - Relationship map for resolving rId
 * @param media - Media files map
 * @returns Parsed Image object
 */
function parseInline(
  inlineEl: XmlElement,
  rels: RelationshipMap | undefined,
  media: Map<string, MediaFile> | undefined
): Image {
  // Parse extent (size)
  const extent = findByFullName(inlineEl, 'wp:extent');
  const size = parseExtent(extent);

  // Parse effect extent
  const effectExtent = findByFullName(inlineEl, 'wp:effectExtent');
  const padding = parseEffectExtent(effectExtent);

  // Parse document properties
  const docPr = findByFullName(inlineEl, 'wp:docPr');
  const props = parseDocProps(docPr);

  // Find blip and extract rId
  const blip = findBlipElement(inlineEl);
  const rId = extractBlipRId(blip);

  // Resolve image data
  const imageData = resolveImageData(rId, rels, media);

  // Find transform
  const xfrm = findPictureTransform(inlineEl);
  const transform = parseTransform(xfrm);

  // Read distance attributes from wp:inline (OOXML spec: distT, distB, distL, distR)
  const distT = parseNumericAttribute(inlineEl, null, 'distT') ?? undefined;
  const distB = parseNumericAttribute(inlineEl, null, 'distB') ?? undefined;
  const distL = parseNumericAttribute(inlineEl, null, 'distL') ?? undefined;
  const distR = parseNumericAttribute(inlineEl, null, 'distR') ?? undefined;

  const wrap: ImageWrap = { type: 'inline' };
  if (distT !== undefined) wrap.distT = distT;
  if (distB !== undefined) wrap.distB = distB;
  if (distL !== undefined) wrap.distL = distL;
  if (distR !== undefined) wrap.distR = distR;

  const image: Image = {
    type: 'image',
    rId,
    size,
    wrap,
  };

  // Add optional properties
  if (props.id) image.id = props.id;
  if (props.alt) image.alt = props.alt;
  if (props.title) image.title = props.title;
  if (props.decorative) image.decorative = true;
  if (imageData.src) image.src = imageData.src;
  if (imageData.mimeType) image.mimeType = imageData.mimeType;
  if (imageData.filename) image.filename = imageData.filename;
  if (padding) image.padding = padding;
  if (transform) image.transform = transform;

  // Resolve image hyperlink (a:hlinkClick)
  if (props.hlinkRId && rels) {
    const href = resolveTarget(rels, props.hlinkRId);
    if (href) image.hlinkHref = href;
  }

  return image;
}

/**
 * Parse a wp:anchor element (floating/anchored image)
 *
 * @param anchorEl - The wp:anchor element
 * @param rels - Relationship map for resolving rId
 * @param media - Media files map
 * @returns Parsed Image object
 */
function parseAnchor(
  anchorEl: XmlElement,
  rels: RelationshipMap | undefined,
  media: Map<string, MediaFile> | undefined
): Image {
  // Parse extent (size)
  const extent = findByFullName(anchorEl, 'wp:extent');
  const size = parseExtent(extent);

  // Parse effect extent
  const effectExtent = findByFullName(anchorEl, 'wp:effectExtent');
  const padding = parseEffectExtent(effectExtent);

  // Parse document properties
  const docPr = findByFullName(anchorEl, 'wp:docPr');
  const props = parseDocProps(docPr);

  // Check behindDoc attribute
  const behindDoc = getAttribute(anchorEl, null, 'behindDoc') === '1';

  // Read distance attributes from the wp:anchor element itself (fallback values)
  const anchorDistances = {
    distT: parseNumericAttribute(anchorEl, null, 'distT') ?? undefined,
    distB: parseNumericAttribute(anchorEl, null, 'distB') ?? undefined,
    distL: parseNumericAttribute(anchorEl, null, 'distL') ?? undefined,
    distR: parseNumericAttribute(anchorEl, null, 'distR') ?? undefined,
  };

  // Parse wrap element (wrap child values take priority over anchor-level values)
  const wrapEl = findAnyOf(anchorEl, WRAP_ELEMENTS);
  const wrap = parseWrapElement(wrapEl, behindDoc, anchorDistances);

  // Parse position
  const posH = findByFullName(anchorEl, 'wp:positionH');
  const posV = findByFullName(anchorEl, 'wp:positionV');
  const horizontal = parsePositionH(posH);
  const vertical = parsePositionV(posV);

  let position: ImagePosition | undefined;
  if (horizontal || vertical) {
    position = {
      horizontal: horizontal ?? { relativeTo: 'column' },
      vertical: vertical ?? { relativeTo: 'paragraph' },
    };
  }

  // Find blip and extract rId
  const blip = findBlipElement(anchorEl);
  const rId = extractBlipRId(blip);

  // Resolve image data
  const imageData = resolveImageData(rId, rels, media);

  // Find transform
  const xfrm = findPictureTransform(anchorEl);
  const transform = parseTransform(xfrm);

  const image: Image = {
    type: 'image',
    rId,
    size,
    wrap,
  };

  // Add optional properties
  if (props.id) image.id = props.id;
  if (props.alt) image.alt = props.alt;
  if (props.title) image.title = props.title;
  if (props.decorative) image.decorative = true;
  if (imageData.src) image.src = imageData.src;
  if (imageData.mimeType) image.mimeType = imageData.mimeType;
  if (imageData.filename) image.filename = imageData.filename;
  if (position) image.position = position;
  if (padding) image.padding = padding;
  if (transform) image.transform = transform;

  // Resolve image hyperlink (a:hlinkClick)
  if (props.hlinkRId && rels) {
    const href = resolveTarget(rels, props.hlinkRId);
    if (href) image.hlinkHref = href;
  }

  return image;
}

/**
 * Parse a w:drawing element
 *
 * The drawing element contains either wp:inline or wp:anchor.
 *
 * @param drawingEl - The w:drawing element
 * @param rels - Relationship map for resolving rId
 * @param media - Media files map
 * @returns Parsed Image object or null if not an image
 */
export function parseDrawing(
  drawingEl: XmlElement,
  rels: RelationshipMap | undefined,
  media: Map<string, MediaFile> | undefined
): Image | null {
  // Skip text box shapes — they are handled by textBoxParser, not as images
  if (isTextBoxDrawing(drawingEl)) return null;

  const children = getChildElements(drawingEl);

  for (const child of children) {
    const name = child.name || '';

    if (name === 'wp:inline' || name === 'wp:anchor') {
      return name === 'wp:inline'
        ? parseInline(child, rels, media)
        : parseAnchor(child, rels, media);
    }
  }

  return null;
}

/**
 * Parse an image from a w:drawing element
 *
 * This is the main entry point for image parsing.
 *
 * @param node - The w:drawing XML element
 * @param rels - Relationship map for resolving rId
 * @param media - Media files map
 * @returns Parsed Image object or null if parsing fails
 */
export function parseImage(
  node: XmlElement,
  rels: RelationshipMap | undefined,
  media: Map<string, MediaFile> | undefined
): Image | null {
  return parseDrawing(node, rels, media);
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Check if an image is inline (not floating)
 */
export function isInlineImage(image: Image): boolean {
  return image.wrap.type === 'inline';
}

/**
 * Check if an image is floating (anchored)
 */
export function isFloatingImage(image: Image): boolean {
  return image.wrap.type !== 'inline';
}

/**
 * Check if an image is behind text
 */
export function isBehindText(image: Image): boolean {
  return image.wrap.type === 'behind';
}

/**
 * Check if an image is in front of text
 */
export function isInFrontOfText(image: Image): boolean {
  return image.wrap.type === 'inFront';
}

/**
 * Get image width in pixels
 */
export function getImageWidthPx(image: Image): number {
  return emuToPixels(image.size.width);
}

/**
 * Get image height in pixels
 */
export function getImageHeightPx(image: Image): number {
  return emuToPixels(image.size.height);
}

/**
 * Get image dimensions in pixels
 */
export function getImageDimensionsPx(image: Image): { width: number; height: number } {
  return {
    width: emuToPixels(image.size.width),
    height: emuToPixels(image.size.height),
  };
}

/**
 * Check if image has alt text (for accessibility)
 */
export function hasAltText(image: Image): boolean {
  return !!image.alt && image.alt.trim().length > 0;
}

/**
 * Check if image is decorative (should be ignored by screen readers)
 */
export function isDecorativeImage(image: Image): boolean {
  return image.decorative === true;
}

/**
 * Get wrap distances in pixels
 */
export function getWrapDistancesPx(image: Image): {
  top: number;
  bottom: number;
  left: number;
  right: number;
} {
  return {
    top: emuToPixels(image.wrap.distT),
    bottom: emuToPixels(image.wrap.distB),
    left: emuToPixels(image.wrap.distL),
    right: emuToPixels(image.wrap.distR),
  };
}

/**
 * Check if image needs text wrapping
 */
export function needsTextWrapping(image: Image): boolean {
  const wrapTypes = ['square', 'tight', 'through', 'topAndBottom'];
  return wrapTypes.includes(image.wrap.type);
}
