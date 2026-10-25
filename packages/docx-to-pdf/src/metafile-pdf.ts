/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// EMF and WMF pictures as vector form XObjects. Core replays the metafile into drawing
// commands; this writes them as PDF operators on the unit square a picture image fills, so
// the picture's crop, clip, and transform place the form exactly as they place an image.
import { PDFDocument, type PDFRef } from 'pdf-lib';
import {
  ExportResourceError,
  replayMetafile,
  type FontBackedExportCapabilities,
  type MetafileCommand,
  type MetafileDrawing,
  type MetafileFont,
  type MetafileMatrix,
  type MetafilePaint,
  type MetafilePathCommand,
  type MetafileRaster,
} from '@docx-editor.dev/core/export';
import {
  DEFAULT_RUN_STYLE,
  shapedRunOutline,
  type StyleSpanRecord,
} from '@docx-editor.dev/core/layout';
import { flateStream, number as n, Commands, PdfWorkLimitError, Work } from './context.ts';
import { pathOperators } from './text-art.ts';

/** A nested drawing deeper than this is left out. */
const MAX_NESTING = 4;

interface ShapedText {
  readonly width: number;
  readonly ascent: number;
  readonly descent: number;
  readonly path: string | null;
}

/** One metafile form per picture part, drawn once and shared by every use. */
export class MetafileForms {
  private readonly forms = new Map<string, Promise<PDFRef | null>>();
  private readonly shaped = new Map<string, ShapedText | null>();
  /** Metafile faces drawn in the document's default face. */
  readonly substituted = new Set<string>();
  constructor(
    readonly doc: PDFDocument,
    readonly session: FontBackedExportCapabilities,
    readonly work: Work
  ) {}

  /** The form for a metafile part, or null when it does not replay. */
  form(
    key: string,
    metafile: { readonly mime: 'image/x-emf' | 'image/x-wmf'; readonly bytes: Uint8Array },
    pageIndex: number
  ): Promise<PDFRef | null> {
    let form = this.forms.get(key);
    if (!form) {
      form = this.build(metafile, pageIndex);
      this.forms.set(key, form);
    }
    return form;
  }

  /** Text in a metafile face, shaped by the session at the face's pixel size. */
  private shape(text: string, font: MetafileFont): ShapedText | null {
    const key = `${font.family}\0${font.sizePx}\0${font.bold}\0${font.italic}\0${text}`;
    if (this.shaped.has(key)) return this.shaped.get(key)!;
    const span = (fontFamily: string | null) =>
      ({
        text,
        props: [],
        range: { start: 0, end: text.length },
        box: { x: 0, y: 0, width: 0, height: 0 },
        style: {
          ...DEFAULT_RUN_STYLE,
          fontFamily,
          fontSizePt: font.sizePx,
          bold: font.bold,
          italic: font.italic,
        },
      }) as unknown as StyleSpanRecord;
    let result: ShapedText | null = null;
    // The session resolves the families the document names. A face only the metafile names
    // draws in the document's default face instead.
    let shaped = font.sizePx > 0 ? this.session.shapeLaidOutText(span(font.family)) : null;
    if (!shaped && font.sizePx > 0) {
      shaped = this.session.shapeLaidOutText(span(null));
      if (shaped) this.substituted.add(font.family);
    }
    if (shaped && !shaped.run.glyphs.some((glyph) => glyph.id === 0)) {
      const scale = shaped.fixedPointScale;
      const advance = shaped.run.glyphs.reduce((sum, glyph) => sum + glyph.advanceX, 0) / scale;
      result = {
        width: advance,
        ascent: shaped.run.metrics.ascent / scale,
        descent: shaped.run.metrics.descent / scale,
        path: shapedRunOutline(shaped.run, font.sizePx, scale)?.path ?? null,
      };
    }
    if (this.shaped.size < 4096) this.shaped.set(key, result);
    return result;
  }

  private async build(
    metafile: { readonly mime: 'image/x-emf' | 'image/x-wmf'; readonly bytes: Uint8Array },
    pageIndex: number
  ): Promise<PDFRef | null> {
    try {
      return await this.write(metafile, pageIndex);
    } catch (error) {
      // A metafile that fails to draw is refused for its picture, never for the whole export.
      // The work budget's own errors still end the export.
      if (error instanceof PdfWorkLimitError || error instanceof ExportResourceError) throw error;
      return null;
    }
  }

