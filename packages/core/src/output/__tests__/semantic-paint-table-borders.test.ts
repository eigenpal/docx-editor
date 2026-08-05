// Table cell border paint — coordinated double-stroke corner joins.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { readOoxmlPart, readOoxmlPackage } from '@docx-editor.dev/core-contract/store';
import { createFixedMeasurer, layoutSemanticDocument } from '@docx-editor.dev/core-contract/layout';
import { paintSemanticLayout } from '../semantic-paint.ts';
import { applyCellBorders } from '../semantic-paint-table-borders.ts';
import type {
  ResolvedCellBorders,
  TableBorderStrokeRecord,
} from '@docx-editor.dev/core-contract/layout';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function layoutOf(body: string) {
  const read = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!read.ok) throw new Error(read.reason);
  return layoutSemanticDocument(read.part, 7, {
    measurer: createFixedMeasurer(6, 14),
  });
}

describe('table cell border paint', () => {
  const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
  const tc = (content: string, tcPr = '') => `<w:tc>${tcPr}${content}</w:tc>`;
  const tr = (cells: string) => `<w:tr>${cells}</w:tr>`;

  test('does not hardcode a black grid; paints resolved styles and skips continue cells', () => {
    const body =
      '<w:tbl>' +
      '<w:tblPr><w:tblBorders>' +
      '<w:top w:val="single" w:sz="4"/>' +
      '<w:left w:val="single" w:sz="4"/>' +
      '<w:bottom w:val="single" w:sz="4"/>' +
      '<w:right w:val="single" w:sz="4"/>' +
      '<w:insideH w:val="single" w:sz="4"/>' +
      '<w:insideV w:val="single" w:sz="4"/>' +
      '</w:tblBorders></w:tblPr>' +
      tr(
        tc(
          p('A'),
          '<w:tcPr><w:vMerge w:val="restart"/><w:tcBorders>' +
            '<w:top w:val="double" w:color="2E75B6" w:sz="24"/>' +
            '<w:left w:val="double" w:color="2E75B6" w:sz="24"/>' +
            '<w:bottom w:val="single" w:color="999999" w:sz="1"/>' +
            '<w:right w:val="dashed" w:color="CC3333" w:sz="8"/>' +
            '</w:tcBorders></w:tcPr>'
        ) +
          tc(
            p('B'),
            '<w:tcPr><w:tcBorders>' +
              '<w:top w:val="dotted" w:color="339933" w:sz="8"/>' +
              '<w:left w:val="dashed" w:color="CC3333" w:sz="8"/>' +
              '<w:bottom w:val="triple" w:color="9933CC" w:sz="24"/>' +
              '<w:right w:val="dotted" w:color="339933" w:sz="8"/>' +
              '</w:tcBorders></w:tcPr>'
          )
      ) +
      tr(
        tc(p('ghost'), '<w:tcPr><w:vMerge w:val="continue"/></w:tcPr>') +
          tc(
            p('C'),
            '<w:tcPr><w:tcBorders>' +
              '<w:top w:val="none"/>' +
              '<w:left w:val="none"/>' +
              '<w:bottom w:val="triple" w:color="9933CC" w:sz="24"/>' +
              '<w:right w:val="dotted" w:color="339933" w:sz="8"/>' +
              '</w:tcBorders></w:tcPr>'
          )
      ) +
      '</w:tbl>';
    const container = document.createElement('div');
    paintSemanticLayout(container, layoutOf(body), { scale: 1 });
    const cells = [...container.querySelectorAll<HTMLElement>('.docx-table-cell')];
    expect(cells.length).toBe(4);
    // No cell keeps the old hardcoded black shorthand.
    for (const cell of cells) {
      expect(cell.style.border).not.toBe('1px solid #000000');
    }
    const restart = cells[0]!;
    expect(restart.style.borderTopStyle).toBe('none');
    expect(restart.style.borderTopColor).toBe('#2E75B6');
    expect(restart.querySelector('.docx-table-border-double')).not.toBeNull();
    expect(restart.style.borderRightStyle).toBe('dashed');
    expect(restart.style.borderRightColor).toBe('#CC3333');
    expect(restart.dataset.rowSpan).toBe('2');

    const continueCell = cells[2]!;
    expect(continueCell.dataset.vMergeContinue).toBe('true');
    expect(continueCell.style.borderTopStyle).toBe('none');
    expect(continueCell.style.backgroundColor).toBe('transparent');
    expect(continueCell.children.length).toBe(0);

    const topRight = cells[1]!;
    expect(topRight.style.borderTopStyle).toBe('dotted');
    expect(topRight.style.borderTopColor).toBe('#339933');
    // Triple uses an inert overlay.
    const bottomRight = cells[3]!;
    const triple = bottomRight.querySelector('.docx-table-border-triple');
    expect(triple).not.toBeNull();
    expect(triple!.getAttribute('aria-hidden')).toBe('true');
    expect(triple!.getAttribute('contenteditable')).toBe('false');
  });

  test('hostile border color never reaches CSS', () => {
    const body = `<w:tbl>${tr(
      tc(
        p('x'),
        '<w:tcPr><w:tcBorders><w:top w:val="single" w:color="url(x)" w:sz="8"/></w:tcBorders></w:tcPr>'
      )
    )}</w:tbl>`;
    const container = document.createElement('div');
    paintSemanticLayout(container, layoutOf(body), { scale: 1 });
    const cell = container.querySelector<HTMLElement>('.docx-table-cell')!;
    // Invalid color → paint defaults to black, never a raw URL.
    expect(cell.style.borderTopColor).toBe('#000000');
    expect(cell.style.borderTop).not.toContain('url');
  });

  function doubleCell(
    borders: { top?: boolean; right?: boolean; bottom?: boolean; left?: boolean },
    sz = '3',
    scale = 1
  ): HTMLElement {
    const parts: string[] = [];
    const color = '2E75B6';
    for (const [side, on] of Object.entries(borders)) {
      if (on) {
        parts.push(`<w:${side} w:val="double" w:color="${color}" w:sz="${sz}"/>`);
      }
    }
    const body = `<w:tbl>${tr(tc(p('x'), `<w:tcPr><w:tcBorders>${parts.join('')}</w:tcBorders></w:tcPr>`))}</w:tbl>`;
    const container = document.createElement('div');
    paintSemanticLayout(container, layoutOf(body), { scale });
    return container.querySelector<HTMLElement>('.docx-table-cell')!;
  }

  function parsePx(value: string | undefined): number {
    if (!value) return 0;
    return Number.parseFloat(value) || 0;
  }

  type StrokeSeg = {
    edge: string;
    which: string;
    left: number;
    top: number;
    width: number;
    height: number;
    color: string;
  };

  function doubleHost(cell: HTMLElement): HTMLElement {
    const host = cell.querySelector<HTMLElement>('.docx-table-border-double');
    expect(host).not.toBeNull();
    expect(host!.getAttribute('aria-hidden')).toBe('true');
    expect(host!.getAttribute('contenteditable')).toBe('false');
    expect(host!.style.pointerEvents).toBe('none');
    return host!;
  }

  function strokeSegs(cell: HTMLElement): StrokeSeg[] {
    return [...cell.querySelectorAll<HTMLElement>('.docx-table-border-double-stroke')].map(
      (el) => ({
        edge: el.dataset.edge ?? '',
        which: el.dataset.stroke ?? '',
        left: parsePx(el.style.left),
        top: parsePx(el.style.top),
        width: parsePx(el.style.width),
        height: parsePx(el.style.height),
        color: el.style.backgroundColor,
      })
    );
  }

  function seg(segs: StrokeSeg[], edge: string, which: 'outer' | 'inner'): StrokeSeg {
    const found = segs.find((s) => s.edge === edge && s.which === which);
    expect(found).toBeDefined();
    return found!;
  }

  /** Rectangles share an area (the old full-length overlays crossed into a grid here). */
  function rectsOverlap(
    a: { left: number; top: number; width: number; height: number },
    b: { left: number; top: number; width: number; height: number }
  ): boolean {
    return (
      a.left < b.left + b.width &&
      a.left + a.width > b.left &&
      a.top < b.top + b.height &&
      a.top + a.height > b.top
    );
  }

  test('double edges paint inert stroke segments at thin sz on all sides', () => {
    const cell = doubleCell({ top: true, right: true, bottom: true, left: true }, '3');
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const styleKey = `border${side[0]!.toUpperCase()}${side.slice(1)}Style` as 'borderTopStyle';
      expect(cell.style[styleKey]).toBe('none');
    }
    const host = doubleHost(cell);
    expect(host.style.left).toBe('0px');
    expect(host.style.top).toBe('0px');
    const segs = strokeSegs(cell);
    expect(segs).toHaveLength(8); // 4 edges × outer+inner
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const outer = seg(segs, side, 'outer');
      const inner = seg(segs, side, 'inner');
      expect(outer.color.replace(/^#/, '').toLowerCase()).toBe('2e75b6');
      expect(inner.color.replace(/^#/, '').toLowerCase()).toBe('2e75b6');
      if (side === 'top' || side === 'bottom') {
        expect(outer.height).toBe(1);
        expect(inner.height).toBe(1);
        // 1px authored band → extent 3 centered with inset -1.
        if (side === 'top') {
          expect(outer.top).toBe(-1);
          expect(inner.top).toBe(1);
        }
      } else {
        expect(outer.width).toBe(1);
        expect(inner.width).toBe(1);
        if (side === 'left') {
          expect(outer.left).toBe(-1);
          expect(inner.left).toBe(1);
        }
      }
    }
  });

  test('double+double corners form concentric L joins without cross-grid', () => {
    const cell = doubleCell({ top: true, left: true }, '3');
    const segs = strokeSegs(cell);
    const topOuter = seg(segs, 'top', 'outer');
    const topInner = seg(segs, 'top', 'inner');
    const leftOuter = seg(segs, 'left', 'outer');
    const leftInner = seg(segs, 'left', 'inner');

    // Horizontal owns the corner; vertical starts after the owned band.
    expect(topOuter.left).toBe(-1);
    expect(topOuter.top).toBe(-1);
    expect(leftOuter.left).toBe(-1);
    expect(leftOuter.top).toBe(0); // -1 + 1 stroke
    expect(rectsOverlap(topOuter, leftOuter)).toBe(false);

    expect(topInner.left).toBe(1); // left inset + stroke + gap
    expect(topInner.top).toBe(1);
    expect(leftInner.left).toBe(1);
    expect(leftInner.top).toBe(2); // below top's full extent
    expect(rectsOverlap(topInner, leftInner)).toBe(false);

    // No stroke protrudes past the opposite (absent) edge as a cap.
    expect(topOuter.left).toBeGreaterThanOrEqual(-1);
    expect(leftOuter.top).toBeGreaterThanOrEqual(0);
  });

  test('double+dashed keeps dashed CSS and flush double ends', () => {
    const body =
      '<w:tbl>' +
      tr(
        tc(
          p('x'),
          '<w:tcPr><w:tcBorders>' +
            '<w:top w:val="double" w:color="2E75B6" w:sz="3"/>' +
            '<w:right w:val="dashed" w:color="CC3333" w:sz="8"/>' +
            '</w:tcBorders></w:tcPr>'
        )
      ) +
      '</w:tbl>';
    const container = document.createElement('div');
    paintSemanticLayout(container, layoutOf(body), { scale: 1 });
    const cell = container.querySelector<HTMLElement>('.docx-table-cell')!;
    expect(cell.style.borderTopStyle).toBe('none');
    expect(cell.style.borderRightStyle).toBe('dashed');
    expect(cell.style.borderRightColor).toBe('#CC3333');
    expect(cell.querySelectorAll('.docx-table-border-double')).toHaveLength(1);
    expect(cell.querySelector('.docx-table-border-triple')).toBeNull();
    const segs = strokeSegs(cell);
    expect(segs).toHaveLength(2);
    const cellW = parsePx(cell.style.width);
    const topOuter = seg(segs, 'top', 'outer');
    const topInner = seg(segs, 'top', 'inner');
    // No right double neighbor → strokes run flush to the cell width (no side cap).
    expect(topOuter.left).toBe(0);
    expect(topOuter.left + topOuter.width).toBe(cellW);
    expect(topInner.left).toBe(0);
    expect(topInner.left + topInner.width).toBe(cellW);
  });

  test('double+single keeps single CSS and flush double ends', () => {
    const body =
      '<w:tbl>' +
      tr(
        tc(
          p('x'),
          '<w:tcPr><w:tcBorders>' +
            '<w:left w:val="double" w:color="2E75B6" w:sz="3"/>' +
            '<w:bottom w:val="single" w:color="000000" w:sz="8"/>' +
            '</w:tcBorders></w:tcPr>'
        )
      ) +
      '</w:tbl>';
    const container = document.createElement('div');
    paintSemanticLayout(container, layoutOf(body), { scale: 1 });
    const cell = container.querySelector<HTMLElement>('.docx-table-cell')!;
    expect(cell.style.borderBottomStyle).toBe('solid');
    expect(cell.style.borderBottomColor).toBe('#000000');
    const segs = strokeSegs(cell);
    const cellH = parsePx(cell.style.height);
    const leftOuter = seg(segs, 'left', 'outer');
    const leftInner = seg(segs, 'left', 'inner');
    expect(leftOuter.top).toBe(0);
    expect(leftOuter.top + leftOuter.height).toBe(cellH);
    expect(leftInner.top).toBe(0);
    expect(leftInner.top + leftInner.height).toBe(cellH);
  });

  test('double+none does not protrude past the open edge', () => {
    const cell = doubleCell({ top: true }, '3');
    const segs = strokeSegs(cell);
    const cellW = parsePx(cell.style.width);
    const topOuter = seg(segs, 'top', 'outer');
    const topInner = seg(segs, 'top', 'inner');
    expect(topOuter.left).toBe(0);
    expect(topOuter.left + topOuter.width).toBe(cellW);
    expect(topInner.left).toBe(0);
    expect(topInner.left + topInner.width).toBe(cellW);
    // Only extends on the authored axis (inset -1), not laterally.
    expect(topOuter.top).toBe(-1);
  });

  test('double edges scale stroke thickness at thicker sz', () => {
    const cell = doubleCell({ top: true, bottom: true }, '24', 1);
    const segs = strokeSegs(cell);
    const topOuter = seg(segs, 'top', 'outer');
    const topInner = seg(segs, 'top', 'inner');
    expect(topOuter.height).toBe(1);
    expect(topInner.height).toBe(1);
    expect(topOuter.top).toBe(0);
    expect(topInner.top).toBe(2); // stroke + gap
  });

  test('double overlays respect scale factor', () => {
    const cell = doubleCell({ left: true }, '24', 2);
    const segs = strokeSegs(cell);
    const leftOuter = seg(segs, 'left', 'outer');
    const leftInner = seg(segs, 'left', 'inner');
    expect(leftOuter.width).toBe(2);
    expect(leftInner.width).toBe(2);
    expect(leftOuter.left).toBe(0);
    expect(leftInner.left).toBe(4); // 2 stroke + 2 gap
  });

  test('triple overlay regression after double refactor', () => {
    const body =
      '<w:tbl>' +
      tr(
        tc(
          p('x'),
          '<w:tcPr><w:tcBorders>' +
            '<w:bottom w:val="triple" w:color="9933CC" w:sz="24"/>' +
            '</w:tcBorders></w:tcPr>'
        )
      ) +
      '</w:tbl>';
    const container = document.createElement('div');
    paintSemanticLayout(container, layoutOf(body), { scale: 1 });
    const cell = container.querySelector<HTMLElement>('.docx-table-cell')!;
    expect(cell.style.borderBottomStyle).toBe('none');
    const triple = cell.querySelector<HTMLElement>('.docx-table-border-triple')!;
    expect(triple).not.toBeNull();
    expect(triple.getAttribute('aria-hidden')).toBe('true');
    expect(triple.getAttribute('contenteditable')).toBe('false');
    expect(triple.style.pointerEvents).toBe('none');
    // Paint draws published stroke rectangles verbatim (no host CSS border geometry).
    const strokes = [...triple.querySelectorAll<HTMLElement>('.docx-table-border-triple-stroke')];
    expect(strokes).toHaveLength(3);
    for (const stroke of strokes) {
      expect(stroke.style.height).toBe('3px');
      expect(stroke.style.backgroundColor.replace(/^#/, '').toLowerCase()).toBe('9933cc');
    }
    // gap = max(1, 3) → extent 15; strokes at y = cellH-15, cellH-15+6, cellH-15+12
    const cellH = parsePx(cell.style.height);
    const tops = strokes.map((s) => parsePx(s.style.top)).sort((a, b) => a - b);
    expect(tops[0]).toBe(cellH - 15);
    expect(tops[1]).toBe(cellH - 9);
    expect(tops[2]).toBe(cellH - 3);
    expect(cell.querySelector('.docx-table-border-double')).toBeNull();
  });

  test('paint scales layout stroke records verbatim (no geometry invention)', () => {
    const body =
      '<w:tbl>' +
      tr(
        tc(
          p('x'),
          '<w:tcPr><w:tcBorders>' +
            '<w:top w:val="double" w:color="2E75B6" w:sz="3"/>' +
            '<w:left w:val="double" w:color="2E75B6" w:sz="3"/>' +
            '</w:tcBorders></w:tcPr>'
        )
      ) +
      '</w:tbl>';
    const layout = layoutOf(body);
    const table = layout.pages[0]!.fragments.find((f) => f.kind === 'table');
    expect(table?.kind).toBe('table');
    const cellRecord = table!.rows[0]!.cells[0]!;
    const layoutStrokes = cellRecord.borders?.strokes ?? [];
    expect(layoutStrokes.length).toBeGreaterThan(0);

    for (const scale of [1, 2]) {
      const container = document.createElement('div');
      paintSemanticLayout(container, layout, { scale });
      const cell = container.querySelector<HTMLElement>('.docx-table-cell')!;
      const painted = [...cell.querySelectorAll<HTMLElement>('.docx-table-border-double-stroke')];
      expect(painted).toHaveLength(layoutStrokes.length);
      for (const stroke of layoutStrokes) {
        const el = painted.find(
          (node) => node.dataset.edge === stroke.side && node.dataset.stroke === stroke.role
        );
        expect(el).toBeDefined();
        expect(parsePx(el!.style.left)).toBeCloseTo(stroke.x * scale, 5);
        expect(parsePx(el!.style.top)).toBeCloseTo(stroke.y * scale, 5);
        expect(parsePx(el!.style.width)).toBeCloseTo(stroke.width * scale, 5);
        expect(parsePx(el!.style.height)).toBeCloseTo(stroke.height * scale, 5);
      }
    }
  });

  test('§18.5 explicit cell none suppresses painted table frame', () => {
    const bytes = readFileSync(
      `${import.meta.dir}/../../../../../e2e/fixtures/comprehensive-word-element-test.docx`
    );
    const result = readOoxmlPackage(bytes);
    if (!result.ok) throw new Error(result.reason);
    const part = result.package.parts.get(result.package.mainDocumentPart)!;
    const layout = layoutSemanticDocument(part, 0, { measurer: createFixedMeasurer() });
    const container = document.createElement('div');
    paintSemanticLayout(container, layout, { scale: 1 });
    const cells = [...container.querySelectorAll<HTMLElement>('.docx-table-cell')];
    const columnA = cells.find((cell) => cell.textContent?.includes('Column A'));
    expect(columnA).toBeDefined();
    const table = columnA!.closest('.docx-table-fragment') as HTMLElement;
    expect(table).not.toBeNull();
    const tableCells = [...table.querySelectorAll<HTMLElement>('.docx-table-cell')];
    for (const cell of tableCells) {
      expect(cell.querySelector('.docx-table-border-double')).toBeNull();
      expect(cell.querySelector('.docx-table-border-triple')).toBeNull();
      expect(cell.querySelector('.docx-table-border-edge-stroke')).toBeNull();
      for (const side of ['Top', 'Right', 'Bottom', 'Left'] as const) {
        const styleKey = `border${side}Style` as keyof CSSStyleDeclaration;
        const style = cell.style[styleKey];
        expect(style === '' || style === 'none').toBe(true);
      }
    }
  });

  test('§5.3 comprehensive fixture double blue corners are concentric Ls', () => {
    const bytes = readFileSync(
      `${import.meta.dir}/../../../../../e2e/fixtures/comprehensive-word-element-test.docx`
    );
    const result = readOoxmlPackage(bytes);
    if (!result.ok) throw new Error(result.reason);
    const part = result.package.parts.get(result.package.mainDocumentPart)!;
    const layout = layoutSemanticDocument(part, 0, { measurer: createFixedMeasurer() });
    const container = document.createElement('div');
    paintSemanticLayout(container, layout, { scale: 1 });
    const cells = [...container.querySelectorAll<HTMLElement>('.docx-table-cell')];
    const doubleBlue = cells.find((cell) => cell.textContent?.includes('Double blue'));
    expect(doubleBlue).toBeDefined();
    // TL cell: top, left, bottom are double blue; right is dashed red.
    expect(doubleBlue!.style.borderTopStyle).toBe('none');
    expect(doubleBlue!.style.borderLeftStyle).toBe('none');
    expect(doubleBlue!.style.borderBottomStyle).toBe('none');
    expect(doubleBlue!.style.borderRightStyle).toBe('dashed');
    expect(doubleBlue!.querySelectorAll('.docx-table-border-double')).toHaveLength(1);
    const segs = strokeSegs(doubleBlue!);
    expect(segs).toHaveLength(6); // top/left/bottom × outer+inner
    const host = doubleHost(doubleBlue!);
    expect(host.getAttribute('aria-hidden')).toBe('true');

    const topOuter = seg(segs, 'top', 'outer');
    const topInner = seg(segs, 'top', 'inner');
    const leftOuter = seg(segs, 'left', 'outer');
    const leftInner = seg(segs, 'left', 'inner');
    const bottomOuter = seg(segs, 'bottom', 'outer');
    const bottomInner = seg(segs, 'bottom', 'inner');

    expect(rectsOverlap(topOuter, leftOuter)).toBe(false);
    expect(rectsOverlap(topInner, leftInner)).toBe(false);
    expect(rectsOverlap(bottomOuter, leftOuter)).toBe(false);
    expect(rectsOverlap(bottomInner, leftInner)).toBe(false);

    // Top meets dashed right flush (no right double neighbor).
    const cellW = parsePx(doubleBlue!.style.width);
    expect(topOuter.left + topOuter.width).toBe(cellW);
    expect(topInner.left + topInner.width).toBe(cellW);
  });

  test('published stroke paint is linear in stroke count', () => {
    const sides: TableBorderStrokeRecord['side'][] = ['top', 'right', 'bottom', 'left'];
    const roles: TableBorderStrokeRecord['role'][] = ['outer', 'inner', 'middle'];

    function syntheticStrokes(count: number): TableBorderStrokeRecord[] {
      const strokes: TableBorderStrokeRecord[] = [];
      for (let index = 0; index < count; index += 1) {
        const side = sides[index % sides.length]!;
        const role = roles[index % roles.length]!;
        strokes.push({
          side,
          role,
          x: index,
          y: index,
          width: 1,
          height: 1,
          color: '2E75B6',
          cssStyle: 'solid',
        });
      }
      return strokes;
    }

    function paintedStrokeCount(strokes: readonly TableBorderStrokeRecord[]): number {
      const cell = document.createElement('div');
      const borders: ResolvedCellBorders = { strokes };
      applyCellBorders(document, cell, borders, 1);
      return cell.querySelectorAll(
        '.docx-table-border-double-stroke, .docx-table-border-triple-stroke, .docx-table-border-edge-stroke'
      ).length;
    }

    for (const count of [3, 6, 12, 24]) {
      const strokes = syntheticStrokes(count);
      expect(paintedStrokeCount(strokes)).toBe(count);
    }
  });
});
