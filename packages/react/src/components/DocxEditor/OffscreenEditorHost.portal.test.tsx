import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { cleanup, render } from '@testing-library/react';

import { OffscreenEditorHost } from './OffscreenEditorHost';

beforeAll(() => GlobalRegistrator.register());
afterEach(() => cleanup());
afterAll(() => GlobalRegistrator.unregister());

describe('OffscreenEditorHost client portal', () => {
  test('portals the hidden PM host onto document.body', () => {
    const { unmount } = render(createElement(OffscreenEditorHost, { document: null }));

    const host = document.body.querySelector('.paged-editor__hidden-pm');
    expect(host).not.toBeNull();
    expect(host?.parentElement).toBe(document.body);

    unmount();
    expect(document.body.querySelector('.paged-editor__hidden-pm')).toBeNull();
  });
});