  private async write(
    metafile: { readonly mime: 'image/x-emf' | 'image/x-wmf'; readonly bytes: Uint8Array },
    pageIndex: number
  ): Promise<PDFRef | null> {
    const replay = await replayMetafile(metafile.bytes, metafile.mime, {
      measureText: (text, font) => this.shape(text, font)?.width ?? 0,
    });
    this.work.check();
    const { drawing } = replay ?? {};
    if (!replay || !drawing || !(drawing.width > 0 && drawing.height > 0)) return null;
    if (!replay.complete) {
      this.work.report(
        'metafile-limit',
        'A metafile picture stopped drawing at a resource bound',
        pageIndex
      );
    }
    const writer = new FormWriter(this.doc, this.work, (text, font) => this.shape(text, font));
    const out = writer.out;
    // Canvas pixels, y down, onto the unit square, y up.
    out.push(`${n(1 / drawing.width)} 0 0 ${n(-1 / drawing.height)} 0 1 cm`);
    await writer.drawing(drawing, 0);
    for (const family of this.substituted) {
      this.work.report(
        'metafile-font',
        'A metafile picture names a font the document does not use; its text uses the default font',
        pageIndex,
        'information'
      );
      this.substituted.delete(family);
    }
    if (writer.missedImage) {
      this.work.report(
        'metafile-image',
        'An image in a metafile picture could not be decoded and is left out',
        pageIndex
      );
    }
    if (writer.missedText) {
      this.work.report(
        'metafile-text',
        'Text in a metafile picture could not be shaped and is left out',
        pageIndex
      );
    }
    const stream = flateStream(this.doc.context, out.join('\n'), {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: [0, 0, 1, 1],
      Resources: this.doc.context.obj({
        ExtGState: this.doc.context.obj(writer.states),
        XObject: this.doc.context.obj(writer.images),
      }),
    });
    return this.doc.context.register(stream);
  }
}

/** Writes one replayed drawing as content-stream operators and the resources they name. */
class FormWriter {
  readonly out: Commands;
  readonly states: Record<string, PDFRef> = {};
  readonly images: Record<string, PDFRef> = {};
  missedText = false;
  missedImage = false;
  private readonly alphaNames = new Map<number, string>();
  constructor(
    private readonly doc: PDFDocument,
    private readonly work: Work,
    private readonly shape: (text: string, font: MetafileFont) => ShapedText | null
  ) {
    this.out = new Commands(work);
  }

  private alpha(value: number): string {
    const alpha = Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
    if (alpha >= 1) return '';
    let name = this.alphaNames.get(alpha);
    if (!name) {
      name = `A${this.alphaNames.size}`;
      this.alphaNames.set(alpha, name);
      this.states[name] = this.doc.context.register(
        this.doc.context.obj({ Type: 'ExtGState', ca: alpha, CA: alpha })
      );
    }
    return `/${name} gs `;
  }

  private static colour(paint: MetafilePaint, operator: 'rg' | 'RG'): string {
    return `${n(paint.r / 255)} ${n(paint.g / 255)} ${n(paint.b / 255)} ${operator}`;
  }

  private path(commands: readonly MetafilePathCommand[]): string {
    const parts: string[] = [];
    for (const command of commands) {
      this.work.tick();
      if (command.op === 'M') parts.push(`${n(command.x)} ${n(command.y)} m`);
      else if (command.op === 'L') parts.push(`${n(command.x)} ${n(command.y)} l`);
      else if (command.op === 'C') {
        parts.push(
          `${n(command.x1)} ${n(command.y1)} ${n(command.x2)} ${n(command.y2)} ${n(command.x)} ${n(command.y)} c`
        );
      } else parts.push('h');
    }
    return parts.join(' ');
  }

  private static matrix(m: MetafileMatrix): string {
    return m.map(n).join(' ');
  }

  async drawing(drawing: MetafileDrawing, depth: number): Promise<void> {
    let open = 0;
    for (const command of drawing.commands) {
      this.work.tick();
      if (command.kind === 'save') {
        this.out.push('q');
        open += 1;
      } else if (command.kind === 'restore') {
        if (open === 0) continue;
        this.out.push('Q');
        open -= 1;
      } else await this.command(command, depth);
    }
    for (; open > 0; open -= 1) this.out.push('Q');
  }

