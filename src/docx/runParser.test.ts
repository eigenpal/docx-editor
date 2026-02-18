import { describe, test, expect } from 'bun:test';
import { parseXmlDocument, type XmlElement } from './xmlParser';
import { parseRun } from './runParser';
import { serializeRun } from './serializer/runSerializer';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function parseRunElement(xml: string): XmlElement {
  const root = parseXmlDocument(xml);
  if (!root) {
    throw new Error('Failed to parse XML');
  }
  return root;
}

describe('runParser font theme round-trip', () => {
  test('preserves w:csTheme on rFonts', () => {
    const r = parseRunElement(`
      <w:r xmlns:w="${W_NS}">
        <w:rPr>
          <w:rFonts
            w:asciiTheme="minorHAnsi"
            w:hAnsiTheme="minorHAnsi"
            w:eastAsiaTheme="minorEastAsia"
            w:csTheme="minorBidi"
          />
        </w:rPr>
        <w:t>x</w:t>
      </w:r>
    `);

    const run = parseRun(r, null, null, null, null);
    const xml = serializeRun(run);

    expect(run.formatting?.fontFamily?.csTheme).toBe('minorBidi');
    expect(xml).toContain('w:csTheme="minorBidi"');
  });
});
