import type { EditorView } from 'prosemirror-view';
import { TextSelection } from 'prosemirror-state';

const NAV_KEYS = new Set(['Home', 'End', 'ArrowLeft', 'ArrowRight']);

type NavKeyEvent = {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  defaultPrevented: boolean;
  preventDefault: () => void;
  nativeEvent: KeyboardEvent;
};

/**
 * When the painted pages container holds DOM focus, forward Home/End and
 * horizontal arrows into the hidden body PM. Native caret movement in the
 * off-screen editor drifts from PM state; the PM `handleKeyDown` path is
 * the source of truth.
 */
export function forwardNavKeysToPm(e: NavKeyEvent, view: EditorView | null | undefined): boolean {
  if (!view || e.defaultPrevented) return false;
  if (!NAV_KEYS.has(e.key) || e.metaKey || e.ctrlKey || e.altKey) return false;

  e.preventDefault();
  if (!view.hasFocus()) view.focus();

  const handled = !!view.someProp('handleKeyDown', (f) => f(view, e.nativeEvent));
  if (!handled && (e.key === 'Home' || e.key === 'End') && !e.shiftKey) {
    const $head = view.state.selection.$head;
    const pos = e.key === 'Home' ? $head.start() : $head.end();
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
  }
  return true;
}
