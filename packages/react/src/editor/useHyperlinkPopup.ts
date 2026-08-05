// The hyperlink popover's behavior, UI-free.
//
// Everything `DocxEditor.HyperLink` does lives here, so a host that wants a completely
// different link UI takes this hook and ignores the parts — the same shape `useFontFamily`
// established for the font picker.
//
// The engine decides WHEN. A click on an external link and Ctrl/Cmd+K are gestures the
// surface classifies (a drag that merely ended on a link is not a click on it), so this hook
// registers with `setHyperlinkChrome` rather than binding listeners of its own. What it owns
// is the popover's own state: open or closed, reading or editing, and where it sits.
//
// The engine decides WHAT IS SAFE. `href` is always the sanitized projection, and the only
// path to opening one is `surface.navigation.openExternal` — the engine's single
// `window.open` gate. Nothing here builds a URL.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { SurfaceHyperlink } from '@docx-editor.dev/core/editor';
import { useDocxEditor } from './context';
import { useEditorState } from './useEditorState';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';

/** Where the popover sits, in viewport coordinates. */
export interface HyperlinkPopupAnchor {
  readonly left: number;
  readonly top: number;
}

/** What the popover is showing. @public */
export type HyperlinkPopupMode =
  /** Not shown. */
  | 'closed'
  /** An existing link: its target, plus copy / edit / unlink. */
  | 'reading'
  /** Text + URL fields, for a new link or a change to an existing one. */
  | 'editing';

/** The popover's observable state. @public */
export interface HyperlinkPopupState {
  readonly mode: HyperlinkPopupMode;
  /** The link being read or edited, or null while inserting a new one. */
  readonly link: SurfaceHyperlink | null;
  /** Viewport position for the panel; null means "the host places it". */
  readonly anchor: HyperlinkPopupAnchor | null;
  /** Draft display text, in edit mode. */
  readonly text: string;
  /** Draft target, in edit mode. */
  readonly url: string;
  /** True after a copy, until the next state change — for a "Copied" confirmation. */
  readonly copied: boolean;
  /** True when the last Apply was refused, so the panel can say so instead of sitting there. */
  readonly error: boolean;
  /** Whether the document can be edited right now; read-only trims the actions. */
  readonly canEdit: boolean;
}

/** What `useHyperlinkPopup` answers. @public */
export interface UseHyperlinkPopupResult {
  readonly state: HyperlinkPopupState;
  /** Open in reading mode over a link, or in editing mode when there is none. */
  open: (link?: SurfaceHyperlink | null, anchor?: HyperlinkPopupAnchor | null) => void;
  /**
   * Open insert-or-edit for the SELECTION — what Ctrl/Cmd+K and the toolbar's link button
   * do. Anchors itself at the caret, seeds the display text from the selection, and opens
   * edit mode pre-filled when the caret is already inside a link.
   */
  openAtCaret: () => void;
  close: () => void;
  /** Copy the sanitized target. Answers false when there is nothing safe to copy. */
  copy: () => Promise<boolean>;
  /** Switch to editing, seeded from the link at the caret. */
  beginEdit: () => void;
  setText: (text: string) => void;
  setUrl: (url: string) => void;
  /** Apply the draft. Answers false when the engine refused it (a bad scheme, no text). */
  commitEdit: () => boolean;
  /** Take the link off, keeping its text. */
  unlink: () => boolean;
  /**
   * Open the target in a new tab, through the engine's single `window.open` gate. Answers
   * false for an inert link — there is nothing to open, and this never invents a URL.
   */
  openTarget: () => boolean;
}

const CLOSED: HyperlinkPopupState = Object.freeze({
  mode: 'closed' as const,
  link: null,
  anchor: null,
  text: '',
  url: '',
  copied: false,
  error: false,
  canEdit: true,
});

const selectTick = (snapshot: EditorSnapshot) => snapshot;

