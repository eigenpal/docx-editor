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
// - a family the app's own font configuration REDIRECTS to a loaded face reports nothing.
//   `defaultFonts()` deliberately answers Times New Roman with metric-compatible Liberation
//   Serif, so the family is available and the document paginates as Word paginates it;
//   naming it in a "these fonts aren't available" notice says the opposite of the truth.
//   A redirect whose target never loaded is not coverage and is still reported.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { sha256FontBytes } from '../../layout/index.ts';
import { blankDocumentBytes } from '../blank-document.ts';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { docx } from './paginated-surface-fixtures.ts';

const regularBytes = new Uint8Array(
  readFileSync(new URL('../../layout/__tests__/fixtures/fonts/DejaVuSans.ttf', import.meta.url))
);

/** Resolve pending font work, then read the notice. */
async function noticeAfterFonts(editor: DocxEditorInstance): Promise<readonly string[]> {
  for (let tick = 0; tick < 200 && editor.fontMeasurement().resolving; tick += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return editor.snapshot().fontSubstitutions ?? [];
}

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

  test('a family the app redirects to a loaded face is available, not substituted', async () => {
    installed = [];
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: docx(runIn('Brand Serif', 'body text') + runIn('Garamond', 'more')),
      fonts: {
        sources: [
          {
            request: { family: 'DejaVu Sans', weight: 400, style: 'normal' },
            id: 'redirect-target',
            bytes: regularBytes,
            hash: sha256FontBytes(regularBytes),
            faceIndex: 0,
          },
        ],
        substitutions: [
          {
            from: { family: 'Brand Serif', weight: 400, style: 'normal' },
            to: { family: 'DejaVu Sans', weight: 400, style: 'normal' },
          },
        ],
      },
    });
    const substitutions = await noticeAfterFonts(editor);
    expect(substitutions).not.toContain('Brand Serif');
    // Garamond has no source and no redirect, so the notice still names it.
    expect(substitutions).toContain('Garamond');
    editor.destroy();
  });

  test('a redirect whose target never loaded is not coverage', async () => {
    installed = [];
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: docx(runIn('Brand Serif', 'body text')),
      fonts: {
        sources: [
          {
            request: { family: 'DejaVu Sans', weight: 400, style: 'normal' },
            id: 'redirect-target',
            bytes: regularBytes,
            hash: sha256FontBytes(regularBytes),
            faceIndex: 0,
          },
        ],
        substitutions: [
          {
            from: { family: 'Brand Serif', weight: 400, style: 'normal' },
            to: { family: 'Never Loaded', weight: 400, style: 'normal' },
          },
        ],
      },
    });
    expect(await noticeAfterFonts(editor)).toContain('Brand Serif');
    editor.destroy();
  });
});
