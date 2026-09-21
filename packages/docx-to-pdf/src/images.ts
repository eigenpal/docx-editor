/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { PDFDocument, PDFName, PDFString, type PDFImage, type PDFPage } from 'pdf-lib';
import type { FontBackedExportCapabilities } from '@docx-editor.dev/core/export';
import type {
  LayoutBox,
  ListMarkerPictureRecord,
  SemanticDrawingVisit,
} from '@docx-editor.dev/core/layout';
import { number as n, pdfLiteralUri, Work } from './context.ts';
import { paintVectorShape } from './vector-shapes.ts';

/**
 * The raster formats this writer embeds directly.
 *
 * PDF has no GIF, BMP or WebP image filter, and its `LZWDecode` is the TIFF flavour
 * (MSB-first, with EarlyChange) rather than GIF's LSB-first stream, so a GIF cannot be
 * re-wrapped without decoding it. Core hands exporters validated ENCODED bytes and header
 * metadata — `ImageDecodePort.decode` answers dimensions and density, never pixels — so
 * widening this set means writing new decoders over attacker-controlled bytes, not reading
 * a buffer core already has.
 */
const EMBEDDABLE_MIMES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg']);

/**
 * Why a picture bullet cannot be drawn into the PDF, or null when it can.
 *
 * Every value folded into the reason is a CLOSED union minted by core — `ImageResourceState`
 * kinds, its `reason`, and a `mime` that came from signature sniffing or the content-type
 * map — so no attacker-controlled string reaches a diagnostic message.
 */
function unpaintableBulletReason(picture: ListMarkerPictureRecord, box: LayoutBox): string | null {
  const resource = picture.resource;
  if (resource.kind === 'unrenderable') return `image refused: ${resource.reason}`;
  if (resource.kind !== 'ready') return `image ${resource.kind}`;
  if (!EMBEDDABLE_MIMES.has(resource.mime)) return `format not embeddable: ${resource.mime}`;
  if (!(box.width > 0 && box.height > 0)) return 'no visible area';
  return null;
}

export class ImageWriter {
  private readonly images = new Map<string, PDFImage>();
  constructor(
    readonly doc: PDFDocument,
    readonly session: FontBackedExportCapabilities,
    readonly work: Work
  ) {}
  /**
   * Draw a list marker's picture bullet in the box layout published for it.
   *
   * Returns '' for anything not drawable — missing, external, still decoding, refused, or a
   * format this writer cannot embed — and the caller then paints the level's `w:lvlText`.
   *
   * That fall back is FOLLOWING the document, not approximating it: the same `w:lvl` authors
   * `w:lvlText` as this level's marker and `w:lvlPicBulletId` as a picture to use in its
   * place (ECMA-376 §17.9.12), so the text is the document's own alternative rather than
   * something this writer invented. It is reported all the same, at `information`: nothing
   * the document authors is lost from the page, so a strict export is still faithful, while
   * the reader is still told which of the two markers was drawn. An inline `w:drawing` whose
   * format cannot be embedded keeps reporting `unsupported`, because there the document
   * offers no alternative and the page really does lose content.
   *
   * No scaling decision is taken here: the box is the extent layout already placed on the
   * baseline, after the marker font scale.
   */
  async paintListMarkerPicture(
    picture: ListMarkerPictureRecord,
    box: LayoutBox,
    page: PDFPage,
    pageIndex: number
  ): Promise<string> {
    await this.work.yield();
    const unpaintable = unpaintableBulletReason(picture, box);
    if (unpaintable !== null) {
      this.work.report(
        'list-picture-bullet',
        `Picture bullet drawn as its level text (${unpaintable})`,
        pageIndex,
        'information'
      );
      return '';
    }
    if (picture.resource.kind !== 'ready') return '';
    const mime = picture.resource.mime;
    const bytes = this.session.validatedImageBytes(picture);
    if (!bytes) return '';
    let image = this.images.get(picture.resource.resourceKey);
    if (!image) {
      image =
        mime === 'image/png' ? await this.doc.embedPng(bytes) : await this.doc.embedJpg(bytes);
      this.images.set(picture.resource.resourceKey, image);
    }
    const key = `Im${image.ref.objectNumber}`;
    page.node.setXObject(PDFName.of(key), image.ref);
    const x = box.x;
    const y = page.getHeight() - box.y - box.height;
    return `q ${n(box.width)} 0 0 ${n(box.height)} ${n(x)} ${n(y)} cm /${key} Do Q`;
  }

