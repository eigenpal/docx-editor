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
  addRepeatingSectionItemTr,
  removeRepeatingSectionItemTr,
} from '@eigenpal/docx-editor-core/prosemirror';
import type { ContentControlValue } from '@eigenpal/docx-editor-core/agent';

/** Parse the PM position out of a `sdt@<pos>` group id. */
function posFromGroupId(id: string | undefined): number | null {
  const m = /^sdt@(\d+)$/.exec(id ?? '');
  return m ? Number(m[1]) : null;
}

const props = defineProps<{
  container: HTMLElement | null;
  view: EditorView | null;
}>();

type Popup =
  | {
      kind: 'dropdown';
      tag: string;
      items: { displayText: string; value: string }[];
      current: string;
      x: number;
      y: number;
    }
  | { kind: 'date'; tag: string; current: string; x: number; y: number };

const popup = ref<Popup | null>(null);
const popupEl = ref<HTMLElement | null>(null);

function apply(tag: string, value: ContentControlValue): void {
  const view = props.view;
  if (view) {
    try {
      view.dispatch(setContentControlValueTr(view.state, { tag }, value));
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

function onMouseDown(e: MouseEvent): void {
  const t = e.target as HTMLElement;
  if (t?.closest?.('.layout-sdt-widget') || t?.closest?.('.layout-sdt-repeat-btn')) {
    e.preventDefault();
  }
}

function activate(trigger: HTMLElement): void {
  const view = props.view;
  const tag = trigger.dataset.sdtTag;
  const kind = trigger.dataset.sdtWidget;
  if (!view || !tag || !kind) return;
  const control = findContentControlsInPM(view.state.doc, { tag })[0];
  const rect = trigger.getBoundingClientRect();
  if (kind === 'checkbox') {
    apply(tag, { kind: 'checkbox', checked: !control?.checked });
  } else if (kind === 'dropdown') {
    popup.value = {
      kind: 'dropdown',
      tag,
      items: control?.listItems ?? [],
      current: control?.text ?? '',
      x: rect.left,
      y: rect.bottom + 2,
    };
  } else if (kind === 'date') {
    popup.value = { kind: 'date', tag, current: control?.dateValue ?? '', x: rect.left, y: rect.bottom + 2 };
  }
}

function onClick(e: MouseEvent): void {
  const repeatBtn = (e.target as HTMLElement)?.closest?.('.layout-sdt-repeat-btn') as HTMLElement | null;
  if (repeatBtn) {
    e.preventDefault();
    e.stopPropagation();
    repeat(repeatBtn);
    return;
  }
  const trigger = (e.target as HTMLElement)?.closest?.('.layout-sdt-widget') as HTMLElement | null;
  if (!trigger) return;
  e.preventDefault();
  e.stopPropagation();
  activate(trigger);
}

// Keyboard activation (Enter/Space) — explicit, not reliant on native button click.
function onTriggerKeyDown(e: KeyboardEvent): void {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const trigger = (e.target as HTMLElement)?.closest?.('.layout-sdt-widget') as HTMLElement | null;
  if (!trigger) return;
  e.preventDefault();
  activate(trigger);
}

function onDocMouseDown(e: MouseEvent): void {
  if (popup.value && !popupEl.value?.contains(e.target as Node)) popup.value = null;
}
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') popup.value = null;
}

// (Re)bind delegated listeners when the container element changes.
let bound: HTMLElement | null = null;
watch(
  () => props.container,
  (el) => {
    if (bound) {
      bound.removeEventListener('mousedown', onMouseDown);
      bound.removeEventListener('click', onClick);
      bound.removeEventListener('keydown', onTriggerKeyDown);
    }
    bound = el ?? null;
    if (bound) {
      bound.addEventListener('mousedown', onMouseDown);
      bound.addEventListener('click', onClick);
      bound.addEventListener('keydown', onTriggerKeyDown);
    }
  },
  { immediate: true }
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
    bound.removeEventListener('mousedown', onMouseDown);
    bound.removeEventListener('click', onClick);
    bound.removeEventListener('keydown', onTriggerKeyDown);
  }
  document.removeEventListener('mousedown', onDocMouseDown);
  document.removeEventListener('keydown', onKey);
});

function onDateInput(e: Event): void {
  const value = (e.target as HTMLInputElement).value;
  if (value && popup.value) apply(popup.value.tag, { kind: 'date', date: value });
}
</script>

<template>
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
        @click="apply(popup.tag, { kind: 'dropdown', value: it.value })"
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
