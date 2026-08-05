// Embedded image resource validation and cache (typed-drawings-and-images task 4).
//
// Content type is a claim; signature sniffing, structural header validation, and
// the decode port are authoritative. Validated bytes never enter public state.

import { sha256FontBytes } from '../../layout/font-resource.ts';
import {
  createValidatedImageBytesRegistry,
  type ValidatedImageBytesHandle,
} from './validated-image-bytes.ts';
import { resolveContentType } from './content-types.ts';
import {
  IMAGE_RELATIONSHIP_TYPE,
  resolveImageRelationship,
  type ImageRelationshipResolution,
  type RelationshipRecord,
} from './relationships.ts';
import { projectDrawingsInPackage, type DrawingProjection } from './drawing-projection.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import {
  IMAGE_RESOURCE_HARD_CEILINGS,
  resolveImageResourceLimits,
  type ImageResourceLimits,
} from '../runtime/limits.ts';

export type SupportedImageMime = 'image/png' | 'image/jpeg' | 'image/gif';
export type PreservedImageMime = 'image/svg+xml' | 'image/tiff' | 'image/x-emf' | 'image/x-wmf';
/** What a `ready` resource can carry: decoded rasters, or host-converted metafile SVG. */
export type RenderableImageMime = SupportedImageMime | 'image/svg+xml';
export type MetafileImageMime = 'image/x-emf' | 'image/x-wmf';

export type { ImageResourceLimits };

export type {
  ValidatedImageBytesHandle,
  ValidatedImageBytesRegistry,
} from './validated-image-bytes.ts';

export type ImageResourceState =
  | {
      readonly kind: 'ready';
      readonly partName: string;
      readonly contentId: string;
      readonly resourceKey: string;
      readonly validatedHandle: ValidatedImageBytesHandle;
      readonly mime: RenderableImageMime;
      readonly pixelWidth: number;
      readonly pixelHeight: number;
      readonly dpiX: number;
      readonly dpiY: number;
    }
  | {
      readonly kind: 'unrenderable';
      readonly partName: string | null;
      readonly mime: SupportedImageMime | PreservedImageMime | 'unknown';
      readonly reason:
        | 'unsupported-format'
        | 'non-picture-graphic'
        | 'signature-mismatch'
        | 'decode-failed'
        | 'resource-limit';
    }
  | {
      readonly kind: 'external';
      readonly relationshipId: string;
      readonly sinkSafe: boolean;
    }
  | { readonly kind: 'missing'; readonly relationshipId: string }
  | { readonly kind: 'pending'; readonly resourceKey: string };

export interface ImageDecodePort {
  decode(
    bytes: Uint8Array,
    mime: SupportedImageMime,
    limits: ImageResourceLimits
  ): Promise<Readonly<{ pixelWidth: number; pixelHeight: number; dpiX: number; dpiY: number }>>;
  /**
   * Optional metafile (EMF/WMF) → SVG conversion. The returned SVG is validated at this
   * trust boundary (bounded `<svg` root, encoded-size and pixel caps) and only ever
   * reaches the DOM through a blob-URL `<img>`, where scripts and external loads are
   * inert. Absent (or throwing), the metafile keeps its labelled placeholder.
   */
  convertMetafile?(
    bytes: Uint8Array,
    mime: MetafileImageMime,
    limits: ImageResourceLimits
  ): Promise<Readonly<{ svgBytes: Uint8Array; pixelWidth: number; pixelHeight: number }> | null>;
}

export interface ImageResourceLookup {
  readonly resolveEmbedded: (
    ownerPartName: string,
    relationshipId: string
  ) => Promise<ImageResourceState>;
  readonly resolveLinked: (ownerPartName: string, relationshipId: string) => ImageResourceState;
  readonly resolveForProjection: (projection: DrawingProjection) => Promise<ImageResourceState>;
  readonly liveReferenceCount: (partName: string) => number;
  readonly dispose: () => void;
}