  async paint(visit: SemanticDrawingVisit, page: PDFPage): Promise<string> {
    await this.work.yield();
    const d = visit.drawing;
    const report = (message: string): string => {
      this.work.report('drawing', message, visit.page.index);
      return '';
    };
    if (visit.story !== 'textbox' && d.vectorShape)
      return paintVectorShape(this.doc, page, visit, this.work);
    if (visit.story === 'textbox' || d.placeholderGraphicKind)
      return report('Vector drawings and textboxes are not supported');
    const bytes = this.session.validatedImageBytes(d);
    if (!bytes || d.resource.kind !== 'ready') return report('Image has no validated raster bytes');
    const mime = d.resource.mime;
    // An inline drawing has no authored alternative, so an unembeddable format is a real
    // refusal here — unlike a picture bullet, whose level authors `w:lvlText` beside it.
    if (!EMBEDDABLE_MIMES.has(mime)) return report(`Unsupported PDF image format: ${mime}`);
    if (
      d.effects.grayscale ||
      d.effects.brightness ||
      d.effects.contrast ||
      d.effects.bilevel !== undefined
    )
      this.work.report(
        'image-effects',
        'Image color adjustments are not encoded',
        visit.page.index
      );
    let image = this.images.get(d.resource.resourceKey);
    if (!image) {
      image =
        mime === 'image/png' ? await this.doc.embedPng(bytes) : await this.doc.embedJpg(bytes);
      this.images.set(d.resource.resourceKey, image);
    }
    let opacityCommand = '';
    if (d.effects.opacity !== undefined && d.effects.opacity !== 1) {
      const opacity = d.effects.opacity;
      if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1)
        return report('Invalid image opacity');
      const name = `Alpha${Math.round(opacity * 100000)}`;
      const ref = this.doc.context.register(
        this.doc.context.obj({ Type: 'ExtGState', ca: opacity, CA: opacity })
      );
      page.node.setExtGState(PDFName.of(name), ref);
      opacityCommand = `/${name} gs `;
    }
    const key = `Im${image.ref.objectNumber}`;
    page.node.setXObject(PDFName.of(key), image.ref);
    const points = d.geometry.imageTransformCorners ?? d.geometry.transformedCorners;
    if (points.length !== 4) return report('Image has no affine rectangle geometry');
    if (d.geometry.clipFallback !== 'none')
      this.work.report('image-clip', 'Image clipping uses a Core fallback', visit.page.index);
    const offsetX = visit.drawingOrigin.x - d.x - visit.page.box.x;
    const offsetY = visit.drawingOrigin.y - d.y - visit.page.box.y;
    const p = points.map((v) => ({ x: v.x + offsetX, y: page.getHeight() - v.y - offsetY }));
    const topLeft = p[0]!,
      topRight = p[1]!,
      bottomLeft = p[3]!;
    const ax = topRight.x - topLeft.x,
      ay = topRight.y - topLeft.y;
    const bx = topLeft.x - bottomLeft.x,
      by = topLeft.y - bottomLeft.y;
    const crop = d.crop;
    const width = 1 - crop.left - crop.right,
      height = 1 - crop.top - crop.bottom;
    if (!(width > 0 && height > 0)) return report('Image crop has no visible area');
    if (d.geometry.clipPolygon && d.geometry.clipPolygon.length === 0) return '';
    const clip = d.geometry.clipPolygon?.length
      ? d.geometry.clipPolygon.map((v) => ({
          x: v.x + offsetX,
          y: page.getHeight() - v.y - offsetY,
        }))
      : p;
    // A byte string, escaped: `PDFString.of` writes its value verbatim, and a `)` in the href
    // would end the string and leave raw PDF inside the action dictionary.
    const uri =
      d.hyperlinkHref && /^(https?:|mailto:|tel:|ftp:)/i.test(d.hyperlinkHref)
        ? pdfLiteralUri(d.hyperlinkHref)
        : null;
    if (uri !== null) {
      // A loop, not `Math.min(...xs)`: the clip polygon is file-derived, and spreading a long
      // one into a call is the one place a large but otherwise valid shape could blow the stack.
      const bounds = [Infinity, Infinity, -Infinity, -Infinity];
      for (const point of clip) {
        bounds[0] = Math.min(bounds[0]!, point.x);
        bounds[1] = Math.min(bounds[1]!, point.y);
        bounds[2] = Math.max(bounds[2]!, point.x);
        bounds[3] = Math.max(bounds[3]!, point.y);
      }
      page.node.addAnnot(
        this.doc.context.register(
          this.doc.context.obj({
            Type: 'Annot',
            Subtype: 'Link',
            Rect: bounds,
            Border: [0, 0, 0],
            A: { S: 'URI', URI: PDFString.of(uri) },
          })
        )
      );
    }
    const path = clip.map((v, i) => `${n(v.x)} ${n(v.y)} ${i === 0 ? 'm' : 'l'}`).join(' ');
    return `q ${opacityCommand}${path} h W n ${n(ax / width)} ${n(ay / width)} ${n(bx / height)} ${n(by / height)} ${n(bottomLeft.x - (ax * crop.left) / width - (bx * crop.bottom) / height)} ${n(bottomLeft.y - (ay * crop.left) / width - (by * crop.bottom) / height)} cm /${key} Do Q`;
  }
}
