/**
 * Image Context Menu
 *
 * Right-click menu shown on a rendered image. Mirrors Word's image menu —
 * layout options at the top, then the standard text actions (Cut / Copy /
 * Paste / Delete) below a divider so the user can do everything for the image
 * without flipping menus. All five layout transitions are wired through
 * `setImageWrapType`; the "In Line with Text" option is disabled only when the
 * image is already inline (clicking would no-op).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WrapType } from '@eigenpal/docx-core/docx/wrapTypes';
import type { ImageLayoutTarget } from '@eigenpal/docx-core/prosemirror/commands';
import {
  IMAGE_LAYOUT_OPTIONS,
  deriveLayoutChoice,
  isImageLayoutOptionEnabled,
  type ImageLayoutIconHint,
  type ImageLayoutOptionDef,
} from '@eigenpal/docx-core/layout-painter';
import { Z_INDEX } from '../styles/zIndex';
import { useTranslation } from '../i18n';
import { MaterialSymbol } from './ui/Icons';
import type { TextContextAction } from './TextContextMenu';

type ImageAttrsCssFloat = 'left' | 'right' | 'none' | null;

/** Map core's icon hint vocabulary to React-side Material Symbol names. */
const ICON_BY_HINT: Record<ImageLayoutIconHint, string> = {
  inline: 'wrap_text',
  squareLeft: 'format_image_left',
  squareRight: 'format_image_right',
  behind: 'flip_to_back',
  inFront: 'flip_to_front',
};

export interface ImageContextMenuTextAction {
  action: TextContextAction;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  dividerAfter?: boolean;
}

export interface ImageContextMenuProps {
  isOpen: boolean;
  position: { x: number; y: number };
  /** Current wrap type of the right-clicked image (used for the highlighted
   *  current option). */
  currentWrapType: WrapType;
  /** Current cssFloat of the right-clicked image — disambiguates Square Left
   *  vs Square Right when `currentWrapType` is `square` / `tight` / `through`. */
  currentCssFloat?: ImageAttrsCssFloat;
  /** Called when the user picks a layout choice. Inline transitions are gated
   *  until the structural follow-up — that item is disabled and won't fire. */
  onApplyLayout: (target: ImageLayoutTarget) => void;
  /** Optional text actions appended after the layout section (Cut/Copy/etc). */
  textActions?: ImageContextMenuTextAction[];
  /** Invoked when a text action item is selected. */
  onTextAction?: (action: TextContextAction) => void;
  onClose: () => void;
}

const ICON_SIZE = 18;