/**
 * Where the caret is on screen, for anchoring a keyboard-opened panel.
 *
 * A click supplies its own rect; Ctrl/Cmd+K has none, and an UNANCHORED panel is not
 * merely misplaced — it falls to the top of the scroll container, and focusing its URL
 * input then scrolls the whole document up to reach it. So the keyboard path reads the
 * caret's own rect.
 *
 * The surface mirrors its model selection into the DOM, so the browser's range is the
 * engine's caret rather than a second opinion about where the caret is. A collapsed range
 * can report a zero-size rect at the start of a line; the fallback is the containing
 * element's box, and a total miss leaves the panel unanchored rather than mis-anchored.
 */
function caretViewportAnchor(): HyperlinkPopupAnchor | null {
  const usable = (rect: DOMRect | undefined): rect is DOMRect =>
    !!rect && (rect.width > 0 || rect.height > 0);

  // FIRST the engine's OWN painted caret. It is the authoritative insertion point — the
  // surface paints it from layout and suppresses the native one — so it has a real rect at
  // an empty paragraph, at a line end, and everywhere the browser's range does not.
  if (typeof document !== 'undefined') {
    const painted = document.querySelector('[data-docx-caret]');
    const rect = painted?.getBoundingClientRect();
    if (usable(rect)) return { left: rect.left, top: rect.bottom };
  }

  // Then the browser's range, which the surface mirrors the model selection into.
  const selection = typeof window === 'undefined' ? null : window.getSelection();
  if (selection && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (usable(rect)) return { left: rect.left, top: rect.bottom };
    const node = range.startContainer;
    const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    const fallback = element?.getBoundingClientRect();
    if (usable(fallback)) return { left: fallback.left, top: fallback.bottom };
  }

  // Nothing measurable. The panel places itself by flow rather than at a made-up point —
  // and, because its input focuses with `preventScroll`, that no longer moves the document.
  return null;
}

/**
 * ONE popover state per editor, published by `DocxEditor.HyperLink`.
 *
 * The compound and every consumer of the hook must see the SAME open/closed state, or a
 * toolbar button and a mounted popover would each hold their own and only one of them would
 * ever be showing.
 */
export const HyperlinkPopupContext = createContext<UseHyperlinkPopupResult | null>(null);

/**
 * The hyperlink popover's behavior.
 *
 * Inside a `DocxEditor.HyperLink` (which the packaged editor mounts by default) this is the
 * SHARED state that compound is driving, so a custom toolbar button and the popover agree.
 * Outside one it is a standalone instance that registers with the engine itself — a host
 * building its own link UI from scratch needs nothing else.
 *
 * @public
 */
export function useHyperlinkPopup(): UseHyperlinkPopupResult {
  const provided = useContext(HyperlinkPopupContext);
  // Both hooks run every render, in the same order: `standalone` only decides whether the
  // instance below registers with the engine, never whether it exists.
  const own = useHyperlinkPopupInstance(provided === null);
  return provided ?? own;
}

/**
 * A popover instance. `active` gates ENGINE REGISTRATION only — an instance created inside
 * a provider still exists, it just does not compete for the surface's chrome handlers.
 *
 * @public
 */
