/**
 * Interactive UI for typed content controls (checkbox / dropdown / date).
 *
 * The painter draws a `.layout-sdt-widget` trigger on each typed control (see
 * `layout-painter/sdtBoundary`). This component delegates clicks on those
 * triggers: a checkbox toggles immediately; a dropdown opens a menu of its list
 * items; a date opens a small date picker. Selections run through the shared
 * `setContentControlValueTr`, so they are normal undoable edits that update both
 * the visible content and the control's structured `w:sdtPr` state.
 *
 * Listeners live on the persistent pages container, so they survive painter
 * re-renders (which recreate the trigger elements).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { EditorView } from 'prosemirror-view';
import {
  findContentControlsInPM,
  setContentControlValueTr,
  addRepeatingSectionItemTr,
  removeRepeatingSectionItemTr,
  type PMContentControl,
} from '@eigenpal/docx-editor-core/prosemirror';

/** Parse the PM position out of a `sdt@<pos>` group id. */
function posFromGroupId(id: string | undefined): number | null {
  const m = /^sdt@(\d+)$/.exec(id ?? '');
  return m ? Number(m[1]) : null;
}

type Popup =
  | {
      kind: 'dropdown';
      tag: string;
      items: { displayText: string; value: string }[];
      current: string;
      rect: DOMRect;
    }
  | { kind: 'date'; tag: string; current: string; rect: DOMRect };

export interface ContentControlWidgetsProps {
  /** The persistent pages container the painter renders into. */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Accessor for the live body EditorView. */
  getView: () => EditorView | null;
}

function controlByTag(view: EditorView, tag: string): PMContentControl | undefined {
  return findContentControlsInPM(view.state.doc, { tag })[0];
}

export function ContentControlWidgets({
  containerRef,
  getView,
}: ContentControlWidgetsProps): React.ReactElement | null {
  const [popup, setPopup] = useState<Popup | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const apply = useCallback(
    (tag: string, value: Parameters<typeof setContentControlValueTr>[2]) => {
      const view = getView();
      if (!view) return;
      try {
        view.dispatch(setContentControlValueTr(view.state, { tag }, value));
        view.focus(); // return focus so keyboard (undo, typing) works after the edit
      } catch {
        // Locked / invalid — ignore in the UI layer.
      }
      setPopup(null);
    },
    [getView]
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const activate = (trigger: HTMLElement) => {
      const view = getView();
      const tag = trigger.dataset.sdtTag;
      const kind = trigger.dataset.sdtWidget;
      if (!view || !tag || !kind) return;
      const control = controlByTag(view, tag);
      const rect = trigger.getBoundingClientRect();
      if (kind === 'checkbox') {
        apply(tag, { kind: 'checkbox', checked: !control?.checked });
      } else if (kind === 'dropdown') {
        setPopup({
          kind: 'dropdown',
          tag,
          items: control?.listItems ?? [],
          current: control?.text ?? '',
          rect,
        });
      } else if (kind === 'date') {
        setPopup({ kind: 'date', tag, current: control?.dateValue ?? '', rect });
      }
    };

    // Add/remove a repeating-section item via the painter's ＋/✕ buttons.
    const repeat = (btn: HTMLElement) => {
      const view = getView();
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
    };

    // Stop the trigger's mousedown from moving the PM caret / stealing focus.
    const onMouseDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t?.closest?.('.layout-sdt-widget') || t?.closest?.('.layout-sdt-repeat-btn')) {
        e.preventDefault();
      }
    };
    const onClick = (e: MouseEvent) => {
      const repeatBtn = (e.target as HTMLElement)?.closest?.(
        '.layout-sdt-repeat-btn'
      ) as HTMLElement | null;
      if (repeatBtn) {
        e.preventDefault();
        e.stopPropagation();
        repeat(repeatBtn);
        return;
      }
      const trigger = (e.target as HTMLElement)?.closest?.(
        '.layout-sdt-widget'
      ) as HTMLElement | null;
      if (!trigger) return;
      e.preventDefault();
      e.stopPropagation();
      activate(trigger);
    };
    // Keyboard activation (Enter/Space) — explicit so it doesn't depend on the
    // painter button's native click synthesis.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const trigger = (e.target as HTMLElement)?.closest?.(
        '.layout-sdt-widget'
      ) as HTMLElement | null;
      if (!trigger) return;
      e.preventDefault();
      activate(trigger);
    };

    container.addEventListener('mousedown', onMouseDown);
    container.addEventListener('click', onClick);
    container.addEventListener('keydown', onKeyDown);
    return () => {
      container.removeEventListener('mousedown', onMouseDown);
      container.removeEventListener('click', onClick);
      container.removeEventListener('keydown', onKeyDown);
    };
  }, [containerRef, getView, apply]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!popup) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (!popupRef.current?.contains(e.target as Node)) setPopup(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPopup(null);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [popup]);

  // Move focus into the dropdown so it's keyboard-operable (the selected option,
  // else the first). The date popup focuses its input via autoFocus.
  useEffect(() => {
    if (popup?.kind !== 'dropdown') return;
    const opts = popupRef.current?.querySelectorAll<HTMLElement>('.layout-sdt-widget-option');
    if (!opts?.length) return;
    (
      ([...opts].find((o) => o.getAttribute('aria-selected') === 'true') ?? opts[0]) as HTMLElement
    ).focus();
  }, [popup]);

  // Arrow-key roving over the dropdown options.
  const onPopupKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const opts = [
      ...(popupRef.current?.querySelectorAll<HTMLElement>('.layout-sdt-widget-option') ?? []),
    ];
    if (!opts.length) return;
    e.preventDefault();
    const i = opts.indexOf(document.activeElement as HTMLElement);
    const next =
      e.key === 'ArrowDown' ? (i + 1) % opts.length : (i - 1 + opts.length) % opts.length;
    opts[next].focus();
  };

  if (!popup) return null;

  const style: React.CSSProperties = {
    position: 'fixed',
    top: popup.rect.bottom + 2,
    left: popup.rect.left,
    zIndex: 1000,
  };

  return (
    <div
      ref={popupRef}
      className="layout-sdt-widget-popup"
      style={style}
      role={popup.kind === 'dropdown' ? 'listbox' : undefined}
      onKeyDown={onPopupKeyDown}
      onMouseDown={(e) => e.preventDefault()}
    >
      {popup.kind === 'dropdown' ? (
        popup.items.length === 0 ? (
          <div className="layout-sdt-widget-empty">No options</div>
        ) : (
          popup.items.map((it) => {
            const selected = it.displayText === popup.current;
            return (
              <button
                key={it.value}
                type="button"
                role="option"
                aria-selected={selected}
                className={`layout-sdt-widget-option${selected ? ' is-selected' : ''}`}
                onClick={() => apply(popup.tag, { kind: 'dropdown', value: it.value })}
              >
                {it.displayText}
              </button>
            );
          })
        )
      ) : (
        <input
          type="date"
          className="layout-sdt-widget-date"
          autoFocus
          defaultValue={popup.current}
          onChange={(e) => {
            if (e.target.value) apply(popup.tag, { kind: 'date', date: e.target.value });
          }}
        />
      )}
    </div>
  );
}
