// The review pane when there is no room to put it beside the document.
//
// Below a threshold the viewport gives its gutter back — the document refits to the full
// width — and the cards move here: an overlay panel, opened by the same toolbar button that
// toggles the pane on a wide screen. It is the comments as a hamburger menu, and the reason
// it exists is that reserving a 316px rail out of a 420px viewport made the document
// unreadable to show the comments.
//
// WHAT CHANGES, AND WHY. On a rail, each card is anchored beside the text it annotates; the
// anchor is the whole point. Over the document that anchor is meaningless — the card is
// covering the text it would have pointed at — so the drawer stacks its cards in document
// order and the caller renders the list unanchored.
//
// MOUNTED WHEN CLOSED. A half-typed reply has to survive a close and reopen, so the panel is
// hidden with `hidden` + `inert` rather than unmounted, exactly as the navigation panel is.
//
// Lives in its own file because `DocxEditorReview.tsx` is close enough to the max-lines gate
// that adding a panel to it would trip a check nothing else catches.

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

/** What {@link ReviewDrawer} needs. Internal to the pro rail; not a public part. */
export interface ReviewDrawerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Accessible name, already localized by the rail. */
  readonly label: string;
  readonly closeLabel: string;
  readonly children: ReactNode;
}

export function ReviewDrawer({ open, onClose, label, closeLabel, children }: ReviewDrawerProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Where focus was when the drawer opened, so closing it puts the reader back on the button
  // they pressed rather than at the top of the document.
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) return undefined;
    openerRef.current = panel.ownerDocument.activeElement;
    // The panel itself, not its first control: a drawer that opened with the first card's
    // Accept button focused is one keystroke away from accepting a change nobody read.
    panel.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    };
    panel.ownerDocument.addEventListener('keydown', onKeyDown);
    return () => {
      panel.ownerDocument.removeEventListener('keydown', onKeyDown);
      const opener = openerRef.current;
      openerRef.current = null;
      if (opener instanceof HTMLElement && opener.isConnected)
        opener.focus({ preventScroll: true });
    };
  }, [open, onClose]);

  return (
    <>
      {/* Dismiss-on-tap, and a visual separation from the document underneath. Not rendered
          closed, so it can never swallow a tap meant for the page. */}
      {open ? (
        <div
          className="docx-review__scrim"
          data-testid="review-scrim"
          onPointerDown={(event) => {
            event.preventDefault();
            onClose();
          }}
        />
      ) : null}
      <div
        ref={panelRef}
        className="docx-review__drawer"
        data-testid="review-drawer"
        role="dialog"
        aria-modal={open || undefined}
        aria-label={label}
        tabIndex={-1}
        hidden={!open}
        // Keeps a hidden panel's controls out of the tab order while its React state — a
        // half-typed reply — lives on.
        inert={!open}
      >
        <div className="docx-review__drawer-head">
          <span className="docx-review__drawer-title">{label}</span>
          <button
            type="button"
            className="docx-review__drawer-close"
            aria-label={closeLabel}
            onPointerDown={(event) => event.preventDefault()}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="docx-review__drawer-body">{children}</div>
      </div>
    </>
  );
}
