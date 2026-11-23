// The font size stepper against the real engine: a selection with mixed sizes keeps the
// − and + buttons enabled, and each press steps every run from its own size.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import type { ReactNode } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { en } from '@docx-editor.dev/i18n';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { testReviewModule } from './review-test-module.ts';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { DocxEditorToolbar } from '../src/editor/toolbar/index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STYLES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';
// Format defaults, pinned so the fixture does not take the application defaults for omitted docDefaults.
const FORMAT_DOC_DEFAULTS =
  '<w:docDefaults><w:rPrDefault><w:rPr><w:kern w:val="2"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults>';

/** `styles` is the content of `w:styles`; the default pins the format defaults. */
function docx(body: string, styles = FORMAT_DOC_DEFAULTS): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rIdStyles" Type="${STYLES_REL}" Target="styles.xml"/></Relationships>`
    ),
    'word/styles.xml': strToU8(`<w:styles xmlns:w="${W}">${styles}</w:styles>`),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const SOURCE = docx(
  '<w:p><w:r><w:rPr><w:sz w:val="52"/></w:rPr><w:t>Big</w:t></w:r>' +
    '<w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t xml:space="preserve"> small</w:t></w:r></w:p>'
);

function mountToolbar(
  toolbar: ReactNode,
  source: Uint8Array = SOURCE
): { view: ReturnType<typeof render>; editor: () => DocxEditorInstance } {
  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={source}
      modules={[testReviewModule()]}
      author="Grace Hopper"
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
    >
      {toolbar}
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  return { view, editor: () => instance! };
}

const sizes = (editor: DocxEditorInstance): string[] =>
  [...serializeOoxmlPart(editor.surface!.session.part()).matchAll(/<w:sz w:val="(\d+)"\/>/g)].map(
    (match) => match[1]!
  );

afterEach(() => {
  cleanup();
});

describe('the font size stepper', () => {
  test('a selection with mixed sizes keeps the steppers enabled and steps each run', async () => {
    const { view, editor } = mountToolbar(<DocxEditorToolbar />);
    await act(async () => {
      editor().surface!.selectAll();
    });
    const root = view.container.querySelector('[data-slot="font.size"]')!;
    const input = root.querySelector('input') as HTMLInputElement;
    const decrease = root.querySelector(
      `button[aria-label="${en.fontSize.decrease}"]`
    ) as HTMLButtonElement;
    const increase = root.querySelector(
      `button[aria-label="${en.fontSize.increase}"]`
    ) as HTMLButtonElement;
    expect(input.value).toBe('—');
    expect(decrease.disabled).toBe(false);
    expect(increase.disabled).toBe(false);
    // Each button's tooltip names its shortcut.
    expect(decrease.title).toContain('Shift+<');
    expect(increase.title).toContain('Shift+>');

    await act(async () => {
      increase.click();
    });
    // 26 pt and 11 pt become 28 pt and 12 pt, with the paragraph mark stepped beside them.
    expect(sizes(editor()).slice(-2)).toEqual(['56', '24']);
    expect(input.value).toBe('—');

    await act(async () => {
      decrease.click();
      decrease.click();
    });
    expect(sizes(editor()).slice(-2)).toEqual(['48', '20']);
  });

  test('the arrow keys in the size box step a mixed selection', async () => {
    const { view, editor } = mountToolbar(<DocxEditorToolbar />);
    await act(async () => {
      editor().surface!.selectAll();
    });
    const input = view.container.querySelector('[data-slot="font.size"] input') as HTMLInputElement;
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    });
    expect(sizes(editor()).slice(-2)).toEqual(['56', '24']);
  });
});
