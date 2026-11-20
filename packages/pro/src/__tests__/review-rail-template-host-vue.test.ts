/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A Vue host written as a template. A compiled template passes new slot functions on each
// render of the component that owns it, so the identity of a slot function says nothing
// there. These tests use templates the Vue compiler compiled, with the slot flags it wrote.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { defineComponent, h, ref } from 'vue';
import { DocxEditorReview, type ReviewItemView } from '../vue/index.ts';
import { RAIL_BAND_STEP } from '../review/rail-window.ts';
import { installRailGeometry } from './review-rail-metrics-harness.ts';
import {
  counter,
  installViewHeight,
  mountedCards,
  scrollTo,
  scrollerOf,
  typeIn,
} from './review-rail-render-work-harness.ts';
import {
  TEMPLATE_COMPONENTS,
  compileTemplate,
  editorTemplate,
  mountRail,
  mountTemplateHost,
  settle,
  unmountRails,
} from './review-rail-render-work-vue-harness.ts';

let restore: (() => void)[] = [];
beforeAll(() => {
  restore = [installRailGeometry(), installViewHeight()];
});
afterAll(() => {
  for (const undo of restore) undo();
});
afterEach(() => {
  unmountRails();
});

const ITEM_SLOT =
  '<template #item="{ item }">' +
  '<div :data-card-key="item.key" :data-label="label">{{ called(item.key) }}<ReviewCard /></div>' +
  '</template>';

/**
 * A `Card` part with a child that reads `label`, inside a `List` part. Every card has the key
 * `part`, so the render counter files the renders of all cards under it.
 */
const CARD_PART =
  '<ReviewList><ReviewCard class-name="host-card" data-card-key="part">' +
  '<span data-testid="host-extra" :data-label="label" />' +
  '</ReviewCard></ReviewList>';

