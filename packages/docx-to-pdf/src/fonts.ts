/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { create as openFont, type FontkitFont } from 'fontkit';
import { PDFDocument, PDFHexString, PDFName, type PDFRef } from 'pdf-lib';
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
  async finish(work: Work): Promise<void> {
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
        CIDSystemInfo: {
          Registry: PDFHexString.fromText('Adobe'),
          Ordering: PDFHexString.fromText('Identity'),
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
