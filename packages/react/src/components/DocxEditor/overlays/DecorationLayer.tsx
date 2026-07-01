/**
 * DecorationLayer — generic ProseMirror decoration forwarder for the
 * painter visible pages.
 *
 * Background: the editor renders into TWO surfaces (see CLAUDE.md → "Editor
 * Architecture — Dual Rendering System"). PM's own decoration rendering
 * happens in the off-screen OffscreenEditorHost, so any plugin that publishes
 * its UI as `Decoration` objects is silently invisible. This component
 * collects decorations from every plugin and renders them as positioned
 * overlays on top of the visible pages.
 *
 * Supported kinds:
 * - **Widget** (`from === to`): the plugin's `toDOM(view, getPos)` is called
 *   and the returned element is appended at the pixel coords of `from`.
 * - **Inline / node** (`from < to`): one absolute-positioned `<div>` per
 *   line-wrap rect, with the decoration's `class` / `style` applied — gives
 *   yCursorPlugin's selection-range tint, search highlights, etc.
 *
 * The overlay is `pointer-events: none` so it never blocks editing; the
 * painter's spans below remain interactive. Per-decoration opt-in to
 * pointer events is up to the plugin (set `style: 'pointer-events: auto'`).
 *
 * **Opt-out**: a plugin that already renders its decorations through its own
 * React overlay (e.g. via `pluginOverlays` + `RenderedDomContext`) can mark
 * its `Decoration` spec with `noOverlay: true` to prevent double-painting.
 */

import { useEffect, useRef } from 'react';
import type { EditorState } from 'prosemirror-state';
import type { Decoration, EditorView } from 'prosemirror-view';
import { createRenderedDomContext } from '../../../plugin-api/RenderedDomContext';

interface DecorationLayerProps {
  /** Returns the current PM view (or null if not yet mounted). */
  getView: () => EditorView | null;
  /** Returns the visible pages container (or null if not yet mounted). */
  getPagesContainer: () => HTMLElement | null;
  /** Current zoom — affects coordinate translation. */
  zoom: number;
  /** Bumps on every PM transaction; drives recomputation. */
  decorationSyncToken: number;
}

const overlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
  // One above SelectionOverlay (z-index: 10) so cursor name labels render above
  // the local caret. Decoration-overlay children inherit this z-index.
  zIndex: 11,
};

export function DecorationLayer({
  getView,
  getPagesContainer,
  zoom,
  decorationSyncToken,
}: DecorationLayerProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const view = getView();
      const pagesContainer = getPagesContainer();
      const overlay = overlayRef.current;
      if (!view || !pagesContainer || !overlay) return;
      syncDecorations(view, pagesContainer, overlay, zoom);
    });
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    // getView/getPagesContainer are stable closures over refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, decorationSyncToken]);

  return (
    <div
      ref={overlayRef}
      className="paged-editor__decoration-overlay"
      style={overlayStyle}
      aria-hidden="true"
    />
  );
}

function syncDecorations(
  view: EditorView,
  pagesContainer: HTMLElement,
  overlay: HTMLElement,
  zoom: number
) {
  // Defer building the RenderedDomContext until we know there are decorations
  // to position — the common no-op case (no plugin emits decorations) costs
  // a single state.plugins iteration and one early return.
  const decorations = collectDecorations(view.state);
  if (decorations.length === 0) {
    if (overlay.firstChild) overlay.replaceChildren();
    return;
  }

  const ctx = createRenderedDomContext(pagesContainer, zoom);
  // The overlay div is a SIBLING of the pages container (both inside the
  // viewport), but `getCoordinatesForPosition` / `getRectsForRange` return
  // coords relative to the pages container itself. The pages container is
  // typically centered within the viewport, so we add its offset to every
  // decoration position before rendering.
  const offset = ctx.getContainerOffset();
  const fragment = document.createDocumentFragment();

  for (const { decoration, from, to } of decorations) {
    if (from === to) {
      // Widget decoration (anchored at one position).
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

    // Inline / node decoration: render one rect per line-wrap.
    const attrs = getDecorationAttrs(decoration);
    if (!attrs) continue;
    const rects = ctx.getRectsForRange(from, to);
    for (const rect of rects) {
      const el = document.createElement('div');
      // Forward every attr that came from the decoration spec — class, style,
      // data-*, aria-*, title, etc. Plugins wire UX through these.
      for (const [name, value] of Object.entries(attrs)) {
        if (name === 'nodeName') continue; // tag name doesn't apply on an overlay div
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

// ---------------------------------------------------------------------------
// Decoration introspection helpers
//
// PM doesn't export the internal `WidgetType` / `InlineType` / `NodeType`
// classes; we use a small typed escape hatch to read the pre-built widget
// DOM and the inline/node attrs. This is the same pattern PM's own
// `viewDecorations` uses internally and has been stable on `Decoration.type`
// since prosemirror-view 1.0.
// ---------------------------------------------------------------------------

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
    // `decorations` returns a `DecorationSource` (could be a `DecorationSet`
    // or a `DecorationGroup` of multiple sets) — `forEachSet` iterates each
    // underlying set so multiple sources aggregate cleanly.
    source.forEachSet((set) => {
      set.find().forEach((decoration) => {
        // Honor opt-out for plugins that already render through their own
        // overlay (e.g. TemplateHighlightOverlay).
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

function getWidgetDOM(d: Decoration, view: EditorView): HTMLElement | null {
  const type = (d as unknown as { type?: WidgetTypeShape }).type;
  if (!type) return null;
  const toDOM = type.toDOM;
  if (typeof toDOM === 'function') return toDOM(view, () => d.from);
  if (toDOM instanceof HTMLElement) return toDOM.cloneNode(true) as HTMLElement;
  return null;
}

function getDecorationAttrs(d: Decoration): Record<string, string> | null {
  const type = (d as unknown as { type?: { attrs?: Record<string, string> } }).type;
  return type?.attrs ?? null;
}
