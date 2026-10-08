// The navigation pane's keyboard and focus rules, with no framework attached.
//
// Both adapters carry an identical copy of this file. It is plain DOM, so the two panes
// answer every key and focus question the same way.

import { editorScopeFor } from '../editor-scope';
import type { NavigationTab } from './useNavigationPane';

/**
 * Ctrl+F, or Cmd+F on macOS. Both modifiers are accepted, as the engine's keymap accepts
 * them for every accelerator, so a Mac keyboard on another platform still reaches Find.
 * Alt and Shift chords are left alone: Ctrl/Cmd+Alt+F inserts a footnote.
 */
export function isFindShortcut(event: KeyboardEvent): boolean {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return false;
  if (event.isComposing) return false;
  const key = event.key.toLowerCase();
  if (key === 'f') return true;
  // A non-Latin layout reports its own letter in `key`; the physical F key still means Find.
  // A Latin layout keeps `key`, so a remapped layout (F position typing `u`) stays Underline.
  return !/^[a-z]$/.test(key) && event.code === 'KeyF';
}

/** The `aria-keyshortcuts` value for the chord {@link isFindShortcut} accepts. */
export const FIND_KEYSHORTCUTS = 'Control+F Meta+F';

/**
 * Whether a key event that reached `target` belongs to THIS editor, so its Find shortcut
 * may claim it. Another editor on the same page, or the host's own page, keeps the chord.
 *
 * Owned: the pane itself, the scroll container (the painted pages and everything mounted
 * in it), and the editor's own container when chrome and pages share one (the packaged
 * frame, or a host that wraps the parts in a `.docx-editor` element). A chrome part with
 * its own styling root and no shared container counts only while this is the one editor
 * on the page, because nothing else says which editor it belongs to.
 */
export function ownsShortcutTarget(
  target: EventTarget | null,
  pane: Element | null,
  viewport: Element | null
): boolean {
  if (!target || typeof Node === 'undefined' || !(target instanceof Node)) return false;
  if (pane?.contains(target)) return true;
  if (!viewport) return false;
  if (viewport.contains(target)) return true;
  const element = target instanceof Element ? target : target.parentElement;
  if (!element) return false;
  const scope = editorScopeFor(viewport);
  if (scope && scope !== viewport && scope.contains(element)) return true;
  if (!element.closest('.docx-editor') || editorScopeFor(element) !== null) return false;
  const viewports = viewport.ownerDocument.querySelectorAll('.docx-editor__scroll-container');
  return viewports.length === 1 && viewports[0] === viewport;
}

/**
 * Where focus lands when the pane opens: the query field on Find; on Headings the current
 * heading, else the first heading, else the filter field.
 */
export function paneEntryTarget(pane: Element | null, tab: NavigationTab): HTMLElement | null {
  const panel = pane?.querySelector<HTMLElement>(`#docx-nav-panel-${tab}`);
  if (!panel) return null;
  if (tab === 'headings') {
    const heading =
      panel.querySelector<HTMLElement>('.docx-nav__heading--current') ??
      panel.querySelector<HTMLElement>('.docx-nav__heading');
    if (heading) return heading;
  }
  return panel.querySelector<HTMLElement>('.docx-nav__search-input');
}

/** Focus `element`, and select an input's text so typing replaces the previous query. */
export function focusPaneEntry(element: HTMLElement): void {
  element.focus();
  if (typeof HTMLInputElement !== 'undefined' && element instanceof HTMLInputElement) {
    element.select();
  }
}

/** Parse a computed length, treating anything unreadable as 0. */
function px(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Publish the scroll container's size on a pane mounted INSIDE it.
 *
 * Such a pane is sticky (see the stylesheet), so it cannot stretch to the viewport with
 * `inset-block: 0` the way a pane beside the viewport does. It reads the content height
 * and the client width from these two properties instead. Returns the cleanup.
 */
export function publishViewportSize(pane: HTMLElement, viewport: HTMLElement): () => void {
  const measure = () => {
    const style = getComputedStyle(viewport);
    const block = viewport.clientHeight - px(style.paddingTop) - px(style.paddingBottom);
    pane.style.setProperty('--docx-nav-block-size', `${Math.max(0, Math.round(block))}px`);
    pane.style.setProperty('--docx-nav-inline-size', `${Math.round(viewport.clientWidth)}px`);
  };
  measure();
  if (typeof ResizeObserver === 'undefined') return () => {};
  const observer = new ResizeObserver(measure);
  observer.observe(viewport);
  return () => observer.disconnect();
}
