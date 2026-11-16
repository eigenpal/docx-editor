// The Settings tab of the side panel: the theme, the interface language, and how comments and
// tracked changes appear.
//
// The model (starting settings, saved copy, and the choices) lives in
// `examples/shared/review-settings.ts`, which the Vue example uses too. Every review control
// writes through `editor.setReviewPaneOptions()` and reads back from `snapshot.reviewPane`, so
// the tab shows what the editor uses, not a copy of it.
import { useEffect, useId, type ReactNode } from 'react';
import { useDocxEditor, useEditorState } from '@docx-editor.dev/react';
import type { ResolvedReviewPane, ReviewPaneOptions } from '@docx-editor.dev/core/editor';
import { exampleText as t } from '../../shared/example-text';
import {
  EXAMPLE_REVIEW_PANE,
  REVIEW_SETTINGS_GROUPS,
  reviewSettingsHelp,
  saveReviewPane,
  storedReviewPane,
  type ReviewSettingsPreview,
} from '../../shared/review-settings';
import { DEMO_LANGUAGES, demoLanguage, switchDemoLanguage } from '../../shared/demo-language';
import type { LocaleCode } from '@docx-editor.dev/i18n';
import '../../shared/review-settings.css';
import { DemoIcon } from './DemoIcon';

export { EXAMPLE_REVIEW_PANE, storedReviewPane };

const PREVIEWS: Record<ReviewSettingsPreview, ReactNode> = {
  initials: (
    <span className="demo-settings__badge" aria-hidden="true">
      AB
    </span>
  ),
  icon: <CommentIcon />,
};

/**
 * Give each new editor instance the saved review settings. A collaboration session builds a
 * new instance, which starts from the module's settings. Mount it once, under the Root.
 */
export function useStoredReviewPane(): void {
  const editor = useDocxEditor();
  useEffect(() => {
    if (editor) editor.setReviewPaneOptions(storedReviewPane());
  }, [editor]);
}

export interface ReviewSettingsProps {
  readonly colorMode: 'light' | 'dark';
  readonly onColorModeChange: (next: 'light' | 'dark') => void;
  /** Whether the rulers show. */
  readonly rulers: boolean;
  readonly onRulersChange: (show: boolean) => void;
}

/** The settings of the demo, as the body of the Settings tab. */
export function ReviewSettings({
  colorMode,
  onColorModeChange,
  rulers,
  onRulersChange,
}: ReviewSettingsProps) {
  const editor = useDocxEditor();
  const pane = useEditorState((snapshot) => snapshot.reviewPane);
  const id = useId();

  const apply = (options: ReviewPaneOptions | ResolvedReviewPane, save: boolean) => {
    if (!editor) return;
    editor.setReviewPaneOptions(options);
    saveReviewPane(save ? editor.snapshot().reviewPane : null);
  };

  return (
    <div className="demo-settings__body">
      <fieldset className="demo-settings__group">
        <legend>{t('demoPanel.theme')}</legend>
        <div className="demo-settings__segments" data-count={2}>
          {(['light', 'dark'] as const).map((mode) => (
            <label key={mode} className="demo-settings__segment">
              <input
                type="radio"
                name={`${id}-theme`}
                value={mode}
                checked={colorMode === mode}
                onChange={() => onColorModeChange(mode)}
              />
              <span>
                <DemoIcon name={mode === 'light' ? 'sun' : 'moon'} />
                {t(`demoPanel.theme.${mode}`)}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="demo-settings__group">
        <legend>{t('demoPanel.view')}</legend>
        <label className="demo-settings__switch">
          <span>{t('demoPanel.rulers')}</span>
          <input
            type="checkbox"
            checked={rulers}
            onChange={(event) => onRulersChange(event.target.checked)}
          />
        </label>
      </fieldset>
      <div className="demo-settings__group">
        <label className="demo-settings__label" htmlFor={`${id}-language`}>
          {t('reviewSettings.language')}
        </label>
        <select
          id={`${id}-language`}
          className="demo-settings__select"
          value={demoLanguage()}
          aria-describedby={`${id}-language-help`}
          onChange={(event) => switchDemoLanguage(event.target.value as LocaleCode)}
        >
          {DEMO_LANGUAGES.map((language) => (
            <option key={language.code} value={language.code} lang={language.code}>
              {language.name}
            </option>
          ))}
        </select>
        <p id={`${id}-language-help`} className="demo-settings__help">
          {t('reviewSettings.languageHelp')}
        </p>
      </div>
      {REVIEW_SETTINGS_GROUPS.map((group) => {
        const current = pane[group.field];
        const help = reviewSettingsHelp(group, current);
        const helpId = `${id}-${group.field}-help`;
        return (
          <fieldset
            key={group.field}
            className="demo-settings__group"
            aria-describedby={help ? helpId : undefined}
          >
            <legend>{t(group.label)}</legend>
            <div className="demo-settings__segments" data-count={group.options.length}>
              {group.options.map((option) => (
                <label key={option.value} className="demo-settings__segment">
                  <input
                    type="radio"
                    name={`${id}-${group.field}`}
                    value={option.value}
                    checked={current === option.value}
                    disabled={!editor}
                    onChange={() => apply({ [group.field]: option.value }, true)}
                  />
                  <span>
                    {option.preview ? PREVIEWS[option.preview] : null}
                    {t(option.label)}
                  </span>
                </label>
              ))}
            </div>
            {help ? (
              <p id={helpId} className="demo-settings__help">
                {t(help)}
              </p>
            ) : null}
          </fieldset>
        );
      })}
      <button
        type="button"
        className="demo-settings__reset"
        disabled={!editor}
        onClick={() => apply(EXAMPLE_REVIEW_PANE, false)}
      >
        {t('reviewSettings.reset')}
      </button>
    </div>
  );
}

function CommentIcon() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
