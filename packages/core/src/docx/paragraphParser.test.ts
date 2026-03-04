import { describe, expect, test } from 'bun:test';
import type { XmlElement } from './xmlParser';
import { parseXmlDocument } from './xmlParser';
import { parseParagraph } from './paragraphParser';

function parseParagraphXml(xml: string) {
  const root = parseXmlDocument(xml) as XmlElement | null;
  if (!root) {
    throw new Error('Failed to parse paragraph XML fixture');
  }
  return parseParagraph(root, null, null, null, null, null);
}

describe('parseParagraph tracked-change hardening', () => {
  test('parses deletion text from w:delText runs', () => {
    const paragraph = parseParagraphXml(`
      <w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:del w:id="7" w:author="Reviewer" w:date="2026-02-22T10:00:00Z">
          <w:r>
            <w:delText xml:space="preserve"> removed </w:delText>
          </w:r>
        </w:del>
      </w:p>
    `);

    const deletion = paragraph.content[0];
    expect(deletion?.type).toBe('deletion');
    if (!deletion || deletion.type !== 'deletion') return;

    expect(deletion.info.id).toBe(7);
    expect(deletion.info.author).toBe('Reviewer');
    expect(deletion.info.date).toBe('2026-02-22T10:00:00Z');
    expect(deletion.content).toHaveLength(1);
    const run = deletion.content[0];
    expect(run.type).toBe('run');
    if (run.type !== 'run') return;

    expect(run.content).toHaveLength(1);
    expect(run.content[0].type).toBe('text');
    if (run.content[0].type !== 'text') return;
    expect(run.content[0].text).toBe(' removed ');
    expect(run.content[0].preserveSpace).toBe(true);
  });

  test('parses deletion instruction text from w:delInstrText', () => {
    const paragraph = parseParagraphXml(`
      <w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:del w:id="8" w:author="Reviewer">
          <w:r>
            <w:delInstrText> MERGEFIELD name </w:delInstrText>
          </w:r>
        </w:del>
      </w:p>
    `);

    const deletion = paragraph.content[0];
    expect(deletion?.type).toBe('deletion');
    if (!deletion || deletion.type !== 'deletion') return;

    const run = deletion.content[0];
    expect(run.type).toBe('run');
    if (run.type !== 'run') return;

    expect(run.content).toHaveLength(1);
    expect(run.content[0].type).toBe('instrText');
    if (run.content[0].type !== 'instrText') return;
    expect(run.content[0].text).toBe(' MERGEFIELD name ');
  });

  test('normalizes tracked-change metadata when attributes are invalid or blank', () => {
    const paragraph = parseParagraphXml(`
      <w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:ins w:id="invalid" w:author="   " w:date="   ">
          <w:r><w:t>Added</w:t></w:r>
        </w:ins>
      </w:p>
    `);

    const insertion = paragraph.content[0];
    expect(insertion?.type).toBe('insertion');
    if (!insertion || insertion.type !== 'insertion') return;

    expect(insertion.info.id).toBe(0);
    expect(insertion.info.author).toBe('Unknown');
    expect(insertion.info.date).toBeUndefined();
  });
});
