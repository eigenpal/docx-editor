// The font notice in the packaged `<DocxEditor>` frame, and `DocxEditor.FontNotice`.
//
// What these pin down: the bar shows for a document that renders a family in a substitute
// face; `fontNotice={false}` removes it; an object restyles it; `renderFontNotice` and
// `fontNotice.children` replace the bar with the host's own component, which receives the
// families, the packaged message and `dismiss`; and a dismissed custom notice stays hidden.

// MUST be first: happy-dom registration happens on import.
import './dom-setup.ts';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { docx } from '../../core/src/editor/__tests__/paginated-surface-fixtures.ts';
import { DocxEditor } from '../src/components/DocxEditor.tsx';
import { DocxEditorRoot } from '../src/editor/DocxEditorRoot.tsx';
import { DocxEditorViewport } from '../src/editor/DocxEditorViewport.tsx';
import { DocxEditorContent } from '../src/editor/DocxEditorContent.tsx';
import type { DocxEditorFontNoticeContext } from '../src/editor/DocxEditorFontNotice.tsx';

const FAMILY = 'Definitely Missing Typeface';
const MISSING = docx(
  `<w:p><w:r><w:rPr><w:rFonts w:ascii="${FAMILY}" w:hAnsi="${FAMILY}"/></w:rPr>` +
    '<w:t>substituted</w:t></w:r></w:p>'
);
const BAR = '.docx-font-notice';

afterEach(cleanup);

// A platform with no installed family: every canvas measurement is the same width, so the
// local font probe finds nothing and the document's family renders in a substitute.
const originalGetContext = HTMLCanvasElement.prototype.getContext;
beforeAll(() => {
  (HTMLCanvasElement.prototype as { getContext: unknown }).getContext = () => ({
    font: '',
    measureText: (text: string) => ({ width: text.length * 10 }),
  });
});
afterAll(() => {
  (HTMLCanvasElement.prototype as { getContext: unknown }).getContext = originalGetContext;
});

/** Lets pending font resolution finish, so the snapshot carries the substituted families. */
async function settle(): Promise<void> {
  for (let tick = 0; tick < 20; tick += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

describe('<DocxEditor fontNotice>', () => {
  test('shows the packaged bar by default', async () => {
    const { container } = render(<DocxEditor document={MISSING} />);
    await settle();
    expect(container.querySelector(BAR)?.textContent).toContain(FAMILY);
  });

  test('fontNotice={false} removes it', async () => {
    const { container } = render(<DocxEditor document={MISSING} fontNotice={false} />);
    await settle();
    expect(container.querySelector(BAR)).toBeNull();
  });

  test('passes an object through to the bar', async () => {
    const { container } = render(
      <DocxEditor document={MISSING} fontNotice={{ className: 'mine' }} />
    );
    await settle();
    expect(container.querySelector(BAR)?.classList.contains('mine')).toBe(true);
  });

  test('renderFontNotice replaces the bar and receives its state', async () => {
    const seen: DocxEditorFontNoticeContext[] = [];
    const { container } = render(
      <DocxEditor
        document={MISSING}
        renderFontNotice={(context) => {
          seen.push(context);
          return (
            <button type="button" data-testid="mine" onClick={context.dismiss}>
              {context.fonts.join('|')}
            </button>
          );
        }}
      />
    );
    await settle();
    const mine = container.querySelector<HTMLElement>('[data-testid="mine"]')!;
    expect(container.querySelector(BAR)).toBeNull();
    expect(mine.textContent).toBe(FAMILY);
    expect(seen.at(-1)!.message).toContain(FAMILY);
    expect(seen.at(-1)!.message).not.toContain('{fonts}');

    fireEvent.click(mine);
    expect(container.querySelector('[data-testid="mine"]')).toBeNull();
  });

  test('fontNotice.children does the same', async () => {
    const { container } = render(
      <DocxEditor
        document={MISSING}
        fontNotice={{ children: ({ fonts }) => <i data-testid="mine">{fonts.length}</i> }}
      />
    );
    await settle();
    expect(container.querySelector(BAR)).toBeNull();
    expect(container.querySelector('[data-testid="mine"]')?.textContent).toBe('1');
  });

  test('a custom notice does not render without substituted families', async () => {
    let calls = 0;
    render(
      <DocxEditor
        document="blank"
        renderFontNotice={() => {
          calls += 1;
          return null;
        }}
      />
    );
    await settle();
    expect(calls).toBe(0);
  });
});

describe('renderFontNotice warnings', () => {
  test('warns once for each case where it cannot render', async () => {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (message: string) => void warnings.push(message);
    try {
      const mine = () => <i data-testid="mine" />;
      const cases = [
        <DocxEditor key="a" document={MISSING} chrome={false} renderFontNotice={mine} />,
        <DocxEditor key="b" document={MISSING} fontNotice={false} renderFontNotice={mine} />,
        <DocxEditor
          key="c"
          document={MISSING}
          fontNotice={{ children: mine }}
          renderFontNotice={mine}
        />,
      ];
      for (const element of [...cases, ...cases]) {
        const { container, unmount } = render(element);
        await settle();
        // Only the third case has a notice to draw, and it draws the render prop once.
        expect(container.querySelectorAll('[data-testid="mine"]').length).toBe(
          element.key === 'c' ? 1 : 0
        );
        unmount();
      }
    } finally {
      console.warn = original;
    }
    const ours = warnings.filter((message) => message.includes('renderFontNotice'));
    expect(ours.length).toBe(3);
    expect(ours[0]).toContain('chrome={false}');
    expect(ours[1]).toContain('fontNotice={false}');
    expect(ours[2]).toContain('fontNotice.children');
  });
});

describe('DocxEditor.FontNotice', () => {
  test('fills the families into a message from a translator that does not interpolate', async () => {
    const { container } = render(
      <DocxEditorRoot document={MISSING}>
        <DocxEditor.FontNotice t={((key: string) => `${key}: {fonts}`) as never}>
          {({ message }) => <p data-testid="mine">{message}</p>}
        </DocxEditor.FontNotice>
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    await settle();
    expect(container.querySelector('[data-testid="mine"]')?.textContent).toBe(
      `editor.fontSubstitutionNotice: ${FAMILY}`
    );
  });

  test('does not call the translator while there is nothing to show', async () => {
    const keys: string[] = [];
    render(
      <DocxEditorRoot document="blank">
        <DocxEditor.FontNotice
          t={
            ((key: string) => {
              keys.push(key);
              return key;
            }) as never
          }
        />
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    await settle();
    expect(keys).toEqual([]);
  });

  test('takes a function as children in a composed editor', async () => {
    const { container } = render(
      <DocxEditorRoot document={MISSING}>
        <DocxEditor.FontNotice>
          {({ message }) => <p data-testid="mine">{message}</p>}
        </DocxEditor.FontNotice>
        <DocxEditorViewport>
          <DocxEditorContent />
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    await settle();
    expect(container.querySelector(BAR)).toBeNull();
    expect(container.querySelector('[data-testid="mine"]')?.textContent).toContain(FAMILY);
  });
});
