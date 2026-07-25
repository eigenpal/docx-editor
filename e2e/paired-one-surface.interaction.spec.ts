// Paired one-surface interaction gate (interactive-paginated-editing 6.5).
//
// The React and Vue specs each prove their own adapter works. This one proves
// they behave the SAME. It runs one scenario set against both adapters and
// compares the results to each other, so a divergence fails here even when both
// adapters pass their own suite — which is exactly the failure mode a
// paired-preview claim has to rule out.

import { expect, test, type Page } from '@playwright/test';
import type { Editor } from '@docx-editor.dev/core-contract/editor';
import { clickTargetPointAt, waitForClickTarget } from './oneSurfaceHelpers.ts';

const ADAPTERS = [
  { name: 'react', url: 'http://localhost:5273' },
  { name: 'vue', url: 'http://localhost:5274' },
] as const;

declare global {
  interface Window {
    __docxAdapterEditor?: Editor;
  }
}

async function mount(page: Page, baseUrl: string): Promise<void> {
  await page.goto(`${baseUrl}/?realAdapter=1`);
  await page.waitForFunction(() => !!window.__docxAdapterEditor);
  await expect(page.getByTestId('adapter-status')).toHaveText('Editable (paragraphs)');
  await waitForClickTarget(page);
}

async function paintedText(page: Page): Promise<string> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-page-index] .ep-one-surface__content > div')]
      .map((el) => el.textContent ?? '')
      .join('')
  );
}

async function selectionOffsets(page: Page): Promise<{ anchor: number | null; head: number | null }> {
  return page.evaluate(() => {
    const sel = window.__docxAdapterEditor!.getInteractionFrame().selection;
    const read = (t: unknown): number | null =>
      t && (t as { kind?: string }).kind === 'text' ? (t as { graphemeOffset: number }).graphemeOffset : null;
    return { anchor: read(sel?.anchor), head: read(sel?.head) };
  });
}

/**
 * Run one scenario against every adapter and return the per-adapter results,
 * so the caller can assert they agree.
 */
async function acrossAdapters<T>(
  browser: import('@playwright/test').Browser,
  scenario: (page: Page) => Promise<T>,
): Promise<Record<string, T>> {
  const results: Record<string, T> = {};
  for (const adapter of ADAPTERS) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await mount(page, adapter.url);
    results[adapter.name] = await scenario(page);
    await context.close();
  }
  return results;
}

