// The review display settings: one gear in the header that opens a small settings panel.
//
// Every control writes through `editor.setReviewPaneOptions()` and reads back from
// `snapshot.reviewPane`, so the panel shows what the editor uses, not a copy of it. The
// settings are view state of this editor: nothing is written into the document. The panel
// keeps the choice in this browser's storage, and `storedReviewPane()` hands it to
// `reviewModule({ pane })` so the next visit starts with it.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useDocxEditor, useEditorState } from '@docx-editor.dev/react';
import {
  DEFAULT_REVIEW_PANE,
  resolveReviewPane,
  type ResolvedReviewPane,
  type ReviewPaneOptions,
} from '@docx-editor.dev/core/editor';
import { exampleText as t, type ExampleTextKey } from '../../shared/example-text';
import { DemoHeaderButton } from './DemoHeaderButton';
import './review-settings.css';

const STORAGE_KEY = 'docx-editor-demo.review-pane';

/** The saved settings, validated, or `undefined` when none are saved or they are not valid. */
export function storedReviewPane(): ReviewPaneOptions | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return undefined;
    const source = parsed as Record<string, unknown>;
    const options: Record<string, unknown> = {};
    // Copy the known fields only: a stale or edited entry must not reach the editor.
    for (const key of Object.keys(DEFAULT_REVIEW_PANE)) {
      if (Object.hasOwn(source, key)) options[key] = source[key];
    }
    return resolveReviewPane(options as ReviewPaneOptions);
  } catch {
    return undefined;
  }
}

function saveReviewPane(pane: ResolvedReviewPane | null): void {
  try {
    if (pane) localStorage.setItem(STORAGE_KEY, JSON.stringify(pane));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage can be off (private window, blocked site data). The setting still applies.
  }
}

type Field = keyof ResolvedReviewPane;

interface Group<F extends Field> {
  readonly field: F;
  readonly label: ExampleTextKey;
  readonly options: readonly {
    readonly value: ResolvedReviewPane[F];
    readonly label: ExampleTextKey;
    readonly help?: ExampleTextKey;
    readonly preview?: ReactNode;
  }[];
  readonly help?: ExampleTextKey;
}

const GROUPS: readonly Group<Field>[] = [
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
      {
        value: 'initials',
        label: 'reviewSettings.commentMarkers.initials',
        preview: (
          <span className="demo-settings__badge" aria-hidden="true">
            AB
          </span>
        ),
      },
      {
        value: 'icon',
        label: 'reviewSettings.commentMarkers.icon',
        preview: <CommentIcon />,
      },
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

export function ReviewSettings() {
  const editor = useDocxEditor();
  const pane = useEditorState((snapshot) => snapshot.reviewPane);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const id = useId();
  const titleId = `${id}-title`;
  const panelId = `${id}-panel`;

  // A new editor instance starts from the module's settings; give it the saved ones too.
  useEffect(() => {
    const saved = storedReviewPane();
    if (editor && saved) editor.setReviewPaneOptions(saved);
  }, [editor]);

  // Opening moves focus to the first group's selected option.
  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLInputElement>('input:checked')?.focus();
  }, [open]);

  // Escape closes and returns focus to the gear; a press outside the panel closes it.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    const onDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  const apply = (options: ReviewPaneOptions | ResolvedReviewPane, save: boolean) => {
    if (!editor) return;
    editor.setReviewPaneOptions(options);
    saveReviewPane(save ? editor.snapshot().reviewPane : null);
  };

  return (
    <div className="demo-settings" ref={rootRef}>
      <DemoHeaderButton
        ref={triggerRef}
        className="demo-settings__trigger"
        aria-label={t('reviewSettings.open')}
        title={t('reviewSettings.open')}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        disabled={!editor}
        style={{ display: 'inline-flex', alignItems: 'center', padding: '6px 8px' }}
        onClick={() => setOpen((value) => !value)}
      >
        <GearIcon />
      </DemoHeaderButton>
      {open ? (
        <section
          ref={panelRef}
          id={panelId}
          className="demo-settings__panel"
          role="dialog"
          aria-labelledby={titleId}
        >
          <header className="demo-settings__header">
            <div>
              <h2 id={titleId}>{t('reviewSettings.title')}</h2>
              <p>{t('reviewSettings.subtitle')}</p>
            </div>
            <button
              type="button"
              className="demo-settings__close"
              aria-label={t('reviewSettings.close')}
              onClick={() => {
                setOpen(false);
                triggerRef.current?.focus();
              }}
            >
              <CloseIcon />
            </button>
          </header>
          <div className="demo-settings__body">
            {GROUPS.map((group) => {
              const current = pane[group.field];
              const help =
                group.options.find((option) => option.value === current)?.help ?? group.help;
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
                          onChange={() => apply({ [group.field]: option.value }, true)}
                        />
                        <span>
                          {option.preview}
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
          </div>
          <footer className="demo-settings__footer">
            <button
              type="button"
              className="demo-settings__reset"
              onClick={() => apply(DEFAULT_REVIEW_PANE, false)}
            >
              {t('reviewSettings.reset')}
            </button>
          </footer>
        </section>
      ) : null}
    </div>
  );
}

const svg = (children: ReactNode, size = 16) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

function GearIcon() {
  return svg(
    <>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </>
  );
}

function CloseIcon() {
  return svg(<path d="M18 6 6 18M6 6l12 12" />);
}

function CommentIcon() {
  return svg(<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />, 14);
}
