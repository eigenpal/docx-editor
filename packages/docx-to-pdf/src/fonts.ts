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
import { flateStream, hex, unicodeHex, Work } from './context.ts';

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
  /**
   * Whether the face's own outlines are bold or slanted. A bold or italic run drawn in a
   * face that is not (a single-weight face, or a substituted regular) gets Word's synthetic
   * style at paint; a real bold or italic face draws as it is.
   */
  readonly bold: boolean;
  readonly slanted: boolean;
  /** The family this face was admitted under, for legacy symbol-encoding extraction. */
  private readonly family: string;
  private readonly subset: ReturnType<FontkitFont['createSubset']>;
  /** A `glyf` face, whose subset has a `loca` table; see {@link encodeSubset}. */
  private readonly trueType: boolean;
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
    // fontkit parses both tables but does not type them.
    const tables = font as unknown as {
      readonly 'OS/2'?: {
        readonly usWeightClass?: number;
        readonly fsSelection?: { bold?: boolean; italic?: boolean; oblique?: boolean };
      };
      readonly head?: { readonly macStyle?: { bold?: boolean; italic?: boolean } };
    };
    const os2 = tables['OS/2'];
    const macStyle = tables.head?.macStyle;
    this.bold =
      (os2?.usWeightClass ?? 400) >= 600 || Boolean(os2?.fsSelection?.bold || macStyle?.bold);
    this.slanted =
      Boolean(os2?.fsSelection?.italic || os2?.fsSelection?.oblique || macStyle?.italic) ||
      (Number.isFinite(font.italicAngle) && font.italicAngle !== 0);
    this.family = admitted.request.family;
    this.strike = strikeMetrics(admitted);
    this.subset = font.createSubset();
    this.trueType = Boolean(
      (font as unknown as { directory?: { tables?: Record<string, unknown> } }).directory?.tables
        ?.glyf
    );
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
      const cid = this.cidFor(glyph, text);
      if (!Number.isInteger(cid) || cid < 0 || cid > 65535)
        throw new Error('Invalid subset glyph identifier');
      code = this.rows.length + 1;
      this.rows.push({ cid, text });
      this.codes.set(key, code);
      this.widths.set(cid, (this.font.getGlyph(glyph).advanceWidth * 1000) / this.font.unitsPerEm);
    }
    return hex(code);
  }
  /** The text each subset glyph first extracted as; see {@link cidFor}. */
  private readonly cidText = new Map<number, string>();
  /**
   * The subset glyph for one (glyph, text) pair.
   *
   * An Arabic face draws BEH, TEH, NOON and YEH on one dotless base glyph and adds the dots
   * as separate glyphs, so one glyph extracts as several letters. Codes already differ per
   * letter, but MuPDF resolves `ToUnicode` per CID, so one shared CID read every such letter
   * as the last one mapped. The subset takes the glyph again under a new CID, the way
   * LibreOffice's writer does. Both fontkit subsets write one entry per listed glyph: a
   * TrueType subset one `glyf` record, a CFF subset one charstring under a single charset
   * range, so the CID is the subset index either way.
   *
   * Bounded: no copy once the copies and every glyph composites could still pull in could
   * reach 65535, where the glyph count and component ids wrap. A TrueType subset with copies
   * is written with long `loca` offsets (see `encodeSubset`).
   */
  private cidFor(glyph: number, text: string): number {
    const known = (this.subset as unknown as { mapping: Record<number, number> }).mapping[glyph];
    if (known === undefined) {
      const cid = this.subset.includeGlyph(glyph);
      this.cidText.set(cid, text);
      return cid;
    }
    const glyphs = (this.subset as unknown as { glyphs?: number[] }).glyphs;
    if (this.cidText.get(known) === text || !Array.isArray(glyphs)) return known;
    if (glyphs.length + this.font.numGlyphs >= 65535) return known;
    // `encode` caches codes per (glyph, text), so each pair reaches here once.
    glyphs.push(glyph);
    this.copies += 1;
    const cid = glyphs.length - 1;
    this.cidText.set(cid, text);
    return cid;
  }
  /** Glyphs the subset lists more than once; see {@link cidFor}. */
  private copies = 0;
  /**
   * Encode the subset. A TrueType face with short `loca` offsets can address 131070 bytes of
   * `glyf`, and fontkit copies the face's format into the subset; copies can pass that, and
   * the offsets then wrap and later glyphs draw other glyphs' outlines. fontkit reads the
   * format from the face's parsed `loca` (whose offsets are already decoded, so the format
   * no longer affects reads), so it says long while the subset encodes.
   */
  private encodeSubset(): Uint8Array {
    const loca = (this.font as unknown as { loca?: { version?: number } }).loca;
    if (!this.trueType || this.copies === 0 || !loca || loca.version !== 0) {
      return this.subset.encode();
    }
    loca.version = 1;
    try {
      return this.subset.encode();
    } finally {
      loca.version = 0;
    }
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
    const bytes = this.encodeSubset();
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
      flateStream(ctx, bytes, cff ? { Subtype: 'CIDFontType0C' } : { Length1: bytes.length })
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
      flateStream(
        ctx,
        cmap(
          groups(
            this.rows.map((row, i) => `<${hex(i + 1)}> ${row.cid}`),
            'cidchar'
          ),
          1
        )
      )
    );
    // Only glyphs with text are written as text; glyphs without are filled as outlines by the
    // text writer, so no code needs a placeholder character.
    const mappings = this.rows.flatMap((row, i) =>
      row.text ? [`<${hex(i + 1)}> <${unicodeHex(row.text)}>`] : []
    );
    const unicode = ctx.register(flateStream(ctx, cmap(groups(mappings, 'bfchar'), 2)));
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
