/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Chrome + review rail must not violate React's store contract while typing is queued.
//
// `useReview` used to poll `getReviewRevision` during render, and that read flushed
// pending input. Consecutive getSnapshot calls then disagreed, and the flush's `change`
// updated EditorChrome while ReviewRoot was still rendering.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import {
  DocxEditorContent,
  DocxEditorRoot,
  DocxEditorViewport,
  useEditorCaret,
} from '@docx-editor.dev/react';
import { DocxEditorReview } from '../react/index.ts';
import { reviewModule } from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const SOURCE = docx('<w:p><w:r><w:t>hello world</w:t></w:r></w:p>');

function EditorChrome() {
  useEditorCaret();
  return <div data-testid="chrome" />;
}

afterEach(() => {
  cleanup();
});

describe('review render purity', () => {
  test('queued typing does not warn while Chrome and the rail re-render', async () => {
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
      original.apply(console, args);
    };
    let instance: DocxEditorInstance | null = null;
    let bump = 0;
    function App({ nonce }: { nonce: number }) {
      void nonce;
      return (
        <DocxEditorRoot
          document={SOURCE}
          modules={[reviewModule()]}
          onReady={(editor) => {
            instance = editor as DocxEditorInstance;
          }}
        >
          <EditorChrome />
          <DocxEditorViewport>
            <DocxEditorContent />
            <DocxEditorReview />
          </DocxEditorViewport>
        </DocxEditorRoot>
      );
    }
    let view: ReturnType<typeof render>;
    try {
      await act(async () => {
        view = render(<App nonce={bump} />);
      });
      expect(view!.getByTestId('chrome')).toBeTruthy();
      // Sync: `enqueueType` flushes on a timer, and an async `act` waits for it.
      // The defect is a READ that flushed during this render, not the timer.
      act(() => {
        instance!.surface!.enqueueType('x');
        bump += 1;
        view.rerender(<App nonce={bump} />);
      });
      expect(instance!.surface!.session.bodyText()).toBe('hello world');
      expect(errors.some((entry) => entry.includes('getSnapshot should be cached'))).toBe(false);
      expect(errors.some((entry) => entry.includes('Cannot update a component'))).toBe(false);
    } finally {
      console.error = original;
    }
  });
});
