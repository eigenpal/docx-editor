// Review pane settings: how the pane beside the page behaves.
//
// ONE home for every pane setting. They are view state of one editor instance: never saved
// into the document, never shared with other participants, and never read by an exporter.
// That is why they live here and not in `RevisionMarkupOptions` (which the exporters read)
// or in `ZoomMode` (which knows nothing about review). The review module supplies the
// initial values, `setReviewPaneOptions` changes them at runtime, and `snapshot.reviewPane` reads
// them, so a toggle in host chrome re-renders like any other control.

/**
 * When the review pane opens by itself.
 *
 * - `'auto'`: the pane opens when a document with review items loads, and when a tracked
 *   change is made while it is closed.
 * - `'manual'`: the pane stays closed until the host or the user opens it. Use it when the
 *   host shows review items its own way, such as in balloons or margin markers.
 *
 * @public
 */
export type ReviewPaneOpening = 'auto' | 'manual';

/**
 * What the open review pane does when its full card column does not fit beside the page at
 * the page's zoom.
 *
 * - `'float'`: the pane shrinks to a strip of markers, and the open card floats over the
 *   page.
 * - `'shrinkPage'`: under a fit zoom mode, the page may shrink down to the mode's
 *   `minZoom` (or 10%) so that the full column fits. The pane changes to the marker strip
 *   only when the column does not fit at that floor either. A fixed zoom behaves as
 *   `'float'`.
 *
 * @public
 */
export type ReviewPaneOverflow = 'float' | 'shrinkPage';

/**
 * Review pane settings to change. Every field is optional, and an omitted field keeps its
 * current value.
 *
 * @public
 */
export interface ReviewPaneOptions {
  /** Default `'auto'`. */
  readonly opening?: ReviewPaneOpening;
  /** Default `'float'`. */
  readonly overflow?: ReviewPaneOverflow;
}

/**
 * The review pane settings in force, with every field resolved.
 *
 * @public
 */
export interface ResolvedReviewPane {
  /** When the pane opens by itself. */
  readonly opening: ReviewPaneOpening;
  /** What the open pane does when its card column does not fit beside the page. */
  readonly overflow: ReviewPaneOverflow;
}

/** The settings an editor starts with when nothing sets them. @public */
export const DEFAULT_REVIEW_PANE: ResolvedReviewPane = Object.freeze({
  opening: 'auto',
  overflow: 'float',
});

const ALLOWED: { readonly [K in keyof ResolvedReviewPane]: readonly string[] } = {
  opening: ['auto', 'manual'],
  overflow: ['float', 'shrinkPage'],
};

/**
 * Merge `options` over `base`. Throws a `TypeError` for an unknown field or value, so a
 * misspelled setting fails loudly instead of being ignored. Returns `base` itself when
 * nothing changes, so the snapshot keeps its reference.
 *
 * @public
 */
export function resolveReviewPane(
  options: ReviewPaneOptions | undefined,
  base: ResolvedReviewPane = DEFAULT_REVIEW_PANE
): ResolvedReviewPane {
  if (options === undefined) return base;
  if (options === null || typeof options !== 'object') {
    throw new TypeError('review pane settings must be an object');
  }
  let next = base;
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined) continue;
    if (!Object.hasOwn(ALLOWED, key)) throw new TypeError(`unknown review pane setting ${key}`);
    const field = key as keyof ResolvedReviewPane;
    if (typeof value !== 'string' || !ALLOWED[field].includes(value)) {
      throw new TypeError(`review pane ${field} must be ${ALLOWED[field].join(' or ')}`);
    }
    if (next[field] !== value) next = { ...next, [field]: value };
  }
  return next === base ? base : Object.freeze(next);
}
