/**
 * Single-row renderer for a keyboard shortcut inside the dialog, plus the
 * platform-aware key formatter (Ctrl→⌘ on Mac). The formatter is exposed
 * as `formatShortcutKeys` for callers that render kbd badges outside the
 * dialog.
 */

import React from 'react';
import type { KeyboardShortcut } from '../KeyboardShortcutsDialog';

/**
 * Detect if running on Mac
 */
function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
}

/**
 * Format key combination for current platform
 */
export function formatKeys(keys: string): string {
  if (isMac()) {
    return keys
      .replace(/Ctrl\+/g, '⌘')
      .replace(/Alt\+/g, '⌥')
      .replace(/Shift\+/g, '⇧');
  }
  return keys;
}

interface ShortcutItemProps {
  shortcut: KeyboardShortcut;
  translatedName: string;
  translatedDescription: string;
}

export const ShortcutItem: React.FC<ShortcutItemProps> = ({
  shortcut,
  translatedName,
  translatedDescription,
}) => {
  const formattedKeys = formatKeys(shortcut.keys);
  const formattedAltKeys = shortcut.altKeys ? formatKeys(shortcut.altKeys) : null;

  return (
    <div
      className="docx-shortcut-item"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 0',
        borderBottom: '1px solid var(--doc-border-light)',
      }}
    >
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontSize: '13px',
            fontWeight: 500,
            color: 'var(--doc-text)',
          }}
        >
          {translatedName}
        </div>
        <div
          style={{
            fontSize: '11px',
            color: 'var(--doc-text-muted)',
            marginTop: '2px',
          }}
        >
          {translatedDescription}
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          gap: '8px',
          alignItems: 'center',
        }}
      >
        <kbd
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '4px 8px',
            fontSize: '12px',
            fontFamily: 'monospace',
            color: 'var(--doc-text)',
            backgroundColor: 'var(--doc-bg-hover)',
            borderRadius: '4px',
            border: '1px solid var(--doc-border-light)',
            boxShadow: '0 1px 1px var(--doc-shadow)',
          }}
        >
          {formattedKeys}
        </kbd>
        {formattedAltKeys && (
          <>
            <span style={{ color: 'var(--doc-text-subtle)', fontSize: '11px' }}>or</span>
            <kbd
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '4px 8px',
                fontSize: '12px',
                fontFamily: 'monospace',
                color: 'var(--doc-text)',
                backgroundColor: 'var(--doc-bg-hover)',
                borderRadius: '4px',
                border: '1px solid var(--doc-border-light)',
                boxShadow: '0 1px 1px var(--doc-shadow)',
              }}
            >
              {formattedAltKeys}
            </kbd>
          </>
        )}
      </div>
    </div>
  );
};
