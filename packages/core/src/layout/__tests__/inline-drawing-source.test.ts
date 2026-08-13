import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { drawingAtomIdentities } from '../inline-drawing-source.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';

test('part-wide drawing identity scan does not fail closed after 4k elements', () => {
  const prefix = Array.from({ length: 5_000 }, () => '<w:p/>').join('');
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:wp="${WP}"><w:body>${prefix}<w:p><w:r><w:drawing>` +
      '<wp:inline><wp:extent cx="1" cy="1"/></wp:inline></w:drawing></w:r></w:p>' +
      '</w:body></w:document>',
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);

  const atoms = drawingAtomIdentities(result.part);

  expect(atoms).not.toBeNull();
});
