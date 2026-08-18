import {
  computed,
  inject,
  onScopeDispose,
  ref,
  watch,
  type ComputedRef,
  type InjectionKey,
} from 'vue';
import type { SurfaceHyperlink } from '@docx-editor.dev/core/editor';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import { useDocxEditor } from './context';
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

function caretViewportAnchor(): HyperlinkPopupAnchor | null {
  const usable = (rect: DOMRect | undefined): rect is DOMRect =>
    !!rect && (rect.width > 0 || rect.height > 0);
  if (typeof document !== 'undefined') {
    const painted = document.querySelector('[data-docx-caret]');
    const rect = painted?.getBoundingClientRect();
    if (usable(rect)) return { left: rect.left, top: rect.bottom };
  }
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
  return null;
}

/** @internal */
export const HyperlinkPopupContext: InjectionKey<UseHyperlinkPopupResult> =
  Symbol('HyperlinkPopupContext');

/** @public */
export function useHyperlinkPopup(): UseHyperlinkPopupResult {
  const provided = inject(HyperlinkPopupContext, null);
  const own = useHyperlinkPopupInstance(provided === null);
  return provided ?? own;
}

/** @public */
export function useHyperlinkPopupInstance(active = true): UseHyperlinkPopupResult {
  const editorRef = useDocxEditor();
  const state = ref<HyperlinkPopupState>(CLOSED);
  const stateRef = { current: state.value };
  watch(state, (next) => {
    stateRef.current = next;
  });
  const snapshot = useEditorState(selectTick);
  const canEdit = computed(() =>
    editorRef.value ? editorRef.value.can({ type: 'insertText', text: '' }).ok : false
  );

  const open = (link?: SurfaceHyperlink | null, anchor?: HyperlinkPopupAnchor | null) => {
    const editor = editorRef.value;
    state.value = {
      mode: link ? 'reading' : 'editing',
      link: link ?? null,
      anchor: anchor ?? null,
      text: link?.text ?? '',
      url: link ? (link.kind === 'internal' ? `#${link.anchor ?? ''}` : link.authored) : '',
      copied: false,
      error: false,
      canEdit: editor ? editor.can({ type: 'insertText', text: '' }).ok : false,
    };
  };

  const close = () => {
    editorRef.value?.surface?.releaseSelection();
    state.value = CLOSED;
  };

  const openAtCaret = () => {
    const editor = editorRef.value;
    const anchor = caretViewportAnchor();
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
        canEdit: editor ? editor.can({ type: 'insertText', text: '' }).ok : false,
      };
      return;
    }
    const selected = editor?.query({ type: 'selectedText' }) ?? '';
    editor?.surface?.retainSelection();
    state.value = {
      mode: 'editing',
      link: null,
      anchor,
      text: selected,
      url: '',
      copied: false,
      error: false,
      canEdit: editor ? editor.can({ type: 'insertText', text: '' }).ok : false,
    };
  };

  onScopeDispose(
    watch(
      () => [editorRef.value, active] as const,
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
    const current = stateRef.current;
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
      if (!surface || surface.retainedSelection()) return;
      state.value = CLOSED;
    }
  });

  const copy = async (): Promise<boolean> => {
    const href = stateRef.current.link?.href;
    if (!href) return false;
    try {
      await navigator.clipboard.writeText(href);
    } catch {
      return false;
    }
    state.value = { ...stateRef.current, copied: true };
    return true;
  };

  const beginEdit = () => {
    state.value = { ...stateRef.current, mode: 'editing', copied: false, error: false };
  };
  const setText = (text: string) => {
    state.value = { ...stateRef.current, text, copied: false, error: false };
  };
  const setUrl = (url: string) => {
    state.value = { ...stateRef.current, url, copied: false, error: false };
  };

  const commitEdit = (): boolean => {
    const editor = editorRef.value;
    const current = stateRef.current;
    const hyperlinks = editor?.surface?.hyperlinks;
    if (!hyperlinks) return false;
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
    const link = stateRef.current.link;
    if (!hyperlinks) return false;
    const removed = hyperlinks.removeHyperlink(link?.id);
    if (removed) close();
    return removed;
  };

  const openTarget = (): boolean => {
    const navigation = editorRef.value?.surface?.navigation;
    const link = stateRef.current.link;
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
