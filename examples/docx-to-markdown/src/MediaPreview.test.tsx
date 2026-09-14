import { expect, test } from 'bun:test';
import { createElement } from 'react';
import { render, waitFor, cleanup } from '@testing-library/react';
import type { MarkdownExportResult, MarkdownImageAsset } from '@docx-editor.dev/docx-to-markdown';
import { MediaPreview, createMediaPreviewUrls } from './MediaPreview';
import { MarkdownBlock } from './MarkdownBlock';

const asset = {
  path: 'media/image.png',
  mimeType: 'image/png',
  bytes: new Uint8Array([1, 2, 3]),
} as MarkdownImageAsset;

test('preview resolves only known paths and releases URLs on replacement and unmount', async () => {
  const create = URL.createObjectURL;
  const revoke = URL.revokeObjectURL;
  const released: string[] = [];
  let count = 0;
  URL.createObjectURL = () => `blob:preview-${++count}`;
  URL.revokeObjectURL = (url) => {
    released.push(url);
  };
  const content =
    '![safe](media/image.png) ![external](https://external.invalid/a.png) <script>bad()</script>';
  const result = { media: [asset] } as unknown as MarkdownExportResult;
  try {
    const view = render(
      createElement(MediaPreview, {
        result,
        children: createElement(MarkdownBlock, { children: content }),
      })
    );
    await waitFor(() =>
      expect(view.container.querySelector('img')?.getAttribute('src')).toBe('blob:preview-1')
    );
    expect(view.container.querySelectorAll('img')).toHaveLength(1);
    expect(view.container.querySelector('script')).toBeNull();
    view.rerender(
      createElement(MediaPreview, {
        result: { ...result },
        children: createElement(MarkdownBlock, { children: content }),
      })
    );
    await waitFor(() =>
      expect(view.container.querySelector('img')?.getAttribute('src')).toBe('blob:preview-2')
    );
    expect(released).toEqual(['blob:preview-1']);
    view.unmount();
    expect(released).toEqual(['blob:preview-1', 'blob:preview-2']);
  } finally {
    cleanup();
    URL.createObjectURL = create;
    URL.revokeObjectURL = revoke;
  }
});

test('partial URL allocation is cleaned if a later allocation fails', () => {
  const create = URL.createObjectURL;
  const revoke = URL.revokeObjectURL;
  const released: string[] = [];
  let count = 0;
  URL.createObjectURL = () => {
    if (++count === 2) throw new Error('allocation failed');
    return 'blob:first';
  };
  URL.revokeObjectURL = (url) => {
    released.push(url);
  };
  try {
    expect(() => createMediaPreviewUrls([asset, { ...asset, path: 'media/second.png' }])).toThrow(
      'allocation failed'
    );
    expect(released).toEqual(['blob:first']);
  } finally {
    URL.createObjectURL = create;
    URL.revokeObjectURL = revoke;
  }
});

test('HTML previews keep occurrence sizes through sanitization and share one blob URL', async () => {
  const result = { media: [asset] } as unknown as MarkdownExportResult;
  const view = render(
    createElement(MediaPreview, {
      result,
      children: createElement(MarkdownBlock, {
        children:
          'Inline: <img src="media/image.png" alt="small" width="24" height="12"> next <img src="media/image.png" alt="banner" width="300" height="80" onerror="bad()">',
      }),
    })
  );
  try {
    await waitFor(() => expect(view.container.querySelectorAll('img')).toHaveLength(2));
    const [small, banner] = Array.from(view.container.querySelectorAll('img'));
    expect(small!.src).toBe(banner!.src);
    expect([small!.width, small!.height]).toEqual([24, 12]);
    expect([banner!.width, banner!.height]).toEqual([300, 80]);
    expect(small!.style.display).toBe('inline');
    expect(banner!.style.aspectRatio).toBe('300 / 80');
    expect(banner!.hasAttribute('onerror')).toBe(false);
  } finally {
    view.unmount();
    cleanup();
  }
});
