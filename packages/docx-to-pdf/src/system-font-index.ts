/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// An index of the font files installed in trusted system font folders, by family name.
//
// The index reads only each file's table directory, its `name` table and its `OS/2` table,
// never the outlines, so building it costs one small read per face. It is built once per
// process, on the first family that no fixed rule resolves. The folders are the operating
// system's own font folders; a family name from a document only selects among the faces
// found there and never builds a path.

import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { join, sep } from 'node:path';

/** One installed face: the file, the face in a collection, and its style. */
export interface IndexedFace {
  readonly path: string;
  readonly faceIndex: number;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly weight: number;
}

/** Installed faces by case-folded family name. */
export type SystemFontIndex = ReadonlyMap<string, readonly IndexedFace[]>;

const MAX_DEPTH = 4;
const MAX_FILES = 6000;
const MAX_TABLES = 128;
const MAX_COLLECTION_FACES = 64;
const MAX_NAME_TABLE_BYTES = 256 * 1024;
const MAX_NAME_RECORDS = 2048;
const PARALLEL_READS = 32;
const FONT_FILE = /\.(ttf|otf|ttc)$/i;

interface FileHandle {
  read(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number
  ): Promise<{ bytesRead: number }>;
  close(): Promise<void>;
}

async function readAt(
  file: FileHandle,
  position: number,
  length: number
): Promise<DataView | null> {
  if (position < 0 || length <= 0) return null;
  const buffer = new Uint8Array(length);
  const { bytesRead } = await file.read(buffer, 0, length, position);
  return bytesRead === length ? new DataView(buffer.buffer) : null;
}

const tag = (view: DataView, offset: number) =>
  String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3)
  );

function utf16be(view: DataView, start: number, length: number): string {
  let text = '';
  for (let index = 0; index + 1 < length; index += 2)
    text += String.fromCharCode(view.getUint16(start + index));
  return text;
}

function macRoman(view: DataView, start: number, length: number): string {
  let text = '';
  for (let index = 0; index < length; index++) {
    const code = view.getUint8(start + index);
    // Family names are ASCII in practice; other Mac Roman bytes are dropped.
    if (code >= 0x20 && code < 0x7f) text += String.fromCharCode(code);
  }
  return text;
}

/** Family names (`name` IDs 1 and 16) and the subfamily (ID 2) of one face. */
async function faceNames(
  file: FileHandle,
  nameOffset: number,
  nameLength: number
): Promise<{ families: Set<string>; subfamily: string } | null> {
  if (nameLength < 6 || nameLength > MAX_NAME_TABLE_BYTES) return null;
  const table = await readAt(file, nameOffset, nameLength);
  if (!table) return null;
  const count = Math.min(table.getUint16(2), MAX_NAME_RECORDS);
  const strings = table.getUint16(4);
  const families = new Set<string>();
  let subfamily = '';
  for (let record = 0; record < count; record++) {
    const at = 6 + record * 12;
    if (at + 12 > nameLength) break;
    const platform = table.getUint16(at);
    const language = table.getUint16(at + 4);
    const id = table.getUint16(at + 6);
    const length = table.getUint16(at + 8);
    const start = strings + table.getUint16(at + 10);
    if (id !== 1 && id !== 2 && id !== 16) continue;
    if (start + length > nameLength) continue;
    let text: string;
    if (platform === 3 || platform === 0) text = utf16be(table, start, length);
    else if (platform === 1 && language === 0) text = macRoman(table, start, length);
    else continue;
    text = text.replace(/\0/g, '').trim();
    if (!text || text.length > 128) continue;
    if (id === 2) {
      if (!subfamily || (platform === 3 && language === 0x409)) subfamily = text;
    } else families.add(text);
  }
  return families.size > 0 ? { families, subfamily } : null;
}

async function indexFace(
  file: FileHandle,
  path: string,
  faceIndex: number,
  offset: number,
  index: Map<string, IndexedFace[]>
): Promise<void> {
  const header = await readAt(file, offset, 12);
  if (!header) return;
  const tables = header.getUint16(4);
  if (tables === 0 || tables > MAX_TABLES) return;
  const directory = await readAt(file, offset + 12, tables * 16);
  if (!directory) return;
  let name: [number, number] | undefined;
  let os2: [number, number] | undefined;
  for (let table = 0; table < tables; table++) {
    const at = table * 16;
    const id = tag(directory, at);
    const entry: [number, number] = [directory.getUint32(at + 8), directory.getUint32(at + 12)];
    if (id === 'name') name = entry;
    else if (id === 'OS/2') os2 = entry;
  }
  if (!name) return;
  const names = await faceNames(file, name[0], name[1]);
  if (!names) return;
  let weight = 400;
  let bold = false;
  let italic = false;
  const os2Table = os2 && os2[1] >= 64 ? await readAt(file, os2[0], 64) : null;
  if (os2Table) {
    weight = os2Table.getUint16(4) || 400;
    const selection = os2Table.getUint16(62);
    italic = (selection & 0x01) !== 0;
    bold = (selection & 0x20) !== 0;
  }
  const subfamily = names.subfamily.toLowerCase();
  if (/italic|oblique/.test(subfamily)) italic = true;
  if (/\bbold\b/.test(subfamily)) bold = true;
  const face: IndexedFace = { path, faceIndex, bold, italic, weight };
  for (const family of names.families) {
    const key = family.toLowerCase();
    const faces = index.get(key);
    if (faces) faces.push(face);
    else index.set(key, [face]);
  }
}

