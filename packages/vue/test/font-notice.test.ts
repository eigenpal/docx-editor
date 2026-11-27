// The font notice in the packaged `<DocxEditor>` frame, and `DocxEditorFontNotice`. The
// twin of the React suite: the bar shows for a document that renders a family in a
// substitute face; `fontNotice: false` removes it; an object restyles it; the `fontNotice`
// slot replaces the bar and receives the families, the packaged message and `dismiss`.

import './dom-setup.ts';

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { h } from 'vue';
import { DocxEditorFontNotice } from '../src/editor/DocxEditorFontNotice';
import type { DocxEditorFontNoticeContext } from '../src/editor/DocxEditorFontNotice';
import { docx } from './helpers/fixtures';
import { flush, mountEditorTree, mountSugarAsync, nextTick } from './helpers/mount';

const FAMILY = 'Definitely Missing Typeface';
const MISSING = docx(
  `<w:p><w:r><w:rPr><w:rFonts w:ascii="${FAMILY}" w:hAnsi="${FAMILY}"/></w:rPr>` +
    '<w:t>substituted</w:t></w:r></w:p>'
);
const BAR = '.docx-font-notice';
const MINE = '[data-testid="mine"]';

afterEach(() => {
  document.body.innerHTML = '';
});

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
  await flush();
  await nextTick();
}

describe('<DocxEditor fontNotice>', () => {
  test('shows the packaged bar by default', async () => {
    const view = await mountSugarAsync({ document: MISSING });
    await settle();
    expect(view.container.querySelector(BAR)?.textContent).toContain(FAMILY);
  });

  test('fontNotice false removes it', async () => {
    const view = await mountSugarAsync({ document: MISSING, fontNotice: false });
    await settle();
    expect(view.container.querySelector(BAR)).toBeNull();
  });

  test('passes an object through to the bar', async () => {
    const view = await mountSugarAsync({ document: MISSING, fontNotice: { className: 'mine' } });
    await settle();
    expect(view.container.querySelector(BAR)?.classList.contains('mine')).toBe(true);
  });

  test('the fontNotice slot replaces the bar and receives its state', async () => {
    const seen: DocxEditorFontNoticeContext[] = [];
    const slot = (context: DocxEditorFontNoticeContext) => {
      seen.push(context);
      return h(
        'button',
        { type: 'button', 'data-testid': 'mine', onClick: context.dismiss },
        context.fonts.join('|')
      );
    };
    const view = await mountSugarAsync(
      { document: MISSING },
      { fontNotice: slot as unknown as () => ReturnType<typeof h> }
    );
    await settle();
    const mine = view.container.querySelector<HTMLElement>(MINE)!;
    expect(view.container.querySelector(BAR)).toBeNull();
    expect(mine.textContent).toBe(FAMILY);
    expect(seen.at(-1)!.message).toContain(FAMILY);
    expect(seen.at(-1)!.message).not.toContain('{fonts}');

    mine.click();
    await settle();
    expect(view.container.querySelector(MINE)).toBeNull();
  });

  test('children that is not a function keeps the packaged bar', async () => {
    // Vue reports the wrong prop type in development. The test checks what renders.
    const original = console.warn;
    console.warn = () => {};
    try {
      const view = await mountSugarAsync({ document: MISSING, fontNotice: { children: 'text' } });
      await settle();
      expect(view.container.querySelector(BAR)?.textContent).toContain(FAMILY);
    } finally {
      console.warn = original;
    }
  });

  test('an attribute reaches the packaged bar, and a custom notice takes none', async () => {
    const warnings: unknown[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => void warnings.push(args[0]);
    try {
      const bar = await mountSugarAsync({ document: MISSING, fontNotice: { class: 'mine' } });
      await settle();
      expect(bar.container.querySelector(BAR)?.classList.contains('mine')).toBe(true);
      bar.unmount();
      const custom = await mountSugarAsync(
        { document: MISSING, fontNotice: { class: 'mine' } },
        { fontNotice: () => [h('i', { 'data-testid': 'mine' }), h('b')] }
      );
      await settle();
      expect(custom.container.querySelector(MINE)).not.toBeNull();
      custom.unmount();
    } finally {
      console.warn = original;
    }
    expect(warnings.filter((entry) => String(entry).includes('Extraneous'))).toEqual([]);
  });

  test('a press on Dismiss does not take focus from the page', async () => {
    const view = await mountSugarAsync({ document: MISSING });
    await settle();
    const button = view.container.querySelector<HTMLElement>(`${BAR}__dismiss`)!;
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    button.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
  });

  test('fontNotice.children does the same', async () => {
    const view = await mountSugarAsync({
      document: MISSING,
      fontNotice: {
        children: ({ fonts }: DocxEditorFontNoticeContext) =>
          h('i', { 'data-testid': 'mine' }, String(fonts.length)),
      },
    });
    await settle();
    expect(view.container.querySelector(BAR)).toBeNull();
    expect(view.container.querySelector(MINE)?.textContent).toBe('1');
  });

  test('a custom notice does not render without substituted families', async () => {
    let calls = 0;
    await mountSugarAsync(
      { document: 'blank' },
      {
        fontNotice: () => {
          calls += 1;
          return [];
        },
      }
    );
    await settle();
    expect(calls).toBe(0);
  });
});

describe('fontNotice slot warnings', () => {
  test('warns once for each case where it cannot render', async () => {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (message: string) => void warnings.push(message);
    try {
      const mine = () => h('i', { 'data-testid': 'mine' });
      const cases: [Record<string, unknown>, number][] = [
        [{ document: MISSING, chrome: false }, 0],
        [{ document: MISSING, fontNotice: false }, 0],
        // Only this case has a notice to draw, and it draws the slot once.
        [{ document: MISSING, fontNotice: { children: mine } }, 1],
      ];
      for (const [props, drawn] of [...cases, ...cases]) {
        const view = await mountSugarAsync(props, { fontNotice: mine });
        await settle();
        expect(view.container.querySelectorAll(MINE).length).toBe(drawn);
        view.unmount();
      }
    } finally {
      console.warn = original;
    }
    const ours = warnings.filter((message) => message.includes('#fontNotice'));
    expect(ours.length).toBe(3);
    expect(ours[0]).toContain(':chrome="false"');
    expect(ours[1]).toContain(':font-notice="false"');
    expect(ours[2]).toContain('fontNotice.children');
  });
});

describe('DocxEditorFontNotice', () => {
  test('fills the families into a message from a translator that does not interpolate', async () => {
    const view = mountEditorTree(
      () =>
        h(
          DocxEditorFontNotice,
          { t: ((key: string) => `${key}: {fonts}`) as never },
          {
            default: ({ message }: DocxEditorFontNoticeContext) =>
              h('p', { 'data-testid': 'mine' }, message),
          }
        ),
      MISSING
    );
    await settle();
    expect(view.container.querySelector(MINE)?.textContent).toBe(
      `editor.fontSubstitutionNotice: ${FAMILY}`
    );
  });

  test('takes a default slot in a composed editor', async () => {
    const view = mountEditorTree(
      () =>
        h(DocxEditorFontNotice, null, {
          default: ({ message }: DocxEditorFontNoticeContext) =>
            h('p', { 'data-testid': 'mine' }, message),
        }),
      MISSING
    );
    await settle();
    expect(view.container.querySelector(BAR)).toBeNull();
    expect(view.container.querySelector(MINE)?.textContent).toContain(FAMILY);
  });
});