export const ImageContextMenu: React.FC<ImageContextMenuProps> = ({
  isOpen,
  position,
  currentWrapType,
  currentCssFloat,
  onApplyLayout,
  textActions,
  onTextAction,
  onClose,
}) => {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  // Map current state to a menu choice for highlighting.
  const currentChoice = useMemo(
    () => deriveLayoutChoice(currentWrapType, currentCssFloat),
    [currentWrapType, currentCssFloat]
  );

  // Keep the navigable index space stable across renders so the keydown effect
  // doesn't rebind its listener on every render.
  const enabledLayout = useMemo(
    () => IMAGE_LAYOUT_OPTIONS.filter((o) => isImageLayoutOptionEnabled(o, currentWrapType)),
    [currentWrapType]
  );
  const navigableTextActions = useMemo(
    () => (textActions ?? []).filter((a) => !a.disabled),
    [textActions]
  );
  const totalNavigable = enabledLayout.length + navigableTextActions.length;

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      const span = Math.max(1, totalNavigable);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightedIndex((i) => (i + 1) % span);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedIndex((i) => (i - 1 + span) % span);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (highlightedIndex < enabledLayout.length) {
          // `inline` is filtered out of `enabledLayout` by `isLayoutOptionEnabled`,
          // so this assertion holds.
          onApplyLayout(enabledLayout[highlightedIndex].choice as ImageLayoutTarget);
          onClose();
        } else if (onTextAction) {
          const ta = navigableTextActions[highlightedIndex - enabledLayout.length];
          if (ta) {
            onTextAction(ta.action);
            onClose();
          }
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [
    isOpen,
    highlightedIndex,
    enabledLayout,
    navigableTextActions,
    totalNavigable,
    onApplyLayout,
    onTextAction,
    onClose,
  ]);

  useEffect(() => {
    if (!isOpen) return;
    const initialIdx = currentChoice
      ? enabledLayout.findIndex((o) => o.choice === currentChoice)
      : -1;
    setHighlightedIndex(initialIdx >= 0 ? initialIdx : 0);
  }, [isOpen, currentChoice, enabledLayout]);

  const getMenuStyle = useCallback((): React.CSSProperties => {
    const menuWidth = 260;
    const layoutRows = IMAGE_LAYOUT_OPTIONS.length;
    const textRows = textActions?.length ?? 0;
    const menuHeight = layoutRows * 36 + textRows * 32 + (textRows > 0 ? 9 : 0) + 16;
    let x = position.x;
    let y = position.y;
    if (typeof window !== 'undefined') {
      if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 10;
      if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 10;
      if (x < 10) x = 10;
      if (y < 10) y = 10;
    }
    return {
      position: 'fixed',
      top: y,
      left: x,
      minWidth: menuWidth,
      background: 'white',
      border: '1px solid var(--doc-border-light, #e0e0e0)',
      borderRadius: '8px',
      boxShadow: '0 2px 10px rgba(0, 0, 0, 0.15)',
      zIndex: Z_INDEX.contextMenu,
      padding: '4px 0',
      overflow: 'hidden',
    };
  }, [position, textActions]);

  if (!isOpen) return null;

  return (
    <div
      ref={menuRef}
      className="docx-image-context-menu"
      style={getMenuStyle()}
      role="menu"
      aria-label={t('imageWrap.menu.ariaLabel')}
      data-testid="image-context-menu"
    >
      {IMAGE_LAYOUT_OPTIONS.map((option: ImageLayoutOptionDef) => {
        const isCurrent = option.choice === currentChoice;
        const isEnabled = isImageLayoutOptionEnabled(option, currentWrapType);
        const navIdx = isEnabled ? enabledLayout.findIndex((o) => o.choice === option.choice) : -1;
        const isHighlighted = navIdx >= 0 && navIdx === highlightedIndex;
        // Always show the descriptive tooltip — disabled options are disabled
        // because they would no-op against the current image.
        const tooltip = t(`imageWrap.menuDesc.${option.i18nDescKey}` as never);
        return (
          <button
            key={option.choice}
            type="button"
            role="menuitem"
            data-wrap-type={option.choice}
            data-current={isCurrent ? 'true' : 'false'}
            data-disabled={!isEnabled ? 'true' : 'false'}
            disabled={!isEnabled}
            onClick={() => {
              if (!isEnabled) return;
              onApplyLayout(option.choice as ImageLayoutTarget);
              onClose();
            }}
            onMouseEnter={() => {
              if (navIdx >= 0) setHighlightedIndex(navIdx);
            }}
            title={tooltip}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              width: '100%',
              padding: '8px 12px',
              border: 'none',
              background: isHighlighted ? 'var(--doc-primary-light, #eef4ff)' : 'transparent',
              cursor: isEnabled ? 'pointer' : 'not-allowed',
              fontSize: '13px',
              color: isEnabled ? 'var(--doc-text, #222)' : 'var(--doc-text-placeholder, #999)',
              textAlign: 'left',
              opacity: isEnabled ? 1 : 0.55,
            }}
          >
            <span
              style={{
                display: 'flex',
                color: isCurrent ? 'var(--doc-primary, #2563eb)' : 'var(--doc-text-muted, #666)',
                width: ICON_SIZE,
              }}
            >
              <MaterialSymbol name={ICON_BY_HINT[option.iconHint]} size={ICON_SIZE} />
            </span>
            <span style={{ flex: 1 }}>{t(`imageWrap.menu.${option.i18nLabelKey}` as never)}</span>
            {isCurrent && (
              <span
                style={{ fontSize: '11px', color: 'var(--doc-primary, #2563eb)' }}
                aria-label={t('toolbar.imageWrap.current' as never)}
              >
                ●
              </span>
            )}
          </button>
        );
      })}

      {textActions && textActions.length > 0 && (
        <>
          <div
            style={{
              height: 1,
              background: 'var(--doc-border-light, #e0e0e0)',
              margin: '4px 0',
            }}
            role="separator"
          />
          {textActions.map((item, idx) => {
            const navIdx = item.disabled
              ? -1
              : enabledLayout.length +
                navigableTextActions.findIndex((a) => a.action === item.action);
            const isHighlighted = navIdx === highlightedIndex && !item.disabled;
            return (
              <React.Fragment key={`${item.action}-${idx}`}>
                <button
                  type="button"
                  role="menuitem"
                  data-action={item.action}
                  data-disabled={item.disabled ? 'true' : 'false'}
                  disabled={item.disabled}
                  onClick={() => {
                    if (item.disabled || !onTextAction) return;
                    onTextAction(item.action);
                    onClose();
                  }}
                  onMouseEnter={() => {
                    if (navIdx >= 0) setHighlightedIndex(navIdx);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    width: '100%',
                    padding: '7px 12px',
                    border: 'none',
                    background: isHighlighted ? 'var(--doc-primary-light, #eef4ff)' : 'transparent',
                    cursor: item.disabled ? 'not-allowed' : 'pointer',
                    fontSize: '13px',
                    color: item.disabled
                      ? 'var(--doc-text-placeholder, #999)'
                      : 'var(--doc-text, #222)',
                    textAlign: 'left',
                    opacity: item.disabled ? 0.55 : 1,
                  }}
                >
                  <span style={{ width: ICON_SIZE }} aria-hidden="true" />
                  <span style={{ flex: 1 }}>{item.label}</span>
                  {item.shortcut && (
                    <span
                      style={{
                        fontSize: '11px',
                        color: 'var(--doc-text-muted, #888)',
                        fontFamily: 'monospace',
                      }}
                    >
                      {item.shortcut}
                    </span>
                  )}
                </button>
                {item.dividerAfter && (
                  <div
                    style={{
                      height: 1,
                      background: 'var(--doc-border-light, #e0e0e0)',
                      margin: '4px 0',
                    }}
                    role="separator"
                  />
                )}
              </React.Fragment>
            );
          })}
        </>
      )}
    </div>
  );
};

