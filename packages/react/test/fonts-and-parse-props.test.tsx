// `fonts` replaces fonts in place, and `parseInWorker` reaches the engine, through both React hosts.
import './dom-setup.ts';
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { act, cleanup, render } from '@testing-library/react';
import type { DocxEditorInstance, FontResolver } from '@docx-editor.dev/core/editor';
import { strToU8, zipSync } from 'fflate';
import { DocxEditor } from '../src/components/DocxEditor.tsx';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const SOURCE = zipSync({
  '[Content_Types].xml': strToU8(
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
  ),
  '_rels/.rels': strToU8(
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="office" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Fonts stay in place</w:t></w:r></w:p></w:body></w:document>`
  ),
});
const LARGE = new Uint8Array(
  readFileSync(new URL('../../../e2e/fixtures/demo.docx', import.meta.url))
);

afterEach(cleanup);
const settle = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));

/** A resolver that records each request under `name` and supplies nothing. */
function resolver(name: string, calls: string[]): FontResolver {
  return async () => {
    calls.push(name);
    return undefined;
  };
}

type Host = 'root' | 'sugar';
function tree(
  host: Host,
  props: {
    readonly document: Uint8Array;
    readonly fonts?: FontResolver;
    readonly parseInWorker?: () => Worker;
    readonly onReady: (editor: unknown) => void;
  }
) {
  return host === 'sugar' ? (
    <DocxEditor {...props} />
  ) : (
    <DocxEditorRoot {...props}>
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
}

describe('fonts prop', () => {
  for (const host of ['root', 'sugar'] as const) {
    test(`${host}: a new value replaces the fonts in the same editor`, async () => {
      const calls: string[] = [];
      const ready: DocxEditorInstance[] = [];
      const onReady = (editor: unknown) => ready.push(editor as DocxEditorInstance);
      const first = resolver('first', calls);
      const second = resolver('second', calls);
      let mounted!: ReturnType<typeof render>;
      await act(async () => {
        mounted = render(tree(host, { document: SOURCE, fonts: first, onReady }));
      });
      await act(() => settle());
      expect(ready).toHaveLength(1);
      const editor = ready[0]!;
      const session = editor.surface?.session;
      await act(async () => {
        mounted.rerender(tree(host, { document: SOURCE, fonts: second, onReady }));
      });
      await act(() => settle());
      // No remount: one editor, one session, and the new resolver was asked.
      expect(ready).toHaveLength(1);
      expect(editor.surface?.session).toBe(session);
      expect(calls).toEqual(['first', 'second']);
      // The same value again does nothing.
      await act(async () => {
        mounted.rerender(tree(host, { document: SOURCE, fonts: second, onReady }));
      });
      await act(() => settle());
      expect(calls).toEqual(['first', 'second']);
      mounted.unmount();
    });
  }
});

describe('parseInWorker prop', () => {
  for (const host of ['root', 'sugar'] as const) {
    test(`${host}: a large document asks the host's worker factory`, async () => {
      let created = 0;
      // A factory that fails: the engine must still open the document on the page.
      const parseInWorker = (): Worker => {
        created += 1;
        throw new Error('no workers here');
      };
      const ready: DocxEditorInstance[] = [];
      const onReady = (editor: unknown) => ready.push(editor as DocxEditorInstance);
      let mounted!: ReturnType<typeof render>;
      await act(async () => {
        mounted = render(tree(host, { document: LARGE, parseInWorker, onReady }));
      });
      for (let wait = 0; wait < 100 && ready.length === 0; wait += 1) await act(() => settle(50));
      expect(created).toBe(1);
      expect(ready).toHaveLength(1);
      expect(ready[0]!.snapshot().parseError).toBeNull();
      mounted.unmount();
    }, 30_000);
  }
});
