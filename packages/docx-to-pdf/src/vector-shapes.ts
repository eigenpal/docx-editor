/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { PDFDocument, PDFName, PDFString, type PDFPage } from 'pdf-lib';
import {
  vectorShapeInkClip,
  type SemanticDrawingVisit,
  type VectorShapeComponent,
} from '@docx-editor.dev/core/layout';
import { color, number as n, pageHeight, pdfLiteralUri, rect, Commands, Work } from './context.ts';
import { gradientShading } from './vector-gradient.ts';
import { shadowOps } from './vector-shadow.ts';
import { patternFillOperator } from './vector-pattern.ts';

/**
 * Paint only Core's admitted, flattened solid geometry; unsupported shapes stay diagnostic.
 * `include` picks the components to paint, such as the part of a picture frame under the
 * picture.
 */
export function paintVectorShape(
  doc: PDFDocument,
  page: PDFPage,
  visit: SemanticDrawingVisit,
  work: Work,
  include?: (component: VectorShapeComponent) => boolean
): string {
  const d = visit.drawing;
  const shape = d.vectorShape!;
  const painted = visit.absolutePaintBounds;
  // The clip grows past the paint bounds only where an outline reaches over the extent edge,
  // which also gives a straight line with no width of its own a box to paint in.
  const bounds = vectorShapeInkClip(d, painted);
  if (bounds.width <= 0 || bounds.height <= 0 || d.accessibility.hidden) return '';
  const content = d.geometry.contentBounds;
  const x = visit.drawingOrigin.x - d.x - visit.page.box.x;
  const y = visit.drawingOrigin.y - d.y - visit.page.box.y;
  // Core has already projected group transforms into these paths. Preserve its viewBox,
  // including nonuniform scaling of strokes, and clip at the published paint bounds plus the
  // outline overhang.
  const unit = 12700;
  // A straight line has one zero extent axis; the other axis gives it its scale.
  const { cx, cy } = shape.extentEmu;
  const sx = cx > 0 ? content.width / (cx / unit) : content.height / (cy / unit);
  const sy = cy > 0 ? content.height / (cy / unit) : sx;
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
  const states = new Map<string, string>();
  for (const component of shape.components) {
    work.tick();
    if (include && !include(component)) continue;
    out.push(vectorComponentOps(doc, page, component, path, states));
  }
  out.push('Q');
  // A byte string, escaped: `PDFString.of` writes its value verbatim, and a `)` in the href
  // would end the string and leave raw PDF inside the action dictionary.
  const uri =
    d.hyperlinkHref && /^(https?:|mailto:|tel:|ftp:)/i.test(d.hyperlinkHref)
      ? pdfLiteralUri(d.hyperlinkHref)
      : null;
  if (uri !== null) {
    // The link covers the published bounds, or the ink box of a line that has no width.
    const target = painted.width > 0 && painted.height > 0 ? painted : bounds;
    const left = target.x - visit.page.box.x;
    const bottom = pageHeight(page) - target.y + visit.page.box.y - target.height;
    page.node.addAnnot(
      doc.context.register(
        doc.context.obj({
          Type: 'Annot',
          Subtype: 'Link',
          Rect: [left, bottom, left + target.width, bottom + target.height],
          Border: [0, 0, 0],
          A: { S: 'URI', URI: PDFString.of(uri) },
        })
      )
    );
  }
  return out.join('\n');
}

/** A page graphics state for these opacities, registered once per painted drawing. */
function alphaState(
  doc: PDFDocument,
  page: PDFPage,
  fill: number,
  stroke: number,
  states: Map<string, string>
): string {
  const key = `${fill} ${stroke}`;
  const known = states.get(key);
  if (known) return known;
  const state = doc.context.register(doc.context.obj({ Type: 'ExtGState', ca: fill, CA: stroke }));
  const name = `ShapeAlpha${state.objectNumber}`;
  page.node.setExtGState(PDFName.of(name), state);
  states.set(key, name);
  return name;
}

