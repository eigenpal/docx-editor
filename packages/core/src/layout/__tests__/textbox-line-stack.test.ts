// Lines of vertical shape text that stack from the left (`wps:bodyPr/@vert`,
// ST_TextVerticalType, ECMA-376 Part 1, 20.1.10.83) lay out from the bottom of the story.

import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { paragraphFragmentsOf } from '../semantic-records.ts';
import { stackLinesFromBottom } from '../textbox-line-stack.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function fragments() {
  const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${paragraph('aa bb cc dd')}${paragraph('ee')}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  const layout = layoutSemanticDocument(read.part, 1, {
    measurer: createFixedMeasurer(6, 14),
    // Room for two words on a line.
    geometry: { width: 36, height: 400, margin: { left: 0, right: 0, top: 0, bottom: 0 } },
  });
  return paragraphFragmentsOf(layout.pages[0]!);
}

test('each line takes the mirrored place and keeps its own geometry', () => {
  const source = fragments();
  const lines = source.flatMap((fragment) => fragment.lines);
  expect(lines).toHaveLength(3);
  const flowHeight = Math.max(...lines.map((line) => line.box.y + line.box.height));
  const stacked = stackLinesFromBottom(source, flowHeight).flatMap((fragment) =>
    fragment.kind === 'paragraph' ? fragment.lines : []
  );
  // The first line is the lowest, and the last one starts the flow.
  expect(stacked.map((line) => line.box.y)).toEqual(
    lines.map((line) => flowHeight - line.box.y - line.box.height)
  );
  expect(stacked.at(-1)!.box.y).toBe(0);
  for (const [index, line] of stacked.entries()) {
    const before = lines[index]!;
    expect(line.box.height).toBe(before.box.height);
    expect(line.baseline).toBe(before.baseline);
    // The text moves with its line.
    expect(line.spans.map((span) => span.box.y - line.box.y)).toEqual(
      before.spans.map((span) => span.box.y - before.box.y)
    );
    expect(line.spans.map((span) => span.box.x)).toEqual(before.spans.map((span) => span.box.x));
  }
});

test('mirroring twice gives the first layout', () => {
  const source = fragments();
  const flowHeight = Math.max(...source.map((fragment) => fragment.box.y + fragment.box.height));
  expect(stackLinesFromBottom(stackLinesFromBottom(source, flowHeight), flowHeight)).toEqual(
    source
  );
});
