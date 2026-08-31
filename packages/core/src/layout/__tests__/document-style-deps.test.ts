import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  type HeadlessDocumentView,
  type HeadlessThemeFonts,
  type OoxmlElement,
} from '@docx-editor.dev/core/store';
import { createDocumentStyleDependencies } from '../document-style-deps.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function root(name: string, xml: string): OoxmlElement {
  const loaded = readOoxmlPart(xml, { name, contentType: 'application/xml' });
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.part.root;
}

describe('document style dependencies', () => {
  test('invalidates theme and settings inputs without replacing the live view', () => {
    const styles = root(
      '/word/styles.xml',
      `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr>` +
        `<w:rFonts w:asciiTheme="minorHAnsi"/>` +
        `</w:rPr></w:rPrDefault></w:docDefaults></w:styles>`
    );
    let settings = root(
      '/word/settings.xml',
      `<w:settings xmlns:w="${W}"><w:defaultTabStop w:val="720"/></w:settings>`
    );
    let theme: HeadlessThemeFonts = { major: 'Heading One', minor: 'Body One' };
    const view = {
      stylesRoot: () => styles,
      settingsRoot: () => settings,
      numberingRoot: () => null,
      documentThemeFonts: () => theme,
    } as unknown as HeadlessDocumentView;
    const dependencies = createDocumentStyleDependencies(view);

    const firstCascade = dependencies.styleCascade();
    expect(dependencies.styleCascade()).toBe(firstCascade);
    expect(dependencies.defaultTabStopPt()).toBe(36);

    theme = { major: 'Heading Two', minor: 'Body Two' };
    settings = root(
      '/word/settings.xml',
      `<w:settings xmlns:w="${W}"><w:defaultTabStop w:val="1134"/></w:settings>`
    );

    expect(dependencies.styleCascade()).not.toBe(firstCascade);
    expect(dependencies.defaultTabStopPt()).toBe(1134 / 20);
  });
});