/**
 * One component's operators in a user space of `unit` EMU per unit: its shadow, its fill
 * (solid, pattern or gradient) and outline, and its line ends. `path` writes one subpath.
 */
export function vectorComponentOps(
  doc: PDFDocument,
  page: PDFPage,
  component: VectorShapeComponent,
  path: (points: readonly Readonly<{ x: number; y: number }>[], closed: boolean) => string,
  states: Map<string, string>,
  unit = 12700
): string {
  const stateName = alphaState(doc, page, component.fillAlpha, component.strokeAlpha, states);
  const out: string[] = [`q /${stateName} gs`];
  const cap = component.strokeCap === 'round' ? 1 : component.strokeCap === 'square' ? 2 : 0;
  const join = component.strokeJoin === 'round' ? 1 : component.strokeJoin === 'bevel' ? 2 : 0;
  out.push(`${cap} J ${join} j`);
  if (component.strokeMiterLimit !== undefined) out.push(`${n(component.strokeMiterLimit)} M`);
  const inset = component.strokeInset === true && component.strokeHex !== null;
  // An inset outline strokes at twice its width, clipped to the closed path, so the
  // authored width stays inside the shape.
  const width = Math.max(1, component.strokeWidthEmu) * (inset ? 2 : 1);
  if (component.fillHex !== null) {
    out.push(
      component.fillPattern
        ? patternFillOperator(doc, page, component.fillPattern)
        : `${color(component.fillHex)} rg`
    );
  }
  if (component.strokeHex !== null)
    out.push(`${color(component.strokeHex)} RG ${n(width / unit)} w`);
  // Dashes scale with the authored width, also under an inset outline's doubled stroke.
  if (component.strokeHex !== null && component.strokeDash?.length) {
    const dashUnit = Math.max(1, component.strokeWidthEmu) / unit;
    out.push(`[${component.strokeDash.map((length) => n(length * dashUnit)).join(' ')}] 0 d`);
  }
  const nonzero = component.fillRule === 'nonzero';
  const [clipOp, fillOnly, fillStroke] = nonzero ? ['W', 'f', 'B'] : ['W*', 'f*', 'B*'];
  const geometry = component.subpathsEmu
    .map((points, index) => path(points, component.subpathsClosed?.[index] !== false))
    .join('\n');
  if (component.shadow) {
    // An inner shadow paints inside its shape only.
    const clip = component.clipEmu?.map((points) => path(points, true)).join('\n');
    out.push(
      clip
        ? `q ${clip} W* n\n${shadowOps(doc, page, component, geometry, unit)}\nQ`
        : shadowOps(doc, page, component, geometry, unit)
    );
  }
  // A shadow silhouette paints only its shadow.
  if (component.shadowOnly) {
    out.push('Q');
    return out.join('\n');
  }
  // A gradient fills inside its own clip; the outline then strokes over it unfilled.
  const gradient = component.fillHex !== null ? component.fillGradient : undefined;
  if (gradient) {
    out.push(`q ${geometry} ${clipOp} n ${gradientShading(doc, page, gradient, unit)} Q`);
    if (component.strokeHex !== null) {
      out.push(inset ? `q ${geometry} ${clipOp} n ${geometry} S Q` : `${geometry} S`);
    }
  } else if (inset) {
    // The fill lies inside the clip already, so one clipped pass fills and strokes.
    out.push(
      `q ${geometry} ${clipOp} n`,
      geometry,
      component.fillHex !== null ? `${fillStroke} Q` : 'S Q'
    );
  } else {
    out.push(geometry);
    out.push(
      component.fillHex !== null
        ? component.strokeHex !== null
          ? fillStroke
          : fillOnly
        : component.strokeHex !== null
          ? 'S'
          : 'n'
    );
  }
  if (component.strokeHex !== null && component.arrowheadsEmu?.length) {
    const arrowName = alphaState(doc, page, component.strokeAlpha, 1, states);
    out.push(`/${arrowName} gs ${color(component.strokeHex)} rg`);
    for (const points of component.arrowheadsEmu) out.push(`${path(points, true)} f`);
  }
  out.push('Q');
  return out.join('\n');
}
