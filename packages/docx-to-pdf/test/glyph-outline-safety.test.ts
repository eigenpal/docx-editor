/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { create, type FontkitFont } from 'fontkit';
import { colorGlyph, glyphOutline } from '../src/color-glyphs.ts';
import { Work } from '../src/context.ts';

// A face from a DOCX is untrusted. fontkit expands TrueType composites recursively with no
// depth limit or cache, so a composite that names itself, or a chain whose components each
// name the next glyph twice, must be refused before fontkit builds the path.
const source = new Uint8Array(
  readFileSync(new URL('../assets/NotoSansArabic-Regular.ttf', import.meta.url))
);

/** Composite glyphs with at least two components, and the byte offset of each component id. */
function composites(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const table: Record<string, number> = {};
  for (let i = 0; i < view.getUint16(4); i++) {
    const record = 12 + i * 16;
    table[String.fromCharCode(...bytes.slice(record, record + 4))] = view.getUint32(record + 8);
  }
  const short = view.getInt16(table.head! + 50) === 0;
  const numGlyphs = view.getUint16(table.maxp! + 4);
  const loca = (i: number) =>
    short ? view.getUint16(table.loca! + i * 2) * 2 : view.getUint32(table.loca! + i * 4);
  const found: { gid: number; ids: number[] }[] = [];
  let simple = -1;
  for (let gid = 1; gid < numGlyphs; gid++) {
    if (loca(gid + 1) === loca(gid)) continue;
    const start = table.glyf! + loca(gid);
    const contours = view.getInt16(start);
    if (contours > 0 && simple < 0) simple = gid;
    if (contours >= 0) continue;
    const ids: number[] = [];
    for (let at = start + 10; ; ) {
      const flags = view.getUint16(at);
      ids.push(at + 2);
      at += 4 + (flags & 1 ? 4 : 2) + (flags & 8 ? 2 : flags & 0x40 ? 4 : flags & 0x80 ? 8 : 0);
      if (!(flags & 0x20)) break;
    }
    if (ids.length >= 2) found.push({ gid, ids });
  }
  return { view, found, simple };
}

function hostile(depth: number, selfReference: boolean) {
  const bytes = source.slice();
  const { view, found, simple } = composites(bytes);
  const chain = found.slice(0, depth);
  chain.forEach((glyph, index) => {
    const target = selfReference ? glyph.gid : (chain[index + 1]?.gid ?? simple);
    for (const at of glyph.ids) view.setUint16(at, target);
  });
  return { font: create(Buffer.from(bytes)) as FontkitFont, top: chain[0]!.gid };
}

const work = () => new Work(new AbortController().signal, Date.now() + 5_000);

test('a self-referencing composite glyph is refused, not a stack overflow', () => {
  const { font, top } = hostile(1, true);
  expect(glyphOutline(font, top, work())).toBeNull();
  expect(colorGlyph(font, top, work())).toEqual({ kind: 'none', outlined: true });
});

test('an exponential composite chain is refused before fontkit expands it', () => {
  const { font, top } = hostile(20, false);
  const started = performance.now();
  expect(glyphOutline(font, top, work())).toBeNull();
  expect(performance.now() - started).toBeLessThan(500);
});

test('ordinary composite glyphs still draw', () => {
  const font = create(Buffer.from(source)) as FontkitFont;
  const { found } = composites(source.slice());
  for (const { gid } of found.slice(0, 20)) expect(glyphOutline(font, gid, work())).toBeTruthy();
});

/**
 * A face whose glyphs 1..levels are composites of `fan` copies of the next glyph, ending in
 * an empty glyph. No leaf has a point, so a point budget alone never trips; fontkit still
 * decodes every occurrence, `fan ** levels` of them.
 */
function emptyFanOut(fan: number, levels: number): FontkitFont {
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
  const records: Record<string, number> = {};
  for (let i = 0; i < view.getUint16(4); i++) {
    records[String.fromCharCode(...source.slice(12 + i * 16, 16 + i * 16))] = 12 + i * 16;
  }
  const numGlyphs = view.getUint16(view.getUint32(records.maxp! + 8) + 4);
  const glyphs: Uint8Array[] = [];
  for (let gid = 0; gid < numGlyphs; gid++) {
    if (gid < 1 || gid > levels) {
      glyphs.push(new Uint8Array(0));
      continue;
    }
    const record = new Uint8Array(10 + 6 * fan);
    const writer = new DataView(record.buffer);
    writer.setInt16(0, -1);
    for (let component = 0; component < fan; component++) {
      // MORE_COMPONENTS on all but the last; ARGS_ARE_XY_VALUES on every one.
      writer.setUint16(10 + component * 6, component < fan - 1 ? 0x22 : 0x02);
      writer.setUint16(12 + component * 6, gid + 1);
    }
    glyphs.push(record);
  }
  const glyfLength = glyphs.reduce((sum, record) => sum + record.length, 0);
  const out = new Uint8Array(source.length + glyfLength + (numGlyphs + 1) * 4 + 8);
  out.set(source);
  const writer = new DataView(out.buffer);
  const glyfAt = (source.length + 3) & ~3;
  const offsets: number[] = [];
  let at = glyfAt;
  for (const record of glyphs) {
    offsets.push(at - glyfAt);
    out.set(record, at);
    at += record.length;
  }
  offsets.push(at - glyfAt);
  const locaAt = (at + 3) & ~3;
  offsets.forEach((offset, index) => writer.setUint32(locaAt + index * 4, offset));
  writer.setUint32(records.glyf! + 8, glyfAt);
  writer.setUint32(records.glyf! + 12, glyfLength);
  writer.setUint32(records.loca! + 8, locaAt);
  writer.setUint32(records.loca! + 12, (numGlyphs + 1) * 4);
  writer.setInt16(writer.getUint32(records.head! + 8) + 50, 1);
  return create(Buffer.from(out)) as FontkitFont;
}

test('a fan-out of empty components is refused by its visit count', () => {
  const font = emptyFanOut(8, 8);
  const started = performance.now();
  expect(glyphOutline(font, 1, work())).toBeNull();
  expect(performance.now() - started).toBeLessThan(500);
});
