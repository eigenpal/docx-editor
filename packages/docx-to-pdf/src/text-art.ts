/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { PDFDocument, PDFName, type PDFPage } from 'pdf-lib';
import type { SemanticDrawingVisit } from '@docx-editor.dev/core/layout';
import { color, number as n, pageHeight, rect, Commands, Work } from './context.ts';
import { vectorComponentOps } from './vector-shapes.ts';

const ARITY: Readonly<Record<string, number>> = { M: 2, L: 2, Q: 4, C: 6, Z: 0 };

/**
 * Engine-generated path data as PDF path operators. Quadratic segments become the equal cubic
 * ones, because PDF paths have no quadratic operator. Null when the data leaves the grammar.
 */
export function pathOperators(path: string, work: Work): string | null {
  const out: string[] = [];
  let x = 0,
    y = 0,
    startX = 0,
    startY = 0;
  for (const command of path.matchAll(/([MLQCZ])([^MLQCZ]*)/gu)) {
    work.tick();
    const letter = command[1]!;
    const v = command[2]!
      .trim()
      .split(/[\s,]+/u)
      .filter(Boolean)
      .map(Number);
    if (v.length !== ARITY[letter] || v.some((value) => !Number.isFinite(value))) return null;
    if (letter === 'M') {
      [x, y] = [v[0]!, v[1]!];
      [startX, startY] = [x, y];
      out.push(`${n(x)} ${n(y)} m`);
    } else if (letter === 'L') {
      [x, y] = [v[0]!, v[1]!];
      out.push(`${n(x)} ${n(y)} l`);
    } else if (letter === 'C') {
      out.push(v.map(n).join(' ') + ' c');
      [x, y] = [v[4]!, v[5]!];
    } else if (letter === 'Q') {
      const [qx, qy, ex, ey] = v as [number, number, number, number];
      const c1x = x + (2 / 3) * (qx - x),
        c1y = y + (2 / 3) * (qy - y);
      const c2x = ex + (2 / 3) * (qx - ex),
        c2y = ey + (2 / 3) * (qy - ey);
      out.push(`${n(c1x)} ${n(c1y)} ${n(c2x)} ${n(c2y)} ${n(ex)} ${n(ey)} c`);
      [x, y] = [ex, ey];
    } else {
      out.push('h');
      [x, y] = [startX, startY];
    }
  }
  return out.length ? out.join(' ') : null;
}

/**
 * Text art (a text watermark, or WordArt on the line): the outlines layout fitted to the box, turned about
 * the box centre and filled with the shape's colour and opacity, as the screen draws them. Text
 * art an installed layout drew paints its vector components instead.
 */
export function paintTextArt(
  doc: PDFDocument,
  page: PDFPage,
  visit: SemanticDrawingVisit,
  work: Work
): string {
  const d = visit.drawing;
  const art = d.textArt;
  if (!art) return '';
  if (art.path === null && !art.components) {
    work.report('drawing', 'Text art has no glyph outlines in its face', visit.page.index);
    return '';
  }
  const operators = art.components ? '' : pathOperators(art.path ?? '', work);
  if (operators === null) {
    work.report('drawing', 'Text art outline is malformed', visit.page.index);
    return '';
  }
  const height = pageHeight(page);
  const dx = visit.drawingOrigin.x - d.x - visit.page.box.x;
  const dy = visit.drawingOrigin.y - d.y - visit.page.box.y;
  // Box-local (x right, y down) to PDF user space, turned clockwise about the box centre.
  const radians = (art.rotationDegrees * Math.PI) / 180;
  const cos = Math.cos(radians),
    sin = Math.sin(radians);
  const cx = d.x + dx + d.width / 2,
    cy = d.y + dy + d.height / 2;
  const e = cx - (d.width / 2) * cos + (d.height / 2) * sin;
  const f = height - cy + (d.width / 2) * sin + (d.height / 2) * cos;
  const clip = `q ${rect(visit.absolutePaintBounds, -visit.page.box.x, -visit.page.box.y, height)} W n`;
  const turn = `${n(cos)} ${n(-sin)} ${n(-sin)} ${n(-cos)} ${n(e)} ${n(f)} cm`;
  if (art.components) {
    // An installed text art layout drew the text as vector components in box EMU.
    const unit = 12700;
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
    const out = new Commands(work);
    out.push(clip, turn, '0 J 0 j 4 M [] 0 d');
    for (const component of art.components) {
      work.tick();
      out.push(vectorComponentOps(doc, page, component, path, states, unit));
    }
    out.push('Q');
    return out.join('\n');
  }
  const state = doc.context.register(
    doc.context.obj({ Type: 'ExtGState', ca: art.fillAlpha, CA: art.strokeAlpha })
  );
  const stateName = `TextArtAlpha${state.objectNumber}`;
  page.node.setExtGState(PDFName.of(stateName), state);
  const fill = art.fillHex !== null;
  const stroke = art.strokeHex !== null;
  if (!fill && !stroke) return '';
  const out = new Commands(work);
  out.push(
    clip,
    turn,
    `/${stateName} gs`,
    ...(fill ? [`${color(art.fillHex)} rg`] : []),
    ...(stroke ? [`${color(art.strokeHex)} RG ${n(art.strokeWidthPt)} w 1 j`] : []),
    operators,
    fill && stroke ? 'B' : fill ? 'f' : 'S',
    'Q'
  );
  return out.join('\n');
}