  private async command(command: MetafileCommand, depth: number): Promise<void> {
    switch (command.kind) {
      case 'fill':
        this.out.push(
          `q ${this.alpha(command.paint.alpha)}${FormWriter.colour(command.paint, 'rg')} ${this.path(command.path)} ${command.evenOdd ? 'f*' : 'f'} Q`
        );
        return;
      case 'stroke': {
        const dash = command.dash.some((length) => length > 0)
          ? `[${command.dash.map(n).join(' ')}] 0 d `
          : '';
        this.out.push(
          `q ${this.alpha(command.paint.alpha)}${FormWriter.colour(command.paint, 'RG')} ${n(command.width)} w 0 J 0 j 10 M ${dash}${this.path(command.path)} S Q`
        );
        return;
      }
      case 'clip':
        this.out.push(`${this.path(command.path)} ${command.evenOdd ? 'W*' : 'W'} n`);
        return;
      case 'image': {
        const ref = await this.raster(command.raster);
        if (!ref) return;
        const name = `I${Object.keys(this.images).length}`;
        this.images[name] = ref;
        // The image fills its unit square with row 0 at the top; the command's matrix maps
        // that square, y down, into canvas pixels.
        const [a, b, c, d, e, f] = command.matrix;
        this.out.push(`q ${FormWriter.matrix([a, b, -c, -d, e + c, f + d])} cm /${name} Do Q`);
        return;
      }
      case 'text': {
        const shaped = this.shape(command.text, command.font);
        // Text with no ink, such as spaces, has no outline and nothing to draw.
        if (!shaped?.path) {
          if (!shaped && command.text.trim()) this.missedText = true;
          return;
        }
        const operators = pathOperators(shaped.path, this.work);
        if (!operators) return;
        const shiftX =
          command.align === 'center'
            ? -shaped.width / 2
            : command.align === 'right'
              ? -shaped.width
              : 0;
        const shiftY =
          command.baseline === 'top'
            ? shaped.ascent
            : command.baseline === 'bottom'
              ? -shaped.descent
              : command.baseline === 'middle'
                ? (shaped.ascent - shaped.descent) / 2
                : 0;
        const [a, b, c, d, e, f] = command.matrix;
        const x = command.x + shiftX;
        const y = command.y + shiftY;
        this.out.push(
          `q ${FormWriter.matrix([a, b, c, d, a * x + c * y + e, b * x + d * y + f])} cm ${this.alpha(command.paint.alpha)}${FormWriter.colour(command.paint, 'rg')} ${operators} f Q`
        );
        return;
      }
      case 'drawing':
        if (depth >= MAX_NESTING) return;
        this.out.push(`q ${FormWriter.matrix(command.matrix)} cm`);
        await this.drawing(command.drawing, depth + 1);
        this.out.push('Q');
        return;
    }
  }

  /** An image XObject for raster content: RGB with a soft mask when any pixel is not opaque. */
  private async raster(raster: MetafileRaster): Promise<PDFRef | null> {
    this.work.tick();
    if (raster.kind === 'encoded') {
      // The producer checks only the signature and header, so the image data can still be
      // corrupt. Such an image is left out of the picture.
      try {
        const image =
          raster.mime === 'image/png'
            ? await this.doc.embedPng(raster.bytes)
            : await this.doc.embedJpg(raster.bytes);
        return image.ref;
      } catch (error) {
        if (error instanceof PdfWorkLimitError || error instanceof ExportResourceError) throw error;
        this.missedImage = true;
        return null;
      }
    }
    const { width, height, data } = raster;
    const pixels = width * height;
    const rgb = new Uint8Array(pixels * 3);
    const alpha = new Uint8Array(pixels);
    let translucent = false;
    for (let pixel = 0; pixel < pixels; pixel += 1) {
      rgb[pixel * 3] = data[pixel * 4]!;
      rgb[pixel * 3 + 1] = data[pixel * 4 + 1]!;
      rgb[pixel * 3 + 2] = data[pixel * 4 + 2]!;
      alpha[pixel] = data[pixel * 4 + 3]!;
      if (alpha[pixel] !== 255) translucent = true;
    }
    this.work.reserveContent(pixels * (translucent ? 4 : 3));
    const image = {
      Type: 'XObject',
      Subtype: 'Image',
      Width: width,
      Height: height,
      BitsPerComponent: 8,
    };
    const mask = translucent
      ? this.doc.context.register(
          flateStream(this.doc.context, alpha, { ...image, ColorSpace: 'DeviceGray' })
        )
      : null;
    return this.doc.context.register(
      flateStream(this.doc.context, rgb, {
        ...image,
        ColorSpace: 'DeviceRGB',
        ...(mask ? { SMask: mask } : {}),
      })
    );
  }
}
