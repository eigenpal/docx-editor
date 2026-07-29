// Production createEditor browser harness for Chromium accessibility-tree falsification (task 4.7).

import { createEditor } from '../../core/src/editor/create-editor.ts';
import type { Editor } from '@docx-editor.dev/core-contract/contracts/editor';
import type {
  AccessibilityObservation,
  SemanticSelection,
  SemanticTarget,
} from '@docx-editor.dev/core-contract/contracts/interaction';
import { PAINTED_PAGES_ASSISTIVE_MARKER } from '@docx-editor.dev/engine-binding';
import { createDeterministicLayoutShaping } from '@docx-editor.dev/engine-layout';
import { paintDisplayPages } from './paint-display.ts';
import {
  LOCALIZED_ACCESSIBLE_NAME,
  LOCALIZED_ATOM_LABELS,
  createEditableParagraphFixture,
  createEditableFixtureWithTexts,
  createMixedReadOnlyFixture,
} from './fixtures.ts';

export type HarnessScenario =
  | 'editable-named'
  | 'editable-unnamed'
  | 'read-only-mixed'
  | 'view-mode';

export interface HarnessMountOptions {
  readonly scenario: HarnessScenario;
}

export interface HarnessParagraphEntry {
  readonly blockId: string;
  readonly storyId: string;
  readonly text: string;
  readonly orderIndex: number;
}

export interface HarnessDriver {
  mount(options: HarnessMountOptions): void;
  destroy(): void;
  relayout(options?: { sync?: boolean }): void;
  setSelection(
    blockIndex: number,
    anchorOffset: number,
    headOffset?: number
  ): { ok: boolean; code?: string; reason?: string };
  focus(): { ok: boolean; code?: string; reason?: string };
  blur(): void;
  swapPagesContainer(): void;
  reloadEditableTexts(texts: readonly string[]): void;
  getObservation(): AccessibilityObservation;
  getParagraphEntries(): readonly HarnessParagraphEntry[];
  getRevision(): number;
  getParagraphText(blockIndex: number): string;
  paintedDomText(): string;
  countEditableOwners(): number;
  countLandmarkDocuments(): number;
  pagesAssistiveMarker(): string | null;
  pagesAriaHidden(): boolean;
}

function scrollHost(scroll: HTMLElement): void {
  scroll.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      width: 960,
      height: 720,
      top: 0,
      left: 0,
      right: 960,
      bottom: 720,
      toJSON: () => ({}),
    }) as DOMRect;
}

