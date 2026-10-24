// Text of a WMF in the character set and face its font record names.
//
// A WMF writes text as single bytes in the character set of the selected font
// (`META_CREATEFONTINDIRECT`, LOGFONT `lfCharSet`), and names the face 18 bytes into that
// record. The metafile replayer reads every text byte as Latin-1 and the face 4 bytes early,
// so Arabic, Hebrew, Cyrillic or East Asian text comes out as Latin letters, in a fallback
// face. This walks the records the replayer draws, tracks the selected font through the
// object table, and re-decodes each replayed text command whose bytes match its record.
//
// The bytes are attacker-controlled. Every read is bounds-checked and the record count is
// capped; a command that does not match its record keeps the replayer's text.

import type { MetafileCommand } from './metafile-recording.ts';

const PLACEABLE_KEY = 0x9ac6cdd7;
const MAX_RECORDS = 200_000;
const MAX_OBJECTS = 4096;
const META_EOF = 0x0000;
const META_SELECTOBJECT = 0x012d;
const META_DELETEOBJECT = 0x01f0;
const META_CREATEFONTINDIRECT = 0x02fb;
const META_TEXTOUT = 0x0521;
const META_EXTTEXTOUT = 0x0a32;
/** Records that take a slot in the object table, beside the font record. */
const CREATES_OBJECT = new Set([0x02fa, 0x02fc, 0x00f7, 0x01f9, 0x0142, 0x06ff]);
/** How far ahead a replayed text command may find its record; the replayer skips some. */
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
  readonly face: string;
}

/** One text record the replayer draws: its bytes as Latin-1, and the font selected for it. */
export interface WmfTextRecord {
  readonly bytes: string;
  readonly font: FontRecord | null;
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
  // A face name is printable; anything else stays with the replayer's choice.
  const printable = face.length > 0 && face.length <= 31 && /^[\x20-\x7e\xa0-\xff]+$/.test(face);
  return { charset: view.getUint8(data + 13), face: printable ? face : '' };
}

/** The text records of a WMF in the order the replayer draws them, or [] when unreadable. */
export function wmfTextRecords(bytes: Uint8Array): readonly WmfTextRecord[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = bytes.length >= 22 && view.getUint32(0, true) === PLACEABLE_KEY ? 22 : 0;
  if (at + 18 > bytes.length || view.getUint16(at + 2, true) !== 9) return [];
  at += 18;
  const objects: (FontRecord | null | 'other')[] = [];
  const allocate = (value: FontRecord | null | 'other'): void => {
    const free = objects.indexOf(null);
    if (free !== -1) objects[free] = value;
    else if (objects.length < MAX_OBJECTS) objects.push(value);
  };
  let selected: FontRecord | null = null;
  const out: WmfTextRecord[] = [];
  for (let count = 0; count < MAX_RECORDS && at + 6 <= bytes.length; count++) {
    const words = view.getUint32(at, true);
    const fn = view.getUint16(at + 4, true);
    if (words < 3 || at + words * 2 > bytes.length || fn === META_EOF) break;
    const data = at + 6;
    const end = at + words * 2;
    if (fn === META_CREATEFONTINDIRECT) {
      // A font the replayer cannot read still takes its slot.
      allocate(fontRecord(view, data, end) ?? 'other');
    } else if (CREATES_OBJECT.has(fn)) {
      allocate('other');
    } else if (fn === META_DELETEOBJECT && data + 2 <= end) {
      const slot = view.getUint16(data, true);
      if (slot < objects.length) objects[slot] = null;
    } else if (fn === META_SELECTOBJECT && data + 2 <= end) {
      const object = objects[view.getUint16(data, true)];
      if (object && object !== 'other') selected = object;
    } else if (fn === META_TEXTOUT && data + 2 <= end) {
      const chars = view.getInt16(data, true);
      if (chars > 0 && data + 2 + chars <= end)
        out.push({ bytes: latin1(view, data + 2, chars, end), font: selected });
    } else if (fn === META_EXTTEXTOUT && data + 8 <= end) {
      const chars = view.getInt16(data + 4, true);
      const clipped = (view.getUint16(data + 6, true) & 4) !== 0;
      const text = data + 8 + (clipped ? 8 : 0);
      if (chars > 0 && text + chars <= end)
        out.push({ bytes: latin1(view, text, chars, end), font: selected });
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
      decoder = new TextDecoder(encoding);
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
 * The replayed commands with each text command re-decoded in its record's character set and
 * set in its record's face. A text command with no matching record is left as replayed.
 */
export function withWmfText(
  commands: readonly MetafileCommand[],
  records: readonly WmfTextRecord[]
): readonly MetafileCommand[] {
  if (!records.length) return commands;
  let next = 0;
  let changed = false;
  const out = commands.map((command) => {
    if (command.kind !== 'text') return command;
    const limit = Math.min(records.length, next + MATCH_WINDOW);
    for (let index = next; index < limit; index++) {
      const record = records[index]!;
      if (record.bytes !== command.text) continue;
      next = index + 1;
      if (!record.font) return command;
      const text = decode(command.text, record.font.charset);
      const family = record.font.face || command.font.family;
      if (text === command.text && family === command.font.family) return command;
      changed = true;
      return { ...command, text, font: { ...command.font, family } };
    }
    return command;
  });
  return changed ? out : commands;
}
