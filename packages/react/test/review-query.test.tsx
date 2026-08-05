// Review rail query: default hides format/structural cards from the filtered queue.

import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, render, screen } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import { DocxEditorReview } from '../src/editor/DocxEditorReview.tsx';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const INSERTION =
  `<w:p><w:r><w:t xml:space="preserve">Kept </w:t></w:r>` +
  `<w:ins w:id="1" w:author="Ada Lovelace" w:date="2026-01-02T03:04:05Z">` +
  `<w:r><w:t>added text</w:t></w:r></w:ins></w:p>`;

const FORMAT_AND_INSERT =
  `<w:p><w:r><w:rPr>` +
  `<w:rPrChange w:id="3" w:author="Ada Lovelace" w:date="2026-01-02T03:04:05Z"><w:b/></w:rPrChange>` +
  `<w:b/></w:rPr><w:t>bold</w:t></w:r></w:p>` +
  INSERTION;

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
        `</Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

afterEach(() => {
  cleanup();
});

describe('DocxEditor.Review query exclusions', () => {
  test('default rail lists only non-format/non-structural cards', () => {
    render(
      <DocxEditorRoot document={docx(FORMAT_AND_INSERT)}>
        <DocxEditorViewport>
          <DocxEditorContent />
          <DocxEditorReview />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );

    act(() => undefined);
    expect(screen.getByTestId('review-rail').getAttribute('data-count')).toBe('1');
  });

  test('formatting and structural opt-ins list every card', () => {
    render(
      <DocxEditorRoot document={docx(FORMAT_AND_INSERT)}>
        <DocxEditorViewport>
          <DocxEditorContent />
          <DocxEditorReview structural formatting />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );

    act(() => undefined);
    expect(screen.getByTestId('review-rail').getAttribute('data-count')).toBe('2');
  });
});
