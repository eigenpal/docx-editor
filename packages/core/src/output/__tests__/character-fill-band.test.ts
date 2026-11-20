// Character highlight and shading on lines whose runs share one fill band: exact line spacing,
// and a line that an inline picture raises above its text.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import {
  createFixedMeasurer,
  layoutSemanticDocument,
  linesOf,
  type LineRecord,
  type SemanticLayout,
} from '../../layout/index.ts';
import { layoutContext, load } from '../../layout/__tests__/anchored-drawing-test-fixtures.ts';
import { elevenPointDefaults } from '../../layout/__tests__/fixtures/eleven-point-defaults.ts';
import { paintSemanticLayout } from '../semantic-paint.ts';
import { characterFillLayer } from '../semantic-paint-character-fill.ts';

const NAMESPACES =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

/** An inline picture 40pt square, taller than the text beside it. */
const picture =
  '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
  '<wp:extent cx="508000" cy="508000"/><wp:docPr id="1" name="p1"/>' +
  '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
  '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name=""/><pic:cNvPicPr/></pic:nvPicPr>' +
  '<pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
  '<pic:spPr><a:xfrm><a:ext cx="508000" cy="508000"/></a:xfrm><a:prstGeom prst="rect"/>' +
  '</pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
const HIGHLIGHT = '<w:highlight w:val="yellow"/>';
const SHADING = '<w:shd w:val="clear" w:color="auto" w:fill="00FFFF"/>';
const run = (text: string, rPr = '') =>
  `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const spacing = (line: number, rule: string) =>
  `<w:pPr><w:spacing w:line="${line}" w:lineRule="${rule}"/></w:pPr>`;
const pictureParagraph = (pPr = '', mark = HIGHLIGHT) =>
  `<w:p>${pPr}${run('before ', mark)}${picture}${run(' after', mark)}</w:p>`;
const cell = (content: string) =>
  '<w:tbl><w:tblGrid><w:gridCol w:w="7200"/></w:tblGrid><w:tr><w:tc>' +
  `<w:tcPr><w:tcW w:w="7200" w:type="dxa"/></w:tcPr>${content}</w:tc></w:tr></w:tbl>`;

function layoutOf(body: string): SemanticLayout {
  const document = load(`<w:document ${NAMESPACES}><w:body>${body}</w:body></w:document>`);
  return layoutSemanticDocument(document, 1, {
    measurer: createFixedMeasurer(6, 14),
    styleCascade: elevenPointDefaults(),
    inlineDrawingLayout: layoutContext(document),
  });
}

function firstLine(body: string): { layout: SemanticLayout; line: LineRecord } {
  const layout = layoutOf(body);
  return { layout, line: linesOf(layout)[0]! };
}

function paint(layout: SemanticLayout): HTMLElement {
  const host = document.createElement('div');
  paintSemanticLayout(host, layout, { scale: 1 });
  return host;
}

describe('the band a line publishes', () => {
  test('beside a picture it covers the natural content band from the line top', () => {
    const { line } = firstLine(pictureParagraph());
    expect(line.characterFillBand).toEqual({ top: 0, height: line.box.height });
    expect(line.box.height).toBeGreaterThan(40);
  });

  test('auto spacing extra below the content stays clear', () => {
    const single = firstLine(pictureParagraph()).line;
    const { line } = firstLine(pictureParagraph(spacing(480, 'auto')));
    expect(line.box.height).toBeGreaterThan(single.box.height);
    expect(line.characterFillBand).toEqual({ top: 0, height: single.box.height });
  });

  test('atLeast spacing room above the content stays clear', () => {
    const single = firstLine(pictureParagraph()).line;
    const { line } = firstLine(pictureParagraph(spacing(1200, 'atLeast')));
    expect(line.box.height).toBeCloseTo(60, 5);
    const band = line.characterFillBand!;
    expect(band.height).toBeCloseTo(single.box.height, 5);
    expect(band.top).toBeCloseTo(60 - single.box.height, 5);
  });

  test('exact spacing fills the whole line box', () => {
    const { line } = firstLine(pictureParagraph(spacing(624, 'exact')));
    expect(line.characterFillBand).toEqual({ top: 0, height: line.box.height });
    expect(line.box.height).toBeCloseTo(31.2, 5);
  });

  test('a table cell line publishes the same band as a body line', () => {
    const body = firstLine(pictureParagraph()).line.characterFillBand;
    const layout = layoutOf(cell(pictureParagraph()));
    const cellLine = linesOf(layout).find((line) => (line.drawings?.length ?? 0) > 0);
    expect(cellLine?.characterFillBand).toEqual(body);
  });

  test('character shading publishes the band too', () => {
    const { line } = firstLine(pictureParagraph('', SHADING));
    expect(line.characterFillBand).toEqual({ top: 0, height: line.box.height });
  });

  test('a picture inside the text band raises nothing and publishes none', () => {
    const icon = picture.replaceAll('508000', '63500');
    const body =
      `<w:p>${run('small', `<w:sz w:val="16"/>${HIGHLIGHT}`)}${icon}` +
      `${run('large', `<w:sz w:val="40"/>${HIGHLIGHT}`)}</w:p>`;
    const { line } = firstLine(body);
    expect(line.drawings?.length).toBe(1);
    expect(line.characterFillBand).toBeUndefined();
  });

  test('lines without a fill, or with auto spacing and no picture, publish none', () => {
    expect(firstLine(pictureParagraph('', '')).line.characterFillBand).toBeUndefined();
    expect(
      firstLine(`<w:p>${run('marked', HIGHLIGHT)}${run(' plain')}</w:p>`).line.characterFillBand
    ).toBeUndefined();
  });
});

describe('painting the band', () => {
  test('a picture line fills each marked advance over the band, behind the text', () => {
    const { layout, line } = firstLine(pictureParagraph());
    const row = paint(layout).querySelector<HTMLElement>(`[data-line-id="${line.id}"]`)!;
    const layer = row.querySelector<HTMLElement>(':scope > .docx-character-fill-band')!;
    expect(layer.getAttribute('aria-hidden')).toBe('true');
    expect(layer.getAttribute('contenteditable')).toBe('false');
    const backings = [...layer.children] as HTMLElement[];
    const marked = line.spans.filter((span) => span.style.highlight === 'yellow');
    expect(marked.length).toBeGreaterThanOrEqual(2);
    expect(backings.map((backing) => backing.dataset.highlight)).toEqual(
      marked.map(() => 'yellow')
    );
    backings.forEach((backing, index) => {
      expect(parseFloat(backing.style.left)).toBeCloseTo(marked[index]!.box.x - line.contentX, 5);
      expect(parseFloat(backing.style.width)).toBeCloseTo(marked[index]!.box.width, 5);
      expect(backing.style.top).toBe('0px');
      expect(parseFloat(backing.style.height)).toBeCloseTo(line.box.height, 5);
    });
    for (const run of row.querySelectorAll<HTMLElement>('.layout-run[data-highlight]'))
      expect(run.style.backgroundColor).toBe('');
  });

  test('an atLeast line seats the band below the room above the content', () => {
    const { layout, line } = firstLine(pictureParagraph(spacing(1200, 'atLeast')));
    const backing = paint(layout).querySelector<HTMLElement>(
      `[data-line-id="${line.id}"] .docx-character-fill-band > *`
    )!;
    expect(parseFloat(backing.style.top)).toBeCloseTo(line.characterFillBand!.top, 5);
    expect(parseFloat(backing.style.top)).toBeGreaterThan(0);
  });

  test('character shading moves to the band without the highlight marker', () => {
    const { layout, line } = firstLine(pictureParagraph('', SHADING));
    const backings = [
      ...paint(layout).querySelectorAll<HTMLElement>(
        `[data-line-id="${line.id}"] .docx-character-fill-band > *`
      ),
    ];
    expect(backings).toHaveLength(line.spans.filter((span) => span.style.shading).length);
    for (const backing of backings) {
      expect(backing.dataset.highlight).toBeUndefined();
      expect(backing.style.backgroundColor).not.toBe('');
    }
  });

  test('exact spacing fills each marked advance for the full line in body and cells', () => {
    const formatted =
      `<w:p>${spacing(580, 'exact')}` +
      run('small', `<w:sz w:val="16"/>${HIGHLIGHT}`) +
      run('plain') +
      run('large', `<w:sz w:val="32"/><w:highlight w:val="green"/>`) +
      '</w:p>';
    const host = paint(layoutOf(formatted + cell(formatted)));
    const layers = [...host.querySelectorAll<HTMLElement>('.docx-character-fill-band')];
    expect(layers).toHaveLength(2);
    for (const layer of layers) {
      const bands = [...layer.querySelectorAll<HTMLElement>('[data-highlight]')];
      expect(bands.map((band) => band.dataset.highlight)).toEqual(['yellow', 'green']);
      expect(bands.map((band) => band.style.height)).toEqual(['29px', '29px']);
      expect(bands.map((band) => band.style.top)).toEqual(['0px', '0px']);
      expect(parseFloat(bands[0]!.style.left) + parseFloat(bands[0]!.style.width)).toBeLessThan(
        parseFloat(bands[1]!.style.left)
      );
    }
    const automatic = paint(layoutOf(formatted.replace('580', '360').replace('exact', 'auto')));
    expect(automatic.querySelector('.docx-character-fill-band')).toBeNull();
    expect(automatic.querySelectorAll('.layout-run[data-highlight]')).toHaveLength(2);
  });

  test('a fill something else replaced stays on the run', () => {
    const { line } = firstLine(pictureParagraph());
    const span = line.spans.find((candidate) => candidate.style.highlight === 'yellow')!;
    const layer = characterFillLayer(document, line, 1)!;
    const washed = document.createElement('span');
    washed.dataset.highlight = 'yellow';
    washed.style.backgroundColor = 'rgb(1, 2, 3)';
    layer.add(washed, span, 0);
    const host = document.createElement('div');
    layer.mount(host);
    expect(washed.style.backgroundColor).toBe('rgb(1, 2, 3)');
    expect(host.querySelector('.docx-character-fill-band')).toBeNull();
  });
});
