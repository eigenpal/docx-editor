// What `snapshot().fontSubstitutions` — the chrome font-compatibility notice — reports.
//
// The notice is a FIDELITY warning: these families render in a face with different
// advance widths, so wrap and pagination will not match Word. What these pin down end to
// end, on a platform where nothing the document names is installed:
//
// - a brand-new blank document reports nothing. It DECLARES Calibri (Word's blank-template
//   `w:docDefaults`) over a single empty paragraph, and a declaration paints no glyph.
// - the first typed character reports it. The gate is "no text rendered", never "this
//   document is exempt", so a real fidelity loss is never hidden.
// - a family whose metric-compatible twin IS installed reports nothing, because the stack
//   both measurement and paint use falls through to it and the metrics are identical.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { blankDocumentBytes } from '../blank-document.ts';
import { createDocxEditor } from '../docx-editor.ts';
import { docx } from './paginated-surface-fixtures.ts';

/**
 * Families this fake platform has installed. A canvas measurement only changes when the
 * shorthand names one of them, which is exactly the signal `createLocalFontProbe` reads.
 */
let installed: readonly string[] = [];

const originalGetContext = HTMLCanvasElement.prototype.getContext;

beforeAll(() => {
  (HTMLCanvasElement.prototype as { getContext: unknown }).getContext = function getContext(
    kind: string
  ) {
    if (kind !== '2d') return null;
    let font = '';
    return {
      set font(value: string) {
        font = value;
      },
      get font() {
        return font;
      },
      measureText(text: string) {
        const resolved = installed.some((family) => font.includes(`"${family}"`));
        return { width: text.length * (resolved ? 7 : 10) };
      },
    };
  };
});

afterAll(() => {
  (HTMLCanvasElement.prototype as { getContext: unknown }).getContext = originalGetContext;
  installed = [];
});

const runIn = (family: string, text: string) =>
  `<w:p><w:r><w:rPr><w:rFonts w:ascii="${family}" w:hAnsi="${family}"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;

describe('font substitution notice', () => {
  test('a brand-new blank document reports no substitution', () => {
    installed = [];
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: blankDocumentBytes(),
    });
    // The family IS declared — the picker and the toolbar both report it — and it is NOT
    // resolvable on this platform. The notice still stays quiet: nothing is rendered.
    expect(editor.getDocumentFonts()).toContain('Calibri');
    expect(editor.snapshot().fontSubstitutions ?? []).toEqual([]);
    editor.destroy();
  });

  test('the first typed character surfaces it: the loss is deferred, never hidden', () => {
    installed = [];
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: blankDocumentBytes(),
    });
    expect(editor.snapshot().fontSubstitutions ?? []).toEqual([]);
    expect(editor.exec({ type: 'insertText', text: 'X' })).toEqual({ ok: true, changed: true });
    expect(editor.snapshot().fontSubstitutions ?? []).toEqual(['Calibri']);
    editor.destroy();
  });

  test('a document whose text renders in an unavailable face reports it', () => {
    installed = [];
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: docx(runIn('Garamond', 'body text')),
    });
    expect(editor.snapshot().fontSubstitutions ?? []).toContain('Garamond');
    editor.destroy();
  });

  test('an installed metric twin is not a reportable substitution', () => {
    // Carlito has Calibri's advance widths and is the next entry in the stack measurement
    // and paint both use, so this document paginates exactly as Word paginates it.
    installed = ['Carlito'];
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: docx(runIn('Calibri', 'body text') + runIn('Garamond', 'more')),
    });
    const substitutions = editor.snapshot().fontSubstitutions ?? [];
    expect(substitutions).not.toContain('Calibri');
    // Garamond has no twin in the stack, so it is still reported.
    expect(substitutions).toContain('Garamond');
    editor.destroy();
  });
});
