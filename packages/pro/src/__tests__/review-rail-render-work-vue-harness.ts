/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The Vue mount of the review rail render tests: an editor with a rail, and a rail whose
// cards count their renders. The React twin is `review-rail-render-work-react-harness.tsx`.

import { h, type App, type ComponentPublicInstance, type VNode } from 'vue';
import type { DocxEditorInstance, EditorModule } from '@docx-editor.dev/core/editor';
import { flush, mountEditorTree } from '../../../vue/test/helpers/mount.ts';
import { reviewModule } from '../index.ts';
import { DocxEditorReview, type ReviewItemView } from '../vue/index.ts';
import {
  AUTHOR,
  counter,
  pagedTrackedDocument,
  type Counter,
} from './review-rail-render-work-harness.ts';

export async function settle(ms = 30): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
  await flush();
}

export async function waitFor(predicate: () => boolean, attempts = 80): Promise<void> {
  for (let i = 0; i < attempts && !predicate(); i++) await settle(25);
}

/**
 * Count each component that mounts or updates inside the rail: in `cards` by the card it
 * belongs to, and in `rail` when it belongs to no card.
 */
export function countRenders(app: App, cards: Counter, rail: Counter): void {
  const record = (instance: ComponentPublicInstance): void => {
    const node = instance.$el as Node | null;
    const element = node instanceof Element ? node : (node?.parentElement ?? null);
    if (!element?.closest('.docx-review')) return;
    const card = element.closest<HTMLElement>('[data-card-key]');
    if (card) cards.add(card.dataset.cardKey!);
    else rail.add(instance.$options.name ?? 'component');
  };
  app.mixin({
    mounted() {
      record(this as ComponentPublicInstance);
    },
    updated() {
      record(this as ComponentPublicInstance);
    },
  });
}

export interface MountRailOptions {
  /** Runs on the app before it mounts, for example to count renders. */
  readonly configure?: (app: App) => void;
  /** The element whose `data-testid` says the rail is ready. */
  readonly ready?: string;
  /** The document. The paged document with one tracked change on each page by default. */
  readonly source?: Uint8Array;
  /** The editor modules. The review module alone by default. */
  readonly modules?: readonly EditorModule[];
  /** Wraps the editor root, for example in a `LocaleProvider`. */
  readonly wrap?: (root: VNode) => VNode;
}

const mountedRails: (() => void)[] = [];

/** Unmount every rail the test mounted. Call it after each test. */
export function unmountRails(): void {
  for (const unmount of mountedRails.splice(0)) unmount();
}

export async function mountRail(review: () => VNode, options: MountRailOptions = {}) {
  const mounted = mountEditorTree(
    () => [],
    options.source ?? pagedTrackedDocument(),
    () => [review()],
    options.modules ?? [reviewModule()],
    // The author of the document's changes, so a reply adds no author and can be edited.
    { author: AUTHOR },
    options.wrap,
    options.configure
  );
  mountedRails.push(mounted.unmount);
  const { container } = mounted;
  const ready = options.ready ?? 'review-card';
  await waitFor(() => container.querySelector(`[data-testid="${ready}"]`) !== null);
  await settle(60);
  return { container, editor: mounted.editor() as DocxEditorInstance };
}

/**
 * A rail whose cards come from an item slot. `templates` counts the calls of the slot,
 * `cards` the renders of the components of each card, and `rail` the renders of the rail's
 * own components. `props` answers the rail's props on each render of the host.
 */
export async function mountCountingRail(
  options: Omit<MountRailOptions, 'configure'> & {
    readonly props?: () => Record<string, unknown>;
  } = {}
) {
  const templates = counter();
  const cards = counter();
  const rail = counter();
  const slots = {
    item: ({ item }: { item: ReviewItemView }) => {
      templates.add(item.key);
      return h('div', { 'data-card-key': item.key }, [h(DocxEditorReview.Card)]);
    },
  };
  const mounted = await mountRail(() => h(DocxEditorReview, options.props?.() ?? null, slots), {
    ...options,
    configure: (app) => countRenders(app, cards, rail),
  });
  const reset = () => {
    templates.reset();
    cards.reset();
    rail.reset();
  };
  return { ...mounted, templates, cards, rail, reset };
}
