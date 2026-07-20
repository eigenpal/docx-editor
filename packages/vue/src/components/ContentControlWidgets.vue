<!--
  Interactive UI for typed content controls (checkbox / dropdown / date) — the
  Vue mirror of the React ContentControlWidgets. The painter draws a
  `.layout-sdt-widget` trigger on each typed control; this delegates clicks on
  those triggers: a checkbox toggles immediately, a dropdown opens a menu of its
  list items, a date opens a date picker. Selections run through the shared
  `setContentControlValueTr` (normal undoable edits that update content + state).
-->
<script setup lang="ts">
import { ref, watch, nextTick, onBeforeUnmount } from 'vue';
import type { EditorView } from 'prosemirror-view';
import {
  findContentControlsInPM,
  setContentControlValueTr,
  setContentControlValueAtPosTr,
  addRepeatingSectionItemTr,
  removeRepeatingSectionItemTr,
} from '@docx-editor.dev/core/prosemirror';
import {
  syncTocRefreshButtons,
  createTocRefreshSyncCache,
  cleanupTocRefreshButtons,
  applyTocRefreshProxyFocus,
  getTocRefreshDescriptors,
} from '@docx-editor.dev/core/painter-model';
import type {
  PaintedPagesReadyEvent,
  TocRefreshDescriptor,
  TocRefreshSyncCache,
} from '@docx-editor.dev/core/painter-model';
import type { ContentControlValue } from '@docx-editor.dev/core/agent';
import { bindContentControlWidgetListeners } from './contentControlWidgetListeners';

const WIDGET_SELECTOR = '.layout-sdt-widget, .layout-inline-sdt-widget';
const TOC_REFRESH_SELECTOR = '.layout-toc-refresh';
const PAINTED_PAGES_SELECTOR = '.paged-editor__pages';

/** Parse the PM position out of a `sdt@<pos>` group id. */
function posFromGroupId(id: string | undefined): number | null {
  const m = /^sdt@(\d+)$/.exec(id ?? '');
  return m ? Number(m[1]) : null;
}

function posFromDataset(value: string | undefined): number | null {
  if (value == null || value === '') return null;
  const pos = Number(value);
  return Number.isFinite(pos) ? pos : null;
}

function paintedPagesRoot(container: HTMLElement): HTMLElement {
  return container.querySelector<HTMLElement>(PAINTED_PAGES_SELECTOR) ?? container;
}

type ControlTarget = {
  tag?: string;
  pos?: number;
};

function targetFromTrigger(trigger: HTMLElement): ControlTarget | null {
  const pos = posFromGroupId(trigger.dataset.sdtGroupId) ?? posFromDataset(trigger.dataset.sdtPos);
  const tag = trigger.dataset.sdtTag;
  if (pos != null) return tag ? { pos, tag } : { pos };
  return tag ? { tag } : null;
}

const props = defineProps<{
  container: HTMLElement | null;
  view: EditorView | null;
  /** Regenerate one stale TOC at the given PM position. */
  onUpdateTableOfContents: (position: number) => void;
  tocUpdateLabel: string;
}>();

type Popup =
  | {
      kind: 'dropdown';
      target: ControlTarget;
      items: { displayText: string; value: string }[];
      current: string;
      x: number;
      y: number;
    }
  | { kind: 'date'; target: ControlTarget; current: string; x: number; y: number };

const popup = ref<Popup | null>(null);
const popupEl = ref<HTMLElement | null>(null);
const tocDescriptors = ref<TocRefreshDescriptor[]>([]);
const tocRefreshCache: TocRefreshSyncCache = createTocRefreshSyncCache();
const focusedTocKey = ref<string | null>(null);

function syncTocBlockState(): TocRefreshDescriptor[] {
  const view = props.view;
  if (!view) {
    tocDescriptors.value = [];
    return [];
  }
  const descriptors = getTocRefreshDescriptors(view.state.doc);
  tocDescriptors.value = descriptors;
  return descriptors;
}

function apply(target: ControlTarget, value: ContentControlValue): void {
  const view = props.view;
  if (view) {
    try {
      const tr =
        target.pos != null
          ? setContentControlValueAtPosTr(view.state, target.pos, value)
          : target.tag
            ? setContentControlValueTr(view.state, { tag: target.tag }, value)
            : null;
      if (!tr) return;
      view.dispatch(tr);
      view.focus(); // return focus so keyboard (undo, typing) works after the edit
    } catch {
      // Locked / invalid — ignore in the UI layer.
    }
  }
  popup.value = null;
}

