// The Export menu of the top bar: DOCX, PDF, or Markdown. The rows and the export itself come
// from `examples/shared/demo-export.ts`, which the Vue example uses too. It is a menu button:
// the arrow keys move between the rows, Escape closes the menu and returns the focus, and a
// press outside closes it.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useDocxEditor, useEditorState } from '@docx-editor.dev/react';
import { exampleText as t } from '../../shared/example-text';
import {
  DEMO_EXPORT_ROWS,
  nextDemoMenuItem,
  runDemoExport,
  type DemoExportFormat,
} from '../../shared/demo-export';
import { DemoIcon } from './DemoIcon';
import { keepCaret } from './demoButtons';

export interface DemoExportMenuProps {
  readonly title: string;
  /** Says what the export is doing, for the status beside the file name. */
  readonly onStatus: (message: string) => void;
}

export function DemoExportMenu({ title, onStatus }: DemoExportMenuProps) {
  const editor = useDocxEditor();
  const opening = useEditorState((snapshot) => snapshot.isOpening === true);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<DemoExportFormat | null>(null);
  // Whether the menu opened from the keyboard, so the first row takes the focus.
  const focusFirst = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return undefined;
    const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    if (focusFirst.current) items?.[0]?.focus();
    else menuRef.current?.focus();
    const doc = rootRef.current?.ownerDocument ?? document;
    const away = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      setOpen(false);
    };
    doc.addEventListener('pointerdown', away, true);
    return () => doc.removeEventListener('pointerdown', away, true);
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  const run = async (format: DemoExportFormat) => {
    close(false);
    if (!editor || busy) return;
    setBusy(format);
    onStatus(t(format === 'docx' ? 'demoExport.saving' : 'demoExport.converting'));
    try {
      await runDemoExport(editor, format, title);
      onStatus(t('demoExport.downloaded'));
    } catch (error) {
      onStatus(error instanceof Error ? error.message : t('demoExport.failed'));
    } finally {
      setBusy(null);
      editor.focus();
    }
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault();
      close(event.key === 'Escape');
      return;
    }
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const index = items.findIndex((item) => item === event.target);
    const next = nextDemoMenuItem(event.key, index, items.length);
    if (next === null) return;
    event.preventDefault();
    items[next]?.focus();
  };

  const label = busy ? t('demoExport.exporting') : t('demoExport.label');
  return (
    <div ref={rootRef} className="demo-menu">
      <button
        ref={triggerRef}
        type="button"
        className="demo-header-action demo-header-action--primary"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        aria-busy={busy !== null}
        disabled={!editor || opening || busy !== null}
        onMouseDown={keepCaret}
        onClick={() => {
          focusFirst.current = false;
          setOpen((was) => !was);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          focusFirst.current = true;
          setOpen(true);
        }}
      >
        <DemoIcon name="save" />
        <span className="demo-header-action__label">{label}</span>
        <span className="demo-header-action__chev">
          <DemoIcon name="chevron" />
        </span>
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={`${id}-menu`}
          className="demo-menu__pop"
          role="menu"
          aria-label={t('demoExport.label')}
          tabIndex={-1}
          onKeyDown={onMenuKeyDown}
        >
          {DEMO_EXPORT_ROWS.map((row) => (
            <button
              key={row.format}
              type="button"
              role="menuitem"
              className="demo-menu__item"
              tabIndex={-1}
              onMouseDown={keepCaret}
              onClick={() => void run(row.format)}
            >
              <span className={`demo-filetype demo-filetype--${row.tone}`} aria-hidden="true">
                {row.badge}
              </span>
              <span className="demo-menu__text">
                <span>{t(row.label)}</span>
                <span className="demo-menu__hint">{t(row.hint)}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