const PNG_SIGNATURE = Object.freeze([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const DEFAULT_DPI = 96;
const MAX_JPEG_MARKER_SCAN = 65_536;
/** Maximum prefix inspected for SVG root detection (exported for bounded-scan tests). */
export const MAX_SVG_SNIFF_BYTES = 512;

const CONTENT_TYPE_TO_MIME: Readonly<Record<string, SupportedImageMime | PreservedImageMime>> =
  Object.freeze({
    'image/png': 'image/png',
    'image/jpeg': 'image/jpeg',
    'image/jpg': 'image/jpeg',
    'image/gif': 'image/gif',
    'image/svg+xml': 'image/svg+xml',
    'image/tiff': 'image/tiff',
    'image/x-emf': 'image/x-emf',
    'image/x-wmf': 'image/x-wmf',
  });

export interface ValidatedRasterHeader {
  readonly pixelWidth: number;
  readonly pixelHeight: number;
}

function bytesStartWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) return false;
  for (let index = 0; index < prefix.length; index += 1) {
    if (bytes[index] !== prefix[index]) return false;
  }
  return true;
}

function isWhitespaceByte(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

/** Bounded scan for an `<svg` document root (optional `<?xml` prolog only). */
export function hasBoundedSvgRoot(bytes: Uint8Array): boolean {
  const prefix = bytes.subarray(0, Math.min(bytes.length, MAX_SVG_SNIFF_BYTES));
  let index = 0;
  while (index < prefix.length && isWhitespaceByte(prefix[index]!)) index += 1;
  if (index + 5 < prefix.length && prefix[index] === 0x3c && prefix[index + 1] === 0x3f) {
    let close = -1;
    for (let scan = index + 2; scan + 1 < prefix.length; scan += 1) {
      if (prefix[scan] === 0x3f && prefix[scan + 1] === 0x3e) {
        close = scan;
        break;
      }
    }
    if (close === -1) return false;
    index = close + 2;
    while (index < prefix.length && isWhitespaceByte(prefix[index]!)) index += 1;
  }
  return (
    index + 4 <= prefix.length &&
    prefix[index] === 0x3c &&
    prefix[index + 1] === 0x73 &&
    prefix[index + 2] === 0x76 &&
    prefix[index + 3] === 0x67 &&
    (index + 4 === prefix.length ||
      prefix[index + 4] === 0x20 ||
      prefix[index + 4] === 0x09 ||
      prefix[index + 4] === 0x0a ||
      prefix[index + 4] === 0x0d ||
      prefix[index + 4] === 0x3e)
  );
}

function isRasterSupportedMime(mime: string): mime is SupportedImageMime {
  return mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/gif';
}

function isPreservedMime(mime: string): mime is PreservedImageMime {
  return (
    mime === 'image/svg+xml' ||
    mime === 'image/tiff' ||
    mime === 'image/x-emf' ||
    mime === 'image/x-wmf'
  );
}

/** Signature sniffing — authoritative over declared content type. */
export function sniffImageMime(
  bytes: Uint8Array
): SupportedImageMime | PreservedImageMime | 'unknown' {
  if (bytesStartWith(bytes, PNG_SIGNATURE)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return 'image/gif';
  }
  if (hasBoundedSvgRoot(bytes)) return 'image/svg+xml';
  if (bytes.length >= 4) {
    if (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) {
      return 'image/tiff';
    }
    if (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a) {
      return 'image/tiff';
    }
  }
  if (
    bytes.length >= 44 &&
    bytes[0] === 0x01 &&
    bytes[1] === 0x00 &&
    bytes[2] === 0x00 &&
    bytes[3] === 0x00
  ) {
    return 'image/x-emf';
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0xd7 &&
    bytes[1] === 0xcd &&
    bytes[2] === 0xc6 &&
    bytes[3] === 0x9a
  ) {
    return 'image/x-wmf';
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x01 &&
    bytes[1] === 0x00 &&
    bytes[2] === 0x09 &&
    bytes[3] === 0x00
  ) {
    return 'image/x-wmf';
  }
  return 'unknown';
}

function isValidPngColorTypeAndBitDepth(colorType: number, bitDepth: number): boolean {
  switch (colorType) {
    case 0:
      return (
        bitDepth === 1 || bitDepth === 2 || bitDepth === 4 || bitDepth === 8 || bitDepth === 16
      );
    case 2:
      return bitDepth === 8 || bitDepth === 16;
    case 3:
      return bitDepth === 1 || bitDepth === 2 || bitDepth === 4 || bitDepth === 8;
    case 4:
      return bitDepth === 8 || bitDepth === 16;
    case 6:
      return bitDepth === 8 || bitDepth === 16;
    default:
      return false;
  }
}

/** Structural PNG IHDR validation before decode. */
export function validatePngHeader(bytes: Uint8Array): ValidatedRasterHeader | null {
  if (!bytesStartWith(bytes, PNG_SIGNATURE)) return null;
  if (bytes.length < 33) return null;
  const chunkLength =
    ((bytes[8]! << 24) >>> 0) | (bytes[9]! << 16) | (bytes[10]! << 8) | bytes[11]!;
  if (chunkLength !== 13) return null;
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) {
    return null;
  }
  const pixelWidth =
    ((bytes[16]! << 24) >>> 0) | (bytes[17]! << 16) | (bytes[18]! << 8) | bytes[19]!;
  const pixelHeight =
    ((bytes[20]! << 24) >>> 0) | (bytes[21]! << 16) | (bytes[22]! << 8) | bytes[23]!;
  if (pixelWidth === 0 || pixelHeight === 0) return null;
  const bitDepth = bytes[24]!;
  const colorType = bytes[25]!;
  const compression = bytes[26]!;
  const filter = bytes[27]!;
  const interlace = bytes[28]!;
  if (!isValidPngColorTypeAndBitDepth(colorType, bitDepth)) return null;
  if (compression !== 0 || filter !== 0) return null;
  if (interlace !== 0 && interlace !== 1) return null;
  return { pixelWidth, pixelHeight };
}