function createHarnessDriver(
  scrollEl: HTMLElement,
  bodyEl: HTMLElement,
  pagesEl: HTMLElement
): HarnessDriver {
  let editor: Editor | null = null;
  let pagesRef: HTMLElement = pagesEl;
  let sparePages: HTMLElement | null = null;

  const host = {
    getBodyHostEl: () => bodyEl,
    getHfHostEl: () => null,
    getPagesContainer: () => pagesRef,
    getScrollContainer: () => scrollEl,
    getInteractionHostMetrics: () => ({
      clientOrigin: { x: 0, y: 0 },
      scrollOffset: { x: 0, y: 0 },
      zoom: 1,
    }),
    scheduleFrame: (cb: () => void) => {
      cb();
      return () => {};
    },
    onDisplay: (
      pages: Parameters<NonNullable<Parameters<typeof createEditor>[0]['host']['onDisplay']>>[0]
    ) => {
      paintDisplayPages(pagesRef, pages);
    },
  };

  function requireEditor(): Editor {
    if (!editor) throw new Error('editor not mounted');
    return editor;
  }

  function paragraphEntries(): readonly HarnessParagraphEntry[] {
    const obs = requireEditor().getAccessibilityObservation();
    return obs.entries
      .filter((entry) => entry.role === 'editableParagraph')
      .map((entry) => ({
        blockId: entry.identity.blockId,
        storyId: entry.identity.storyId,
        text: entry.text,
        orderIndex: entry.orderIndex,
      }));
  }

  function textTarget(
    blockIndex: number,
    graphemeOffset: number,
    affinity: 'upstream' | 'downstream'
  ): SemanticTarget {
    const entry = paragraphEntries()[blockIndex];
    if (!entry) throw new Error(`paragraph index ${blockIndex} is out of range`);
    return {
      kind: 'text',
      scope: { kind: 'body' },
      identity: { storyId: entry.storyId, blockId: entry.blockId },
      graphemeOffset,
      affinity,
    };
  }

  function semanticSelection(
    blockIndex: number,
    anchorOffset: number,
    headOffset: number
  ): SemanticSelection {
    const frameId = requireEditor().getInteractionFrame().id;
    const anchor = textTarget(blockIndex, anchorOffset, 'upstream');
    const head = textTarget(
      blockIndex,
      headOffset,
      headOffset >= anchorOffset ? 'downstream' : 'upstream'
    );
    return { frameId, scope: { kind: 'body' }, anchor, head };
  }

  function mountEditor(options: HarnessMountOptions): void {
    editor?.destroy();
    bodyEl.replaceChildren();
    pagesRef.replaceChildren();
    sparePages?.replaceChildren();

    const common = {
      host,
      accessibilityAtomLabels: LOCALIZED_ATOM_LABELS,
      // This harness verifies accessibility ownership, not font fidelity. It still
      // supplies an explicit immutable shaping snapshot required by production
      // createEditor, while the paired fidelity gate owns real HarfBuzz/font bytes.
      layoutShaping: createDeterministicLayoutShaping(),
    };

    switch (options.scenario) {
      case 'editable-named':
        editor = createEditor({
          ...common,
          document: createEditableParagraphFixture(),
          accessibleName: LOCALIZED_ACCESSIBLE_NAME,
        });
        break;
      case 'editable-unnamed':
        editor = createEditor({
          ...common,
          document: createEditableParagraphFixture(),
        });
        break;
      case 'read-only-mixed':
        editor = createEditor({
          ...common,
          document: createMixedReadOnlyFixture(),
          accessibleName: LOCALIZED_ACCESSIBLE_NAME,
        });
        break;
      case 'view-mode':
        editor = createEditor({
          ...common,
          document: createEditableParagraphFixture(),
          accessibleName: LOCALIZED_ACCESSIBLE_NAME,
          mode: 'view',
        });
        break;
    }
    editor.relayout();
  }

  return {
    mount: mountEditor,
    destroy() {
      editor?.destroy();
      editor = null;
      pagesRef.replaceChildren();
      bodyEl.replaceChildren();
      sparePages?.replaceChildren();
    },
    relayout(options) {
      requireEditor().relayout(options);
    },
    setSelection(blockIndex, anchorOffset, headOffset = anchorOffset) {
      const selection = semanticSelection(blockIndex, anchorOffset, headOffset);
      const result = requireEditor().exec({ type: 'setSelection', range: selection });
      return {
        ok: result.ok,
        code: result.ok ? undefined : result.code,
        reason: result.ok ? undefined : result.reason,
      };
    },
    focus() {
      const outcome = requireEditor().focus();
      return {
        ok: outcome.ok,
        code: outcome.ok ? undefined : outcome.code,
        reason: outcome.ok ? undefined : outcome.reason,
      };
    },
    blur() {
      const mount = bodyEl.querySelector('[data-docx-input-host-mount]');
      const editable =
        mount instanceof HTMLElement && mount.isContentEditable
          ? mount
          : bodyEl.querySelector('[data-docx-input-host-mount] [contenteditable="true"]');
      if (editable instanceof HTMLElement) editable.blur();
    },
    swapPagesContainer() {
      if (!sparePages) {
        sparePages = document.createElement('div');
        sparePages.setAttribute('data-testid', 'harness-pages-spare');
        sparePages.setAttribute('data-docx-painted-pages', 'true');
        scrollEl.insertBefore(sparePages, bodyEl);
      }
      pagesRef.replaceChildren();
      pagesRef = sparePages;
      sparePages = pagesEl;
      requireEditor().relayout();
    },
    reloadEditableTexts(texts: readonly string[]) {
      requireEditor().load(createEditableFixtureWithTexts(texts));
    },
    getObservation() {
      return requireEditor().getAccessibilityObservation();
    },
    getParagraphEntries() {
      return paragraphEntries();
    },
    getRevision() {
      return requireEditor().getDocumentHandle().revision;
    },
    getParagraphText(blockIndex: number) {
      const entry = paragraphEntries()[blockIndex];
      if (!entry) throw new Error(`paragraph index ${blockIndex} is out of range`);
      return entry.text;
    },
    paintedDomText() {
      return pagesRef.textContent ?? '';
    },
    countEditableOwners() {
      return bodyEl.querySelectorAll(
        '[data-docx-input-host-mount][contenteditable="true"], [data-docx-input-host-mount] [contenteditable="true"]'
      ).length;
    },
    countLandmarkDocuments() {
      return (
        bodyEl.querySelectorAll('[role="document"]').length +
        pagesRef.querySelectorAll('[role="document"]').length
      );
    },
    pagesAssistiveMarker() {
      return pagesRef.getAttribute(PAINTED_PAGES_ASSISTIVE_MARKER);
    },
    pagesAriaHidden() {
      return pagesRef.getAttribute('aria-hidden') === 'true';
    },
  };
}

const scrollEl = document.querySelector<HTMLElement>('#harness-scroll');
const bodyEl = document.querySelector<HTMLElement>('#harness-body');
const pagesEl = document.querySelector<HTMLElement>('#harness-pages');

if (!scrollEl || !bodyEl || !pagesEl) {
  throw new Error('harness host elements missing');
}

scrollHost(scrollEl);
const driver = createHarnessDriver(scrollEl, bodyEl, pagesEl);

declare global {
  interface Window {
    __a11yHarness?: HarnessDriver;
  }
}

window.__a11yHarness = driver;
driver.mount({ scenario: 'editable-named' });
