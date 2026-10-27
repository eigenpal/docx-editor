import './dom-setup.ts';
import { afterEach, expect, test } from 'bun:test';
import { cleanup, render, waitFor } from '@testing-library/react';
import type { DrawingPreviewRequest } from '@docx-editor.dev/core/editor';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(cleanup);

const BLUR = '<a:effectLst><a:blur rad="127000"/></a:effectLst>';

async function documentWith(effect: string) {
  const { previewDocument, previewShape } =
    await import('../../core/src/store/__tests__/drawing-support-fixtures.ts');
  return previewDocument(previewShape(effect));
}

test('DrawingPreview keeps the native drawing until the image is ready', async () => {
  const { DocxEditor } = await import('../src/index.ts');
  const bytes = await documentWith(BLUR);
  const requests: DrawingPreviewRequest[] = [];
  let resolve: (value: string) => void = () => {};
  const renderPreview = (request: DrawingPreviewRequest) => {
    requests.push(request);
    return new Promise<string>((done) => {
      resolve = done;
    });
  };
  const view = render(
    <DocxEditor document={bytes} chrome={false}>
      <DocxEditor.DrawingPreview render={renderPreview} />
    </DocxEditor>
  );
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]!.element.support).toBe('partial');
  expect(requests[0]!.docx.byteLength).toBeGreaterThan(0);
  expect(view.container.querySelector('svg')).not.toBeNull();
  expect(view.container.querySelector('[data-docx-customized]')).toBeNull();
  resolve('https://previews.example/shape.png');
  await waitFor(() =>
    expect(view.getByAltText('Sample shape').getAttribute('src')).toBe(
      'https://previews.example/shape.png'
    )
  );
  expect(view.container.querySelector<HTMLElement>('.docx-drawing-native')!.hidden).toBe(true);
});

test('DrawingPreview leaves native drawings alone by default and on failure', async () => {
  const { DocxEditor } = await import('../src/index.ts');
  let calls = 0;
  const native = render(
    <DocxEditor document={await documentWith('')} chrome={false}>
      <DocxEditor.DrawingPreview
        render={async () => {
          calls++;
          return 'https://previews.example/unused.png';
        }}
      />
    </DocxEditor>
  );
  await waitFor(() => expect(native.container.querySelector('svg')).not.toBeNull());
  await new Promise((done) => setTimeout(done, 20));
  expect(calls).toBe(0);
  native.unmount();

  let failures = 0;
  const failing = render(
    <DocxEditor document={await documentWith(BLUR)} chrome={false}>
      <DocxEditor.DrawingPreview
        render={async () => {
          failures++;
          throw new Error('service down');
        }}
      />
    </DocxEditor>
  );
  await waitFor(() => expect(failures).toBe(1));
  await new Promise((done) => setTimeout(done, 20));
  expect(failing.container.querySelector('img')).toBeNull();
  expect(failing.container.querySelector('svg')).not.toBeNull();
});

test('children see every status, keep the native drawing with null, and can retry', async () => {
  const { DocxEditor } = await import('../src/index.ts');
  let attempt = 0;
  const statuses: string[] = [];
  const view = render(
    <DocxEditor document={await documentWith('')} chrome={false}>
      <DocxEditor.DrawingPreview
        match={(element) => element.graphicKind === 'textbox'}
        render={async () => {
          attempt++;
          if (attempt === 1) throw new Error('service down');
          return 'https://previews.example/custom.png';
        }}
      >
        {({ preview }) => {
          statuses.push(preview.status);
          if (preview.status === 'error')
            return <button onClick={preview.retry}>Retry preview</button>;
          if (preview.status !== 'ready') return null;
          return <figure data-url={preview.url}>Server preview</figure>;
        }}
      </DocxEditor.DrawingPreview>
    </DocxEditor>
  );
  await waitFor(() => expect(view.getByText('Retry preview')).not.toBeNull());
  expect(statuses).toContain('loading');
  view.getByText('Retry preview').click();
  await waitFor(() =>
    expect(view.getByText('Server preview').getAttribute('data-url')).toBe(
      'https://previews.example/custom.png'
    )
  );
  expect(attempt).toBe(2);
});
