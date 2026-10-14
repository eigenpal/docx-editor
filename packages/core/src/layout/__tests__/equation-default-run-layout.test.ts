import { expect, test } from 'bun:test';
import {
  projectOmmlEquation,
  readOoxmlPart,
  type EquationExpression,
  type OoxmlNode,
  type OmmlEquationProjection,
} from '@docx-editor.dev/core/store';
import { layoutEquation } from '../equation-layout.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { resolveRunStyle } from '../run-style.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const FONT = '<w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/>';

function equationOf(body: string): OoxmlNode {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:m="${M}"><w:body><w:p>` +
      `<m:oMath>${body}</m:oMath></w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const find = (node: OoxmlNode): OoxmlNode | undefined => {
    if (node.kind === 'textValue') return undefined;
    if (node.namespaceUri === M && node.localName === 'oMath') return node;
    for (const child of node.children) {
      const found = find(child);
      if (found) return found;
    }
    return undefined;
  };
  return find(parsed.part.root)!;
}

// Letters, digits, an operator, and a Greek letter: every glyph class the math style maps.
const body = (properties: string) => {
  const run = (text: string) => `<m:r>${properties}<m:t>${text}</m:t></m:r>`;
  return (
    `${run('x+1')}<m:f><m:num>${run('αb')}</m:num><m:den>${run('2')}</m:den></m:f>` +
    `<m:sSup><m:e>${run('y')}</m:e><m:sup>${run('n')}</m:sup></m:sSup>`
  );
};

function geometry(projection: OmmlEquationProjection) {
  return layoutEquation(projection, createFixedMeasurer(6, 14), resolveRunStyle([])).geometry;
}

test.each([
  ['the math font', `<w:rPr>${FONT}</w:rPr>`],
  ['the math font and italic', `<w:rPr>${FONT}<w:i/><w:iCs/></w:rPr>`],
  [
    'every default property',
    `<w:rPr>${FONT}<w:i/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US"/></w:rPr>`,
  ],
])('default run properties with %s lay out like runs without them', (_name, properties) => {
  const plain = projectOmmlEquation(equationOf(body('')))!;
  const formatted = projectOmmlEquation(equationOf(body(properties)))!;
  expect(formatted.expression).toEqual(plain.expression);
  expect(geometry(formatted)).toEqual(geometry(plain));
});

// Runs whose default properties differ stay read-only, but they draw like runs without them.
test('runs with different default sizes lay out like runs without properties', () => {
  const sized = (size: string) => `<w:rPr>${FONT}<w:sz w:val="${size}"/></w:rPr>`;
  const mixed = `<m:r>${sized('24')}<m:t>x+1</m:t></m:r><m:r>${sized('28')}<m:t>y</m:t></m:r>`;
  const plain = '<m:r><m:t>x+1</m:t></m:r><m:r><m:t>y</m:t></m:r>';
  const formatted = projectOmmlEquation(equationOf(mixed))!;
  expect(JSON.stringify(formatted.expression)).toContain('format');
  expect(geometry(formatted)).toEqual(geometry(projectOmmlEquation(equationOf(plain))!));
});

// The run format that the projection carried before default run properties were recognized.
// Without `m:rPr`, layout ignores the math font and `w:i`: the default italic math style
// already maps letters to mathematical italic glyphs and leaves digits and operators upright.
test('the math font and italic do not change the geometry of a run without m:rPr', () => {
  const projection = (format?: { fontFamily: string; italic: boolean }) =>
    ({
      sourceNodeId: 'public-equation',
      expression: Object.freeze({
        kind: 'text',
        value: 'x+1α',
        ...(format ? { format } : {}),
      }) as EquationExpression,
      fallbackText: 'x+1α',
      truncated: false,
      visitedNodes: 3,
    }) satisfies OmmlEquationProjection;
  expect(geometry(projection({ fontFamily: 'Cambria Math', italic: true }))).toEqual(
    geometry(projection())
  );
});
