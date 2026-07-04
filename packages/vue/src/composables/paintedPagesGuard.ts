interface PaintTicket {
  documentEpoch: number;
  paintEpoch: number;
}

export interface PaintedPagesGuard {
  noteDocumentChange: () => void;
  startPaint: () => PaintTicket;
  finishPaint: (ticket: PaintTicket) => void;
  abandonPaint: (ticket: PaintTicket) => void;
  requestOverlayRefresh: () => void;
  pagesAreCurrent: () => boolean;
  dispose: () => void;
}

/**
 * Prevents overlay geometry reads while the visible page DOM trails the PM
 * document. Paint tickets also stop an overtaken pass from releasing work.
 *
 * This is adapter-private coordination; it deliberately does not live in core.
 */
export function createPaintedPagesGuard(refreshOverlays: () => void): PaintedPagesGuard {
  let documentEpoch = 0;
  let newestPaintEpoch = 0;
  let paintedDocumentEpoch: number | null = null;
  let disposed = false;

  const pagesAreCurrent = () => paintedDocumentEpoch === documentEpoch;

  return {
    noteDocumentChange() {
      if (disposed) return;
      documentEpoch++;
      paintedDocumentEpoch = null;
    },

    startPaint() {
      newestPaintEpoch++;
      paintedDocumentEpoch = null;
      return { documentEpoch, paintEpoch: newestPaintEpoch };
    },

    finishPaint(ticket) {
      if (
        disposed ||
        ticket.paintEpoch !== newestPaintEpoch ||
        ticket.documentEpoch !== documentEpoch
      ) {
        return;
      }

      paintedDocumentEpoch = documentEpoch;
      refreshOverlays();
    },

    abandonPaint(_ticket) {
      // A failed pass must leave pages stale and retained work untouched.
    },

    requestOverlayRefresh() {
      if (disposed) return;
      if (pagesAreCurrent()) {
        refreshOverlays();
      }
    },

    pagesAreCurrent,

    dispose() {
      disposed = true;
      paintedDocumentEpoch = null;
    },
  };
}
