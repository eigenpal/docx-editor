import { expect, test } from 'bun:test';
import { defineFontResolver, exportMarkdown } from '../src/index.ts';
import { docx } from './fixture.ts';

test('plain text with bundled fonts has no warnings', async () => {
  const result = await exportMarkdown(docx('<w:p><w:r><w:t>Text</w:t></w:r></w:p>'));
  expect(result.warnings).toEqual([]);
  expect(Object.isFrozen(result.warnings)).toBe(true);
});

test('reports legacy text boxes even when layout omits their records', async () => {
  const textbox =
    '<w:p><w:r><w:pict><v:shape id="box" type="#_x0000_t202" xmlns:v="urn:schemas-microsoft-com:vml" ' +
    'style="position:absolute;width:200pt;height:100pt"><v:textbox><w:txbxContent>' +
    '<w:p><w:r><w:t>Text box content</w:t></w:r></w:p>' +
    '</w:txbxContent></v:textbox></v:shape></w:pict></w:r></w:p>';
  const result = await exportMarkdown(
    docx(
      '<w:p><w:r><w:t>Body text</w:t></w:r></w:p>' +
        textbox +
        textbox.replace('id="box"', 'id="box2"')
    )
  );
  expect(result.markdown.trim()).toBe('Body text');
  expect(result.warnings).toEqual([
    {
      code: 'omitted-textbox',
      message: 'Legacy text box content in /word/document.xml may be omitted from Markdown.',
      partName: '/word/document.xml',
    },
  ]);
});

test('reports failed origins and incomplete fonts in best-effort output', async () => {
  const result = await exportMarkdown(
    docx(
      '<w:p><w:r><w:rPr><w:rFonts w:ascii="MissingTestFont"/></w:rPr><w:t>Text</w:t></w:r></w:p>'
    ),
    {
      fonts: defineFontResolver(() => {
        throw new Error('Font service unavailable');
      }),
    }
  );
  expect(result.markdown).toBe('Text');
  expect(result.warnings).toContainEqual({
    code: 'font-origin-failed',
    message: 'A font source failed: Font service unavailable',
  });
  expect(
    result.warnings.some(
      (warning) => warning.code === 'incomplete-font' && warning.message.includes('MissingTestFont')
    )
  ).toBe(true);
});
