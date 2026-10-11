// The review settings panel's model, shared by the React and Vue examples: the example's
// starting settings, their saved copy in this browser, and the choices the panel offers.
//
// Every choice writes through `editor.setReviewPaneOptions()` and the panels read back from
// `snapshot.reviewPane`. The settings are view state of the editor: nothing is written into
// the document.
import {
  DEFAULT_REVIEW_PANE,
  resolveReviewPane,
  type ResolvedReviewPane,
  type ReviewPaneOptions,
} from '@docx-editor.dev/core/editor';
import type { ExampleTextKey } from './example-text';

const STORAGE_KEY = 'docx-editor-demo.review-pane';

/**
 * The examples' own starting settings: the pane stays closed, so comments show as initials
 * markers in the margin until the reader opens one, and tracked changes open in tracked change balloons.
 * The library defaults open the pane, list changes in it, and draw comment icons.
 */
export const EXAMPLE_REVIEW_PANE: ResolvedReviewPane = resolveReviewPane({
  opening: 'manual',
  revisionsIn: 'balloons',
  commentMarkers: 'initials',
});

/** The saved settings over the example's defaults. Invalid saved settings are ignored. */
export function storedReviewPane(): ResolvedReviewPane {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EXAMPLE_REVIEW_PANE;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return EXAMPLE_REVIEW_PANE;
    const source = parsed as Record<string, unknown>;
    const options: Record<string, unknown> = {};
    // Copy the known fields only: a stale or edited entry must not reach the editor.
    for (const key of Object.keys(DEFAULT_REVIEW_PANE)) {
      if (Object.hasOwn(source, key)) options[key] = source[key];
    }
    return resolveReviewPane(options as ReviewPaneOptions, EXAMPLE_REVIEW_PANE);
  } catch {
    return EXAMPLE_REVIEW_PANE;
  }
}

/** Save the settings in force, or forget them with `null`. */
export function saveReviewPane(pane: ResolvedReviewPane | null): void {
  try {
    if (pane) localStorage.setItem(STORAGE_KEY, JSON.stringify(pane));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage can be off (private window, blocked site data). The setting still applies.
  }
}

export type ReviewSettingsField = keyof ResolvedReviewPane;

/** A small picture beside an option's label, drawn by each framework's panel. */
export type ReviewSettingsPreview = 'initials' | 'icon';

export interface ReviewSettingsGroup<F extends ReviewSettingsField = ReviewSettingsField> {
  readonly field: F;
  readonly label: ExampleTextKey;
  readonly options: readonly {
    readonly value: ResolvedReviewPane[F];
    readonly label: ExampleTextKey;
    readonly help?: ExampleTextKey;
    readonly preview?: ReviewSettingsPreview;
  }[];
  readonly help?: ExampleTextKey;
}

export const REVIEW_SETTINGS_GROUPS: readonly ReviewSettingsGroup[] = [
  {
    field: 'revisionsIn',
    label: 'reviewSettings.revisionsIn',
    help: 'reviewSettings.revisionsInHelp',
    options: [
      { value: 'pane', label: 'reviewSettings.revisionsIn.pane' },
      { value: 'balloons', label: 'reviewSettings.revisionsIn.balloons' },
    ],
  },
  {
    field: 'commentMarkers',
    label: 'reviewSettings.commentMarkers',
    help: 'reviewSettings.commentMarkersHelp',
    options: [
      { value: 'initials', label: 'reviewSettings.commentMarkers.initials', preview: 'initials' },
      { value: 'icon', label: 'reviewSettings.commentMarkers.icon', preview: 'icon' },
    ],
  },
  {
    field: 'opening',
    label: 'reviewSettings.opening',
    help: 'reviewSettings.openingHelp',
    options: [
      { value: 'auto', label: 'reviewSettings.opening.auto' },
      { value: 'manual', label: 'reviewSettings.opening.manual' },
    ],
  },
  {
    field: 'overflow',
    label: 'reviewSettings.overflow',
    options: [
      {
        value: 'float',
        label: 'reviewSettings.overflow.float',
        help: 'reviewSettings.overflowHelp.float',
      },
      {
        value: 'shrinkPage',
        label: 'reviewSettings.overflow.shrinkPage',
        help: 'reviewSettings.overflowHelp.shrinkPage',
      },
      {
        value: 'scroll',
        label: 'reviewSettings.overflow.scroll',
        help: 'reviewSettings.overflowHelp.scroll',
      },
    ],
  },
];

/** The help text for a group under its current value. */
export function reviewSettingsHelp(
  group: ReviewSettingsGroup,
  current: ResolvedReviewPane[ReviewSettingsField]
): ExampleTextKey | undefined {
  return group.options.find((option) => option.value === current)?.help ?? group.help;
}
