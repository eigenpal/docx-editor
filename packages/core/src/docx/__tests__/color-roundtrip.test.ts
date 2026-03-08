import { describe, test, expect } from 'bun:test';
import { parseRunProperties } from '../runParser';
import { serializeTextFormatting } from '../serializer/runSerializer';
import { parseXml } from '../xmlParser';
import type { XmlElement } from '../xmlParser';

function parseRPr(xml: string): XmlElement {
  const doc = parseXml(
    `<w:rPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${xml}</w:rPr>`
  );
  // parseXml returns a document root; the w:rPr is the first element
  return (doc.elements as XmlElement[])[0];
}

function roundTrip(innerXml: string) {
  const rPr = parseRPr(innerXml);
  const formatting = parseRunProperties(rPr, null);
  const serialized = serializeTextFormatting(formatting);
  return { formatting, serialized };
}

// ============================================================================
// 6.1 RGB Text Color
// ============================================================================

describe('RGB text color round-trip', () => {
  test('parse and serialize RGB color', () => {
    const { formatting, serialized } = roundTrip('<w:color w:val="FF0000"/>');
    expect(formatting?.color?.rgb).toBe('FF0000');
    expect(formatting?.color?.themeColor).toBeUndefined();
    expect(serialized).toContain('w:val="FF0000"');
    expect(serialized).toContain('<w:color');
  });

  test('parse and serialize blue RGB color', () => {
    const { formatting, serialized } = roundTrip('<w:color w:val="0000FF"/>');
    expect(formatting?.color?.rgb).toBe('0000FF');
    expect(serialized).toContain('w:val="0000FF"');
  });
});

// ============================================================================
// 6.2 Theme Text Color with Tint/Shade
// ============================================================================

describe('Theme text color round-trip', () => {
  test('theme color without modifier', () => {
    const { formatting, serialized } = roundTrip(
      '<w:color w:val="4472C4" w:themeColor="accent1"/>'
    );
    expect(formatting?.color?.rgb).toBe('4472C4');
    expect(formatting?.color?.themeColor).toBe('accent1');
    expect(formatting?.color?.themeTint).toBeUndefined();
    expect(formatting?.color?.themeShade).toBeUndefined();
    expect(serialized).toContain('w:val="4472C4"');
    expect(serialized).toContain('w:themeColor="accent1"');
  });

  test('theme color with tint', () => {
    const { formatting, serialized } = roundTrip(
      '<w:color w:val="B4C6E7" w:themeColor="accent1" w:themeTint="66"/>'
    );
    expect(formatting?.color?.themeColor).toBe('accent1');
    expect(formatting?.color?.themeTint).toBe('66');
    expect(serialized).toContain('w:themeColor="accent1"');
    expect(serialized).toContain('w:themeTint="66"');
  });

  test('theme color with shade', () => {
    const { formatting, serialized } = roundTrip(
      '<w:color w:val="2F5496" w:themeColor="accent1" w:themeShade="BF"/>'
    );
    expect(formatting?.color?.themeColor).toBe('accent1');
    expect(formatting?.color?.themeShade).toBe('BF');
    expect(serialized).toContain('w:themeColor="accent1"');
    expect(serialized).toContain('w:themeShade="BF"');
  });

  test('dk1 theme color', () => {
    const { formatting, serialized } = roundTrip('<w:color w:val="000000" w:themeColor="dk1"/>');
    expect(formatting?.color?.themeColor).toBe('dk1');
    expect(serialized).toContain('w:themeColor="dk1"');
  });
});

// ============================================================================
// 6.3 Auto Color
// ============================================================================

describe('Auto color round-trip', () => {
  test('parse and serialize auto color', () => {
    const { formatting, serialized } = roundTrip('<w:color w:val="auto"/>');
    expect(formatting?.color?.auto).toBe(true);
    expect(formatting?.color?.rgb).toBeUndefined();
    expect(serialized).toContain('w:val="auto"');
  });
});

// ============================================================================
// 6.4 Named Highlight Colors
// ============================================================================

describe('Named highlight color round-trip', () => {
  const highlights = [
    'yellow',
    'green',
    'cyan',
    'magenta',
    'blue',
    'red',
    'darkBlue',
    'darkCyan',
    'darkGreen',
    'darkMagenta',
    'darkRed',
    'darkYellow',
    'lightGray',
    'darkGray',
    'black',
    'white',
  ];

  for (const hl of highlights) {
    test(`highlight "${hl}" round-trips`, () => {
      const { formatting, serialized } = roundTrip(`<w:highlight w:val="${hl}"/>`);
      expect(formatting?.highlight as string).toBe(hl);
      expect(serialized).toContain(`w:val="${hl}"`);
      expect(serialized).toContain('<w:highlight');
    });
  }
});

// ============================================================================
// 6.5 Character Shading
// ============================================================================

