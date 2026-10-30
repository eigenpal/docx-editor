import {
  computed,
  getCurrentScope,
  inject,
  provide,
  ref,
  shallowRef,
  watch,
  type ComputedRef,
  type InjectionKey,
} from 'vue';
import { hostDocumentOf, hostWindowOf } from '@docx-editor.dev/core/editor';
import { scopeDispose } from './scope-dispose';
import type { SurfaceHyperlink } from '@docx-editor.dev/core/editor';
import type { Editor, EditorSnapshot, SelectionPin } from '@docx-editor.dev/core/contracts/editor';
import { useDocxEditor, useEditorContentElement } from './context';
import { useEditorState } from './useEditorState';

/** @public */
export interface HyperlinkPopupAnchor {
  readonly left: number;
  readonly top: number;
}

/** @public */
export type HyperlinkPopupMode = 'closed' | 'reading' | 'editing';

/** @public */
export interface HyperlinkPopupState {
  readonly mode: HyperlinkPopupMode;
  readonly link: SurfaceHyperlink | null;
  readonly anchor: HyperlinkPopupAnchor | null;
  readonly text: string;
  readonly url: string;
  readonly copied: boolean;
  readonly error: boolean;
  readonly canEdit: boolean;
}

/** @public */
export interface UseHyperlinkPopupResult {
  readonly state: ComputedRef<HyperlinkPopupState>;
  open: (link?: SurfaceHyperlink | null, anchor?: HyperlinkPopupAnchor | null) => void;
  openAtCaret: () => void;
  close: () => void;
  copy: () => Promise<boolean>;
  beginEdit: () => void;
  setText: (text: string) => void;
  setUrl: (url: string) => void;
  commitEdit: () => boolean;
  unlink: () => boolean;
  openTarget: () => boolean;
}

/** @public */
export function isFieldLink(link: SurfaceHyperlink): boolean {
  return link.paragraphId === '';
}

/**
 * The longest target the per-update check reads. `selectedText` builds the whole selected
 * string, so a select-all panel in a long document would pay for it on every remote keystroke.
 * Longer targets are checked once, at Apply. The React twin uses the same limit.
 */
const TARGET_CHECK_LIMIT = 4096;

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

function caretViewportAnchor(doc: Document | null): HyperlinkPopupAnchor | null {
  const usable = (rect: DOMRect | undefined): rect is DOMRect =>
    !!rect && (rect.width > 0 || rect.height > 0);
  if (!doc) return null;
  const painted = doc.querySelector('[data-docx-caret]');
  const rect = painted?.getBoundingClientRect();
  if (usable(rect)) return { left: rect.left, top: rect.bottom };
  const selection = doc.getSelection();
  if (selection && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (usable(rect)) return { left: rect.left, top: rect.bottom };
    const node = range.startContainer;
    const element = node.nodeType === 1 ? (node as Element) : node.parentElement;
    const fallback = element?.getBoundingClientRect();
    if (usable(fallback)) return { left: fallback.left, top: fallback.bottom };
  }
  return null;
}

/** @internal */
export const HyperlinkPopupContext: InjectionKey<UseHyperlinkPopupResult> =
  Symbol('HyperlinkPopupContext');

/**
 * Counts what shows the shared popover state: `DocxEditor.HyperLink`, or a host panel that
 * calls `useHyperlinkPopup()`. The shared state answers link clicks, Ctrl/Cmd+K and the
 * `text.link` control only while one is mounted, so with nothing to show the panel those
 * controls are disabled instead of opening a panel no one sees.
 *
 * @internal
 */
export const HyperlinkPopupViews: InjectionKey<() => () => void> = Symbol('HyperlinkPopupViews');

/**
 * The hyperlink popover's behavior. Inside `DocxEditor.Root` it is the shared state that
 * `DocxEditor.HyperLink` renders, and calling it marks the component as a view of that
 * state. Outside a root it is a standalone instance that registers with the engine itself.
 *
 * @public
 */
