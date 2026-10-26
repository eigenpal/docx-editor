import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { dirname, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sample = await readFile(resolve(root, 'examples/vite/public/sample.docx'));
const zip = await JSZip.loadAsync(sample);
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });

test('example apps serve identical default documents', async () => {
  for (const app of ['vue', 'nuxt', 'nextjs', 'astro', 'remix']) {
    expect(await readFile(resolve(root, `examples/${app}/public/sample.docx`))).toEqual(sample);
  }
});

test('all sample XML and internal relationships remain valid', async () => {
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || !/\.(xml|rels)$/.test(entry.name)) continue;
    const xml = await entry.async('string');
    expect(XMLValidator.validate(xml), entry.name).toBe(true);
    if (!entry.name.endsWith('.rels')) continue;
    const source = entry.name.replace(/(^|\/)_rels\//, '$1').replace(/\.rels$/, '');
    const records = parser.parse(xml).Relationships.Relationship ?? [];
    const relationships = Array.isArray(records) ? records : [records];
    const ids = new Set<string>();
    for (const relation of relationships) {
      expect(ids.has(relation.Id), `${entry.name}: ${relation.Id}`).toBe(false);
      ids.add(relation.Id);
      if (relation.TargetMode === 'External') continue;
      const target = posix.normalize(posix.join(posix.dirname(source), relation.Target));
      expect(zip.file(target), `${entry.name}: ${target}`).not.toBeNull();
    }
  }
});

test('sample includes multilingual text and starts the summary on a new page', async () => {
  const xml = await zip.file('word/document.xml')!.async('string');
  for (const text of [
    'Nested workflow',
    'Grouped task list',
    'هذا مثال',
    'זוהי דוגמה',
    '中文',
    '日本語',
    '한국어',
  ]) {
    expect(xml).toContain(text);
  }
  const summary = xml.lastIndexOf('25. Element Coverage Summary');
  const paragraph = xml.slice(xml.lastIndexOf('<w:p>', summary), summary);
  expect(paragraph).toContain('<w:pageBreakBefore/>');
  expect(xml).toContain('<w:bidi/>');
  expect(xml).toContain('<w:bidiVisual/>');
});

test('the displayed project hyperlink points to the project website', async () => {
  const xml = await zip.file('word/_rels/document.xml.rels')!.async('string');
  expect(xml).not.toContain('anthropic.com');
  expect(xml).toContain('Target="https://docx-editor.dev"');
});

test('chart titles and legends reserve space and doughnut labels show percentages only', async () => {
  for (const name of ['combo', 'doughnut']) {
    const xml = await zip.file(`word/charts/${name}.xml`)!.async('string');
    const chart = parser.parse(xml)['c:chartSpace']['c:chart'];
    expect(chart['c:title']['c:overlay'].val).toBe('0');
    expect(chart['c:legend']['c:overlay'].val).toBe('0');
    if (name === 'doughnut') {
      const labels = chart['c:plotArea']['c:doughnutChart']['c:ser']['c:dLbls'];
      expect(labels['c:showPercent'].val).toBe('1');
      for (const flag of ['showLegendKey', 'showVal', 'showCatName', 'showSerName']) {
        expect(labels[`c:${flag}`].val).toBe('0');
      }
    }
  }
});

test('each SmartArt data part resolves its saved drawing through its own relationships', async () => {
  for (const index of [1, 2]) {
    const data = await zip.file(`word/diagrams/data${index}.xml`)!.async('string');
    const id = /\brelId="([^"]+)"/.exec(data)?.[1];
    expect(id).toBeDefined();
    const entry = zip.file(`word/diagrams/_rels/data${index}.xml.rels`);
    expect(entry).not.toBeNull();
    const records = parser.parse(await entry!.async('string')).Relationships.Relationship;
    const relations = Array.isArray(records) ? records : [records];
    expect(relations).toContainEqual({
      Id: id,
      Type: 'http://schemas.microsoft.com/office/2007/relationships/diagramDrawing',
      Target: `drawing${index}.xml`,
    });
  }
});
