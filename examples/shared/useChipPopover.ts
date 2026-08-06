// A card that hangs off a painted content control, positioned by the browser.
//
// `anchor-name` goes on the chip once and CSS names it with `position-anchor`, so nothing here
// measures anything and the card follows its chip through scroll, resize and reflow. The card is
// a `popover`, so it renders in the top layer: no z-index, and the page cannot clip it.

import { useCallback, useEffect, useRef } from 'react';

/** The name CSS anchors to. One card at a time, so one name is enough. */
export const CHIP_ANCHOR = '--docx-chip';

/** How long to wait for a repainted chip before treating the control as gone, in ms. */
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
 * Shows a card anchored to the control `controlId` names, and closes it on a press anywhere that
 * is not the card or a chip, or on Escape. Pass `controlId: undefined` to close.
 *
 * `popover="manual"`, so dismissal is written here. Light dismiss treats a press on the chip as
 * a press outside, and a chip press is what opens the card — it exempts a popover's invoker, and
 * the invoker here is a box the engine paints rather than a button this code hands over.
 */
export function useChipPopover<T extends HTMLElement>(
  controlId: string | undefined,
  onClose: () => void
): ChipPopover<T> {
  const cardRef = useRef<T | null>(null);
  // Read inside the effects, so an inline arrow does not re-run them every render.
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
    // Re-authoring a control publishes a new id, and the engine repaints on its own schedule
    // rather than inside the React commit that handed it over — so the chip may not exist yet.
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
      // The one imperative line, and it carries no geometry.
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
    // Capture: the painted surface cancels its own pointer handling, so a bubbling listener
    // never hears a press on the page.
    const onDown = (event: Event): void => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      // A press on a chip is the next card opening.
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
