import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { buildNumberingIndex } from '../numbering-index.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { paragraphFragmentsOf, type ParagraphFragmentRecord } from '../semantic-records.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';

const FIXTURE = new URL('../../../../../e2e/fixtures/docx-editor-numbering.docx', import.meta.url);

function fixtureParagraphs(): readonly ParagraphFragmentRecord[] {
  const loaded = readOoxmlPackage(new Uint8Array(readFileSync(FIXTURE)));
  if (!loaded.ok) throw new Error(loaded.reason);
  const pkg = loaded.package;
  const main = pkg.parts.get(pkg.mainDocumentPart)!;
  const numbering = pkg.parts.get('/word/numbering.xml');
  const styles = pkg.parts.get('/word/styles.xml');
  const layout = layoutSemanticDocument(main, 1, {
    measurer: createFixedMeasurer(),
    numberingIndex: buildNumberingIndex(numbering?.root ?? null),
    styleCascade: buildStyleCascadeTable(styles?.root ?? null),
    defaultTabStopPt: 36,
  });
  return layout.pages.flatMap((page) => paragraphFragmentsOf(page, true));
}

const lineText = (fragment: ParagraphFragmentRecord): readonly string[] =>
  fragment.lines.map((line) => line.spans.map((span) => span.text).join(''));

test('table list suffix tabs keep the first word with the marker line', () => {
  const fragments = fixtureParagraphs();
  const portuguese = fragments.find((fragment) =>
    lineText(fragment).join('').startsWith('Os Contraentes')
  );
  const english = fragments.find((fragment) => lineText(fragment).join('').startsWith('According'));

  expect(portuguese).toBeDefined();
  expect(english).toBeDefined();
  if (!portuguese || !english) throw new Error('expected fixture list paragraphs');
  expect(portuguese.marker?.text).toBe('(1)');
  expect(lineText(portuguese)[0]).toStartWith('Os Contraentes');
  expect(english.marker?.text).toBe('(2)');
  expect(lineText(english)[0]).toStartWith('According');
});
