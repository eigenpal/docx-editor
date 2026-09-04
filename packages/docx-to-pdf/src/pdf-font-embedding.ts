/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { create as createFontkitFont, type FontkitCollection, type FontkitFont } from 'fontkit';
import type { PdfAdmittedFont } from './pdf-paint-writer-port.ts';

/** Maximum SFNT tables inspected in one face directory. @internal */
export const MAX_SFNT_TABLES = 4096;

/** Maximum faces accepted in one TTC/OTC collection. @internal */
export const MAX_TTC_FACES = 256;

const BITMAP_ONLY_EMBEDDING = 0x0200;
const TTC_VERSION_1 = 0x00010000;
const TTC_VERSION_2 = 0x00020000;

export type FontEmbeddingDecision =
  | { readonly kind: 'embed'; readonly collectionSelector: string | null }
  | { readonly kind: 'refuse'; readonly reason: string };

export type EmbeddedCmapCache = Map<string, FontkitFont | 'unreadable'>;

function readUint16(bytes: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset > bytes.byteLength - 2) return null;
  return (bytes[offset]! << 8) | bytes[offset + 1]!;
}

function readUint32(bytes: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset > bytes.byteLength - 4) return null;
  return (
    (bytes[offset]! * 0x1000000 +
      (bytes[offset + 1]! << 16) +
      (bytes[offset + 2]! << 8) +
      bytes[offset + 3]!) >>>
    0
  );
}

function tagAt(bytes: Uint8Array, offset: number): string | null {
  if (offset < 0 || offset > bytes.byteLength - 4) return null;
  return String.fromCharCode(
    bytes[offset]!,
    bytes[offset + 1]!,
    bytes[offset + 2]!,
    bytes[offset + 3]!
  );
}

function isFontCollection(bytes: Uint8Array): boolean {
  return tagAt(bytes, 0) === 'ttcf';
}

function refuse(reason: string): FontEmbeddingDecision {
  return { kind: 'refuse', reason };
}

function embed(collectionSelector: string | null): FontEmbeddingDecision {
  return { kind: 'embed', collectionSelector };
}

function isFontkitFont(value: FontkitFont | FontkitCollection | null): value is FontkitFont {
  return value !== null && typeof (value as FontkitFont).hasGlyphForCodePoint === 'function';
}

function isFontkitCollection(value: FontkitFont | FontkitCollection): value is FontkitCollection {
  return typeof (value as FontkitCollection).getFont === 'function';
}

