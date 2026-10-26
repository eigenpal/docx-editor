/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The Vue twin of `review-rail-window-mount.test.tsx`: the rail's visible band, from its first
// render. A null band renders every card, so a rail that mounted with a null band beside a
// document with thousands of tracked changes built and dropped thousands of cards.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { createApp, defineComponent, h, nextTick, shallowRef, type VNode } from 'vue';
import { useRailWindow, type RailWindow } from '../vue/use-rail-window.ts';

afterEach(() => document.body.replaceChildren());

/**
 * Mount a rail inside a scroller, recording the band each render reads. The element reaches
 * `railRef` from vnode hooks, as the packaged rail's does; `attached={false}` is a rail that
 * never provides one. The rail renders only while `active` holds, as the packaged one does.
 */
async function mountRail(
  scroller: boolean,
  { attached = true, active = shallowRef(true) } = {}
): Promise<(RailWindow | null)[]> {
  const renders: (RailWindow | null)[] = [];
  const Rail = defineComponent({
    setup() {
      const railRef = shallowRef<HTMLElement | null>(null);
      const band = useRailWindow(shallowRef({}), railRef, () => active.value);
      const capture = (vnode: VNode) => {
        railRef.value = vnode.el instanceof HTMLElement ? vnode.el : null;
      };
      return () => {
        renders.push(band.value);
        if (!active.value) return null;
        const rail = h('aside', {
          ...(attached
            ? {
                onVnodeMounted: capture,
                onVnodeBeforeUnmount: () => {
                  railRef.value = null;
                },
              }
            : {}),
          'data-testid': 'rail',
        });
        return scroller ? h('div', { 'data-testid': 'scroller' }, [rail]) : rail;
      };
    },
  });
  const host = document.createElement('div');
  document.body.append(host);
  createApp(Rail).mount(host);
  await nextTick();
  await nextTick();
  return renders;
}

/** happy-dom lays nothing out: give the rail its scroller and the scroller a height. */
async function withScroller<T>(scroller: boolean, run: () => Promise<T>): Promise<T> {
  const offset = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent');
  const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get(this: HTMLElement) {
      return scroller && this.dataset.testid === 'rail' ? this.parentElement : null;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => 900,
  });
  try {
    return await run();
  } finally {
    for (const [name, descriptor] of [
      ['offsetParent', offset],
      ['clientHeight', height],
    ] as const) {
      if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
    }
  }
}

const covers = (band: RailWindow | null, y: number) =>
  band === null || (y >= band.top && y <= band.bottom);

describe('the review rail band (Vue)', () => {
  test('holds no card before the first measure, then the visible band', async () => {
    const renders = await withScroller(true, () => mountRail(true));
    // No render shows every card: the first one holds none, and the measured band follows.
    expect(renders.every((band) => band !== null)).toBe(true);
    expect(covers(renders[0]!, 0)).toBe(false);
    expect(covers(renders.at(-1)!, 0)).toBe(true);
    expect(covers(renders.at(-1)!, 100_000)).toBe(false);
  });

  test('renders every card when the rail has no scroller', async () => {
    const renders = await withScroller(false, () => mountRail(false));
    expect(renders.at(-1)).toBeNull();
  });

  test('holds no card while a rail that becomes visible is measured', async () => {
    const active = shallowRef(false);
    const renders = await withScroller(true, async () => {
      const seen = await mountRail(true, { active });
      active.value = true;
      await nextTick();
      await nextTick();
      return seen;
    });
    expect(renders.every((band) => band !== null)).toBe(true);
    expect(covers(renders.at(-1)!, 0)).toBe(true);
  });

  test('renders every card when the rail element never reaches the ref', async () => {
    const renders = await withScroller(true, () => mountRail(true, { attached: false }));
    expect(renders.at(-1)).toBeNull();
  });
});