describe('a review rail in a compiled template (Vue)', () => {
  test('a host render for state outside the editor renders no card', async () => {
    const outside = ref(0);
    const { container, templates, cards, reset } = await mountTemplateHost(
      `<p data-testid="outside">{{ outside }}</p>` +
        editorTemplate(`<DocxEditorReview>${ITEM_SLOT}</DocxEditorReview>`),
      () => ({ outside, label: 'one' })
    );
    const mounted = mountedCards(container);
    expect(mounted.length).toBeGreaterThan(1);

    reset();
    for (let i = 0; i < 3; i += 1) {
      outside.value += 1;
      await settle();
    }
    expect(container.querySelector('[data-testid="outside"]')?.textContent).toBe('3');
    // The rail then renders for a reason of its own: it still holds the cards.
    scrollTo(scrollerOf(container), RAIL_BAND_STEP);
    await settle();
    for (const key of mounted) {
      expect(templates.of(key)).toBe(0);
      expect(cards.of(key)).toBe(0);
    }
  });

  test('a host render for state beside the rail renders no card', async () => {
    const beside = ref(0);
    const { container, editor, templates, cards, reset } = await mountTemplateHost(
      editorTemplate(`<DocxEditorReview>${ITEM_SLOT}</DocxEditorReview>`),
      () => ({ beside, label: 'one' })
    );
    const mounted = mountedCards(container);
    expect(mounted.length).toBeGreaterThan(1);

    reset();
    for (let i = 0; i < 3; i += 1) {
      beside.value += 1;
      await settle();
    }
    expect(container.querySelector('[data-testid="beside"]')?.textContent).toBe('3');
    typeIn(editor, 0);
    await settle();
    expect(templates.total()).toBe(0);
    expect(cards.total()).toBe(0);
  });

  test('a render of the component that owns the rail renders no card', async () => {
    // The rail is a child of the owner's own root and has a bound prop, so Vue visits it as
    // a compiled child: it gets the new slot functions without an update of its own, and
    // sees them on its next render.
    const ticks = ref(0);
    const calls = counter();
    const owner = (rail: string) =>
      defineComponent({
        components: TEMPLATE_COMPONENTS,
        setup: () => ({
          ticks,
          stack: true,
          label: 'one',
          called: (key: string) => (calls.add(key), ''),
        }),
        render: compileTemplate(`<span data-testid="ticks">{{ ticks }}</span>${rail}`),
      });
    for (const RailHost of [
      owner(`<DocxEditorReview :stack="stack">${ITEM_SLOT}</DocxEditorReview>`),
      owner(`<DocxEditorReview :stack="stack">${CARD_PART}</DocxEditorReview>`),
    ]) {
      ticks.value = 0;
      const { container, editor, cards, rail, reset } = await mountTemplateHost(
        editorTemplate('<RailHost />'),
        undefined,
        { components: { RailHost } }
      );
      expect(container.querySelectorAll('[data-testid="review-card"]').length).toBeGreaterThan(1);

      calls.reset();
      reset();
      ticks.value += 1;
      await settle();
      expect(container.querySelector('[data-testid="ticks"]')?.textContent).toBe('1');
      // A keystroke that changes no item renders the rail, and no card.
      typeIn(editor, 0);
      await settle();
      expect(rail.keys()).toContain('DocxEditorReview');
      expect(calls.total()).toBe(0);
      expect(cards.total()).toBe(0);
      unmountRails();
    }
  });

  test('reactive state that a template slot reads updates each mounted card once', async () => {
    const label = ref('one');
    const { container, templates, reset } = await mountTemplateHost(
      editorTemplate(`<DocxEditorReview>${ITEM_SLOT}</DocxEditorReview>`),
      () => ({ label })
    );
    const mounted = mountedCards(container);
    expect(mounted.length).toBeGreaterThan(1);
    expect(container.querySelectorAll('[data-label="one"]')).toHaveLength(mounted.length);

    reset();
    label.value = 'two';
    await settle();
    for (const key of mounted) expect(templates.of(key)).toBe(1);
    expect(container.querySelectorAll('[data-label="two"]')).toHaveLength(mounted.length);
    expect(container.querySelectorAll('[data-label="one"]')).toHaveLength(0);
  });

  test('a List part in a template keeps its cards, and follows the state its Card reads', async () => {
    const beside = ref(0);
    const label = ref('one');
    const { container, editor, cards, reset } = await mountTemplateHost(
      editorTemplate(`<DocxEditorReview>${CARD_PART}</DocxEditorReview>`),
      () => ({ beside, label })
    );
    const mounted = container.querySelectorAll('.host-card').length;
    expect(mounted).toBeGreaterThan(1);
    expect(container.querySelectorAll('[data-label="one"]')).toHaveLength(mounted);

    reset();
    beside.value += 1;
    await settle();
    typeIn(editor, 0);
    await settle();
    expect(container.querySelector('[data-testid="beside"]')?.textContent).toBe('1');
    expect(cards.total()).toBe(0);

    label.value = 'two';
    await settle();
    expect(cards.of('part')).toBe(mounted);
    expect(container.querySelectorAll('[data-label="two"]')).toHaveLength(mounted);
    expect(container.querySelectorAll('[data-label="one"]')).toHaveLength(0);
  });

  test('a slot under v-if appears, leaves, and runs once per render of its owner', async () => {
    // `v-if` on a slot template makes the compiler mark the slots dynamic (`_: 2`).
    const custom = ref(true);
    const beside = ref(0);
    const label = ref('one');
    const { container, templates, reset } = await mountTemplateHost(
      editorTemplate(
        '<DocxEditorReview><template v-if="custom" #item="{ item }">' +
          '<div :data-card-key="item.key" :data-label="label">{{ called(item.key) }}<ReviewCard /></div>' +
          '</template></DocxEditorReview>'
      ),
      () => ({ custom, beside, label })
    );
    const mounted = mountedCards(container);
    expect(mounted.length).toBeGreaterThan(1);
    const packaged = () => container.querySelectorAll('[data-testid="review-card"]').length;

    // State that the slot reads.
    reset();
    label.value = 'two';
    await settle();
    for (const key of mounted) expect(templates.of(key)).toBe(1);
    expect(container.querySelectorAll('[data-label="two"]')).toHaveLength(mounted.length);

    // A render of the owner for other state: Vue passes new functions and marks no slot
    // stable, so each mounted card runs its slot once. That is the cost of a dynamic slot.
    reset();
    beside.value += 1;
    await settle();
    for (const key of mounted) expect(templates.of(key)).toBe(1);

    // The slot leaves: the packaged card stands in. The slot returns: the host's card does.
    custom.value = false;
    await settle();
    expect(mountedCards(container)).toEqual([]);
    expect(packaged()).toBe(mounted.length);
    label.value = 'three';
    custom.value = true;
    await settle();
    expect(mountedCards(container)).toEqual(mounted);
    expect(container.querySelectorAll('[data-label="three"]')).toHaveLength(mounted.length);
  });

  test('a slot that reads a v-for variable shows each value of the variable', async () => {
    // The slot reads `tone`, which is no reactive state of its own: the compiler marks the
    // slots dynamic, and the new function is the only sign of the new value.
    const tones = ref(['plain']);
    const { container } = await mountTemplateHost(
      editorTemplate(
        '<template v-for="(tone, index) in tones" :key="index">' +
          '<DocxEditorReview><template #item="{ item }">' +
          '<div :data-card-key="item.key" :data-label="tone"><ReviewCard /></div>' +
          '</template></DocxEditorReview></template>'
      ),
      () => ({ tones })
    );
    const mounted = mountedCards(container);
    expect(mounted.length).toBeGreaterThan(1);
    expect(container.querySelectorAll('[data-label="plain"]')).toHaveLength(mounted.length);

    tones.value = ['bold'];
    await settle();
    expect(container.querySelectorAll('[data-label="bold"]')).toHaveLength(mounted.length);
    expect(container.querySelectorAll('[data-label="plain"]')).toHaveLength(0);
  });

  test('plain slot functions under a stable flag still compare by identity', async () => {
    // A JSX transform can write the stable flag on a slot that reads a local variable.
    let label = 'one';
    const epoch = ref(0);
    const Host = defineComponent({
      name: 'Host',
      setup() {
        return () => {
          void epoch.value;
          const shown = label;
          return h(DocxEditorReview, null, {
            item: ({ item }: { item: ReviewItemView }) =>
              h('div', { 'data-card-key': item.key, 'data-label': shown }, [
                h(DocxEditorReview.Card),
              ]),
            _: 1,
          });
        };
      },
    });
    const { container } = await mountRail(() => h(Host));
    const mounted = mountedCards(container);
    expect(mounted.length).toBeGreaterThan(1);

    label = 'two';
    epoch.value += 1;
    await settle();
    expect(container.querySelectorAll('[data-label="two"]')).toHaveLength(mounted.length);
    expect(container.querySelectorAll('[data-label="one"]')).toHaveLength(0);
  });

  test('a template replaced by hot module replacement shows on each mounted card', async () => {
    const hot = (
      globalThis as {
        __VUE_HMR_RUNTIME__?: {
          createRecord: (id: string, component: unknown) => boolean;
          rerender: (id: string, render: unknown) => void;
        };
      }
    ).__VUE_HMR_RUNTIME__;
    // Vue offers the runtime in its development build, which the tests run.
    expect(hot).toBeDefined();
    const railTemplate = (label: string) =>
      '<DocxEditorReview><template #item="{ item }">' +
      `<div :data-card-key="item.key" data-label="${label}"><ReviewCard /></div>` +
      '</template></DocxEditorReview>';
    const RailHost = defineComponent({
      name: 'HotRailHost',
      __hmrId: 'review-rail-template-host',
      components: TEMPLATE_COMPONENTS,
      render: compileTemplate(railTemplate('one')),
    });
    hot!.createRecord('review-rail-template-host', RailHost);
    const { container } = await mountTemplateHost(editorTemplate('<RailHost />'), undefined, {
      components: { RailHost },
    });
    const mounted = mountedCards(container);
    expect(mounted.length).toBeGreaterThan(1);
    expect(container.querySelectorAll('[data-label="one"]')).toHaveLength(mounted.length);

    hot!.rerender('review-rail-template-host', compileTemplate(railTemplate('two')));
    await settle();
    expect(container.querySelectorAll('[data-label="two"]')).toHaveLength(mounted.length);
    expect(container.querySelectorAll('[data-label="one"]')).toHaveLength(0);
  });
});
