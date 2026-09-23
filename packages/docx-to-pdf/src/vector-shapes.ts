/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { PDFDocument, PDFName, PDFString, type PDFPage } from 'pdf-lib';
import type { SemanticDrawingVisit } from '@docx-editor.dev/core/layout';
import { color, number as n, pageHeight, pdfLiteralUri, rect, Commands, Work } from './context.ts';

/** Paint only Core's admitted, flattened solid geometry; unsupported shapes stay diagnostic. */
export function paintVectorShape(
  doc: PDFDocument,
  page: PDFPage,
  visit: SemanticDrawingVisit,
  work: Work
): string {
  const d = visit.drawing;
  const shape = d.vectorShape!;
  const bounds = visit.absolutePaintBounds;
  if (bounds.width <= 0 || bounds.height <= 0 || d.accessibility.hidden) return '';
  const content = d.geometry.contentBounds;
  const x = visit.drawingOrigin.x - d.x - visit.page.box.x;
  const y = visit.drawingOrigin.y - d.y - visit.page.box.y;
  // Core has already projected group transforms into these paths. Preserve its viewBox,
  // including nonuniform scaling of strokes, and clip at the published paint bounds.
  const unit = 12700;
  const sx = content.width / (shape.extentEmu.cx / unit);
  const sy = content.height / (shape.extentEmu.cy / unit);
  const out = new Commands(work);
  out.push(
    `q ${rect(bounds, -visit.page.box.x, -visit.page.box.y, pageHeight(page))} W n`,
    `${n(sx)} 0 0 ${n(-sy)} ${n(content.x + x)} ${n(pageHeight(page) - content.y - y)} cm`,
    '0 J 0 j 4 M [] 0 d'
  );
  const path = (points: readonly Readonly<{ x: number; y: number }>[], closed: boolean) => {
    const commands: string[] = [];
    for (const [index, point] of points.entries()) {
      work.tick();
      commands.push(`${n(point.x / unit)} ${n(point.y / unit)} ${index === 0 ? 'm' : 'l'}`);
    }
    if (closed && points.length) commands.push('h');
    return commands.join(' ');
  };
  for (const component of shape.components) {
    work.tick();
    const state = doc.context.register(
      doc.context.obj({
        Type: 'ExtGState',
        ca: component.fillAlpha,
        CA: component.strokeAlpha,
      })
    );
    const stateName = `ShapeAlpha${state.objectNumber}`;
    page.node.setExtGState(PDFName.of(stateName), state);
    out.push(`q /${stateName} gs`);
    if (component.fillHex !== null) out.push(`${color(component.fillHex)} rg`);
    if (component.strokeHex !== null)
      out.push(
        `${color(component.strokeHex)} RG ${n(Math.max(1, component.strokeWidthEmu) / unit)} w`
      );
    for (const [index, points] of component.subpathsEmu.entries())
      out.push(path(points, component.subpathsClosed?.[index] !== false));
    out.push(
      component.fillHex !== null
        ? component.strokeHex !== null
          ? 'B*'
          : 'f*'
        : component.strokeHex !== null
          ? 'S'
          : 'n'
    );
    if (component.strokeHex !== null && component.arrowheadsEmu?.length) {
      const arrowState = doc.context.register(
        doc.context.obj({
          Type: 'ExtGState',
          ca: component.strokeAlpha,
        })
      );
      const arrowName = `ShapeAlpha${arrowState.objectNumber}`;
      page.node.setExtGState(PDFName.of(arrowName), arrowState);
      out.push(`/${arrowName} gs ${color(component.strokeHex)} rg`);
      for (const points of component.arrowheadsEmu) out.push(`${path(points, true)} f`);
    }
    out.push('Q');
  }
  out.push('Q');
  // A byte string, escaped: `PDFString.of` writes its value verbatim, and a `)` in the href
  // would end the string and leave raw PDF inside the action dictionary.
  const uri =
    d.hyperlinkHref && /^(https?:|mailto:|tel:|ftp:)/i.test(d.hyperlinkHref)
      ? pdfLiteralUri(d.hyperlinkHref)
      : null;
  if (uri !== null) {
    const left = bounds.x - visit.page.box.x;
    const bottom = pageHeight(page) - bounds.y + visit.page.box.y - bounds.height;
    page.node.addAnnot(
      doc.context.register(
        doc.context.obj({
          Type: 'Annot',
          Subtype: 'Link',
          Rect: [left, bottom, left + bounds.width, bottom + bounds.height],
          Border: [0, 0, 0],
          A: { S: 'URI', URI: PDFString.of(uri) },
        })
      )
    );
  }
  return out.join('\n');
}
