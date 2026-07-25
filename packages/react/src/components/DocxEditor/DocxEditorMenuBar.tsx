// Legacy menu region (interactive-paginated-editing M6V.1, React only).
//
// The legacy chrome carried a menu row above the formatting pill. Every item is
// present for visual parity and permanently disabled with a localized reason: M6V.1
// permits only undo, redo, bold, italic and save to act, and none of those is a menu.
//
// The menu names come from `LEGACY_CHROME_MENUS` in engine-editor so the adapter holds
// i18n keys only and never a hardcoded English string.

import type { ReactNode } from 'react';
import { LEGACY_CHROME_MENUS, LEGACY_CHROME_UNAVAILABLE_KEY } from '@docx-editor.dev/engine-editor';
import type { Translate } from './DocxEditorToolbar';

export interface DocxEditorMenuBarProps {
  /** Resolves i18n keys. The adapter ships no English of its own. */
  readonly t: Translate;
}

/**
 * The menu row. Rendered as real disabled buttons rather than plain text so that
 * assistive technology reports them as unavailable controls, which is what they are.
 */
export function DocxEditorMenuBar({ t }: DocxEditorMenuBarProps): ReactNode {
  const unavailable = t(LEGACY_CHROME_UNAVAILABLE_KEY);
  return (
    <div className="flex flex-shrink-0 items-center gap-0.5 pt-0.5" role="menubar" aria-label={t('toolbar.ariaLabel')} data-testid="menu-bar">
      {LEGACY_CHROME_MENUS.map((menu) => {
        const label = t(menu.labelKey);
        const reason = `${label} — ${unavailable}`;
        return (
          <button
            key={menu.id}
            type="button"
            role="menuitem"
            className="cursor-default rounded px-2 py-0.5 text-[13px] text-muted-foreground"
            data-testid={`menu-${menu.id}`}
            data-parity-only="true"
            disabled
            title={reason}
            aria-label={reason}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
