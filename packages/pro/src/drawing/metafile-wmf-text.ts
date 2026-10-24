/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Text of a WMF in the character set and face its font record names.
//
// A WMF writes text as single bytes in the character set of the selected font
// (`META_CREATEFONTINDIRECT`, LOGFONT `lfCharSet`), and names the face 18 bytes into that
// record. The metafile replayer reads every text byte as Latin-1 and the face 4 bytes early,
// so Arabic, Hebrew, Cyrillic or East Asian text comes out as Latin letters, in a fallback
// face. This walks the records the replayer draws and tracks the selected font through the
// object table; a matcher then re-decodes each replayed text whose bytes match its record.
//
// The bytes are attacker-controlled. Every read is bounds-checked and the record count is
// capped; a text that does not match its record keeps the replayer's text and face.

const PLACEABLE_KEY = 0x9ac6cdd7;
const MAX_RECORDS = 200_000;
const MAX_OBJECTS = 4096;
const META_EOF = 0x0000;
const META_SELECTOBJECT = 0x012d;
const META_SETTEXTALIGN = 0x012e;
const META_DELETEOBJECT = 0x01f0;
const META_CREATEFONTINDIRECT = 0x02fb;
const META_TEXTOUT = 0x0521;
const META_EXTTEXTOUT = 0x0a32;
/** Records that take a slot in the object table, beside the font record. */
const CREATES_OBJECT = new Set([0x02fa, 0x02fc, 0x00f7, 0x01f9, 0x0142, 0x06ff]);
/** How far ahead a replayed text may find its record; the replayer skips some. */
const MATCH_WINDOW = 16;

/** `lfCharSet` values and the code page their bytes are in. */
const ENCODINGS: ReadonlyMap<number, string> = new Map([
  [0, 'windows-1252'],
  [1, 'windows-1252'],
  [128, 'shift_jis'],
  [129, 'euc-kr'],
  [134, 'gbk'],
  [136, 'big5'],
  [161, 'windows-1253'],
  [162, 'windows-1254'],
  [163, 'windows-1258'],
  [177, 'windows-1255'],
  [178, 'windows-1256'],
  [186, 'windows-1257'],
  [204, 'windows-1251'],
  [222, 'windows-874'],
  [238, 'windows-1250'],
]);

interface FontRecord {
  readonly charset: number;
  /** The face the record names, or '' when it names none a resolver could find. */
  readonly face: string;
}

/** One text record the replayer draws: its bytes as Latin-1, and the font selected for it. */
export interface WmfTextRecord {
  readonly bytes: string;
  readonly font: FontRecord | null;
  /** The `META_SETTEXTALIGN` flags in force; 0 is top left. */
  readonly align: number;
}

/** A replayed text, re-decoded, and the face its record names ('' keeps the replayer's). */
export interface WmfText {
  readonly text: string;
  readonly face: string;
  /** Which edge of the text the record's reference point names. */
  readonly baseline: 'top' | 'alphabetic' | 'bottom';
  readonly align: 'left' | 'center' | 'right';
}

function latin1(view: DataView, start: number, count: number, end: number): string {
  let out = '';
  for (let at = start; at < start + count && at < end; at++) {
    const byte = view.getUint8(at);
    if (byte === 0) break;
    out += String.fromCharCode(byte);
  }
  return out;
}

function fontRecord(view: DataView, data: number, end: number): FontRecord | null {
  if (data + 19 > end) return null;
  const face = latin1(view, data + 18, 32, end).trim();
  // A face name is printable, with no quote that would end it in a font string.
  const printable = face.length <= 31 && /^[\x20-\x21\x23-\x26\x28-\x7e\xa0-\xff]*$/.test(face);
  return { charset: view.getUint8(data + 13), face: printable ? face : '' };
}