/** Structural GIF logical screen descriptor validation before decode. */
export function validateGifHeader(bytes: Uint8Array): ValidatedRasterHeader | null {
  if (bytes.length < 10) return null;
  if (
    bytes[0] !== 0x47 ||
    bytes[1] !== 0x49 ||
    bytes[2] !== 0x46 ||
    bytes[3] !== 0x38 ||
    (bytes[4] !== 0x37 && bytes[4] !== 0x39) ||
    bytes[5] !== 0x61
  ) {
    return null;
  }
  const pixelWidth = bytes[6]! | (bytes[7]! << 8);
  const pixelHeight = bytes[8]! | (bytes[9]! << 8);
  if (pixelWidth === 0 || pixelHeight === 0) return null;
  return { pixelWidth, pixelHeight };
}

function isJpegSofMarker(marker: number): boolean {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}

/** Bounded JPEG marker scan through the first supported SOF marker. */
export function validateJpegHeader(bytes: Uint8Array): ValidatedRasterHeader | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  const scanLimit = Math.min(bytes.length, MAX_JPEG_MARKER_SCAN);
  while (offset + 1 < scanLimit) {
    if (bytes[offset] !== 0xff) return null;
    let marker = bytes[offset + 1]!;
    offset += 2;
    while (marker === 0xff && offset < scanLimit) {
      marker = bytes[offset]!;
      offset += 1;
    }
    if (marker === 0xd8) continue;
    if (marker === 0xd9) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 1 >= scanLimit) return null;
    const segmentLength = (bytes[offset]! << 8) | bytes[offset + 1]!;
    if (segmentLength < 2) return null;
    const segmentEnd = offset + segmentLength;
    if (segmentEnd > scanLimit) return null;
    if (isJpegSofMarker(marker)) {
      if (segmentLength < 7 || offset + 6 >= scanLimit) return null;
      const pixelHeight = (bytes[offset + 3]! << 8) | bytes[offset + 4]!;
      const pixelWidth = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
      if (pixelWidth === 0 || pixelHeight === 0) return null;
      return { pixelWidth, pixelHeight };
    }
    offset = segmentEnd;
  }
  return null;
}

export function validateRasterHeader(
  bytes: Uint8Array,
  mime: SupportedImageMime
): ValidatedRasterHeader | null {
  switch (mime) {
    case 'image/png':
      return validatePngHeader(bytes);
    case 'image/gif':
      return validateGifHeader(bytes);
    case 'image/jpeg':
      return validateJpegHeader(bytes);
    default:
      return null;
  }
}

