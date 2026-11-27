// `fieldDate` on the Markdown converter: a DATE field with a `\@` picture (ECMA-376 Part 1,
// 17.16.5.13, 17.16.4.1) exports that moment. Without the option the field keeps its saved
// result.
import { expect, test } from 'bun:test';
import { exportMarkdown } from '../src/index.ts';
import { docx } from './fixture.ts';

/** Thursday 5 March 2026, 14:07 local time. */
const MOMENT = new Date(2026, 2, 5, 14, 7);
const source = docx(
  '<w:p>' +
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r>' +
    '<w:r><w:instrText xml:space="preserve"> DATE \\@ "d MMMM yyyy" </w:instrText></w:r>' +
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
    '<w:r><w:t>1 January 2020</w:t></w:r>' +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r>' +
    '</w:p>'
);

test('fieldDate exports the date; the default keeps the saved result', async () => {
  expect((await exportMarkdown(source)).markdown.trim()).toBe('1 January 2020');
  expect((await exportMarkdown(source, { fieldDate: MOMENT })).markdown.trim()).toBe(
    '5 March 2026'
  );
});

test('an invalid fieldDate is refused', async () => {
  await expect(exportMarkdown(source, { fieldDate: new Date(Number.NaN) })).rejects.toThrow(
    'Invalid fieldDate'
  );
});
