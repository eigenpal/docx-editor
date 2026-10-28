/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type { PDFPage } from 'pdf-lib';
import type {
  EquationBarGeometry,
  EquationGeometry,
  SemanticSpanVisit,
} from '@docx-editor.dev/core/layout';
import { TextWriter } from './text.ts';
import { Work, color } from './context.ts';
import { pageHeight, rect } from './context.ts';
import { mergeEquationText } from './equation-text-merge.ts';

export function paintEquation(
  visit: SemanticSpanVisit,
  page: PDFPage,
  text: TextWriter,
  work: Work
): string {
  const equation = visit.span.equation!;
  if (equation.truncated)
    work.report('equation-truncated', 'Core truncated an equation', visit.page.index);
  const top =
    visit.storyOrigin.y + visit.line.box.y + visit.line.baseline - equation.geometry.baseline;
  const out: string[] = [];
  const bar = (box: EquationBarGeometry['bar'], x: number, y: number) =>
    out.push(
      `${color(visit.span.style.color)} rg ${rect(box, x - visit.page.box.x, y - visit.page.box.y, pageHeight(page), true)} f`
    );
  function node(g: EquationGeometry, parentX: number, parentY: number): void {
    work.tick();
    const x = parentX + g.box.x,
      y = parentY + g.box.y;
    switch (g.kind) {
      case 'text':
      case 'fallback':
        if (g.kind === 'fallback')
          work.report('equation-fallback', 'Core uses fallback equation text', visit.page.index);
        out.push(
          text.paint(
            {
              ...visit,
              storyOrigin: { x: 0, y: 0 },
              line: { ...visit.line, box: { ...visit.line.box, y }, baseline: g.baseline },
              absoluteBox: { ...g.box, x, y },
              span: {
                ...visit.span,
                text: g.text,
                equation: undefined,
                glyphOffsetPt: 0,
                // The face layout measured: the math face, or an authored text face.
                style: {
                  ...visit.span.style,
                  ...(g.runStyle
                    ? {
                        fontFamily: g.runStyle.fontFamily,
                        fontFamilyEastAsia: g.runStyle.fontFamilyEastAsia,
                        bold: g.runStyle.bold,
                        italic: g.runStyle.italic,
                        characterSpacingPt: g.runStyle.characterSpacingPt,
                      }
                    : { fontFamily: 'Cambria Math', fontFamilyEastAsia: 'Cambria Math' }),
                  fontSizePt: g.fontSizePt,
                  verticalAlign: 'baseline',
                  baselineShiftPt: 0,
                },
              },
            },
            page
          )
        );
        return;
      case 'row':
        for (const child of g.items) node(child, x, y);
        return;
      case 'fraction':
        bar(g.bar, x, y);
        node(g.numerator, x, y);
        node(g.denominator, x, y);
        return;
      case 'radical':
        bar(g.bar, x, y);
        node(g.sign, x, y);
        node(g.radicand, x, y);
        if (g.degree) node(g.degree, x, y);
        return;
      case 'bar':
        bar(g.bar, x, y);
        node(g.body, x, y);
        return;
      case 'script':
        node(g.base, x, y);
        if (g.subscript) node(g.subscript, x, y);
        if (g.superscript) node(g.superscript, x, y);
        return;
      case 'nary':
        node(g.operator, x, y);
        node(g.body, x, y);
        if (g.lowerLimit) node(g.lowerLimit, x, y);
        if (g.upperLimit) node(g.upperLimit, x, y);
        return;
      default: {
        const unknown: never = g;
        work.report(
          'equation-unsupported',
          `Equation node ${(unknown as { kind?: string }).kind ?? 'unknown'} is not painted`,
          visit.page.index
        );
      }
    }
  }
  node(equation.geometry, visit.absoluteBox.x, top);
  // Spaced atoms paint as separate nodes; one face on one baseline writes one text object.
  return mergeEquationText(out, text.faces.values()).join('\n');
}