function repeat(btn: HTMLElement): void {
  const view = props.view;
  const pos = posFromGroupId(btn.dataset.sdtGroupId);
  if (!view || pos == null) return;
  try {
    const tr =
      btn.dataset.sdtRepeat === 'add'
        ? addRepeatingSectionItemTr(view.state, pos)
        : removeRepeatingSectionItemTr(view.state, pos);
    view.dispatch(tr);
    view.focus();
  } catch {
    // Last-item removal / invalid — ignore in the UI layer.
  }
}

function refreshToc(button: HTMLElement): void {
  const pos = posFromDataset(button.dataset.tocPosition);
  if (pos != null) props.onUpdateTableOfContents(pos);
}

function onMouseDown(e: MouseEvent): void {
  const t = e.target as HTMLElement;
  if (t?.closest?.(TOC_REFRESH_SELECTOR)) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  if (t?.closest?.(WIDGET_SELECTOR) || t?.closest?.('.layout-sdt-repeat-btn')) {
    e.preventDefault();
  }
}

function activate(trigger: HTMLElement): void {
  const view = props.view;
  const kind = trigger.dataset.sdtWidget;
  const target = targetFromTrigger(trigger);
  if (!view || !kind || !target) return;
  const control =
    target.pos != null
      ? findContentControlsInPM(view.state.doc).find((c) => c.pos === target.pos)
      : target.tag
        ? findContentControlsInPM(view.state.doc, { tag: target.tag })[0]
        : undefined;
  const rect = trigger.getBoundingClientRect();
  if (kind === 'checkbox') {
    apply(target, { kind: 'checkbox', checked: !control?.checked });
  } else if (kind === 'dropdown') {
    popup.value = {
      kind: 'dropdown',
      target,
      items: control?.listItems ?? [],
      current: control?.text ?? '',
      x: rect.left,
      y: rect.bottom + 2,
    };
  } else if (kind === 'date') {
    popup.value = {
      kind: 'date',
      target,
      current: control?.dateValue ?? '',
      x: rect.left,
      y: rect.bottom + 2,
    };
  }
}

function onClick(e: MouseEvent): void {
  const refreshBtn = (e.target as HTMLElement)?.closest?.(TOC_REFRESH_SELECTOR) as HTMLElement | null;
  if (refreshBtn) {
    e.preventDefault();
    e.stopPropagation();
    refreshToc(refreshBtn);
    return;
  }
  const repeatBtn = (e.target as HTMLElement)?.closest?.('.layout-sdt-repeat-btn') as HTMLElement | null;
  if (repeatBtn) {
    e.preventDefault();
    e.stopPropagation();
    repeat(repeatBtn);
    return;
  }
  const trigger = (e.target as HTMLElement)?.closest?.(WIDGET_SELECTOR) as HTMLElement | null;
  if (!trigger) return;
  e.preventDefault();
  e.stopPropagation();
  activate(trigger);
}

function onTriggerKeyDown(e: KeyboardEvent): void {
  const trigger = (e.target as HTMLElement)?.closest?.(WIDGET_SELECTOR) as HTMLElement | null;
  if (!trigger || (e.key !== 'Enter' && e.key !== ' ')) return;
  e.preventDefault();
  activate(trigger);
}

function syncTocRefreshForGeneration(paintGeneration?: string | number | null): void {
  const container = props.container;
  const view = props.view;
  if (!container || !view) return;
  const pages = paintedPagesRoot(container);
  const descriptors = syncTocBlockState();
  if (
    focusedTocKey.value != null &&
    !descriptors.some((descriptor) => descriptor.key === focusedTocKey.value)
  ) {
    focusedTocKey.value = null;
  }
  syncTocRefreshButtons(
    pages,
    {
      doc: view.state.doc,
      label: props.tocUpdateLabel,
      paintGeneration: paintGeneration ?? pages.dataset.paintGeneration ?? null,
      focusedTocKey: focusedTocKey.value,
    },
    tocRefreshCache
  );
}

function syncTocRefresh(event: Event): void {
  syncTocRefreshForGeneration((event as PaintedPagesReadyEvent).detail.paintGeneration);
}

function syncTocRefreshInitially(): void {
  const container = props.container;
  if (!container || !props.view) return;
  syncTocRefreshForGeneration(
    container.dataset.paintGeneration ? Number(container.dataset.paintGeneration) : undefined
  );
}

function cleanupTocRefreshUi(container: HTMLElement): void {
  const pages = paintedPagesRoot(container);
  cleanupTocRefreshButtons(pages);
  applyTocRefreshProxyFocus(pages, null);
  focusedTocKey.value = null;
  tocDescriptors.value = [];
}

function onProxyFocus(descriptor: TocRefreshDescriptor): void {
  focusedTocKey.value = descriptor.key;
  const container = props.container;
  if (!container) return;
  applyTocRefreshProxyFocus(paintedPagesRoot(container), descriptor.position);
}

