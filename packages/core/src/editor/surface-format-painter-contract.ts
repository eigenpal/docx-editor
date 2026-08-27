// Format painter contract types (paginated-surface seam).
//
// Split from `paginated-surface-contract.ts` the way the content-control ops are, so the
// surface contract names the lane and this file describes it. The CAPTURE itself never
// appears here: what a host needs is whether something is held and at which level, and
// publishing the OOXML property bags would make an internal vocabulary part of the surface
// contract that hosts then program against.

/**
 * How long the painter stays armed.
 *
 * Word's two gestures, named: a single press arms it for ONE application, a double press
 * locks it on until the user presses `Esc`. `'off'` is the resting state.
 */
export type FormatPainterMode = 'off' | 'once' | 'locked';

/**
 * The refusal an apply gets before anything has been copied.
 *
 * A constant rather than a literal at each site, because THREE lanes state it — `can`, the
 * exec dispatch, and the toolbar's enabled state — and the i18n catalogue keys the localized
 * sentence on this exact English (`DISABLED_REASON_KEYS`). A paraphrase in one of them is a
 * refusal that reaches every locale raw.
 */
export const NO_COPIED_FORMATTING = 'no formatting has been copied';

/**
 * What a capture carries.
 *
 * `'run'` is character formatting alone — the level a range INSIDE one paragraph copies.
 * `'paragraph'` adds the paragraph style and its direct paragraph properties, which is what
 * a selection covering a paragraph mark copies. `'none'` means nothing has been captured.
 */
export type FormatPainterLevel = 'none' | 'run' | 'paragraph';

/**
 * Painter state, as the surface publishes it.
 *
 * Surface chrome rather than document bytes, so it moves through the same `onChange` report
 * every other observable surface state uses — a toolbar's pressed state has one source.
 */
export interface FormatPainterSurfaceState {
  readonly mode: FormatPainterMode;
  readonly level: FormatPainterLevel;
}

/** Word's Format Painter over the surface. */
export interface FormatPainterOps {
  state(): FormatPainterSurfaceState;
  /**
   * Capture the formatting at the selection. False when the selection resolves to no span
   * the layout has published yet — there is nothing to read.
   */
  capture(): boolean;
  /**
   * Paint the captured formatting over the current selection. False when nothing is
   * captured, when the document refuses the write, or when the selection covers nothing the
   * write can reach.
   */
  apply(): boolean;
  /**
   * One press of the painter control, with Word's meaning.
   *
   * A press while the painter is off captures and arms it for a single application. A press
   * that lands within the double-press window locks it on. A press while it is armed and
   * outside that window turns it off.
   *
   * The double-press window is the ENGINE's, deliberately: the alternative is each adapter
   * binding its own `dblclick` beside its own `click`, which is two hosts deciding
   * separately what a double-click means and drifting the moment one of them changes.
   */
  press(): void;
  /** Turn the painter off, keeping the capture. `Esc` and a finished single application. */
  disarm(): void;
}