function postscriptSelector(face: FontkitFont): string | null {
  const name = face.postscriptName;
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sfntEmbeddingPermission(bytes: Uint8Array, base: number): FontEmbeddingDecision {
  const tableCount = readUint16(bytes, base + 4);
  if (tableCount === null || tableCount > MAX_SFNT_TABLES) {
    return refuse('The admitted font has no bounded SFNT table directory');
  }
  const directoryEnd = base + 12 + tableCount * 16;
  if (!Number.isSafeInteger(directoryEnd) || directoryEnd > bytes.byteLength) {
    return refuse('The admitted font has a truncated SFNT table directory');
  }
  for (let index = 0; index < tableCount; index += 1) {
    const record = base + 12 + index * 16;
    const tag = tagAt(bytes, record);
    if (tag !== 'OS/2') continue;
    const offset = readUint32(bytes, record + 8);
    const length = readUint32(bytes, record + 12);
    if (
      offset === null ||
      length === null ||
      offset > bytes.byteLength ||
      length > bytes.byteLength - offset ||
      length < 10
    ) {
      return refuse('The admitted font has an invalid OS/2 table range');
    }
    const fsType = readUint16(bytes, offset + 8);
    if (fsType === null) {
      return refuse('The admitted font has a truncated OS/2 fsType value');
    }
    if ((fsType & 0x0002) !== 0) {
      return refuse('The OS/2 fsType forbids font embedding');
    }
    if ((fsType & 0x0100) !== 0) {
      return refuse(
        'The OS/2 fsType forbids subsetting, and PDFKit has no safe full-font embedding mode'
      );
    }
    if ((fsType & BITMAP_ONLY_EMBEDDING) !== 0) {
      return refuse(
        'The OS/2 fsType permits bitmap embedding only, and this writer embeds outline data'
      );
    }
    return embed(null);
  }
  return embed(null);
}

function collectionFaceOffset(
  bytes: Uint8Array,
  faceIndex: number
): { readonly offset: number } | { readonly reason: string } {
  if (bytes.byteLength < 12) {
    return { reason: 'The admitted font collection header is truncated' };
  }
  const version = readUint32(bytes, 4);
  if (version !== TTC_VERSION_1 && version !== TTC_VERSION_2) {
    return { reason: 'The admitted font collection has an unsupported TTC version' };
  }
  const faceCount = readUint32(bytes, 8);
  if (faceCount === null) {
    return { reason: 'The admitted font collection header is truncated' };
  }
  if (faceCount === 0) {
    return { reason: 'The admitted font collection has no faces' };
  }
  if (faceCount > MAX_TTC_FACES) {
    return { reason: `The admitted font collection exceeds the ${MAX_TTC_FACES} face limit` };
  }
  const offsetsEnd = 12 + faceCount * 4;
  if (!Number.isSafeInteger(offsetsEnd) || offsetsEnd > bytes.byteLength) {
    return { reason: 'The admitted font collection face directory is truncated' };
  }
  if (!Number.isSafeInteger(faceIndex) || faceIndex < 0) {
    return { reason: 'The admitted font collection faceIndex is invalid' };
  }
  if (faceIndex >= faceCount) {
    return {
      reason: `The admitted font collection faceIndex ${faceIndex} is out of range for ${faceCount} faces`,
    };
  }
  const faceOffset = readUint32(bytes, 12 + faceIndex * 4);
  if (faceOffset === null || faceOffset < offsetsEnd || faceOffset > bytes.byteLength - 12) {
    return { reason: 'The admitted font collection face offset is invalid' };
  }
  return { offset: faceOffset };
}

function collectionFaceSelector(
  bytes: Uint8Array,
  faceIndex: number
): { readonly selector: string } | { readonly reason: string } {
  let opened: FontkitFont | FontkitCollection;
  try {
    opened = createFontkitFont(Buffer.from(bytes));
  } catch {
    return { reason: 'The admitted font collection could not be opened' };
  }
  if (!isFontkitCollection(opened)) {
    return { reason: 'The admitted font collection did not parse as a font collection' };
  }
  const fonts = opened.fonts;
  if (faceIndex >= fonts.length) {
    return {
      reason: `The admitted font collection faceIndex ${faceIndex} is out of range for ${fonts.length} faces`,
    };
  }
  const face = fonts[faceIndex]!;
  if (!isFontkitFont(face)) {
    return { reason: 'The selected collection face is not a font face' };
  }
  const selector = postscriptSelector(face);
  if (selector === null) {
    return { reason: 'The selected collection face has no PostScript name' };
  }
  for (let index = 0; index < fonts.length; index += 1) {
    if (index === faceIndex) continue;
    if (postscriptSelector(fonts[index]!) === selector) {
      return { reason: 'The selected collection face PostScript name is not unique' };
    }
  }
  let selected: FontkitFont | null;
  try {
    selected = createFontkitFont(Buffer.from(bytes), selector);
  } catch {
    return { reason: 'The selected collection face PostScript name did not resolve' };
  }
  if (!isFontkitFont(selected)) {
    return { reason: 'The selected collection face PostScript name did not resolve' };
  }
  return { selector };
}

/** Decides whether PDFKit may embed an admitted face, including TTC/OTC selection. @internal */
export function fontEmbeddingDecision(font: PdfAdmittedFont): FontEmbeddingDecision {
  const { bytes, faceIndex } = font;
  if (!isFontCollection(bytes)) {
    if (faceIndex !== 0) {
      return refuse('A nonzero faceIndex requires a TrueType collection resource');
    }
    return sfntEmbeddingPermission(bytes, 0);
  }

  const located = collectionFaceOffset(bytes, faceIndex);
  if ('reason' in located) return refuse(located.reason);

  const permission = sfntEmbeddingPermission(bytes, located.offset);
  if (permission.kind === 'refuse') return permission;

  const selected = collectionFaceSelector(bytes, faceIndex);
  if ('reason' in selected) return refuse(selected.reason);
  return embed(selected.selector);
}

function openSelectedFace(
  font: PdfAdmittedFont,
  collectionSelector: string | null
): FontkitFont | 'unreadable' {
  try {
    const opened =
      collectionSelector === null
        ? createFontkitFont(Buffer.from(font.bytes))
        : createFontkitFont(Buffer.from(font.bytes), collectionSelector);
    return isFontkitFont(opened) ? opened : 'unreadable';
  } catch {
    return 'unreadable';
  }
}

/** Opens the selected admitted face for cmap coverage checks. @internal */
export function embeddedFaceCmap(
  font: PdfAdmittedFont,
  collectionSelector: string | null,
  cache: EmbeddedCmapCache
): FontkitFont | 'unreadable' {
  const cached = cache.get(font.identity);
  if (cached) return cached;
  const cmap = openSelectedFace(font, collectionSelector);
  cache.set(font.identity, cmap);
  return cmap;
}
