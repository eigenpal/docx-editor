// Paint names the glyph fallback faces in a run's CSS font stack, right behind the alias of
// the face that layout shaped the run in. A character that face lacks then draws in the face
// that layout measured it in, not in a font the browser picks.
import { expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { layoutSemanticDocument } from '@docx-editor.dev/core/layout';
import { withGlyphFallbackAliases } from '../../layout/glyph-fallback-aliases.ts';
import type { TextMeasurer } from '../../layout/semantic-records.ts';
import { paintSemanticLayout } from '../semantic-paint.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer: TextMeasurer = {
  measure: (text, style) => text.length * style.fontSizePt * 0.5,
  lineMetrics: () => ({ height: 16, baseline: 12 }),
};

function paintedStack(fontAlias: (family: string) => string | undefined): string {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:rPr><w:rFonts w:ascii="Brand Sans" w:hAnsi="Brand Sans"/></w:rPr><w:t>abc ☐</w:t></w:r></w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!read.ok) throw new Error(read.reason);
  const result = layoutSemanticDocument(read.part, 0, {
    measurer,
    geometry: { width: 400, height: 900, margin: { top: 10, bottom: 10, left: 10, right: 10 } },
  });
  const host = document.createElement('div');
  paintSemanticLayout(host, result, { scale: 1, fontAlias });
  return host.querySelector<HTMLElement>('.layout-run-text')!.style.fontFamily;
}

const families = (stack: string): string[] =>
  stack.split(',').map((family) => family.trim().replace(/^"|"$/g, ''));

test('the glyph fallback faces follow the alias of the run', () => {
  const stack = families(
    paintedStack(
      withGlyphFallbackAliases(
        (family: string) => (family === 'Brand Sans' ? 'docx-brand' : undefined),
        ['docx-symbols', 'docx-emoji']
      )
    )
  );
  expect(stack.slice(0, 4)).toEqual(['docx-brand', 'docx-symbols', 'docx-emoji', 'Brand Sans']);
});

test('a run with no alias names them behind its declared family', () => {
  const stack = families(paintedStack(withGlyphFallbackAliases(() => undefined, ['docx-symbols'])));
  expect(stack.slice(0, 2)).toEqual(['Brand Sans', 'docx-symbols']);
});

test('with no glyph fallback face held, the stack is the alias and the family', () => {
  const stack = families(
    paintedStack((family: string) => (family === 'Brand Sans' ? 'docx-brand' : undefined))
  );
  expect(stack.slice(0, 2)).toEqual(['docx-brand', 'Brand Sans']);
  expect(stack).not.toContain('docx-symbols');
});
