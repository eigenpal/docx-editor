/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { PDFDocument, PDFName, PDFHexString, type PDFImage, type PDFPage } from 'pdf-lib';
import type { FontBackedExportCapabilities } from '@docx-editor.dev/core/export';
import type { SemanticDrawingVisit } from '@docx-editor.dev/core/layout';
import { number as n, Work } from './context.ts';
import { paintVectorShape } from './vector-shapes.ts';

export class ImageWriter {
  private readonly images = new Map<string, PDFImage>();
  constructor(
    readonly doc: PDFDocument,
    readonly session: FontBackedExportCapabilities,
    readonly work: Work
  ) {}
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
    if (mime !== 'image/png' && mime !== 'image/jpeg')
      return report(`Unsupported PDF image format: ${mime}`);
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
    if (d.hyperlinkHref && /^(https?:|mailto:|tel:|ftp:)/i.test(d.hyperlinkHref)) {
      const xs = clip.map((point) => point.x),
        ys = clip.map((point) => point.y);
      const bounds = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      page.node.addAnnot(
        this.doc.context.register(
          this.doc.context.obj({
            Type: 'Annot',
            Subtype: 'Link',
            Rect: bounds,
            Border: [0, 0, 0],
            A: { S: 'URI', URI: PDFHexString.fromText(d.hyperlinkHref) },
          })
        )
      );
    }
    const path = clip.map((v, i) => `${n(v.x)} ${n(v.y)} ${i === 0 ? 'm' : 'l'}`).join(' ');
    return `q ${opacityCommand}${path} h W n ${n(ax / width)} ${n(ay / width)} ${n(bx / height)} ${n(by / height)} ${n(bottomLeft.x - (ax * crop.left) / width - (bx * crop.bottom) / height)} ${n(bottomLeft.y - (ay * crop.left) / width - (by * crop.bottom) / height)} cm /${key} Do Q`;
  }
}
