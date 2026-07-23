// Output capability registry (comprehensive 3.8). Every DISPLAY-ITEM kind (text, rect, ...)
// registers its renderer + a paint LAYER here, instead of a `item.type` switch in each backend.
// A backend renders a page by grouping items by ascending layer (so lower layers paint first) and
// dispatching each through its registered renderer; an unregistered item kind fails closed rather
// than being silently dropped. A new display-item kind registers a renderer instead of editing the
// backend. This module is DOM-shaped (the DOM backend); other backends (PDF) keep their own
// exhaustive handling until they adopt the same pattern.

import type { DisplayItem } from '@docx-editor.dev/engine-layout';

/** Render one display item into a DOM element. */
export type DisplayItemRenderer = (item: DisplayItem, doc: Document) => HTMLElement;

interface Entry {
  readonly render: DisplayItemRenderer;
  /** Paint order: lower layers are appended first (e.g. rects behind text). */
  readonly layer: number;
}

const renderers = new Map<string, Entry>();

/** Register the DOM renderer + paint layer for a display-item kind. Duplicates are rejected. */
export function registerDisplayItemRenderer(type: string, render: DisplayItemRenderer, layer: number): void {
  if (renderers.has(type)) throw new Error(`duplicate display-item renderer for '${type}'`);
  renderers.set(type, { render, layer });
}

/** The paint layer of a display-item kind (0 if unregistered — only reached via the guarded path). */
export const displayItemLayer = (type: string): number => renderers.get(type)?.layer ?? 0;

/** Render one display item through its registered renderer; fails closed on an unknown kind. */
export function renderDisplayItem(item: DisplayItem, doc: Document): HTMLElement {
  const entry = renderers.get(item.type);
  if (!entry) throw new Error(`no display-item renderer registered for kind '${item.type}'`);
  return entry.render(item, doc);
}

/** The distinct paint layers present in an item list, in ascending order. */
export function orderedLayers(items: readonly DisplayItem[]): number[] {
  return [...new Set(items.map((i) => displayItemLayer(i.type)))].sort((a, b) => a - b);
}
