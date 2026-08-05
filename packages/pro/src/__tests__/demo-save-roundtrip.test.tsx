/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The demo's exact save path, through the BUILT react adapter: insert a chip into a
// mounted Root, save, and find it in the bytes. Owner report 2026-08-05: a citation
// inserted in the demo was missing from the saved file.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, expect, test } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorContent, DocxEditorRoot, DocxEditorViewport } from '@docx-editor.dev/react';
import { customNodesModule, defineCustomNode, insertCustomNode, reviewModule } from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const citation = defineCustomNode({ name: 'citation', tagPrefix: 'docx', label: 'Citation' });

afterEach(() => {
  cleanup();
});

test('a chip inserted through the mounted adapter survives save', async () => {
  let instance: DocxEditorInstance | null = null;
  render(
    <DocxEditorRoot
      document={docx('<w:p><w:r><w:t>hello world</w:t></w:r></w:p>')}
      author="Demo Reviewer"
      modules={[reviewModule(), customNodesModule({ nodes: [citation] })]}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
    >
      <DocxEditorViewport>
        <DocxEditorContent />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  const editor = instance!;
  await act(async () => {
    // The demo captures the caret; the default head works the same way here.
    const at = editor.surface!.state().selection.head;
    const result = insertCustomNode(
      editor,
      citation,
      { sourceId: 'src_repro', locator: 'p.42' },
      '(Smith 2024, p. 42)',
      { alias: 'Citation', at }
    );
    expect(result.ok).toBe(true);
  });
  const saved = new Uint8Array(await editor.save());
  const xml = strFromU8(unzipSync(saved)['word/document.xml']!);
  expect(xml).toContain('docx:citation?sourceId=src_repro');
  expect(xml).toContain('(Smith 2024, p. 42)');
});