function claimedMimeForPart(
  pkg: OoxmlPackage,
  partName: string
): SupportedImageMime | PreservedImageMime | 'unknown' {
  const resolved = resolveContentType(pkg.contentTypes, partName);
  if (!resolved.ok) return 'unknown';
  return CONTENT_TYPE_TO_MIME[resolved.contentType.toLowerCase()] ?? 'unknown';
}

function snapshotBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

function contentIdOf(bytes: Uint8Array): string {
  return sha256FontBytes(bytes);
}

function resourceKeyOf(ownerPartName: string, partName: string, contentId: string): string {
  return `${ownerPartName}\0${partName}\0${contentId}`;
}

function freezeState(state: ImageResourceState): ImageResourceState {
  return Object.freeze(state) as ImageResourceState;
}

function unrenderable(
  partName: string | null,
  mime: SupportedImageMime | PreservedImageMime | 'unknown',
  reason: Extract<ImageResourceState, { kind: 'unrenderable' }>['reason']
): ImageResourceState {
  return freezeState({ kind: 'unrenderable', partName, mime, reason });
}

function checkedPixelCount(
  width: number,
  height: number,
  limits: ImageResourceLimits
): number | null {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  if (width > limits.maxDimension || height > limits.maxDimension) return null;
  if (width > Number.MAX_SAFE_INTEGER / height) return null;
  const pixels = width * height;
  if (pixels > limits.maxPixels) return null;
  return pixels;
}

function checkedDecodedRgbaBytes(pixelCount: number, limits: ImageResourceLimits): boolean {
  if (pixelCount > Number.MAX_SAFE_INTEGER / 4) return false;
  return pixelCount * 4 <= limits.maxDecodedBytes;
}

function mimeClassesMismatch(
  claimed: SupportedImageMime | PreservedImageMime | 'unknown',
  sniffed: SupportedImageMime | PreservedImageMime | 'unknown'
): boolean {
  if (claimed === 'unknown' || sniffed === 'unknown') return false;
  const claimedRaster = isRasterSupportedMime(claimed);
  const sniffedRaster = isRasterSupportedMime(sniffed);
  const claimedPreserved = isPreservedMime(claimed);
  const sniffedPreserved = isPreservedMime(sniffed);
  if (claimedRaster && sniffedPreserved) return true;
  if (claimedPreserved && sniffedRaster) return true;
  if (claimedRaster && sniffedRaster && claimed !== sniffed) return true;
  if (claimedPreserved && sniffedPreserved && claimed !== sniffed) return true;
  return false;
}

function relationshipFingerprint(
  ownerPartName: string,
  relationshipId: string,
  resolved: ImageRelationshipResolution
): string {
  if (resolved.mode === 'internal') {
    return `${ownerPartName}\0${relationshipId}\0internal\0${resolved.partName}\0${resolved.raw}`;
  }
  if (resolved.mode === 'external') {
    return `${ownerPartName}\0${relationshipId}\0external\0${resolved.raw}\0${resolved.sinkSafe ? '1' : '0'}`;
  }
  return `${ownerPartName}\0${relationshipId}\0missing`;
}

function relationshipsFor(pkg: OoxmlPackage, ownerPartName: string): readonly RelationshipRecord[] {
  return pkg.relationships.get(ownerPartName) ?? [];
}

function resolveEmbeddedPartName(
  pkg: OoxmlPackage,
  ownerPartName: string,
  relationshipId: string
): ImageRelationshipResolution {
  return resolveImageRelationship(
    relationshipsFor(pkg, ownerPartName),
    ownerPartName,
    relationshipId
  );
}

interface CachedLookupEntry {
  readonly relationshipFingerprint: string;
  readonly contentId: string;
  readonly state: ImageResourceState;
}

/** Package-wide live drawing references to a media part name. */
export function liveDrawingReferenceCount(pkg: OoxmlPackage, partName: string): number {
  let count = 0;
  for (const projection of projectDrawingsInPackage(pkg)) {
    const embedId = projection.picture?.embeddedRelationshipId;
    if (!embedId) continue;
    const resolved = resolveEmbeddedPartName(pkg, projection.ownerPartName, embedId);
    if (resolved.mode === 'internal' && resolved.partName === partName) count += 1;
  }
  return count;
}