export function useHyperlinkPopup(): UseHyperlinkPopupResult {
  const provided = inject(HyperlinkPopupContext, null);
  const attach = inject(HyperlinkPopupViews, null);
  // Counted only where a scope can uncount it again, or the controls would stay enabled
  // after the panel was gone.
  if (provided && attach && getCurrentScope()) scopeDispose(attach());
  const own = useHyperlinkPopupInstance(provided === null);
  return provided ?? own;
}

/**
 * The shared popover state a root provides: registered with the engine only while a view
 * shows it.
 *
 * @internal
 */
export function provideHyperlinkPopup(): UseHyperlinkPopupResult {
  const views = ref(0);
  provide(HyperlinkPopupViews, () => {
    views.value += 1;
    let attached = true;
    return () => {
      if (!attached) return;
      attached = false;
      views.value -= 1;
    };
  });
  const popup = hyperlinkPopupInstance(() => views.value > 0);
  provide(HyperlinkPopupContext, popup);
  return popup;
}

/** @public */
export function useHyperlinkPopupInstance(active = true): UseHyperlinkPopupResult {
  return hyperlinkPopupInstance(() => active);
}

function hyperlinkPopupInstance(active: () => boolean): UseHyperlinkPopupResult {
  const editorRef = useDocxEditor();
  const contentElement = useEditorContentElement();
  const state = ref<HyperlinkPopupState>(CLOSED);
  const selectionRetainer = shallowRef<{ editor: Editor; pin: SelectionPin } | null>(null);
  const snapshot = useEditorState(selectTick);
  const canEdit = computed(() =>
    editorRef.value ? editorRef.value.can({ type: 'insertText', text: '' }).ok : false
  );

  // The words a create panel opened over; empty for a panel opened at a bare caret.
  let targetText = '';
  // Whether those words were already a pending deletion when the panel opened.
  let struckAtOpen = false;

  const releaseSelectionPin = () => {
    targetText = '';
    struckAtOpen = false;
    const retained = selectionRetainer.value;
    if (!retained) return;
    retained.editor.releaseSelection(retained.pin);
    selectionRetainer.value = null;
  };
  scopeDispose(releaseSelectionPin);

  // Whether the words a create panel is about to link are gone (a peer deleted or rewrote
  // them, struck them in suggesting mode, or an undo took them out). Apply would otherwise
  // insert the draft as a new link at the collapsed caret. The React twin states the full reason.
  const targetGone = (everyUpdate = false): boolean => {
    const editor = editorRef.value;
    if (targetText === '' || !editor) return false;
    if (!struckAtOpen && editor.surface?.hyperlinks.selectionIsPendingDeletion() === true)
      return true;
    if (everyUpdate && targetText.length > TARGET_CHECK_LIMIT) return false;
    return editor.query({ type: 'selectedText' }) !== targetText;
  };

  const open = (link?: SurfaceHyperlink | null, anchor?: HyperlinkPopupAnchor | null) => {
    releaseSelectionPin();
    const editor = editorRef.value;
    state.value = {
      mode: link ? 'reading' : 'editing',
      link: link ?? null,
      anchor: anchor ?? null,
      text: link?.text ?? '',
      url: link ? (link.kind === 'internal' ? `#${link.anchor ?? ''}` : link.authored) : '',
      copied: false,
      error: false,
      canEdit: editor ? editorRef.value!.can({ type: 'insertText', text: '' }).ok : false,
    };
  };

  const close = () => {
    releaseSelectionPin();
    state.value = CLOSED;
  };

  const openAtCaret = () => {
    const editor = editorRef.value;
    const anchor = caretViewportAnchor(hostDocumentOf(contentElement.value) ?? null);
    releaseSelectionPin();
    const link =
      editor?.surface?.hyperlinks.linkAtCaret() ??
      editor?.surface?.hyperlinks.fieldLinkAtCaret() ??
      null;
    if (link && isFieldLink(link)) {
      open(link, anchor);
      return;
    }
    if (link) {
      state.value = {
        mode: 'editing',
        link,
        anchor,
        text: link.text,
        url: link.kind === 'internal' ? `#${link.anchor ?? ''}` : link.authored,
        copied: false,
        error: false,
        canEdit: editor ? editorRef.value!.can({ type: 'insertText', text: '' }).ok : false,
      };
      return;
    }
    const selected = editor?.query({ type: 'selectedText' }) ?? '';
    const pin = editor?.retainSelection() ?? null;
    if (editor && pin) selectionRetainer.value = { editor, pin };
    targetText = selected;
    struckAtOpen = editor?.surface?.hyperlinks.selectionIsPendingDeletion() === true;
    state.value = {
      mode: 'editing',
      link: null,
      anchor,
      text: selected,
      url: '',
      copied: false,
      error: false,
      canEdit: editor ? editorRef.value!.can({ type: 'insertText', text: '' }).ok : false,
    };
  };

  scopeDispose(
    watch(
      () => [editorRef.value, active()] as const,
      ([editor, isActive], _prev, onCleanup) => {
        if (!editor || !isActive) return;
        const off = editor.setHyperlinkChrome({
          onPopover: (activation) =>
            open(activation.link, { left: activation.rect.left, top: activation.rect.bottom }),
          onRequest: openAtCaret,
        });
        onCleanup(off);
      },
      { immediate: true, flush: 'post' }
    )
  );

  watch([snapshot, editorRef], () => {
    const current = state.value;
    const editor = editorRef.value;
    if (current.mode === 'reading' && current.link) {
      const atCaret = isFieldLink(current.link)
        ? (editor?.surface?.hyperlinks.fieldLinkAtCaret() ?? null)
        : (editor?.surface?.hyperlinks.linkAtCaret() ?? null);
      if (atCaret && atCaret.id === current.link.id) return;
      state.value = CLOSED;
      return;
    }
    if (current.mode === 'editing' && !current.link) {
      const surface = editor?.surface;
      if (!surface) return;
      if (surface.retainedSelection() && !targetGone(true)) return;
      close();
    }
  });

  const copy = async (): Promise<boolean> => {
    const href = state.value.link?.href;
    if (!href) return false;
    try {
      await hostWindowOf(contentElement.value).navigator.clipboard.writeText(href);
    } catch {
      return false;
    }
    state.value = { ...state.value, copied: true };
    return true;
  };

  const beginEdit = () => {
    state.value = { ...state.value, mode: 'editing', copied: false, error: false };
  };
  const setText = (text: string) => {
    state.value = { ...state.value, text, copied: false, error: false };
  };
  const setUrl = (url: string) => {
    state.value = { ...state.value, url, copied: false, error: false };
  };

  const commitEdit = (): boolean => {
    const editor = editorRef.value;
    const current = state.value;
    const hyperlinks = editor?.surface?.hyperlinks;
    if (!hyperlinks) return false;
    if (!current.link && targetGone()) {
      close();
      return false;
    }
    const url = current.url.trim();
    if (url.length === 0) {
      state.value = { ...current, error: true };
      return false;
    }
    const internal = url.startsWith('#');
    const applied = hyperlinks.applyHyperlink({
      ...(internal ? { anchor: url.slice(1) } : { url }),
      ...(current.text.trim().length > 0 ? { text: current.text } : {}),
    });
    if (!applied) {
      state.value = { ...current, error: true };
      return false;
    }
    close();
    return true;
  };

  const unlink = (): boolean => {
    const hyperlinks = editorRef.value?.surface?.hyperlinks;
    const link = state.value.link;
    if (!hyperlinks) return false;
    const removed = hyperlinks.removeHyperlink(link?.id);
    if (removed) close();
    return removed;
  };

  const openTarget = (): boolean => {
    const navigation = editorRef.value?.surface?.navigation;
    const link = state.value.link;
    if (!navigation || !link) return false;
    if (link.kind === 'internal') {
      const jumped = link.anchor ? navigation.goToBookmark(link.anchor) : false;
      if (jumped) state.value = CLOSED;
      return jumped;
    }
    const opened = navigation.openExternal(link.href);
    if (opened) state.value = CLOSED;
    return opened;
  };

  const publicState = computed(() =>
    state.value.mode === 'closed' ? CLOSED : { ...state.value, canEdit: canEdit.value }
  );

  return {
    state: publicState,
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
  };
}
