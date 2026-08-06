// A card that hangs off a painted content control, positioned by the browser.
//
// The obvious version reads the chip's rect and writes `position: fixed; left; top`. That is
// a snapshot: it is wrong the moment the page scrolls, the window resizes, the zoom changes or
// a reflow moves the chip, and the usual repair is a scroll listener re-measuring every frame.
// This does none of that. `anchor-name` goes on the chip once, CSS names it with
// `position-anchor`, and the browser keeps the two together for as long as both exist.
//
// The card is a `popover`, so it renders in the top layer: no z-index, and the page it sits
// over cannot clip it.

import { useCallback, useEffect, useRef } from 'react';

/** The name CSS anchors to. One card at a time, so one name is enough. */
export const CHIP_ANCHOR = '--docx-chip';

/**
 * How long to wait for a repainted chip before treating the control as gone, in ms.
 *
 * A budget rather than a frame count: what is being waited for is the engine's next paint, and
 * how many frames that takes depends on the document, not on the card.
 */
const ANCHOR_TIMEOUT_MS = 600;

/** The engine's painted chip: the boundary box, not the page-sized chrome layer over it. */
function chipFor(controlId: string): HTMLElement | null {
  const layer = document.querySelector(`[data-docx-content-control="${CSS.escape(controlId)}"]`);
  const chip = layer?.querySelector('.docx-content-control-boundary');
  return chip instanceof HTMLElement ? chip : null;
}

export interface ChipPopover<T extends HTMLElement> {
  /** Put this on the card element, which must also carry `popover="manual"`. */
  readonly ref: (element: T | null) => void;
}

/**
 * Shows a card anchored to the control `controlId` names, and closes it on a press anywhere
 * that is not the card or a chip, or on Escape.
 *
 * Pass `controlId: undefined` to close. The caller still owns whether a card exists and what
 * is in it; this owns only where it appears and when it goes away.
 *
 * `popover="manual"`, not `"auto"`, so dismissal is written here. Light dismiss would be free,
 * but it treats a press on the chip as a press outside — and a chip press is exactly what OPENS
 * the card, so the platform closed each card in the same click that asked for it. Nothing can
 * be done about that from here: light dismiss exempts a popover's invoker, and the invoker is
 * a box the engine paints rather than a button this code hands over.
 */
export function useChipPopover<T extends HTMLElement>(
  controlId: string | undefined,
  onClose: () => void
): ChipPopover<T> {
  const cardRef = useRef<T | null>(null);
  // Read inside the effects without making them depend on the caller's identity: a host that
  // passes an inline arrow would otherwise re-run them every render, hiding and re-showing.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // A callback ref, so the effect below runs once the element exists.
  const setCard = useCallback((element: T | null) => {
    cardRef.current = element;
  }, []);

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    if (!controlId) {
      if (card.matches(':popover-open')) card.hidePopover();
      return;
    }
    let anchored: HTMLElement | null = null;
    let frame = 0;
    // The chip may not be painted yet. A write that REPLACES a control — which is what
    // re-authoring one is — publishes a new id, and the engine repaints on its own schedule
    // rather than inside the React commit that handed the id over. So keep looking until the
    // budget runs out; giving up on the first miss closed every card a write had just opened.
    const deadline = performance.now() + ANCHOR_TIMEOUT_MS;
    const attach = (): void => {
      const chip = chipFor(controlId);
      if (!chip) {
        if (performance.now() < deadline) {
          frame = requestAnimationFrame(attach);
          return;
        }
        closeRef.current();
        return;
      }
      anchored = chip;
      // The ONE imperative line, and it carries no geometry. Everything from here — placement,
      // scroll tracking, flipping when it would overflow — is the browser's.
      chip.style.setProperty('anchor-name', CHIP_ANCHOR);
      if (!card.matches(':popover-open')) card.showPopover();
    };
    attach();
    return () => {
      cancelAnimationFrame(frame);
      anchored?.style.removeProperty('anchor-name');
    };
  }, [controlId]);

  useEffect(() => {
    if (!controlId) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeRef.current();
    };
    // Capture, because the painted surface cancels its own pointer handling and a bubbling
    // listener never hears a press on the page.
    const onDown = (event: Event): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      // A press on the card is use, and a press on any chip is the next card opening.
      if (target.closest('[popover]') || target.closest('[data-docx-content-control]')) return;
      closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [controlId]);

  return { ref: setCard };
}