export interface CreateImageResourceCacheOptions {
  readonly limits?: Partial<ImageResourceLimits>;
  readonly decodePort: ImageDecodePort;
}

interface ImageResourceRegistrySlot {
  readonly lookup: ImageResourceLookup;
}

const IMAGE_LIMIT_IDENTITY_KEYS = Object.keys(
  IMAGE_RESOURCE_HARD_CEILINGS
) as (keyof ImageResourceLimits)[];

function limitsIdentityKey(limits: ImageResourceLimits): string {
  return IMAGE_LIMIT_IDENTITY_KEYS.map((key) => `${key}=${limits[key]}`).join('\0');
}

/** pkg → decodePort → normalized limits → lookup (no strong pkg retention beyond WeakMap keys). */
const imageResourceRegistry = new WeakMap<
  OoxmlPackage,
  WeakMap<ImageDecodePort, Map<string, ImageResourceRegistrySlot>>
>();

function registrySlotFor(
  pkg: OoxmlPackage,
  decodePort: ImageDecodePort,
  limits: ImageResourceLimits
): ImageResourceRegistrySlot {
  let byDecodePort = imageResourceRegistry.get(pkg);
  if (!byDecodePort) {
    byDecodePort = new WeakMap();
    imageResourceRegistry.set(pkg, byDecodePort);
  }
  let byLimits = byDecodePort.get(decodePort);
  if (!byLimits) {
    byLimits = new Map();
    byDecodePort.set(decodePort, byLimits);
  }
  const limitsKey = limitsIdentityKey(limits);
  const existing = byLimits.get(limitsKey);
  if (existing) return existing;

  const lookup = createImageResourceCacheInternal(pkg, decodePort, limits);
  const slot = { lookup };
  byLimits.set(limitsKey, slot);
  return slot;
}

function unregisterLookupIfCurrent(
  pkg: OoxmlPackage,
  decodePort: ImageDecodePort,
  limits: ImageResourceLimits,
  lookup: ImageResourceLookup
): void {
  const byDecodePort = imageResourceRegistry.get(pkg);
  if (!byDecodePort) return;
  const byLimits = byDecodePort.get(decodePort);
  if (!byLimits) return;
  const limitsKey = limitsIdentityKey(limits);
  const slot = byLimits.get(limitsKey);
  if (!slot || slot.lookup !== lookup) return;
  byLimits.delete(limitsKey);
  if (byLimits.size === 0) {
    byDecodePort.delete(decodePort);
  }
}

/**
 * Derived cache for one immutable package snapshot. Registry identity is
 * `(package snapshot, decodePort object, normalized limits)` — the first caller
 * never imposes its decoder or limits on later callers with different options.
 */
export function imageResourceLookupFor(
  pkg: OoxmlPackage,
  options: CreateImageResourceCacheOptions
): ImageResourceLookup {
  const limits = resolveImageResourceLimits(options.limits);
  return registrySlotFor(pkg, options.decodePort, limits).lookup;
}

/** @deprecated Prefer {@link imageResourceLookupFor} — registry binds cache to package identity. */
export function createImageResourceCache(
  initialPkg: OoxmlPackage,
  options: CreateImageResourceCacheOptions
): ImageResourceLookup {
  return imageResourceLookupFor(initialPkg, options);
}

