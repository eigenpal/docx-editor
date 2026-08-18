import './dom-setup.ts';

import { describe, expect, test } from 'bun:test';
import { Fragment, createApp, defineComponent, h, type VNode } from 'vue';
import {
  MERGE_APPEND_ORDER,
  MERGE_DEFAULT_ORDER,
  MERGE_FIXTURE_ENTRIES,
  MERGE_FRAGMENT_KEY,
  MERGE_HIDDEN_B_ORDER,
  MERGE_LAST_WINS_LABEL,
  MERGE_PRESET_FALSE_ORDER,
} from '../../../scripts/test/merge-arrangement-fixtures.ts';
import { docxSlotOf, mergeArrangement, unwrapFragment } from '../src/editor/merge-arrangement';

function keyOfChild(vnode: VNode): string | null {
  const unwrapped = unwrapFragment(vnode, keyOfChild);
  if (unwrapped !== null) return unwrapped;
  return docxSlotOf(vnode);
}

function renderPart(id: string, label: string) {
  const Part = defineComponent({
    name: `Part_${id}`,
    props: { hidden: { type: Boolean, default: undefined } },
    setup(props) {
      return () => (props.hidden ? null : h('span', { 'data-slot': id }, label));
    },
  });
  (Part as unknown as { docxSlot: string }).docxSlot = id;
  return Part;
}

function runMerge(children: VNode[], preset = true): string[] {
  const parts = Object.fromEntries(
    MERGE_FIXTURE_ENTRIES.map((e) => [e.id, renderPart(e.id, e.label)])
  );
  const out = mergeArrangement({
    entries: MERGE_FIXTURE_ENTRIES,
    children,
    preset,
    keyOfEntry: (entry) => entry.id,
    keyOfChild: keyOfChild,
    renderEntry: (entry) => h(parts[entry.id]!, {}),
  });
  const container = document.createElement('div');
  const app = createApp({
    render: () => h('div', { class: 'merge-root' }, out as VNode[]),
  });
  app.mount(container);
  const keys = [...container.querySelectorAll('[data-slot]')].map(
    (el) => el.getAttribute('data-slot')!
  );
  app.unmount();
  return keys;
}

describe('mergeArrangement (Vue)', () => {
  test('no children yields the packaged arrangement in order', () => {
    expect(runMerge([])).toEqual([...MERGE_DEFAULT_ORDER]);
  });

  test('hidden override removes its slot', () => {
    const B = renderPart('b', 'B');
    expect(runMerge([h(B, { hidden: true })])).toEqual([...MERGE_HIDDEN_B_ORDER]);
  });

  test('preset=false renders children verbatim', () => {
    expect(runMerge([h('span', { 'data-slot': 'host-only' }, 'host')], false)).toEqual([
      ...MERGE_PRESET_FALSE_ORDER,
    ]);
  });

  test('unknown children append after defaults', () => {
    expect(runMerge([h('span', { 'data-slot': 'extra' }, 'x')])).toEqual([...MERGE_APPEND_ORDER]);
  });

  test('last override for the same slot wins', () => {
    const B1 = renderPart('b', 'B-override-1');
    const B2 = defineComponent({
      setup() {
        return () => h('span', { 'data-slot': 'b' }, MERGE_LAST_WINS_LABEL);
      },
    });
    (B2 as unknown as { docxSlot: string }).docxSlot = 'b';
    const container = document.createElement('div');
    const out = mergeArrangement({
      entries: MERGE_FIXTURE_ENTRIES,
      children: [h(B1!), h(B2!)],
      preset: true,
      keyOfEntry: (entry) => entry.id,
      keyOfChild: keyOfChild,
      renderEntry: (entry) => h(renderPart(entry.id, entry.label)!, {}),
    });
    const app = createApp({ render: () => h('div', out as VNode[]) });
    app.mount(container);
    expect(container.textContent).toContain(MERGE_LAST_WINS_LABEL);
    app.unmount();
  });

  test('single-child Fragment unwraps to its key', () => {
    const B = renderPart(MERGE_FRAGMENT_KEY, 'B');
    const wrapped = h(Fragment, null, [h(B!)]);
    expect(unwrapFragment(wrapped, keyOfChild)).toBe(MERGE_FRAGMENT_KEY);
  });
});
