/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { create as openFont, type FontkitFont } from 'fontkit';
import { PDFDocument, PDFName, PDFString, type PDFRef } from 'pdf-lib';
import type { ExportAdmittedFontFace } from '@docx-editor.dev/core/export';
import { mapSymbolPuaText } from '@docx-editor.dev/core/layout';
import { fontEmbeddingDecision } from './pdf-font-embedding.ts';
import { strikeMetrics } from './font-metrics.ts';
import { hex, unicodeHex, Work } from './context.ts';

function cmap(body: string, type: 1 | 2): string {
  return `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> def\n/CMapName /Docx${type} def\n/CMapType ${type} def\n1 begincodespacerange\n<0000> <ffff>\nendcodespacerange\n${body}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
}
function groups(rows: readonly string[], operator: string): string {
  const out: string[] = [];
  for (let i = 0; i < rows.length; i += 100) {
    const slice = rows.slice(i, i + 100);
    out.push(`${slice.length} begin${operator}\n${slice.join('\n')}\nend${operator}`);
  }
  return out.join('\n');
}
/** One admitted face. Character codes are distinct from subset glyph IDs. */
export class EmbeddedFace {
  readonly ref: PDFRef;
  readonly name: string;
  readonly font: FontkitFont;
  readonly strike: ReturnType<typeof strikeMetrics>;
  /**
   * A COLR/CPAL face. Its glyphs are painted as filled palette layers by the text writer and
   * never written as text, so the face is not embedded: the subsetter cannot encode a color
   * glyph, and the page carries the text in its line's `ActualText` instead.
   */
  readonly colorLayers: boolean;
  /** The family this face was admitted under, for legacy symbol-encoding extraction. */
  private readonly family: string;
  private readonly subset: ReturnType<FontkitFont['createSubset']>;
  private readonly codes = new Map<string, number>();
  private readonly rows: { cid: number; text: string }[] = [];
  private readonly widths = new Map<number, number>();
  constructor(
    readonly doc: PDFDocument,
    admitted: ExportAdmittedFontFace,
    index: number
  ) {
    const gate = fontEmbeddingDecision(admitted);
    if (gate.kind === 'refuse') throw new Error(gate.reason);
    const font = gate.collectionSelector
      ? openFont(Buffer.from(admitted.bytes), gate.collectionSelector)
      : openFont(Buffer.from(admitted.bytes));
    if (!font || !('createSubset' in font))
      throw new Error('The selected resource is not a font face');
    if (Object.keys(font.variationAxes ?? {}).length)
      throw new Error('Variable fonts require an exact static instance');
    this.font = font;
    this.colorLayers = Boolean(font.COLR && font.CPAL);
    this.family = admitted.request.family;
    this.strike = strikeMetrics(admitted);
    this.subset = font.createSubset();
    this.ref = doc.context.nextRef();
    this.name = `F${index}`;
  }
  /**
   * One drawn glyph, and the text it should EXTRACT as.
   *
   * A legacy symbol face draws Word's own private-use codepoint (U+F0B7 is Symbol's bullet),
   * which is the right glyph and the wrong character: copied out of the page it is a private
   * character that means nothing outside that font. `ToUnicode` therefore carries the Unicode
   * twin, exactly as Word's own PDF export does. Drawing and extraction stay separate — the
   * glyph id is untouched — and a codepoint with no exact twin keeps what the file had rather
   * than gaining an approximate character.
   */
  encode(glyph: number, text: string): string {
    if (!Number.isInteger(glyph) || glyph <= 0 || glyph >= this.font.numGlyphs)
      throw new Error('Core produced a missing or invalid glyph');
    text = mapSymbolPuaText(text, this.family);
    const key = `${glyph}:${text}`;
    let code = this.codes.get(key);
    if (code === undefined) {
      if (this.rows.length >= 65534) throw new Error('Font character code limit exceeded');
      const cid = this.subset.includeGlyph(glyph);
      if (!Number.isInteger(cid) || cid < 0 || cid > 65535)
        throw new Error('Invalid subset glyph identifier');
      code = this.rows.length + 1;
      this.rows.push({ cid, text });
      this.codes.set(key, code);
      this.widths.set(cid, (this.font.getGlyph(glyph).advanceWidth * 1000) / this.font.unitsPerEm);
    }
    return hex(code);
  }
  /**
   * A code that draws this face's space and extracts as `text`: the carrier for characters
   * painted some other way, such as the palette layers of a color emoji. Drawn invisibly, it
   * gives a reader that ignores `ActualText` the characters all the same. Null when the face
   * has no space glyph to lend.
   */
  carrier(text: string): string | null {
    const space = this.font.glyphForCodePoint(0x20)?.id;
    if (!Number.isInteger(space) || space <= 0) return null;
    return this.encode(space, text);
  }
  /**
   * The advance this PDF declares for a character code, in 1/1000 em.
   *
   * What a viewer moves the pen by after drawing the glyph, so it is what a `TJ` adjustment
   * has to be measured against. Returns 0 for a code that was never encoded, which cannot
   * happen on the paint path because `encode` always runs first.
   */
  declaredWidth(code: string): number {
    const row = this.rows[parseInt(code, 16) - 1];
    const width = row === undefined ? 0 : (this.widths.get(row.cid) ?? 0);
    // As SERIALIZED, to five decimals. A caller predicting the viewer's pen has to advance
    // by the number this file actually carries; modelling the unrounded float instead lets a
    // tiny per-glyph difference accumulate across a run with no adjustment to absorb it.
    return Math.round(width * 1e5) / 1e5;
  }
  async finish(work: Work): Promise<void> {
    if (this.colorLayers) return;
    await work.yield();
    const bytes = this.subset.encode();
    work.check();
    const cff = bytes[0] === 1 && bytes[1] === 0;
    const ctx = this.doc.context;
    const prefix = Number(this.name.slice(1))
      .toString(26)
      .padStart(6, '0')
      .split('')
      .map((c) => String.fromCharCode(65 + parseInt(c, 26)))
      .join('');
    const base = PDFName.of(`${prefix}+DocxFont`);
    const file = ctx.register(
      ctx.flateStream(bytes, cff ? { Subtype: 'CIDFontType0C' } : { Length1: bytes.length })
    );
    const factor = 1000 / this.font.unitsPerEm;
    const bbox = this.font.bbox;
    const descriptor = ctx.register(
      ctx.obj({
        Type: 'FontDescriptor',
        FontName: base,
        Flags: 4,
        FontBBox: [bbox.minX, bbox.minY, bbox.maxX, bbox.maxY].map((v) => v * factor),
        ItalicAngle: this.font.italicAngle || 0,
        Ascent: this.font.ascent * factor,
        Descent: this.font.descent * factor,
        CapHeight: (this.font.capHeight || this.font.ascent) * factor,
        StemV: 80,
        [cff ? 'FontFile3' : 'FontFile2']: file,
      })
    );
    const widths: (number | number[])[] = [];
    for (const [cid, width] of [...this.widths].sort((a, b) => a[0] - b[0]))
      widths.push(cid, [width]);
    const descendant = ctx.register(
      ctx.obj({
        Type: 'Font',
        Subtype: cff ? 'CIDFontType0' : 'CIDFontType2',
        BaseFont: base,
        // Registry and Ordering are PDF byte strings, `(Adobe)` and `(Identity)`, not text
        // strings. `PDFHexString.fromText` writes UTF-16BE behind a BOM, and a consumer that
        // compares these as bytes, which Acrobat and PDF/A checkers do, cannot match the
        // CIDFont to its CMap and drops it.
        CIDSystemInfo: {
          Registry: PDFString.of('Adobe'),
          Ordering: PDFString.of('Identity'),
          Supplement: 0,
        },
        FontDescriptor: descriptor,
        DW: 0,
        W: widths,
        ...(cff ? {} : { CIDToGIDMap: 'Identity' }),
      })
    );
    const encoding = ctx.register(
      ctx.flateStream(
        cmap(
          groups(
            this.rows.map((row, i) => `<${hex(i + 1)}> ${row.cid}`),
            'cidchar'
          ),
          1
        )
      )
    );
    const mappings = this.rows.flatMap((row, i) =>
      row.text ? [`<${hex(i + 1)}> <${unicodeHex(row.text)}>`] : []
    );
    const unicode = ctx.register(ctx.flateStream(cmap(groups(mappings, 'bfchar'), 2)));
    ctx.assign(
      this.ref,
      ctx.obj({
        Type: 'Font',
        Subtype: 'Type0',
        BaseFont: base,
        Encoding: encoding,
        DescendantFonts: [descendant],
        ToUnicode: unicode,
      })
    );
  }
}