function createImageResourceCacheInternal(
  initialPkg: OoxmlPackage,
  decodePort: ImageDecodePort,
  limits: ImageResourceLimits
): ImageResourceLookup {
  const pkg = initialPkg;
  let generation = 0;
  let disposed = false;
  const validatedBytesRegistry = createValidatedImageBytesRegistry();
  const byRelationship = new Map<string, CachedLookupEntry>();
  const inFlightByContent = new Map<string, Promise<ImageResourceState>>();

  const ensureActive = (): void => {
    if (disposed) throw new Error('ImageResourceLookup disposed');
  };

  const lookupKey = (ownerPartName: string, relationshipId: string): string =>
    `${ownerPartName}\0${relationshipId}`;

  const contentFlightKey = (ownerPartName: string, partName: string, contentId: string): string =>
    `${ownerPartName}\0${partName}\0${contentId}`;

  const invalidateAll = (): void => {
    generation += 1;
    byRelationship.clear();
    inFlightByContent.clear();
  };

  const currentRelationshipEntry = (
    ownerPartName: string,
    relationshipId: string
  ): CachedLookupEntry | null => {
    const resolved = resolveEmbeddedPartName(pkg, ownerPartName, relationshipId);
    const fingerprint = relationshipFingerprint(ownerPartName, relationshipId, resolved);
    const cached = byRelationship.get(lookupKey(ownerPartName, relationshipId));
    if (!cached || cached.relationshipFingerprint !== fingerprint) return null;
    if (resolved.mode === 'internal') {
      const live = pkg.partBytes.get(resolved.partName);
      if (!live) return null;
      if (contentIdOf(live) !== cached.contentId) return null;
    }
    return cached;
  };

  const validateAndDecodeEmbedded = async (
    ownerPartName: string,
    resolvedPartName: string,
    snapshotted: Uint8Array,
    startGeneration: number
  ): Promise<ImageResourceState> => {
    if (startGeneration !== generation || disposed) {
      throw new Error('ImageResourceLookup stale');
    }

    if (snapshotted.length > limits.maxEncodedBytes) {
      return unrenderable(
        resolvedPartName,
        claimedMimeForPart(pkg, resolvedPartName),
        'resource-limit'
      );
    }

    const sniffed = sniffImageMime(snapshotted);
    const claimed = claimedMimeForPart(pkg, resolvedPartName);

    if (claimed !== 'unknown' && sniffed !== 'unknown' && mimeClassesMismatch(claimed, sniffed)) {
      return unrenderable(resolvedPartName, sniffed, 'signature-mismatch');
    }

    if (claimed !== 'unknown' && sniffed === 'unknown') {
      return unrenderable(resolvedPartName, claimed, 'signature-mismatch');
    }

    if (sniffed === 'unknown') {
      return unrenderable(resolvedPartName, 'unknown', 'unsupported-format');
    }

    if (sniffed === 'image/x-emf' || sniffed === 'image/x-wmf') {
      const convert = decodePort.convertMetafile?.bind(decodePort);
      if (!convert) {
        return unrenderable(resolvedPartName, sniffed, 'unsupported-format');
      }
      const metafileMime = sniffed;
      const contentId = contentIdOf(snapshotted);
      const flightKey = contentFlightKey(ownerPartName, resolvedPartName, contentId);
      const existingFlight = inFlightByContent.get(flightKey);
      if (existingFlight) return existingFlight;
      const convertCopy = snapshotBytes(snapshotted);
      let flight!: Promise<ImageResourceState>;
      flight = new Promise<ImageResourceState>((resolve, reject) => {
        void (async () => {
          try {
            let converted: Readonly<{
              svgBytes: Uint8Array;
              pixelWidth: number;
              pixelHeight: number;
            }> | null;
            try {
              converted = await convert(convertCopy, metafileMime, limits);
            } catch {
              resolve(unrenderable(resolvedPartName, metafileMime, 'decode-failed'));
              return;
            }
            if (startGeneration !== generation || disposed) {
              reject(new Error('ImageResourceLookup stale'));
              return;
            }
            // A null return is the converter declining the format — the ordinary
            // labelled placeholder, not a decode failure.
            if (converted === null) {
              resolve(unrenderable(resolvedPartName, metafileMime, 'unsupported-format'));
              return;
            }
            // The converter runs on attacker-controlled bytes; its OUTPUT is untrusted
            // too. Re-validate at this boundary before it can become a ready resource.
            if (converted.svgBytes.length > limits.maxEncodedBytes) {
              resolve(unrenderable(resolvedPartName, metafileMime, 'resource-limit'));
              return;
            }
            if (!hasBoundedSvgRoot(converted.svgBytes)) {
              resolve(unrenderable(resolvedPartName, metafileMime, 'decode-failed'));
              return;
            }
            const pixelCount = checkedPixelCount(
              converted.pixelWidth,
              converted.pixelHeight,
              limits
            );
            if (pixelCount === null || !checkedDecodedRgbaBytes(pixelCount, limits)) {
              resolve(unrenderable(resolvedPartName, metafileMime, 'resource-limit'));
              return;
            }
            const resourceKey = resourceKeyOf(ownerPartName, resolvedPartName, contentId);
            const validatedHandle = validatedBytesRegistry.acquire(
              resourceKey,
              contentId,
              snapshotBytes(converted.svgBytes)
            );
            validatedBytesRegistry.retain(validatedHandle);
            resolve(
              freezeState({
                kind: 'ready',
                partName: resolvedPartName,
                contentId,
                resourceKey,
                validatedHandle,
                mime: 'image/svg+xml',
                pixelWidth: converted.pixelWidth,
                pixelHeight: converted.pixelHeight,
                dpiX: DEFAULT_DPI,
                dpiY: DEFAULT_DPI,
              })
            );
          } catch (error) {
            reject(error);
          } finally {
            if (startGeneration === generation) {
              inFlightByContent.delete(flightKey);
            }
          }
        })();
      });
      inFlightByContent.set(flightKey, flight);
      return flight;
    }

    if (isPreservedMime(sniffed)) {
      return unrenderable(resolvedPartName, sniffed, 'unsupported-format');
    }

    const header = validateRasterHeader(snapshotted, sniffed);
    if (header === null) {
      return unrenderable(resolvedPartName, sniffed, 'unsupported-format');
    }

    const headerPixels = checkedPixelCount(header.pixelWidth, header.pixelHeight, limits);
    if (headerPixels === null || !checkedDecodedRgbaBytes(headerPixels, limits)) {
      return unrenderable(resolvedPartName, sniffed, 'resource-limit');
    }

    const contentId = contentIdOf(snapshotted);
    const flightKey = contentFlightKey(ownerPartName, resolvedPartName, contentId);
    const existingFlight = inFlightByContent.get(flightKey);
    if (existingFlight) return existingFlight;

    const decodeCopy = snapshotBytes(snapshotted);
    let flight!: Promise<ImageResourceState>;
    flight = new Promise<ImageResourceState>((resolve, reject) => {
      void (async () => {
        try {
          let decoded: Readonly<{
            pixelWidth: number;
            pixelHeight: number;
            dpiX: number;
            dpiY: number;
          }>;
          try {
            decoded = await decodePort.decode(decodeCopy, sniffed, limits);
          } catch {
            resolve(unrenderable(resolvedPartName, sniffed, 'decode-failed'));
            return;
          }

          if (startGeneration !== generation || disposed) {
            reject(new Error('ImageResourceLookup stale'));
            return;
          }

          if (
            decoded.pixelWidth !== header.pixelWidth ||
            decoded.pixelHeight !== header.pixelHeight
          ) {
            resolve(unrenderable(resolvedPartName, sniffed, 'decode-failed'));
            return;
          }

          const pixelCount = checkedPixelCount(decoded.pixelWidth, decoded.pixelHeight, limits);
          if (pixelCount === null || !checkedDecodedRgbaBytes(pixelCount, limits)) {
            resolve(unrenderable(resolvedPartName, sniffed, 'resource-limit'));
            return;
          }

          const dpiX =
            Number.isFinite(decoded.dpiX) && decoded.dpiX > 0 ? decoded.dpiX : DEFAULT_DPI;
          const dpiY =
            Number.isFinite(decoded.dpiY) && decoded.dpiY > 0 ? decoded.dpiY : DEFAULT_DPI;

          const resourceKey = resourceKeyOf(ownerPartName, resolvedPartName, contentId);
          const validatedHandle = validatedBytesRegistry.acquire(
            resourceKey,
            contentId,
            decodeCopy
          );
          validatedBytesRegistry.retain(validatedHandle);
          resolve(
            freezeState({
              kind: 'ready',
              partName: resolvedPartName,
              contentId,
              resourceKey,
              validatedHandle,
              mime: sniffed,
              pixelWidth: decoded.pixelWidth,
              pixelHeight: decoded.pixelHeight,
              dpiX,
              dpiY,
            })
          );
        } catch (error) {
          reject(error);
        } finally {
          if (startGeneration === generation) {
            inFlightByContent.delete(flightKey);
          }
        }
      })();
    });
    inFlightByContent.set(flightKey, flight);
    return flight;
  };

  const storeRelationshipResult = (
    ownerPartName: string,
    relationshipId: string,
    resolved: ImageRelationshipResolution,
    state: ImageResourceState,
    contentId = ''
  ): ImageResourceState => {
    byRelationship.set(lookupKey(ownerPartName, relationshipId), {
      relationshipFingerprint: relationshipFingerprint(ownerPartName, relationshipId, resolved),
      contentId,
      state,
    });
    return state;
  };

  const resolveEmbedded = async (
    ownerPartName: string,
    relationshipId: string
  ): Promise<ImageResourceState> => {
    ensureActive();
    const resolved = resolveEmbeddedPartName(pkg, ownerPartName, relationshipId);
    const cached = currentRelationshipEntry(ownerPartName, relationshipId);
    if (cached) return cached.state;

    if (resolved.mode === 'external') {
      return storeRelationshipResult(
        ownerPartName,
        relationshipId,
        resolved,
        freezeState({
          kind: 'external',
          relationshipId,
          sinkSafe: resolved.sinkSafe,
        })
      );
    }
    if (resolved.mode === 'missing') {
      return storeRelationshipResult(
        ownerPartName,
        relationshipId,
        resolved,
        freezeState({ kind: 'missing', relationshipId })
      );
    }

    const liveBytes = pkg.partBytes.get(resolved.partName);
    if (!liveBytes) {
      return storeRelationshipResult(
        ownerPartName,
        relationshipId,
        resolved,
        freezeState({ kind: 'missing', relationshipId })
      );
    }

    const snapshotted = snapshotBytes(liveBytes);
    const startGeneration = generation;
    const state = await validateAndDecodeEmbedded(
      ownerPartName,
      resolved.partName,
      snapshotted,
      startGeneration
    );
    if (startGeneration !== generation || disposed) {
      throw new Error('ImageResourceLookup stale');
    }
    const contentId =
      state.kind === 'ready' || (state.kind === 'unrenderable' && state.partName)
        ? contentIdOf(snapshotted)
        : '';
    return storeRelationshipResult(ownerPartName, relationshipId, resolved, state, contentId);
  };

  const resolveLinked = (ownerPartName: string, relationshipId: string): ImageResourceState => {
    ensureActive();
    const resolved = resolveEmbeddedPartName(pkg, ownerPartName, relationshipId);
    const cached = currentRelationshipEntry(ownerPartName, relationshipId);
    if (cached) return cached.state;

    if (resolved.mode === 'external') {
      return storeRelationshipResult(
        ownerPartName,
        relationshipId,
        resolved,
        freezeState({
          kind: 'external',
          relationshipId,
          sinkSafe: resolved.sinkSafe,
        })
      );
    }
    if (resolved.mode === 'internal') {
      return storeRelationshipResult(
        ownerPartName,
        relationshipId,
        resolved,
        unrenderable(
          resolved.partName,
          claimedMimeForPart(pkg, resolved.partName),
          'unsupported-format'
        )
      );
    }
    return storeRelationshipResult(
      ownerPartName,
      relationshipId,
      resolved,
      freezeState({ kind: 'missing', relationshipId })
    );
  };

  const resolveForProjection = async (
    projection: DrawingProjection
  ): Promise<ImageResourceState> => {
    ensureActive();
    if (!projection.picture) {
      return unrenderable(null, 'unknown', 'non-picture-graphic');
    }
    const linked = projection.picture.linkedRelationshipId;
    if (linked) return resolveLinked(projection.ownerPartName, linked);
    const embedded = projection.picture.embeddedRelationshipId;
    if (!embedded) return unrenderable(null, 'unknown', 'unsupported-format');
    return resolveEmbedded(projection.ownerPartName, embedded);
  };

  const lookup = Object.freeze({
    resolveEmbedded,
    resolveLinked,
    resolveForProjection,
    liveReferenceCount: (partName: string) => liveDrawingReferenceCount(pkg, partName),
    dispose: () => {
      disposed = true;
      invalidateAll();
      validatedBytesRegistry.dispose();
      unregisterLookupIfCurrent(pkg, decodePort, limits, lookup);
    },
  });
  return lookup;
}

export { IMAGE_RELATIONSHIP_TYPE };
