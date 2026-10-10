import '../../../packages/react/test/dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, render, waitFor } from '@testing-library/react';
import { HighlightedCode, MAX_HIGHLIGHTED_CODE_CHARACTERS } from './HighlightedCode';

afterEach(cleanup);

describe('HighlightedCode', () => {
  test('never paints highlighted output from a previous response', async () => {
    const view = render(
      <HighlightedCode code={'{"secret":"contract-a"}'} language="json" label="Response" />
    );

    await waitFor(() => expect(view.container.querySelector('.shiki')).not.toBeNull());
    expect(view.container.textContent).toContain('contract-a');

    view.rerender(
      <HighlightedCode code="// Updating the DOCX export…" language="json" label="Response" />
    );

    expect(view.container.textContent).toContain('Updating the DOCX export');
    expect(view.container.textContent).not.toContain('contract-a');

    view.rerender(
      <HighlightedCode code="// The current DOCX export failed." language="json" label="Response" />
    );

    expect(view.container.textContent).toContain('current DOCX export failed');
    expect(view.container.textContent).not.toContain('contract-a');

    await waitFor(() =>
      expect(view.container.querySelector('.shiki')?.textContent).toContain(
        'current DOCX export failed'
      )
    );
    expect(view.container.textContent).not.toContain('contract-a');
  });

  test('keeps large responses complete while bypassing token-heavy highlighting', async () => {
    const tail = 'LAST_PAGE_AND_BINDING';
    const response = `${'x'.repeat(MAX_HIGHLIGHTED_CODE_CHARACTERS + 1)}${tail}`;
    const view = render(<HighlightedCode code={response} language="json" label="Response" />);

    expect(view.container.querySelector('.shiki')).toBeNull();
    expect(view.container.textContent?.endsWith(tail)).toBe(true);

    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(view.container.querySelector('.shiki')).toBeNull();
    expect(view.container.textContent?.length).toBe(response.length);
  });
});