/** The text records of a WMF in the order the replayer draws them, or [] when unreadable. */
export function wmfTextRecords(bytes: Uint8Array): readonly WmfTextRecord[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = bytes.length >= 22 && view.getUint32(0, true) === PLACEABLE_KEY ? 22 : 0;
  if (at + 18 > bytes.length || view.getUint16(at + 2, true) !== 9) return [];
  at += 18;
  const objects: (FontRecord | null | 'other')[] = [];
  const allocate = (value: FontRecord | 'other'): void => {
    const free = objects.indexOf(null);
    if (free !== -1) objects[free] = value;
    else if (objects.length < MAX_OBJECTS) objects.push(value);
  };
  let selected: FontRecord | null = null;
  let align = 0;
  const out: WmfTextRecord[] = [];
  for (let count = 0; count < MAX_RECORDS && at + 6 <= bytes.length; count++) {
    const words = view.getUint32(at, true);
    const fn = view.getUint16(at + 4, true);
    if (words < 3 || at + words * 2 > bytes.length || fn === META_EOF) break;
    const data = at + 6;
    const end = at + words * 2;
    if (fn === META_CREATEFONTINDIRECT) {
      // A font the scan cannot read still takes its slot.
      allocate(fontRecord(view, data, end) ?? 'other');
    } else if (CREATES_OBJECT.has(fn)) {
      allocate('other');
    } else if (fn === META_DELETEOBJECT && data + 2 <= end) {
      const slot = view.getUint16(data, true);
      if (slot < objects.length) objects[slot] = null;
    } else if (fn === META_SETTEXTALIGN && data + 2 <= end) {
      align = view.getUint16(data, true);
    } else if (fn === META_SELECTOBJECT && data + 2 <= end) {
      const object = objects[view.getUint16(data, true)];
      if (object && object !== 'other') selected = object;
    } else if (fn === META_TEXTOUT && data + 2 <= end) {
      const chars = view.getInt16(data, true);
      if (chars > 0 && data + 2 + chars <= end)
        out.push({ bytes: latin1(view, data + 2, chars, end), font: selected, align });
    } else if (fn === META_EXTTEXTOUT && data + 8 <= end) {
      const chars = view.getInt16(data + 4, true);
      const clipped = (view.getUint16(data + 6, true) & 4) !== 0;
      const text = data + 8 + (clipped ? 8 : 0);
      if (chars > 0 && text + chars <= end)
        out.push({ bytes: latin1(view, text, chars, end), font: selected, align });
    }
    at = end;
  }
  return out;
}

const decoders = new Map<string, TextDecoder | null>();

function decode(text: string, charset: number): string {
  const encoding = ENCODINGS.get(charset);
  if (!encoding) return text;
  let decoder = decoders.get(encoding);
  if (decoder === undefined) {
    try {
      // The legacy code pages are standard encodings; the lane typings list only a few.
      decoder = new TextDecoder(encoding as ConstructorParameters<typeof TextDecoder>[0]);
    } catch {
      decoder = null;
    }
    decoders.set(encoding, decoder);
  }
  if (!decoder) return text;
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index++) bytes[index] = text.charCodeAt(index);
  return decoder.decode(bytes);
}

/**
 * Matches the replayer's texts, in drawing order, to the records they came from. Each call
 * answers the re-decoded text and face, or null when the text matches no record ahead.
 */
export function wmfTextMatcher(
  records: readonly WmfTextRecord[]
): (replayed: string) => WmfText | null {
  let next = 0;
  return (replayed) => {
    const limit = Math.min(records.length, next + MATCH_WINDOW);
    for (let index = next; index < limit; index++) {
      const record = records[index]!;
      if (record.bytes !== replayed) continue;
      next = index + 1;
      // TA_BASELINE is 24 and TA_BOTTOM 8 of the vertical bits; TA_CENTER 6 and TA_RIGHT 2.
      const vertical = record.align & 24;
      const horizontal = record.align & 6;
      return {
        text: record.font ? decode(replayed, record.font.charset) : replayed,
        face: record.font?.face ?? '',
        baseline: vertical === 24 ? 'alphabetic' : vertical === 8 ? 'bottom' : 'top',
        align: horizontal === 6 ? 'center' : horizontal === 2 ? 'right' : 'left',
      };
    }
    return null;
  };
}
