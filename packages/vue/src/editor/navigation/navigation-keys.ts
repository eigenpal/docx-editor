// The navigation pane's keyboard and focus rules, with no framework attached.
//
// Both adapters carry an identical copy of this file. It is plain DOM, so the two panes
// answer every key and focus question the same way.

import { chordLetter, editorInstanceScope } from '@docx-editor.dev/core/editor';
import { isApplePlatform } from '@docx-editor.dev/i18n';
import type { NavigationTab } from './useNavigationPane';

/**
 * Cmd+F on Apple platforms, Ctrl+F elsewhere (`isApplePlatform`, the detector the shortcut
 * labels use). Only the platform's own modifier counts: on macOS Ctrl+F moves the caret
 * forward one character in text, and elsewhere the Meta key belongs to the system.
 * Alt and Shift chords are left alone: Ctrl/Cmd+Alt+F inserts a footnote.
 */
export function isFindShortcut(event: KeyboardEvent, apple = isApplePlatform()): boolean {
  if (event.altKey || event.shiftKey || event.isComposing) return false;
  if (apple ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey) return false;
  // The engine keymap's own letter rule: a Latin `key` answers, so a remapped layout (F
  // position typing `u`) stays Underline; a non-Latin layout falls back to the physical key.
  return chordLetter(event) === 'f';
}

/**
 * The `aria-keyshortcuts` value for the chord {@link isFindShortcut} accepts, from the
 * resolved shortcut label (`platformShortcut('Ctrl+F')`), so a server render and the
 * hydrating client agree on the first pass.
 */
export function findKeyShortcuts(resolvedLabel: string): string {
  return resolvedLabel.startsWith('Ctrl') ? 'Control+F' : 'Meta+F';
}

/**
 * Give focus back after the pane closes, without scrolling the document.
 *
 * An opener in the pages layer (after Ctrl/Cmd+F from the text) goes back through the
 * editor, which restores the caret without scrolling: the pages layer is the whole document
 * tall, and a plain `focus()` scrolls to its top. Any other opener, and the disc, take focus
 * with `preventScroll`. With neither, the editor.
 */
export function returnFocus(
  opener: HTMLElement | null,
  disc: HTMLElement | null,
  focusEditor: (() => void) | null
): void {
  if (opener?.isConnected) {
    if (focusEditor && opener.closest('.docx-pages')) focusEditor();
    else opener.focus({ preventScroll: true });
    return;
  }
  if (disc) disc.focus({ preventScroll: true });
  else focusEditor?.();
}

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
  const scope = editorInstanceScope(viewport);
  if (scope && scope !== viewport && scope.contains(element)) return true;
  if (!element.closest('.docx-editor') || editorInstanceScope(element) !== null) return false;
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

/** Focus the pane's first focusable control, or the pane itself. */
function focusIntoPane(pane: Element): void {
  const target =
    pane.querySelector<HTMLElement>(
      '.docx-nav__heading--current, .docx-nav__heading, .docx-nav__search-input'
    ) ??
    pane.querySelector<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
  if (target) {
    target.focus();
    return;
  }
  if (pane instanceof HTMLElement) {
    if (!pane.hasAttribute('tabindex')) pane.setAttribute('tabindex', '-1');
    pane.focus();
  }
}

/**
 * Make the page content `inert` while an overlaying pane covers it, so Tab and the pointer
 * cannot reach content the pane hides. A pane inside the scroll container leaves its own
 * ancestors alone and marks their other children. A pane beside the container marks the
 * container's children, never the container itself, so the wheel still scrolls it. Only
 * attributes set here are removed again. Returns the cleanup.
 */
export function inertBehindPane(pane: Element, viewport: Element): () => void {
  const covered: Element[] = [];
  if (viewport.contains(pane)) {
    let node: Element = pane;
    while (node !== viewport && node.parentElement) {
      for (const sibling of node.parentElement.children) if (sibling !== node) covered.push(sibling);
      node = node.parentElement;
    }
  } else {
    covered.push(...viewport.children);
  }
  // Focus in content that turns inert, such as an open balloon or a comment draft, would
  // drop to <body>. Move it into the pane first.
  const active = pane.ownerDocument.activeElement;
  if (active && covered.some((element) => element.contains(active))) focusIntoPane(pane);
  const marked: Element[] = [];
  for (const element of covered) {
    if (element.hasAttribute('inert')) continue;
    element.setAttribute('inert', '');
    marked.push(element);
  }
  return () => {
    for (const element of marked) element.removeAttribute('inert');
    marked.length = 0;
  };
}

/**
 * Cover the page with an overlaying pane: its content turns inert (see
 * {@link inertBehindPane}), and a press on the scroll container outside the pane calls
 * `close`. Returns the cleanup, which undoes both.
 */
export function coverPage(pane: Element, viewport: HTMLElement, close: () => void): () => void {
  const release = inertBehindPane(pane, viewport);
  const onPointerDown = (event: Event) => {
    if (event.target instanceof Node && pane.contains(event.target)) return;
    close();
  };
  viewport.addEventListener('pointerdown', onPointerDown);
  return () => {
    viewport.removeEventListener('pointerdown', onPointerDown);
    release();
  };
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
