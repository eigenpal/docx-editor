/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Review-card height reporting: the shared sizer, and the React rail that renders a new
// slot ref every commit without feeding a render loop.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, test } from 'bun:test';
import { StrictMode, startTransition } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { zipSync, strToU8 } from 'fflate';
import { DocxEditorRoot, DocxEditorViewport, DocxEditorContent } from '@docx-editor.dev/react';
import {
  DocxEditorReview,
  useReview,
  useReviewCardHeights,
  useStackedReviewPositions,
} from '../react/index.ts';
import { reviewModule } from '../index.ts';
import { createReviewSlotSizer } from '../review/slot-sizing.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const COMMENTS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';

function commented(ids: readonly number[]): Uint8Array {
  const paragraphs = ids
    .map(
      (id) =>
        `<w:p><w:commentRangeStart w:id="${id}"/><w:r><w:t>text ${id}</w:t></w:r>` +
        `<w:commentRangeEnd w:id="${id}"/><w:r><w:commentReference w:id="${id}"/></w:r></w:p>`
    )
    .join('');
  const comments = ids
    .map(
      (id) =>
        `<w:comment w:id="${id}" w:author="Ada"><w:p><w:r><w:t>Note ${id}.</w:t></w:r></w:p></w:comment>`
    )
    .join('');
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId2" Type="${COMMENTS_REL}" Target="comments.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${paragraphs}</w:body></w:document>`
    ),
    'word/comments.xml': strToU8(`<w:comments xmlns:w="${W}">${comments}</w:comments>`),
  });
}

/** A ResizeObserver the test drives by hand. */
class ManualResizeObserver {
  static readonly all: ManualResizeObserver[] = [];
  readonly targets = new Set<Element>();
  readonly observeCalls: Element[] = [];
  constructor(readonly callback: ResizeObserverCallback) {
    ManualResizeObserver.all.push(this);
  }
  observe(target: Element) {
    this.targets.add(target);
    this.observeCalls.push(target);
  }
  unobserve(target: Element) {
    this.targets.delete(target);
  }
  disconnect() {
    this.targets.clear();
  }
  /** Deliver a notification for every observed target. */
  fire() {
    const entries = [...this.targets].map((target) => ({ target }) as ResizeObserverEntry);
    if (entries.length > 0) this.callback(entries, this as unknown as ResizeObserver);
  }
}

/** Give elements a fixed `offsetHeight`, and count the reads. */
function stubHeights(heightOf: (element: HTMLElement) => number) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
  const reads = { count: 0 };
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      reads.count += 1;
      return heightOf(this);
    },
  });
  return {
    reads,
    restore() {
      if (descriptor) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', descriptor);
      else delete (HTMLElement.prototype as { offsetHeight?: number }).offsetHeight;
    },
  };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const microtask = () => Promise.resolve();

afterEach(() => {
  cleanup();
  ManualResizeObserver.all.length = 0;
});

describe('createReviewSlotSizer', () => {
  const original = globalThis.ResizeObserver;
  const withObserver = (run: () => Promise<void> | void) => async () => {
    globalThis.ResizeObserver = ManualResizeObserver as unknown as typeof ResizeObserver;
    try {
      await run();
    } finally {
      globalThis.ResizeObserver = original;
    }
  };

  test(
    'reports a height once, and again only when it changes',
    withObserver(() => {
      let height = 118;
      const heights = stubHeights(() => height);
      try {
        const reports: [string, number][] = [];
        const sizer = createReviewSlotSizer((key, value) => reports.push([key, value]));
        const node = document.createElement('div');
        sizer.observe(node, 'a');
        const observer = ManualResizeObserver.all[0]!;
        observer.fire();
        observer.fire();
        expect(reports).toEqual([['a', 118]]);
        height = 140;
        observer.fire();
        expect(reports).toEqual([
          ['a', 118],
          ['a', 140],
        ]);
      } finally {
        heights.restore();
      }
    })
  );

  test(
    'keeps the observation when the same node detaches and attaches in one commit',
    withObserver(async () => {
      const heights = stubHeights(() => 118);
      try {
        const reports: [string, number][] = [];
        const sizer = createReviewSlotSizer((key, value) => reports.push([key, value]));
        const node = document.createElement('div');
        sizer.observe(node, 'a');
        const observer = ManualResizeObserver.all[0]!;
        const readsBefore = heights.reads.count;
        // What React does with a ref callback that is a new function each render.
        sizer.observe(null, 'a');
        sizer.observe(node, 'a');
        await microtask();
        expect(heights.reads.count).toBe(readsBefore);
        expect(observer.observeCalls).toEqual([node]);
        expect(observer.targets.has(node)).toBe(true);
        expect(reports).toEqual([['a', 118]]);
      } finally {
        heights.restore();
      }
    })
  );

  test(
    'stops observing a detached slot after the commit and keeps its last height',
    withObserver(async () => {
      let height = 118;
      const heights = stubHeights(() => height);
      try {
        const reports: [string, number][] = [];
        const sizer = createReviewSlotSizer((key, value) => reports.push([key, value]));
        const first = document.createElement('div');
        sizer.observe(first, 'a');
        const observer = ManualResizeObserver.all[0]!;
        sizer.observe(null, 'a');
        await microtask();
        expect(observer.targets.has(first)).toBe(false);
        // Virtualization brings the card back as a new node of the same height.
        sizer.observe(document.createElement('div'), 'a');
        expect(reports).toEqual([['a', 118]]);
        height = 0;
        sizer.observe(document.createElement('div'), 'a');
        expect(reports).toEqual([['a', 118]]);
      } finally {
        heights.restore();
      }
    })
  );

  test(
    'gives each key one ref callback until its slot is released',
    withObserver(async () => {
      const heights = stubHeights(() => 118);
      try {
        const sizer = createReviewSlotSizer(() => {});
        const ref = sizer.slotRef('a');
        expect(sizer.slotRef('a')).toBe(ref);
        expect(sizer.slotRef('b')).not.toBe(ref);
        const node = document.createElement('div');
        ref(node);
        expect(ManualResizeObserver.all[0]!.targets.has(node)).toBe(true);
        ref(null);
        await microtask();
        expect(ManualResizeObserver.all[0]!.targets.has(node)).toBe(false);
        // Released keys drop their callback, so the cache holds only mounted cards.
        expect(sizer.slotRef('a')).not.toBe(ref);
      } finally {
        heights.restore();
      }
    })
  );

  test(
    'forgets keys that leave the item list once their slot is gone',
    withObserver(async () => {
      const heights = stubHeights(() => 118);
      try {
        const reports: [string, number][] = [];
        const sizer = createReviewSlotSizer((key, value) => reports.push([key, value]));
        const mounted = document.createElement('div');
        const unmounted = document.createElement('div');
        const removed = document.createElement('div');
        sizer.observe(mounted, 'mounted');
        sizer.observe(unmounted, 'unmounted');
        sizer.observe(removed, 'removed');
        const removedRef = sizer.slotRef('removed');
        sizer.observe(null, 'unmounted');
        sizer.observe(null, 'removed');
        // Before the detach microtask: the commit that removed the slot is over.
        expect(sizer.retain(new Set(['unmounted']))).toEqual(['removed']);
        await microtask();
        // An attached slot stays even when its key is not listed, as a draft box is not.
        expect(sizer.retain(new Set(['unmounted']))).toEqual([]);
        expect(sizer.slotRef('removed')).not.toBe(removedRef);
        // A forgotten key reports again when it comes back.
        sizer.observe(document.createElement('div'), 'removed');
        expect(reports.filter(([key]) => key === 'removed')).toHaveLength(2);
        // A listed key keeps its height while its card is unmounted.
        sizer.observe(document.createElement('div'), 'unmounted');
        expect(reports.filter(([key]) => key === 'unmounted')).toHaveLength(1);
        // A forgotten key whose node attaches again before the detach settles reports again.
        const draft = document.createElement('div');
        sizer.observe(draft, 'draft');
        sizer.observe(null, 'draft');
        expect(sizer.retain(new Set(['unmounted', 'removed']))).toEqual(['draft']);
        sizer.observe(draft, 'draft');
        expect(reports.filter(([key]) => key === 'draft')).toHaveLength(2);
      } finally {
        heights.restore();
      }
    })
  );

  test(
    'moves a node to its new key',
    withObserver(async () => {
      const heights = stubHeights(() => 118);
      try {
        const reports: [string, number][] = [];
        const sizer = createReviewSlotSizer((key, value) => reports.push([key, value]));
        const node = document.createElement('div');
        sizer.observe(node, 'a');
        sizer.observe(node, 'b');
        const observer = ManualResizeObserver.all[0]!;
        expect(observer.targets.has(node)).toBe(true);
        // The old key's late detach must not unobserve the node the new key owns.
        sizer.observe(null, 'a');
        await microtask();
        expect(observer.targets.has(node)).toBe(true);
        expect(reports).toEqual([
          ['a', 118],
          ['b', 118],
        ]);
      } finally {
        heights.restore();
      }
    })
  );

  test(
    'observes a slot again after the StrictMode effect and ref replay',
    withObserver(async () => {
      const heights = stubHeights(() => 118);
      try {
        const sizer = createReviewSlotSizer(() => {});
        const node = document.createElement('div');
        sizer.observe(node, 'a');
        // React 19 StrictMode: refs detach, effects clean up, refs attach, effects run.
        sizer.observe(null, 'a');
        sizer.disconnect();
        sizer.observe(node, 'a');
        sizer.reconnect();
        await microtask();
        const live = ManualResizeObserver.all.filter((observer) => observer.targets.has(node));
        expect(live.length).toBe(1);
      } finally {
        heights.restore();
      }
    })
  );

  test(
    'observes the attached slots again after disconnect and reconnect',
    withObserver(() => {
      let height = 118;
      const heights = stubHeights(() => height);
      try {
        const reports: [string, number][] = [];
        const sizer = createReviewSlotSizer((key, value) => reports.push([key, value]));
        const node = document.createElement('div');
        sizer.observe(node, 'a');
        sizer.disconnect();
        height = 130;
        sizer.reconnect();
        const observer = ManualResizeObserver.all.at(-1)!;
        expect(observer.targets.has(node)).toBe(true);
        expect(reports).toEqual([
          ['a', 118],
          ['a', 130],
        ]);
      } finally {
        heights.restore();
      }
    })
  );
});

describe('DocxEditorReview slot sizing', () => {
  test('activating a card while a resize report is pending does not loop', async () => {
    const original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = ManualResizeObserver as unknown as typeof ResizeObserver;
    let cardHeight = 118;
    const heights = stubHeights((element) =>
      element.classList.contains('docx-review__slot') ? cardHeight : 0
    );
    const errors: unknown[] = [];
    const onError = (event: Event) => {
      errors.push((event as ErrorEvent).error ?? event);
      event.preventDefault();
    };
    const consoleError = console.error;
    console.error = (...args: unknown[]) => {
      if (args.some((arg) => String(arg).includes('Maximum update depth'))) errors.push(args[0]);
    };
    window.addEventListener('error', onError);
    try {
      const view = render(
        <DocxEditorRoot document={commented([1, 2, 3])} modules={[reviewModule()]}>
          <DocxEditorViewport>
            <DocxEditorContent />
            <DocxEditorReview />
          </DocxEditorViewport>
        </DocxEditorRoot>
      );
      await act(async () => {
        await tick();
      });
      const cards = view.getAllByTestId('review-card');
      expect(cards.length).toBe(3);

      // A resize report is still pending at a lower priority when a click re-renders the
      // rail at a higher one. React 18 leaves a default-priority report pending; React 19
      // batches that with the click, so a transition stands in for the lower priority.
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
      cardHeight = 140;
      startTransition(() => {
        for (const observer of ManualResizeObserver.all) observer.fire();
      });
      const readsBefore = heights.reads.count;
      fireEvent.click(cards[1]!);
      for (let i = 0; i < 5; i += 1) await tick();

      expect(errors).toEqual([]);
      // Re-attached slots read no layout: the click's commits measure nothing again.
      expect(heights.reads.count - readsBefore).toBe(0);
      expect(view.getAllByTestId('review-card').length).toBe(3);
      // The pending report landed too: the cards stack by their new height.
      const tops = [...view.container.querySelectorAll<HTMLElement>('.docx-review__slot')]
        .map((slot) => Number.parseFloat(slot.style.top))
        .sort((a, b) => a - b);
      expect(tops.length).toBe(3);
      expect(tops[1]! - tops[0]!).toBeGreaterThanOrEqual(140);
      expect(tops[2]! - tops[1]!).toBeGreaterThanOrEqual(140);
    } finally {
      (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
      window.removeEventListener('error', onError);
      console.error = consoleError;
      heights.restore();
      globalThis.ResizeObserver = original;
    }
  });

  test('useReviewCardHeights measures and stacks host cards', async () => {
    const original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = ManualResizeObserver as unknown as typeof ResizeObserver;
    let cardHeight = 100;
    const heights = stubHeights((element) => (element.dataset.hostCard ? cardHeight : 0));
    const refs: ((node: HTMLElement | null) => void)[][] = [];
    let latest: {
      review: ReturnType<typeof useReview>;
      heights: ReadonlyMap<string, number>;
    } | null = null;
    function HostCards() {
      const review = useReview();
      const { items } = review;
      const { heights: measured, cardRef } = useReviewCardHeights(items);
      latest = { review, heights: measured };
      const positions = useStackedReviewPositions(items, measured, { defaultHeight: 10 });
      refs.push(items.map((item) => cardRef(item.key)));
      return (
        <>
          {items.map((item) => (
            <div
              key={item.key}
              data-host-card={item.key}
              ref={cardRef(item.key)}
              style={{ position: 'absolute', top: positions.get(item.key) ?? 0 }}
            />
          ))}
        </>
      );
    }
    try {
      const view = render(
        <DocxEditorRoot document={commented([1, 2])} modules={[reviewModule()]}>
          <DocxEditorViewport>
            <DocxEditorContent />
            <DocxEditorReview preset={false}>
              <HostCards />
            </DocxEditorReview>
          </DocxEditorViewport>
        </DocxEditorRoot>
      );
      await act(async () => {
        await tick();
      });
      const tops = () =>
        [...view.container.querySelectorAll<HTMLElement>('[data-host-card]')]
          .map((card) => Number.parseFloat(card.style.top))
          .sort((a, b) => a - b);
      expect(tops().length).toBe(2);
      expect(tops()[1]! - tops()[0]!).toBeGreaterThanOrEqual(100);
      await act(async () => {
        cardHeight = 160;
        for (const observer of ManualResizeObserver.all) observer.fire();
      });
      expect(tops()[1]! - tops()[0]!).toBeGreaterThanOrEqual(160);
      // The same ref function for a key on every render.
      const first = refs.find((row) => row.length === 2)!;
      expect(refs.at(-1)).toEqual(first);
      expect(refs.at(-1)![0]).toBe(first[0]);
      // Deleting an item drops its height; the other card keeps its own.
      const [gone, kept] = latest!.review.items;
      await act(async () => {
        latest!.review.remove(gone!);
        await tick();
      });
      expect(latest!.review.items.map((item) => item.key)).toEqual([kept!.key]);
      expect([...latest!.heights.keys()]).toEqual([kept!.key]);
    } finally {
      heights.restore();
      globalThis.ResizeObserver = original;
    }
  });

  test('keeps following card heights after a StrictMode mount', async () => {
    const original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = ManualResizeObserver as unknown as typeof ResizeObserver;
    let cardHeight = 100;
    const heights = stubHeights((element) =>
      element.classList.contains('docx-review__slot') ? cardHeight : 0
    );
    try {
      const view = render(
        <StrictMode>
          <DocxEditorRoot document={commented([1, 2])} modules={[reviewModule()]}>
            <DocxEditorViewport>
              <DocxEditorContent />
              <DocxEditorReview />
            </DocxEditorViewport>
          </DocxEditorRoot>
        </StrictMode>
      );
      await act(async () => {
        await tick();
      });
      const tops = () =>
        [...view.container.querySelectorAll<HTMLElement>('.docx-review__slot')]
          .map((slot) => Number.parseFloat(slot.style.top))
          .sort((a, b) => a - b);
      expect(tops().length).toBe(2);
      // StrictMode cleaned up the rail's effects once; the card must still be observed.
      await act(async () => {
        cardHeight = 180;
        for (const observer of ManualResizeObserver.all) observer.fire();
      });
      expect(tops()[1]! - tops()[0]!).toBeGreaterThanOrEqual(180);
    } finally {
      heights.restore();
      globalThis.ResizeObserver = original;
    }
  });
});