describe('Character shading round-trip', () => {
  test('simple fill shading', () => {
    const { formatting, serialized } = roundTrip('<w:shd w:val="clear" w:fill="FFFF00"/>');
    expect(formatting?.shading?.pattern).toBe('clear');
    expect(formatting?.shading?.fill?.rgb).toBe('FFFF00');
    expect(serialized).toContain('w:val="clear"');
    expect(serialized).toContain('w:fill="FFFF00"');
  });

  test('theme fill shading with tint', () => {
    const { formatting, serialized } = roundTrip(
      '<w:shd w:val="clear" w:fill="B4C6E7" w:themeFill="accent1" w:themeFillTint="66"/>'
    );
    expect(formatting?.shading?.fill?.themeColor).toBe('accent1');
    expect(formatting?.shading?.fill?.themeTint).toBe('66');
    expect(serialized).toContain('w:themeFill="accent1"');
    expect(serialized).toContain('w:themeFillTint="66"');
  });

  test('theme fill shading with shade', () => {
    const { formatting, serialized } = roundTrip(
      '<w:shd w:val="clear" w:fill="2F5496" w:themeFill="accent1" w:themeFillShade="BF"/>'
    );
    expect(formatting?.shading?.fill?.themeColor).toBe('accent1');
    expect(formatting?.shading?.fill?.themeShade).toBe('BF');
    expect(serialized).toContain('w:themeFill="accent1"');
    expect(serialized).toContain('w:themeFillShade="BF"');
  });

  test('pattern with color and fill', () => {
    const { formatting, serialized } = roundTrip(
      '<w:shd w:val="pct25" w:color="FF0000" w:fill="FFFFFF"/>'
    );
    expect(formatting?.shading?.pattern).toBe('pct25');
    expect(formatting?.shading?.color?.rgb).toBe('FF0000');
    expect(formatting?.shading?.fill?.rgb).toBe('FFFFFF');
    expect(serialized).toContain('w:val="pct25"');
    expect(serialized).toContain('w:color="FF0000"');
    expect(serialized).toContain('w:fill="FFFFFF"');
  });
});

// ============================================================================
// 6.6 Border Color (via paragraph borders)
// ============================================================================

describe('Border color round-trip', () => {
  // Border colors are parsed via table/paragraph parsers, not runParser.
  // We test the serializer directly here since border parsing is separate.
  // For full integration, see the E2E tests.

  test('serializeTextFormatting does not emit border XML (borders are separate)', () => {
    // Text formatting doesn't include borders — borders are on paragraphs/tables.
    // This test confirms that the run serializer scope is limited.
    const { serialized } = roundTrip('<w:color w:val="FF0000"/>');
    expect(serialized).not.toContain('w:bdr');
  });
});

// ============================================================================
// 6.7 Underline Color
// ============================================================================

describe('Underline color round-trip', () => {
  test('underline with RGB color', () => {
    const { formatting, serialized } = roundTrip('<w:u w:val="single" w:color="FF0000"/>');
    expect(formatting?.underline?.style).toBe('single');
    expect(formatting?.underline?.color?.rgb).toBe('FF0000');
    expect(serialized).toContain('w:val="single"');
    expect(serialized).toContain('w:color="FF0000"');
  });

  test('underline with theme color', () => {
    const { formatting, serialized } = roundTrip(
      '<w:u w:val="single" w:color="4472C4" w:themeColor="accent1"/>'
    );
    expect(formatting?.underline?.color?.rgb).toBe('4472C4');
    expect(formatting?.underline?.color?.themeColor).toBe('accent1');
    expect(serialized).toContain('w:color="4472C4"');
    expect(serialized).toContain('w:themeColor="accent1"');
  });

  test('underline with theme color and tint', () => {
    const { formatting, serialized } = roundTrip(
      '<w:u w:val="single" w:color="B4C6E7" w:themeColor="accent1" w:themeTint="66"/>'
    );
    expect(formatting?.underline?.color?.themeColor).toBe('accent1');
    expect(formatting?.underline?.color?.themeTint).toBe('66');
    expect(serialized).toContain('w:themeColor="accent1"');
    expect(serialized).toContain('w:themeTint="66"');
  });

  test('underline with theme color and shade', () => {
    const { formatting, serialized } = roundTrip(
      '<w:u w:val="single" w:color="2F5496" w:themeColor="accent1" w:themeShade="BF"/>'
    );
    expect(formatting?.underline?.color?.themeColor).toBe('accent1');
    expect(formatting?.underline?.color?.themeShade).toBe('BF');
    expect(serialized).toContain('w:themeColor="accent1"');
    expect(serialized).toContain('w:themeShade="BF"');
  });
});

// ============================================================================
// 6.8 Combined Formatting Round-Trip
// ============================================================================

describe('Combined formatting round-trip', () => {
  test('text color + highlight together', () => {
    const { formatting, serialized } = roundTrip(
      '<w:color w:val="FF0000" w:themeColor="accent2"/><w:highlight w:val="yellow"/>'
    );
    expect(formatting?.color?.rgb).toBe('FF0000');
    expect(formatting?.color?.themeColor).toBe('accent2');
    expect(formatting?.highlight).toBe('yellow');
    expect(serialized).toContain('w:themeColor="accent2"');
    expect(serialized).toContain('w:val="yellow"');
  });

  test('color + shading + underline together', () => {
    const { formatting, serialized } = roundTrip(
      '<w:color w:val="0000FF"/><w:shd w:val="clear" w:fill="FFFFCC"/><w:u w:val="single" w:color="FF0000"/>'
    );
    expect(formatting?.color?.rgb).toBe('0000FF');
    expect(formatting?.shading?.fill?.rgb).toBe('FFFFCC');
    expect(formatting?.underline?.color?.rgb).toBe('FF0000');
    expect(serialized).toContain('w:val="0000FF"');
    expect(serialized).toContain('w:fill="FFFFCC"');
    expect(serialized).toContain('w:color="FF0000"');
  });
});