export interface UseImageContextMenuReturn {
  isOpen: boolean;
  position: { x: number; y: number };
  currentWrapType: WrapType;
  currentCssFloat: ImageAttrsCssFloat;
  /** PM doc position of the image being edited (for command dispatch). */
  imagePos: number | null;
  /** Captured rendered position of an inline image in EMUs, used by inline →
   *  anchor transitions to seed `wp:positionH/V`. Null for non-inline images. */
  inlinePositionEmu: { horizontalEmu: number; verticalEmu: number } | null;
  /** Open the menu at a specific viewport position for a specific image. */
  openForImage: (opts: {
    x: number;
    y: number;
    wrapType: WrapType;
    cssFloat?: ImageAttrsCssFloat;
    pos: number;
    inlinePositionEmu?: { horizontalEmu: number; verticalEmu: number };
  }) => void;
  closeMenu: () => void;
}

export function useImageContextMenu(): UseImageContextMenuReturn {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [currentWrapType, setCurrentWrapType] = useState<WrapType>('inline');
  const [currentCssFloat, setCurrentCssFloat] = useState<ImageAttrsCssFloat>(null);
  const [imagePos, setImagePos] = useState<number | null>(null);
  const [inlinePositionEmu, setInlinePositionEmu] =
    useState<UseImageContextMenuReturn['inlinePositionEmu']>(null);

  const openForImage = useCallback(
    (opts: {
      x: number;
      y: number;
      wrapType: WrapType;
      cssFloat?: ImageAttrsCssFloat;
      pos: number;
      inlinePositionEmu?: { horizontalEmu: number; verticalEmu: number };
    }) => {
      setPosition({ x: opts.x, y: opts.y });
      setCurrentWrapType(opts.wrapType);
      setCurrentCssFloat(opts.cssFloat ?? null);
      setImagePos(opts.pos);
      setInlinePositionEmu(opts.inlinePositionEmu ?? null);
      setIsOpen(true);
    },
    []
  );

  const closeMenu = useCallback(() => {
    setIsOpen(false);
    setImagePos(null);
    setInlinePositionEmu(null);
  }, []);

  return {
    isOpen,
    position,
    currentWrapType,
    currentCssFloat,
    imagePos,
    inlinePositionEmu,
    openForImage,
    closeMenu,
  };
}