test.describe('paired one-surface interaction (task 6.5)', () => {
  test('both adapters expose the same public interaction surface', async ({ browser }) => {
    // SHELL-STRUCTURE testids are excluded for the duration of one declared window.
    //
    // M6V.1 ports the legacy React shell hierarchy (React ONLY, by owner direction),
    // and 10V.1 mechanically ports the finished result to Vue. Between those two tasks
    // the two adapters legitimately expose different shell containers — React the
    // legacy `docx-editor`, Vue the interim `docx-editor-shell` — so asserting full
    // testid equality here would fail on the divergence the plan requires.
    //
    // The INTERACTION surface is still compared strictly, which is what this gate
    // exists for: every testid the interaction specs drive must match. Only the shell
    // frame's own containers are exempt, and this exemption MUST be deleted at 10V.1.
    const SHELL_STRUCTURE_TESTIDS = new Set(['docx-editor', 'docx-editor-shell']);
    const results = await acrossAdapters(browser, async (page) =>
      page.evaluate(() =>
        [...document.querySelectorAll('[data-testid]')].map((el) => (el as HTMLElement).dataset.testid).sort(),
      ),
    );
    const interactionSurface = (ids: (string | undefined)[]) =>
      ids.filter((id): id is string => !!id && !SHELL_STRUCTURE_TESTIDS.has(id));
    expect(interactionSurface(results.vue)).toEqual(interactionSurface(results.react));
    expect(results.react).toContain('one-surface-click-target');
    // And the exemption must stay narrow: exactly one shell container per adapter.
    expect(results.react.filter((id) => id && SHELL_STRUCTURE_TESTIDS.has(id))).toHaveLength(1);
    expect(results.vue.filter((id) => id && SHELL_STRUCTURE_TESTIDS.has(id))).toHaveLength(1);
  });

  test('a click at the same fraction of the same glyph lands on the same offset', async ({ browser }) => {
    const results = await acrossAdapters(browser, async (page) => {
      const offsets: number[] = [];
      for (const fraction of [0.05, 0.4, 0.75, 0.98]) {
        const point = await clickTargetPointAt(page, fraction);
        await page.mouse.click(point.x, point.y);
        offsets.push((await selectionOffsets(page)).head ?? -1);
      }
      return offsets;
    });
    expect(results.vue).toEqual(results.react);
    // And the offsets must actually advance, or both adapters agree on nothing.
    expect(results.react[0]).toBeLessThan(results.react[3]!);
  });

  test('typing the same text at the same place produces the same document', async ({ browser }) => {
    const results = await acrossAdapters(browser, async (page) => {
      const before = await paintedText(page);
      const point = await clickTargetPointAt(page, 0.1);
      await page.mouse.click(point.x, point.y);
      await page.keyboard.type('Paired');
      await expect.poll(async () => await paintedText(page)).toContain('Paired');
      return { before, after: await paintedText(page) };
    });
    expect(results.vue).toEqual(results.react);
  });

  test('the caret stays painted and geometry keys stay alive after typing', async ({ browser }) => {
    // The typing scenario above asserted painted TEXT only. Independent review
    // found that hid a defect in the primary editing loop: after any keystroke the
    // reconciled selection was published with an affinity the caret-stop index does
    // not contain, so `frame.caret` was null, no caret element existed, and Home,
    // End, PageUp, PageDown, ArrowUp and ArrowDown were all refused with
    // `invalidTarget` — dead keys, because the bridge swallows them in capture
    // phase. Both adapters. Nothing in the suite looked at the caret after typing.
    const results = await acrossAdapters(browser, async (page) => {
      // Click mid-glyph so the caret lands at an INTERIOR offset. At the paragraph
      // end the buggy affinity happened to be correct, which is why the headless
      // end-of-paragraph test also stayed green.
      const point = await clickTargetPointAt(page, 0.4);
      await page.mouse.click(point.x, point.y);
      await page.keyboard.type('Q');
      await expect.poll(async () => await paintedText(page)).toContain('Q');

      const afterTyping = await page.evaluate(() => {
        const frame = window.__docxAdapterEditor!.getInteractionFrame();
        const head = frame.selection?.head as { kind?: string; affinity?: string } | undefined;
        return {
          caretInFrame: frame.caret !== null,
          focused: frame.focus.focused,
          headAffinity: head?.kind === 'text' ? head.affinity : null,
          caretInDom: document.querySelectorAll('[data-testid="one-surface-caret"]').length,
        };
      });

      // Every geometry key must be answerable, not refused for want of a caret.
      const keyOutcomes = await page.evaluate(() => {
        const editor = window.__docxAdapterEditor!;
        const out: Record<string, string> = {};
        for (const key of ['Home', 'End', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
          // Read `res.outcome.ok`, not `res.ok`. `dispatchInteraction` returns
          // `{ outcome, hostEffects }`, so `res.ok` is always `undefined`: every key
          // recorded the literal string "refused: " and the assertion below passed for
          // accepted AND refused keys alike. Round-5 review proved it vacuous — for a
          // genuinely refused PageUp the computed value was "refused: " and this spec
          // still passed. It was the guard for the round-4 dead-keys defect, so it
          // protected nothing.
          const res = editor.dispatchInteraction({
            kind: 'geometryKeyboard',
            frameId: editor.getInteractionFrame().id,
            key,
            shiftKey: false,
            altKey: false,
            ctrlKey: false,
            metaKey: false,
          } as never) as { outcome: { ok: boolean; reason?: string } };
          out[key] = res.outcome.ok ? 'ok' : `refused: ${res.outcome.reason ?? ''}`;
        }
        return out;
      });

      return { afterTyping, keyOutcomes };
    });

    for (const adapter of ['react', 'vue'] as const) {
      const { afterTyping, keyOutcomes } = results[adapter];
      expect(afterTyping.focused, `${adapter} focus after typing`).toBe(true);
      expect(afterTyping.caretInFrame, `${adapter} frame.caret after typing`).toBe(true);
      expect(afterTyping.caretInDom, `${adapter} painted caret after typing`).toBeGreaterThan(0);
      expect(afterTyping.headAffinity, `${adapter} head affinity`).toBe('upstream');
      for (const [key, outcome] of Object.entries(keyOutcomes)) {
        expect(outcome, `${adapter} ${key} after typing`).not.toContain('caret');
      }
    }
    // And the two adapters must agree.
    expect(results.vue).toEqual(results.react);
  });

  test('the same drag selects the same range', async ({ browser }) => {
    const results = await acrossAdapters(browser, async (page) => {
      const from = await clickTargetPointAt(page, 0.05);
      const to = await clickTargetPointAt(page, 0.95);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      for (let i = 1; i <= 8; i += 1) {
        await page.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y);
      }
      await page.mouse.up();
      return selectionOffsets(page);
    });
    expect(results.vue).toEqual(results.react);
    expect(results.react.head).toBeGreaterThan(results.react.anchor!);
  });

  test('an unsupported command is refused with the same typed reason', async ({ browser }) => {
    const results = await acrossAdapters(browser, async (page) =>
      page.evaluate(() => {
        const outcome = window.__docxAdapterEditor!.can({ type: 'toggleMark', mark: 'underline' });
        return outcome.ok ? { ok: true } : { ok: false, code: outcome.code, reason: outcome.reason };
      }),
    );
    // A capability refusal must read identically, or one adapter's UI would
    // explain the limit differently from the other's.
    expect(results.vue).toEqual(results.react);
    expect(results.react.ok).toBe(false);
  });

  test('a margin click is refused identically and moves no caret in either adapter', async ({ browser }) => {
    const results = await acrossAdapters(browser, async (page) => {
      const point = await clickTargetPointAt(page, 0.1);
      await page.mouse.click(point.x, point.y);
      const placed = await selectionOffsets(page);
      const outcome = await page.evaluate(() => {
        const editor = window.__docxAdapterEditor!;
        const frame = editor.getInteractionFrame();
        const rect = document.querySelector('[data-page-index]')!.getBoundingClientRect();
        const result = editor.dispatchInteraction({
          kind: 'click',
          frameId: frame.id,
          clientPoint: { x: rect.x + rect.width / 2, y: rect.y + rect.height - 8 },
          clickCount: 1,
        }).outcome;
        return result.ok ? { ok: true } : { ok: false, code: result.code, reason: result.reason };
      });
      return { outcome, placed, after: await selectionOffsets(page) };
    });
    expect(results.vue).toEqual(results.react);
    expect(results.react.outcome.ok).toBe(false);
    expect(results.react.after).toEqual(results.react.placed);
  });

  test('an edit survives save and reopen identically in both adapters', async ({ browser }) => {
    const results = await acrossAdapters(browser, async (page) => {
      const point = await clickTargetPointAt(page, 0.1);
      await page.mouse.click(point.x, point.y);
      await page.keyboard.type('Roundtrip');
      await expect.poll(async () => await paintedText(page)).toContain('Roundtrip');
      await page.evaluate(async () => {
        const editor = window.__docxAdapterEditor!;
        const saved = await editor.save();
        await editor.load(saved instanceof Uint8Array ? saved : new Uint8Array(saved as ArrayBuffer));
      });
      await expect.poll(async () => await paintedText(page)).toContain('Roundtrip');
      return paintedText(page);
    });
    expect(results.vue).toEqual(results.react);
  });

  test('bold via can then exec produces the same document in both adapters', async ({ browser }) => {
    const results = await acrossAdapters(browser, async (page) => {
      const from = await clickTargetPointAt(page, 0.05);
      const to = await clickTargetPointAt(page, 0.95);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      for (let i = 1; i <= 6; i += 1) await page.mouse.move(from.x + ((to.x - from.x) * i) / 6, from.y);
      await page.mouse.up();
      return page.evaluate(() => {
        const editor = window.__docxAdapterEditor!;
        // can() before exec(), the rule the toolbar follows.
        const can = editor.can({ type: 'toggleMark', mark: 'bold' });
        if (!can.ok) return { can: false, exec: null, boldRuns: [] as string[] };
        const exec = editor.exec({ type: 'toggleMark', mark: 'bold' });
        const boldRuns = editor
          .getInteractionFrame()
          .display.flatMap((p) => p.items)
          .flatMap((item) => (item.kind === 'text' ? item.runs : []))
          .filter((run) => run.bold)
          .map((run) => run.text);
        return { can: true, exec, boldRuns };
      });
    });
    expect(results.vue).toEqual(results.react);
    expect(results.react.can).toBe(true);
    expect(results.react.boldRuns.length).toBeGreaterThan(0);
  });

  test('clipboard paste lands identically in both adapters', async ({ browser }) => {
    const results = await acrossAdapters(browser, async (page) => {
      const point = await clickTargetPointAt(page, 0.1);
      await page.mouse.click(point.x, point.y);
      await page.evaluate(() => {
        const pm = document.querySelector('.ProseMirror')!;
        const data = new DataTransfer();
        data.setData('text/plain', 'PairedPaste');
        pm.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      });
      await expect.poll(async () => await paintedText(page)).toContain('PairedPaste');
      return paintedText(page);
    });
    expect(results.vue).toEqual(results.react);
  });

  test('an IME composition commits identically in both adapters', async ({ browser }) => {
    const results = await acrossAdapters(browser, async (page) => {
      const point = await clickTargetPointAt(page, 0.1);
      await page.mouse.click(point.x, point.y);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.imeSetComposition', { text: 'には', selectionStart: 2, selectionEnd: 2 });
      await cdp.send('Input.insertText', { text: 'にほん' });
      await expect.poll(async () => await paintedText(page)).toContain('にほん');
      const text = await paintedText(page);
      // Committed once, not twice.
      return { text, occurrences: text.split('にほん').length - 1 };
    });
    expect(results.vue).toEqual(results.react);
    expect(results.react.occurrences).toBe(1);
  });

  test('an active composition is visible to the frame and blocks geometry keys', async ({ browser }) => {
    // `frame.composition` was hardcoded `{ active: false }` and the surface's
    // composition observation was never read, so the public
    // `EditorDriver.compositionState()` was a constant. Independent review measured
    // ArrowDown during a live composition returning ok:true and moving the painted
    // caret to a different paragraph while the IME kept composing in the original.
    const results = await acrossAdapters(browser, async (page) => {
      const point = await clickTargetPointAt(page, 0.3);
      await page.mouse.click(point.x, point.y);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.imeSetComposition', { text: 'には', selectionStart: 2, selectionEnd: 2 });

      const during = await page.evaluate(() => {
        const editor = window.__docxAdapterEditor!;
        const frame = editor.getInteractionFrame();
        const head = frame.selection?.head as { kind?: string; identity?: { blockId: string } } | undefined;
        const blockBefore = head?.kind === 'text' ? head.identity!.blockId : null;
        const res = editor.dispatchInteraction({
          kind: 'geometryKeyboard',
          frameId: frame.id,
          key: 'ArrowDown',
          shiftKey: false,
          altKey: false,
          ctrlKey: false,
          metaKey: false,
        } as never) as { outcome: { ok: boolean; code?: string } };
        const after = editor.getInteractionFrame().selection?.head as
          | { kind?: string; identity?: { blockId: string } }
          | undefined;
        return {
          compositionActive: frame.composition.active,
          arrowAccepted: res.outcome.ok,
          arrowCode: res.outcome.code ?? null,
          blockUnchanged: blockBefore === (after?.kind === 'text' ? after.identity!.blockId : null),
        };
      });

      // The composition must still commit correctly afterwards.
      await cdp.send('Input.insertText', { text: 'にほん' });
      await expect.poll(async () => await paintedText(page)).toContain('にほん');
      return during;
    });

    for (const adapter of ['react', 'vue'] as const) {
      const r = results[adapter];
      expect(r.compositionActive, `${adapter} frame sees the composition`).toBe(true);
      expect(r.arrowAccepted, `${adapter} ArrowDown during composition`).toBe(false);
      expect(r.arrowCode, `${adapter} refusal code`).toBe('unsupported');
      expect(r.blockUnchanged, `${adapter} caret stayed in the composing block`).toBe(true);
    }
    expect(results.vue).toEqual(results.react);
  });

  test('the input host follows the caret through container AND window scroll', async ({ browser }) => {
    // Two review findings meet here. The engine tracked `scroll` on exactly one
    // element, so a window/ancestor scroll left the hidden ProseMirror host at a
    // stale client position — measured 300px drift in React, 400px in Vue, with
    // `placementReason` still reporting 'applied'. And the Vue demo's viewport never
    // scrolled at all (clientHeight === scrollHeight, assigned scrollTop did not
    // stick), so the scroll leg of this gate passed vacuously on one adapter.
    const results = await acrossAdapters(browser, async (page) => {
      const point = await clickTargetPointAt(page, 0.3);
      await page.mouse.click(point.x, point.y);

      const drift = async (): Promise<{ dx: number; dy: number; reason: string | null }> =>
        page.evaluate(() => {
          const editor = window.__docxAdapterEditor!;
          const caret = editor.getCaretClientRect?.() ?? null;
          const shell = document.querySelector('[data-docx-input-host] > *') as HTMLElement | null;
          const obs = (editor as unknown as { getInputHostObservation?: () => { placementReason?: string } })
            .getInputHostObservation?.();
          if (!caret || !shell) return { dx: -1, dy: -1, reason: obs?.placementReason ?? null };
          const r = shell.getBoundingClientRect();
          return {
            dx: Math.abs(r.x - caret.x),
            dy: Math.abs(r.y - caret.y),
            reason: obs?.placementReason ?? null,
          };
        });

      const atRest = await drift();

      // The editor's own scroll container.
      const containerScrolled = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="docx-editor-scroll"]') as HTMLElement | null;
        if (!el) return { moved: false, scrollable: false };
        const scrollable = el.scrollHeight > el.clientHeight;
        el.scrollTop = 120;
        return { moved: el.scrollTop > 0, scrollable };
      });
      await page.waitForTimeout(80);
      const afterContainer = await drift();

      // And the window/document, which the engine never watched.
      await page.evaluate(() => window.scrollTo(0, 300));
      await page.waitForTimeout(80);
      const afterWindow = await drift();

      return { atRest, containerScrolled, afterContainer, afterWindow };
    });

    for (const adapter of ['react', 'vue'] as const) {
      const r = results[adapter];
      // The container must genuinely be a scroller, or the leg proves nothing.
      expect(r.containerScrolled.scrollable, `${adapter} viewport is scrollable`).toBe(true);
      expect(r.containerScrolled.moved, `${adapter} scrollTop sticks`).toBe(true);
      for (const [label, d] of Object.entries(r)) {
        if (label === 'containerScrolled') continue;
        const m = d as { dx: number; dy: number };
        expect(m.dx, `${adapter} ${label} dx`).toBeLessThan(3);
        expect(m.dy, `${adapter} ${label} dy`).toBeLessThan(3);
      }
    }
  });

  test('undo and redo reverse and restore identically in both adapters', async ({ browser }) => {
    const results = await acrossAdapters(browser, async (page) => {
      const original = await paintedText(page);
      const point = await clickTargetPointAt(page, 0.1);
      await page.mouse.click(point.x, point.y);
      // One character: typing bursts are not coalesced into a single undo step,
      // so a multi-character assertion would pin an unspecified policy.
      await page.keyboard.type('P');
      await expect.poll(async () => await paintedText(page)).not.toBe(original);
      const typed = await paintedText(page);

      const undo = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
      const redo = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y';
      await page.keyboard.press(undo);
      await expect.poll(async () => await paintedText(page)).toBe(original);
      await page.keyboard.press(redo);
      await expect.poll(async () => await paintedText(page)).toBe(typed);
      return { original, typed, final: await paintedText(page) };
    });
    expect(results.vue).toEqual(results.react);
  });
});
