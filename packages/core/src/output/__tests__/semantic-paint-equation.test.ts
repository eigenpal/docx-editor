import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import {
  OFFICE_MATH_NAMESPACE_URI,
  WML_NAMESPACE_URI,
  readOoxmlPart,
} from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument, linesOf } from '@docx-editor.dev/core/layout';
import { paintSemanticLayout } from '../semantic-paint.ts';

function layoutAndPaint(body: string) {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:m="${OFFICE_MATH_NAMESPACE_URI}">` +
      `<w:body>${body}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  const layout = layoutSemanticDocument(read.part, 3, {
    measurer: createFixedMeasurer(6, 14),
  });
  const container = document.createElement('div');
  paintSemanticLayout(container, layout, { scale: 1 });
  return { container, layout };
}

const supported =
  '<m:oMath>' +
  '<m:f><m:num><m:r><m:t>a</m:t></m:r></m:num>' +
  '<m:den><m:r><m:t>b</m:t></m:r></m:den></m:f>' +
  '<m:rad><m:deg/><m:e><m:r><m:t>x</m:t></m:r></m:e></m:rad>' +
  '<m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e>' +
  '<m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup>' +
  '<m:nary><m:naryPr><m:chr m:val="∑"/></m:naryPr>' +
  '<m:sub><m:r><m:t>n</m:t></m:r></m:sub><m:sup/>' +
  '<m:e><m:r><m:t>x</m:t></m:r></m:e></m:nary>' +
  '</m:oMath>';

describe('semantic equation paint', () => {
  test('paints nested layout records with activation metadata and pointer events', () => {
    const { container, layout } = layoutAndPaint(
      `<w:p><w:r><w:t>A</w:t></w:r>${supported}<w:r><w:t>Z</w:t></w:r></w:p>`
    );
    const record = linesOf(layout)[0]!.spans.find((span) => span.equation)!;
    const equation = container.querySelector<HTMLElement>('[data-docx-equation]');

    expect(equation).not.toBeNull();
    expect(equation!.dataset.docxEquation).toBe(record.equation!.sourceNodeId);
    expect(equation!.dataset.paragraphId).toBe(record.range.paragraphId);
    expect(equation!.dataset.start).toBe(String(record.range.start));
    expect(equation!.dataset.end).toBe(String(record.range.end));
    expect(equation!.getAttribute('contenteditable')).toBe('false');
    expect(equation!.style.pointerEvents).toBe('auto');
    expect(Number.parseFloat(equation!.style.width)).toBeCloseTo(
      record.equation!.geometry.box.width,
      5
    );
    expect(Number.parseFloat(equation!.style.height)).toBeCloseTo(
      record.equation!.geometry.box.height,
      5
    );
    expect(equation!.querySelector('.docx-equation-fraction')).not.toBeNull();
    expect(equation!.querySelector('.docx-equation-radical')).not.toBeNull();
    expect(equation!.querySelector('.docx-equation-script')).not.toBeNull();
    expect(equation!.querySelector('.docx-equation-nary')).not.toBeNull();
    expect(equation!.querySelector('.docx-equation-fraction-bar')).not.toBeNull();
    expect(equation!.querySelector('.docx-equation-radical-bar')).not.toBeNull();
  });

  test('writes unsupported markup-like fallback through textContent', () => {
    const payload = '&lt;img src=x onerror=alert(1)&gt;';
    const { container } = layoutAndPaint(
      `<w:p><m:oMath><m:unsupported><m:r><m:t>${payload}</m:t></m:r>` +
        '</m:unsupported></m:oMath></w:p>'
    );
    const equation = container.querySelector<HTMLElement>('[data-docx-equation]')!;
    expect(equation.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(equation.querySelector('img')).toBeNull();
    expect(equation.querySelector('script')).toBeNull();
  });
});