function onProxyBlur(): void {
  focusedTocKey.value = null;
  const container = props.container;
  if (!container) return;
  applyTocRefreshProxyFocus(paintedPagesRoot(container), null);
}

function onDocMouseDown(e: MouseEvent): void {
  if (popup.value && !popupEl.value?.contains(e.target as Node)) popup.value = null;
}
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') popup.value = null;
}

// (Re)bind delegated listeners when the container element changes.
let bound: HTMLElement | null = null;
let unbindBound: (() => void) | null = null;
watch(
  () => props.container,
  (el, prev) => {
    if (prev) cleanupTocRefreshUi(prev);
    unbindBound?.();
    unbindBound = null;
    bound = el ?? null;
    if (bound) {
      unbindBound = bindContentControlWidgetListeners(bound, {
        onMouseDown,
        onClick,
        onKeyDown: onTriggerKeyDown,
        onPagesReady: syncTocRefresh,
      });
      syncTocRefreshInitially();
    }
  },
  { immediate: true }
);

watch(
  () => props.tocUpdateLabel,
  () => {
    const container = props.container;
    if (!container || !tocRefreshCache.doc || tocRefreshCache.paintRoot == null) return;
    syncTocRefreshButtons(
      tocRefreshCache.paintRoot,
      {
        doc: tocRefreshCache.doc,
        label: props.tocUpdateLabel,
        paintGeneration: tocRefreshCache.paintGeneration,
        focusedTocKey: focusedTocKey.value,
      },
      tocRefreshCache
    );
  }
);

watch(popup, (p) => {
  if (p) {
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKey);
    if (p.kind === 'dropdown') {
      // Move focus into the menu (selected option, else first) for keyboard use.
      void nextTick(() => {
        const opts = popupEl.value?.querySelectorAll<HTMLElement>('.layout-sdt-widget-option');
        if (!opts?.length) return;
        ([...opts].find((o) => o.getAttribute('aria-selected') === 'true') ?? opts[0]).focus();
      });
    }
  } else {
    document.removeEventListener('mousedown', onDocMouseDown);
    document.removeEventListener('keydown', onKey);
  }
});

function onPopupKeyDown(e: KeyboardEvent): void {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const opts = [...(popupEl.value?.querySelectorAll<HTMLElement>('.layout-sdt-widget-option') ?? [])];
  if (!opts.length) return;
  e.preventDefault();
  const i = opts.indexOf(document.activeElement as HTMLElement);
  const next = e.key === 'ArrowDown' ? (i + 1) % opts.length : (i - 1 + opts.length) % opts.length;
  opts[next].focus();
}

onBeforeUnmount(() => {
  if (bound) {
    cleanupTocRefreshUi(bound);
  }
  unbindBound?.();
  unbindBound = null;
  bound = null;
  document.removeEventListener('mousedown', onDocMouseDown);
  document.removeEventListener('keydown', onKey);
});

function onDateInput(e: Event): void {
  const value = (e.target as HTMLInputElement).value;
  if (value && popup.value) apply(popup.value.target, { kind: 'date', date: value });
}
</script>

<template>
  <div v-if="tocDescriptors.length > 0" class="layout-toc-refresh-proxies">
    <button
      v-for="descriptor in tocDescriptors"
      :key="descriptor.key"
      type="button"
      class="layout-toc-refresh-proxy"
      data-toc-refresh-proxy=""
      :data-toc-key="descriptor.key"
      :data-toc-position="String(descriptor.position)"
      :aria-label="tocUpdateLabel"
      :title="tocUpdateLabel"
      @focus="onProxyFocus(descriptor)"
      @blur="onProxyBlur"
      @click="onUpdateTableOfContents(descriptor.position)"
    />
  </div>
  <div
    v-if="popup"
    ref="popupEl"
    class="layout-sdt-widget-popup"
    :role="popup.kind === 'dropdown' ? 'listbox' : undefined"
    :style="{ position: 'fixed', top: popup.y + 'px', left: popup.x + 'px', zIndex: 1000 }"
    @keydown="onPopupKeyDown"
    @mousedown.prevent
  >
    <template v-if="popup.kind === 'dropdown'">
      <div v-if="popup.items.length === 0" class="layout-sdt-widget-empty">No options</div>
      <button
        v-for="it in popup.items"
        :key="it.value"
        type="button"
        role="option"
        :aria-selected="it.displayText === popup.current"
        class="layout-sdt-widget-option"
        :class="{ 'is-selected': it.displayText === popup.current }"
        @click="apply(popup.target, { kind: 'dropdown', value: it.value })"
      >
        {{ it.displayText }}
      </button>
    </template>
    <input
      v-else
      type="date"
      class="layout-sdt-widget-date"
      :value="popup.current"
      @change="onDateInput"
    />
  </div>
</template>
