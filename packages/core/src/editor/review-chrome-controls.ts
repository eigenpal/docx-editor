import { GENERATED_ICON_PATHS } from './generated-icon-paths.ts';

/** Shared review controls for the React and Vue formatting bars. */
export const REVIEW_CHROME_GROUP = {
  id: 'review',
  labelKey: 'formattingBar.commentsAndChanges',
  controls: [
    {
      id: 'allMarkup',
      shape: 'icon',
      labelKey: 'review.allMarkup',
      defaultToolbar: false,
      paths: GENERATED_ICON_PATHS['visibility'],
      state: { kind: 'command' },
    },
    {
      id: 'noMarkup',
      shape: 'icon',
      labelKey: 'review.noMarkup',
      defaultToolbar: false,
      paths: GENERATED_ICON_PATHS['visibility'],
      state: { kind: 'command' },
    },
    {
      id: 'original',
      shape: 'icon',
      labelKey: 'review.original',
      defaultToolbar: false,
      paths: GENERATED_ICON_PATHS['visibility'],
      state: { kind: 'command' },
    },
    {
      id: 'previousChange',
      shape: 'icon',
      labelKey: 'review.previousChange',
      defaultToolbar: false,
      paths: GENERATED_ICON_PATHS['keyboard_arrow_up'],
      state: { kind: 'command' },
    },
    {
      id: 'nextChange',
      shape: 'icon',
      labelKey: 'review.nextChange',
      defaultToolbar: false,
      paths: GENERATED_ICON_PATHS['keyboard_arrow_down'],
      state: { kind: 'command' },
    },
    {
      id: 'acceptAllChanges',
      shape: 'icon',
      labelKey: 'review.acceptAllChanges',
      defaultToolbar: false,
      paths: GENERATED_ICON_PATHS['check'],
      state: { kind: 'command' },
    },
    {
      id: 'rejectAllChanges',
      shape: 'icon',
      labelKey: 'review.rejectAllChanges',
      defaultToolbar: false,
      paths: GENERATED_ICON_PATHS['close'],
      state: { kind: 'command' },
    },
    {
      id: 'paragraphMarks',
      shape: 'icon',
      labelKey: 'formattingBar.paragraphMarks',
      defaultToolbar: false,
      paths: GENERATED_ICON_PATHS['format_paragraph'],
      state: { kind: 'command' },
    },
    {
      id: 'comments',
      shape: 'icon',
      labelKey: 'formattingBar.commentsAndChanges',
      paths: GENERATED_ICON_PATHS['comment'],
      state: { kind: 'command' },
    },
    {
      // Packaged under Review > Markup Options > Reviewers; hosts may compose a shortcut.
      id: 'authors',
      shape: 'dropdown',
      labelKey: 'reviewers.label',
      paths: GENERATED_ICON_PATHS['visibility'],
      defaultToolbar: false,
      state: { kind: 'command' },
    },
    {
      // The "✎ Editing ▾" mode pill: icon + current-mode label + caret.
      id: 'editingMode',
      shape: 'dropdown',
      labelKey: 'editingMode.label',
      valueKey: 'editingMode.editing',
      paths: GENERATED_ICON_PATHS['edit_note'],
      state: { kind: 'command' },
    },
  ],
} as const;
