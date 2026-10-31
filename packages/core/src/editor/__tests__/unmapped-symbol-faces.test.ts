// A `w:sym` face joins the font notice only when one of its glyphs has no Unicode
// equivalent, because only then does the missing face show as a missing-glyph box.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { docx } from './paginated-surface-fixtures.ts';
import { openTreeSession } from '../../binding/tree-session.ts';
import { unmappedSymbolFaces } from '../unmapped-symbol-faces.ts';

function sessionOf(body: string) {
  const opened = openTreeSession(docx(body));
  if (!opened.ok) throw new Error(opened.reason);
  return opened.session;
}

const symbol = (font: string, char: string) =>
  `<w:p><w:r><w:t>box </w:t><w:sym w:font="${font}" w:char="${char}"/></w:r></w:p>`;

async function settled(editor: DocxEditorInstance): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const measurement = editor.fontMeasurement();
    if (!measurement.resolving && attempt > 20) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('font resolution never settled');
}

describe('unmappedSymbolFaces', () => {
  test('keeps faces whose glyph stays private-use, in reading order', () => {
    const session = sessionOf(
      symbol('MT Extra', 'F0FC') +
        symbol('Wingdings', 'F0FE') +
        symbol('Marlett', 'F061') +
        symbol('mt extra', 'F0FD')
    );
    expect(unmappedSymbolFaces(session)).toEqual(['MT Extra', 'Marlett']);
  });

  test('a mapped glyph, a plain character, or no face reports nothing', () => {
    const session = sessionOf(
      symbol('Wingdings', 'F0FC') +
        symbol('Symbol', 'F0B7') +
        symbol('Arial', '0041') +
        '<w:p><w:r><w:sym w:char="F0FC"/></w:r></w:p>'
    );
    expect(unmappedSymbolFaces(session)).toEqual([]);
  });

  test('an unmapped byte of a table face still reports the face', () => {
    const session = sessionOf(symbol('Wingdings', 'F041'));
    expect(unmappedSymbolFaces(session)).toEqual(['Wingdings']);
  });
});

describe('font notice', () => {
  // Every probe measures the same width, so no family resolves on the platform.
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  beforeEach(() => {
    (HTMLCanvasElement.prototype as { getContext: unknown }).getContext = () => ({
      font: '',
      measureText: (text: string) => ({ width: text.length * 10 }),
    });
  });
  afterEach(() => {
    (HTMLCanvasElement.prototype as { getContext: unknown }).getContext = originalGetContext;
  });

  async function notice(body: string): Promise<readonly string[]> {
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: docx(body),
    });
    try {
      await settled(editor);
      return editor.snapshot().fontSubstitutions ?? [];
    } finally {
      editor.destroy();
    }
  }

  test('reports a missing face that a private-use glyph needs', async () => {
    expect(await notice(symbol('MT Extra', 'F0FC'))).toContain('MT Extra');
  });

  test('leaves out a missing face whose glyph has a Unicode equivalent', async () => {
    expect(await notice(symbol('Wingdings', 'F0FE'))).not.toContain('Wingdings');
  });
});