export function useHyperlinkPopupInstance(active = true): UseHyperlinkPopupResult {
  const editor = useDocxEditor();
  const [state, setState] = useState<HyperlinkPopupState>(CLOSED);
  // The engine's gestures fire from listeners registered ONCE; reading the live state
  // through a ref keeps that registration off the render path, so opening the popover does
  // not tear down and rebind the surface's chrome handlers.
  const stateRef = useRef(state);
  stateRef.current = state;
  // The snapshot's identity is the engine's "something moved" signal. A committed edit, an
  // undo or a caret move all invalidate what an open popover is describing.
  const snapshot = useEditorState(selectTick);
  const canEdit = editor ? editor.can({ type: 'insertText', text: '' }).ok : false;

  const open = useCallback(
    (link?: SurfaceHyperlink | null, anchor?: HyperlinkPopupAnchor | null) => {
      setState({
        // A link to read; nothing to read means the user is creating one.
        mode: link ? 'reading' : 'editing',
        link: link ?? null,
        anchor: anchor ?? null,
        text: link?.text ?? '',
        // The AUTHORED target seeds the field, not the sanitized projection: the user is
        // editing what the document says, and showing them a rewritten value would make an
        // untouched save look like a change.
        url: link ? (link.kind === 'internal' ? `#${link.anchor ?? ''}` : link.authored) : '',
        copied: false,
        error: false,
        canEdit: editor ? editor.can({ type: 'insertText', text: '' }).ok : false,
      });
    },
    [editor]
  );

  const close = useCallback(() => {
    editor?.surface?.releaseSelection();
    setState(CLOSED);
  }, [editor]);

  /**
   * Open for the caret's own link, or for a new one — what Ctrl/Cmd+K and the toolbar
   * button do. Reading mode when the caret is already inside a link (Word reopens the
   * dialog on it), editing mode otherwise.
   */
  const openAtCaret = useCallback(() => {
    const anchor = caretViewportAnchor();
    const link = editor?.surface?.hyperlinks.linkAtCaret() ?? null;
    if (link) {
      // Ctrl+K on an existing link goes straight to EDIT — the user pressed the key to
      // change it, and making them press Edit as well is a step for nothing.
      setState({
        mode: 'editing',
        link,
        anchor,
        text: link.text,
        url: link.kind === 'internal' ? `#${link.anchor ?? ''}` : link.authored,
        copied: false,
        error: false,
        canEdit: editor ? editor.can({ type: 'insertText', text: '' }).ok : false,
      });
      return;
    }
    const selected = editor?.query({ type: 'selectedText' }) ?? '';
    // The text stays SELECTED while the panel is up. Focusing the URL field moves the
    // browser's one selection into it, so without this the highlight the user is about to
    // turn into a link vanishes exactly when they need to see it. The engine draws it on its
    // own overlay and releases the pin when the caret leaves — which is what closes us below.
    editor?.surface?.retainSelection();
    setState({
      mode: 'editing',
      link: null,
      anchor,
      text: selected,
      url: '',
      copied: false,
      error: false,
      canEdit: editor ? editor.can({ type: 'insertText', text: '' }).ok : false,
    });
  }, [editor]);

  // Register with the engine: a plain click on an external link opens the popover under it,
  // Ctrl/Cmd+K opens insert-or-edit. The cleanup restores whatever was registered before, so
  // nested hosts unwind in order.
  useEffect(() => {
    if (!editor || !active) return undefined;
    return editor.setHyperlinkChrome({
      onPopover: (activation) =>
        open(activation.link, { left: activation.rect.left, top: activation.rect.bottom }),
      onRequest: openAtCaret,
    });
  }, [editor, active, open, openAtCaret]);

  // Dismiss when the CARET LEAVES the link the panel is describing — not on any state tick.
  //
  // "Something moved" is the wrong question, and asking it made the popover unusable: a
  // click on a link queues a `selectionchange`, the surface adopts it a turn later, and that
  // tick landed after the panel had opened and closed it again. The panel appeared and
  // vanished on every click, and only a synthetic click (which skips the pointer path) ever
  // seemed to work.
  //
  // The honest question is whether what the panel SAYS is still true. It is exactly as
  // strict — an edit that removes the link, or a caret that moves out of it, still closes
  // the panel — and it is immune to ticks that change nothing it shows. Editing mode is
  // exempt: the user is mid-keystroke there, and the commit itself moves the caret.
  useEffect(() => {
    const current = stateRef.current;
    if (current.mode !== 'reading' || !current.link) return;
    const atCaret = editor?.surface?.hyperlinks.linkAtCaret() ?? null;
    if (atCaret && atCaret.id === current.link.id) return;
    setState(CLOSED);
  }, [snapshot, editor]);

  // A CREATE panel closes when the caret leaves the range it is about to link.
  //
  // The same question as above — "is what the panel says still true" — asked of a panel that
  // has no link yet: what it says is "these words are about to become a link", and clicking
  // somewhere else makes that false. The engine owns the comparison (it releases the pin when
  // the caret escapes, either edge counting as inside), so this reads a fact rather than
  // recomputing document order in the adapter, and Vue gets the same rule from the same place.
  //
  // Only a panel that RETAINED something is governed by this: an edit panel opened on an
  // existing link is covered by the effect above, and typing in the URL field moves no caret.
  useEffect(() => {
    const current = stateRef.current;
    if (current.mode !== 'editing' || current.link) return;
    const surface = editor?.surface;
    if (!surface || surface.retainedSelection()) return;
    setState(CLOSED);
  }, [snapshot, editor]);

  const copy = useCallback(async () => {
    const href = stateRef.current.link?.href;
    if (!href) return false;
    try {
      await navigator.clipboard.writeText(href);
    } catch {
      // A denied clipboard permission is not an error worth throwing at a user who clicked
      // a copy button; the confirmation simply does not appear.
      return false;
    }
    setState((previous) => ({ ...previous, copied: true }));
    return true;
  }, []);

  const beginEdit = useCallback(() => {
    setState((previous) => ({ ...previous, mode: 'editing', copied: false, error: false }));
  }, []);

  const setText = useCallback((text: string) => {
    setState((previous) => ({ ...previous, text, copied: false, error: false }));
  }, []);

  const setUrl = useCallback((url: string) => {
    setState((previous) => ({ ...previous, url, copied: false, error: false }));
  }, []);

  const commitEdit = useCallback(() => {
    const current = stateRef.current;
    const hyperlinks = editor?.surface?.hyperlinks;
    if (!hyperlinks) return false;
    const url = current.url.trim();
    if (url.length === 0) {
      setState((previous) => ({ ...previous, error: true }));
      return false;
    }
    // `#name` is a bookmark in this document; anything else goes through the package's URL
    // allowlist, which refuses what `sanitizeHref` refuses.
    const internal = url.startsWith('#');
    const applied = hyperlinks.applyHyperlink({
      ...(internal ? { anchor: url.slice(1) } : { url }),
      ...(current.text.trim().length > 0 ? { text: current.text } : {}),
    });
    if (!applied) {
      // The engine refused: a scheme it will not write, a selection spanning paragraphs, or
      // nothing to link. Stay open so the value can be corrected, and SAY so.
      setState((previous) => ({ ...previous, error: true }));
      return false;
    }
    // Through `close`, not a bare `setState`: applying must also drop the retained
    // highlight, or the words stay lit over a link that already exists.
    close();
    return true;
  }, [editor, close]);

  const unlink = useCallback(() => {
    const hyperlinks = editor?.surface?.hyperlinks;
    const link = stateRef.current.link;
    if (!hyperlinks) return false;
    const removed = hyperlinks.removeHyperlink(link?.id);
    if (removed) close();
    return removed;
  }, [editor, close]);

  const openTarget = useCallback(() => {
    const navigation = editor?.surface?.navigation;
    const link = stateRef.current.link;
    if (!navigation || !link) return false;
    // Internal links are a scroll, not a tab.
    if (link.kind === 'internal') {
      const jumped = link.anchor ? navigation.goToBookmark(link.anchor) : false;
      if (jumped) setState(CLOSED);
      return jumped;
    }
    // THE gate. `link.href` is the sanitized projection; an inert link carries null and is
    // refused inside `openExternal` regardless of what is asked here.
    const opened = navigation.openExternal(link.href);
    if (opened) setState(CLOSED);
    return opened;
  }, [editor]);

  return useMemo(
    () => ({
      state: state.mode === 'closed' ? CLOSED : { ...state, canEdit },
      open,
      openAtCaret,
      close,
      copy,
      beginEdit,
      setText,
      setUrl,
      commitEdit,
      unlink,
      openTarget,
    }),
    [
      state,
      canEdit,
      open,
      openAtCaret,
      close,
      copy,
      beginEdit,
      setText,
      setUrl,
      commitEdit,
      unlink,
      openTarget,
    ]
  );
}