async function indexFile(path: string, index: Map<string, IndexedFace[]>): Promise<void> {
  const file = (await open(path, 'r')) as unknown as FileHandle;
  try {
    const head = await readAt(file, 0, 12);
    if (!head) return;
    if (tag(head, 0) === 'ttcf') {
      const count = Math.min(head.getUint32(8), MAX_COLLECTION_FACES);
      const offsets = await readAt(file, 12, count * 4);
      if (!offsets) return;
      for (let face = 0; face < count; face++)
        await indexFace(file, path, face, offsets.getUint32(face * 4), index);
      return;
    }
    await indexFace(file, path, 0, 0, index);
  } finally {
    await file.close();
  }
}

/** The font files under `roots`, in a stable order, never leaving a root through a link. */
async function fontFiles(roots: readonly string[]): Promise<string[]> {
  const files: string[] = [];
  const walk = async (root: string, directory: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH || files.length >= MAX_FILES) return;
    let entries: string[];
    try {
      entries = (await readdir(directory)).sort();
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES) return;
      const path = join(directory, entry);
      let info;
      try {
        info = await lstat(path);
      } catch {
        continue;
      }
      if (info.isSymbolicLink()) {
        // A link is followed only when its target stays inside the same root.
        try {
          const target = await realpath(path);
          if (target !== root && !target.startsWith(root + sep)) continue;
          info = await lstat(target);
        } catch {
          continue;
        }
      }
      if (info.isDirectory()) await walk(root, path, depth + 1);
      else if (info.isFile() && FONT_FILE.test(entry)) files.push(path);
    }
  };
  for (const root of roots) {
    let real: string;
    try {
      real = await realpath(root);
    } catch {
      continue;
    }
    await walk(real, real, 0);
  }
  return files;
}

/** Build the index of every face under `roots`. Unreadable or malformed files are skipped. */
export async function buildSystemFontIndex(roots: readonly string[]): Promise<SystemFontIndex> {
  const files = await fontFiles(roots);
  // Each file indexes into its own map, so parallel reads cannot reorder faces: the merge
  // below runs in file order.
  const perFile: Map<string, IndexedFace[]>[] = [];
  for (let start = 0; start < files.length; start += PARALLEL_READS) {
    const batch = files.slice(start, start + PARALLEL_READS);
    perFile.push(
      ...(await Promise.all(
        batch.map(async (path) => {
          const own = new Map<string, IndexedFace[]>();
          try {
            await indexFile(path, own);
          } catch {
            // A file that cannot be read or parsed adds nothing.
          }
          return own;
        })
      ))
    );
  }
  const index = new Map<string, IndexedFace[]>();
  for (const own of perFile)
    for (const [family, faces] of own) {
      const merged = index.get(family);
      if (merged) merged.push(...faces);
      else index.set(family, faces);
    }
  return index;
}

/**
 * The installed face for one style of `family`: the exact bold and italic flags first, then
 * the face that keeps the slant, then the one that keeps the weight, then the regular face.
 * The renderer emboldens or slants what the face lacks. Undefined when the family is not
 * installed.
 */
export function indexedFace(
  index: SystemFontIndex,
  family: string,
  bold: boolean,
  italic: boolean
): IndexedFace | undefined {
  const faces = index.get(family.trim().toLowerCase());
  if (!faces) return undefined;
  for (const [wantBold, wantItalic] of [
    [bold, italic],
    [false, italic],
    [bold, false],
    [false, false],
  ] as const) {
    const matching = faces.filter((face) => face.bold === wantBold && face.italic === wantItalic);
    if (matching.length > 0) return closestWeight(matching, wantBold ? 700 : 400);
  }
  return undefined;
}

function closestWeight(faces: readonly IndexedFace[], weight: number): IndexedFace {
  let best = faces[0]!;
  for (const face of faces)
    if (Math.abs(face.weight - weight) < Math.abs(best.weight - weight)) best = face;
  return best;
}
