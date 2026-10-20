/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { DocxEditorRoot, DocxEditorViewport, DocxEditorContent } from '@docx-editor.dev/react';
import { DocxEditorReview } from '../react/index.ts';
import { reviewModule } from '../index.ts';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(cleanup);
function docx(body: string): Uint8Array {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}
test('shows actionable structural cards by default, with an explicit opt-out', async () => {
  // One resolvable insertion plus one structural site (a tracked row insertion,
  // `w:trPr/w:ins`) — the kind of markup a heavily revised contract carries by the dozen.
  const TRACKED = docx(
    '<w:p><w:r><w:t>base </w:t></w:r>' +
      '<w:ins w:id="1" w:author="A" w:date="2026-01-01T00:00:00Z"><w:r><w:t>added</w:t></w:r></w:ins></w:p>' +
      '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>' +
      '<w:tr><w:tc><w:tcPr/><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc></w:tr>' +
      '<w:tr><w:trPr><w:ins w:id="2" w:author="A" w:date="2026-01-01T00:00:00Z"/></w:trPr>' +
      '<w:tc><w:tcPr/><w:p><w:r><w:t>b</w:t></w:r></w:p></w:tc></w:tr>' +
      '</w:tbl>'
  );
  const kindsOf = (root: HTMLElement) =>
    [...root.querySelectorAll('[data-testid="review-card"]')].map(
      (card) => (card as HTMLElement).dataset.kind
    );

  let instance: DocxEditorInstance | null = null;
  const view = render(
    <DocxEditorRoot
      document={TRACKED}
      modules={[reviewModule()]}
      onReady={(editor) => {
        instance = editor as DocxEditorInstance;
      }}
    >
      <DocxEditorViewport>
        <DocxEditorContent />
        <DocxEditorReview />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  // The default rail exposes structural decisions alongside text changes.
  expect(
    instance!
      .getReviewItems()
      .some((item) => item.kind === 'revision' && item.revisionKind === 'structural')
  ).toBe(true);
  expect(kindsOf(view.container)).toContain('insert');
  expect(kindsOf(view.container)).toContain('structural');
  for (const action of ['accept', 'reject']) {
    const card = view.container.querySelector('[data-kind="structural"]')!;
    expect(card.textContent).toContain('Inserted table row');
    await act(async () => {
      fireEvent.click(card.querySelector(`[data-testid="review-${action}"]`)!);
    });
    expect(kindsOf(view.container)).not.toContain('structural');
    expect(
      instance!
        .getReviewItems()
        .filter((i) => i.kind === 'revision' && i.revisionKind === 'structural')
    ).toHaveLength(0);
    await act(async () => {
      expect(instance!.exec({ type: 'undo' }).ok).toBe(true);
    });
    expect(kindsOf(view.container)).toContain('structural');
  }
  view.unmount();

  const shown = render(
    <DocxEditorRoot document={TRACKED} modules={[reviewModule()]}>
      <DocxEditorViewport>
        <DocxEditorContent />
        <DocxEditorReview structural={false} />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  expect(kindsOf(shown.container)).not.toContain('structural');
});

test('table property changes remain reviewable without a painted formatting balloon', async () => {
  const bytes = docx(
    '<w:tbl><w:tblPr><w:jc w:val="right"/><w:tblPrChange w:id="10" w:author="Ada"><w:tblPr><w:jc w:val="left"/></w:tblPr></w:tblPrChange></w:tblPr><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
  );
  const view = render(
    <DocxEditorRoot document={bytes} modules={[reviewModule()]}>
      <DocxEditorViewport>
        <DocxEditorContent />
        <DocxEditorReview />
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  const card = view.getByTestId('review-card');
  expect(card.dataset.kind).toBe('format');
  expect(card.textContent).toContain('Alignment: Right');
  await act(async () => {
    fireEvent.click(view.getByTestId('review-reject'));
  });
  expect(view.queryByTestId('review-card')).toBeNull();
});
