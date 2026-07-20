<template>
  <div ref="overlayRef" class="paged-editor__decoration-overlay" aria-hidden="true" />
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { EditorState } from 'prosemirror-state';
import type { Decoration, EditorView } from 'prosemirror-view';
import { createRenderedDomContext } from '../plugin-api/RenderedDomContext';

const props = defineProps<{
  getView: () => EditorView | null;
  getPagesContainer: () => HTMLElement | null;
  zoom: number;
  transactionVersion: number;
  pagesAreCurrent: () => boolean;
}>();

const overlayRef = ref<HTMLDivElement | null>(null);
let rafId: number | null = null;

function scheduleSync() {
  if (rafId !== null) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(() => {
    rafId = null;
    if (!props.pagesAreCurrent()) return;
    const view = props.getView();
    const pagesContainer = props.getPagesContainer();
    const overlay = overlayRef.value;
    if (!view || !pagesContainer || !overlay) return;
    syncDecorations(view, pagesContainer, overlay, props.zoom);
  });
}

onMounted(() => {
  const pages = props.getPagesContainer();
  if (!pages) return;
  const cancelStaleSync = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };
  pages.addEventListener('docx-editor-vue:painted-pages-stale', cancelStaleSync);
  onBeforeUnmount(() => {
    pages.removeEventListener('docx-editor-vue:painted-pages-stale', cancelStaleSync);
  });
});

onBeforeUnmount(() => {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
});

watch(
  () => props.transactionVersion,
  () => scheduleSync()
);

function syncDecorations(
  view: EditorView,
  pagesContainer: HTMLElement,
  overlay: HTMLElement,
  zoom: number
) {
  const decorations = collectDecorations(view.state);
  if (decorations.length === 0) {
    if (overlay.firstChild) overlay.replaceChildren();
    return;
  }

  const ctx = createRenderedDomContext(pagesContainer, zoom);
  const offset = ctx.getContainerOffset();
  const fragment = document.createDocumentFragment();

  for (const { decoration, from, to } of decorations) {
    if (from === to) {
      const dom = getWidgetDOM(decoration, view);
      if (!dom) continue;
      const coords = ctx.getCoordinatesForPosition(from);
      if (!coords) continue;
      const wrapper = document.createElement('div');
      wrapper.style.cssText =
        `position:absolute;left:${coords.x + offset.x}px;top:${coords.y + offset.y}px;` +
        `height:${coords.height}px;`;
      wrapper.appendChild(dom);
      fragment.appendChild(wrapper);
      continue;
    }

    const attrs = getDecorationAttrs(decoration);
    if (!attrs) continue;
    const rects = ctx.getRectsForRange(from, to);
    for (const rect of rects) {
      const el = document.createElement('div');
      for (const [name, value] of Object.entries(attrs)) {
        if (name === 'nodeName') continue;
        el.setAttribute(name, value);
      }
      const baseStyle =
        `position:absolute;left:${rect.x + offset.x}px;top:${rect.y + offset.y}px;` +
        `width:${rect.width}px;height:${rect.height}px;`;
      el.style.cssText = baseStyle + (attrs.style ?? '');
      fragment.appendChild(el);
    }
  }

  overlay.replaceChildren(fragment);
}

interface CollectedDecoration {
  decoration: Decoration;
  from: number;
  to: number;
}

function collectDecorations(state: EditorState): CollectedDecoration[] {
  const out: CollectedDecoration[] = [];
  for (const plugin of state.plugins) {
    const decorationsFn = plugin.props.decorations;
    if (!decorationsFn) continue;
    const source = decorationsFn.call(plugin, state);
    if (!source) continue;
    source.forEachSet((set) => {
      set.find().forEach((decoration) => {
        if (decoration.spec?.noOverlay) return;
        out.push({ decoration, from: decoration.from, to: decoration.to });
      });
    });
  }
  return out;
}

type WidgetTypeShape = {
  toDOM: ((view: EditorView, getPos: () => number | undefined) => HTMLElement) | HTMLElement;
};

function getWidgetDOM(decoration: Decoration, view: EditorView): HTMLElement | null {
  const type = (decoration as unknown as { type?: WidgetTypeShape }).type;
  if (!type) return null;
  const toDOM = type.toDOM;
  if (typeof toDOM === 'function') return toDOM(view, () => decoration.from);
  if (toDOM instanceof HTMLElement) return toDOM.cloneNode(true) as HTMLElement;
  return null;
}

function getDecorationAttrs(decoration: Decoration): Record<string, string> | null {
  const type = (decoration as unknown as { type?: { attrs?: Record<string, string> } }).type;
  return type?.attrs ?? null;
}
</script>
