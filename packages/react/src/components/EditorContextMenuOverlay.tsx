import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EditorView } from 'prosemirror-view';
import { TextSelection } from 'prosemirror-state';
import type { RenderedDomContext } from '../plugin-api/types';
import type { ColorValue } from '@eigenpal/docx-core/types/document';
import {
  TextContextMenu,
  getDefaultTextContextMenuItems,
  type TextContextMenuItem,
  type TextContextAction,
} from './TextContextMenu';
import { getHighlightColors, getTextColors } from './ui/ColorPicker';
import { mapHexToHighlightName } from './toolbarUtils';
import { useColorHistory } from './ColorHistoryContext';
import {
  spellcheckPluginKey,
  closeSpellcheckMenu,
  ignoreMisspelling,
  addWordToDictionary,
  type SpellcheckMenuState,
  type SpellcheckMisspelling,
} from '../plugins/spellcheck/prosemirror-plugin';
import { setTextColor, clearTextColor, setHighlight } from '@eigenpal/docx-core/prosemirror';
import { clickToPositionDom } from '@eigenpal/docx-core/layout-bridge/clickToPositionDom';

export interface EditorContextMenuOverlayProps {
  renderedDomContext: RenderedDomContext | null;
  editorView: EditorView | null;
  spellcheckState?: {
    misspellings: SpellcheckMisspelling[];
    menu: SpellcheckMenuState | null;
  } | null;
}

const MENU_PADDING = 4;

function slugifyLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function normalizeTextColorValue(value: ColorValue | string): string {
  if (typeof value === 'string') return value;
  if (value.auto) return 'auto';
  if (value.rgb) return `#${value.rgb}`;
  return 'auto';
}

function normalizeHexValue(value: string): string {
  return value.replace(/^#/, '').toUpperCase();
}

function normalizeHighlightValue(value: string | undefined): string {
  if (!value) return 'none';
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'none') return 'none';
  if (/^[0-9A-Fa-f]{6}$/.test(trimmed) || /^#[0-9A-Fa-f]{6}$/.test(trimmed)) {
    return normalizeHexValue(trimmed);
  }
  return trimmed;
}

const ColorSwatchIcon: React.FC<{ color: string; label?: string }> = ({ color, label }) => (
  <span
    style={{
      width: 14,
      height: 14,
      borderRadius: 3,
      border: '1px solid var(--doc-border, rgba(15, 23, 42, 0.18))',
      backgroundColor: color,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 9,
      fontWeight: 600,
      color: 'var(--doc-text-subtle)',
      textTransform: 'uppercase',
    }}
  >
    {label}
  </span>
);

export const EditorContextMenuOverlay: React.FC<EditorContextMenuOverlayProps> = ({
  renderedDomContext,
  editorView,
  spellcheckState,
}) => {
  const { lastTextColor, lastHighlightColor, setLastTextColor, setLastHighlightColor } =
    useColorHistory();

  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [minY, setMinY] = useState<number | undefined>(undefined);
  const [hasSelection, setHasSelection] = useState(false);
  const [selectionRange, setSelectionRange] = useState<{ from: number; to: number } | null>(null);
  const selectionRangeRef = useRef<{ from: number; to: number } | null>(null);
  const [activeMisspelling, setActiveMisspelling] = useState<SpellcheckMisspelling | null>(null);

  const baseItems = useMemo(() => getDefaultTextContextMenuItems(), []);

  const lastTextColorValue = useMemo(
    () => normalizeTextColorValue(lastTextColor),
    [lastTextColor]
  );

  const lastHighlightColorValue = useMemo(
    () => normalizeHighlightValue(lastHighlightColor),
    [lastHighlightColor]
  );

  const textColorPickerValue = useMemo(() => {
    if (lastTextColorValue === 'auto') return '#000000';
    if (/^#[0-9A-Fa-f]{6}$/.test(lastTextColorValue)) return lastTextColorValue;
    if (/^[0-9A-Fa-f]{6}$/.test(lastTextColorValue)) return `#${lastTextColorValue}`;
    return '#000000';
  }, [lastTextColorValue]);

  const highlightColorPickerValue = useMemo(() => {
    if (lastHighlightColorValue === 'none') return '#ffff00';
    if (/^#[0-9A-Fa-f]{6}$/.test(lastHighlightColorValue)) return lastHighlightColorValue;
    if (/^[0-9A-Fa-f]{6}$/.test(lastHighlightColorValue)) return `#${lastHighlightColorValue}`;
    const match = getHighlightColors().find(
      (color) => color.name.toLowerCase() === lastHighlightColorValue.toLowerCase()
    );
    if (match?.hex) return `#${match.hex}`;
    return '#ffff00';
  }, [lastHighlightColorValue]);

  const textColorSubmenu = useMemo<TextContextMenuItem[]>(() => {
    const items: TextContextMenuItem[] = [
      {
        action: 'textColor',
        label: 'Automatic',
        value: 'auto',
        swatch: 'auto',
        testId: 'context-textColor-swatch-automatic',
      },
    ];
    getTextColors().forEach((color) => {
      const slug = slugifyLabel(color.name);
      items.push({
        action: 'textColor',
        label: color.name,
        value: `#${color.hex}`,
        swatch: `#${color.hex}`,
        testId: `context-textColor-swatch-${slug}`,
      });
    });
    items.push({
      action: 'textColor',
      label: 'Custom color',
      isColorPicker: true,
      testId: 'context-textColor-picker',
      value: textColorPickerValue,
    });
    return items;
  }, [textColorPickerValue]);

  const highlightColorSubmenu = useMemo<TextContextMenuItem[]>(() => {
    const items = getHighlightColors().map((color) => {
      const slug = slugifyLabel(color.name);
      return {
        action: 'highlightColor',
        label: color.name,
        value: color.hex ? `#${color.hex}` : 'none',
        swatch: color.hex ? `#${color.hex}` : 'none',
        testId: `context-highlightColor-swatch-${slug}`,
      } as TextContextMenuItem;
    });
    items.push({
      action: 'highlightColor',
      label: 'Custom highlight',
      isColorPicker: true,
      testId: 'context-highlightColor-picker',
      value: highlightColorPickerValue,
    });
    return items;
  }, [highlightColorPickerValue]);

  const resolvedTextSwatch = useMemo(() => {
    if (lastTextColorValue === 'auto') {
      return { color: '#ffffff', label: 'A' };
    }
    if (/^[0-9A-Fa-f]{6}$/.test(lastTextColorValue)) {
      return { color: `#${lastTextColorValue}` };
    }
    return { color: lastTextColorValue };
  }, [lastTextColorValue]);

  const resolvedHighlightSwatch = useMemo(() => {
    if (lastHighlightColorValue === 'none') {
      return { color: '#ffffff', label: '×' };
    }
    if (/^[0-9A-Fa-f]{6}$/.test(lastHighlightColorValue)) {
      return { color: `#${lastHighlightColorValue}` };
    }
    if (/^#[0-9A-Fa-f]{6}$/.test(lastHighlightColorValue)) {
      return { color: lastHighlightColorValue };
    }
    const match = getHighlightColors().find(
      (color) => color.name.toLowerCase() === lastHighlightColorValue.toLowerCase()
    );
    if (match?.hex) return { color: `#${match.hex}` };
    return { color: lastHighlightColorValue };
  }, [lastHighlightColorValue]);

  const activeMenu = useMemo(() => {
    if (!activeMisspelling || !spellcheckState?.menu) return null;
    const menu = spellcheckState.menu;
    if (menu.from !== activeMisspelling.from || menu.to !== activeMisspelling.to) return null;
    return menu;
  }, [activeMisspelling, spellcheckState?.menu]);

  const suggestionItems = useMemo<TextContextMenuItem[]>(() => {
    if (!activeMisspelling) return [];
    if (!activeMenu || activeMenu.loading) {
      return [{ action: 'spellcheckLoading', label: 'Loading suggestions...', disabled: true }];
    }
    if (!activeMenu.suggestions.length) {
      return [{ action: 'spellcheckLoading', label: 'No suggestions', disabled: true }];
    }
    return activeMenu.suggestions.slice(0, 5).map((suggestion) => ({
      action: 'spellcheckReplace',
      label: suggestion,
      value: suggestion,
    }));
  }, [activeMenu, activeMisspelling]);

  const menuItems = useMemo<TextContextMenuItem[]>(() => {
    const items: TextContextMenuItem[] = [...baseItems];

    items.push({ action: 'separator', label: '' });
    items.push({
      action: 'textColor',
      label: 'Text Color',
      value: lastTextColorValue,
      icon: (
        <ColorSwatchIcon
          color={resolvedTextSwatch.color}
          label={resolvedTextSwatch.label}
        />
      ),
      submenu: textColorSubmenu,
      split: true,
      submenuVariant: 'colorGrid',
      testIdPrefix: 'context-textColor',
    });
    items.push({
      action: 'highlightColor',
      label: 'Highlight Color',
      value: lastHighlightColorValue,
      icon: (
        <ColorSwatchIcon
          color={resolvedHighlightSwatch.color}
          label={resolvedHighlightSwatch.label}
        />
      ),
      submenu: highlightColorSubmenu,
      split: true,
      submenuVariant: 'colorGrid',
      testIdPrefix: 'context-highlightColor',
    });

    if (activeMisspelling) {
      items.push({ action: 'separator', label: '' });
      items.push({
        action: 'spellcheckSuggestions',
        label: 'Suggestions',
        submenu: suggestionItems,
      });
      items.push({ action: 'spellcheckIgnore', label: 'Ignore' });
      items.push({ action: 'spellcheckAddToDictionary', label: 'Add to Dictionary' });
    }

    return items;
  }, [
    baseItems,
    highlightColorSubmenu,
    lastHighlightColorValue,
    lastTextColorValue,
    suggestionItems,
    textColorSubmenu,
    activeMisspelling,
  ]);

  const closeMenu = useCallback(() => {
    setIsOpen(false);
    setActiveMisspelling(null);
    setSelectionRange(null);
    selectionRangeRef.current = null;
    if (editorView && spellcheckState?.menu) {
      closeSpellcheckMenu(editorView);
    }
  }, [editorView, spellcheckState?.menu]);

  const getPagesContainer = useCallback(() => {
    if (renderedDomContext?.pagesContainer) return renderedDomContext.pagesContainer;
    if (typeof document === 'undefined') return null;
    const selectors = ['.paged-editor__pages', '.docx-editor-pages', '.docx-ai-editor'];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el) return el as HTMLElement;
    }
    return null;
  }, [renderedDomContext]);

  const openMenu = useCallback(
    (event: MouseEvent) => {
      if (!editorView) return;

      event.preventDefault();
      event.stopPropagation();

      const container = getPagesContainer();
      if (container) {
        const containerRect = container.getBoundingClientRect();
        setMinY(containerRect.top + MENU_PADDING);
      } else {
        setMinY(undefined);
      }

      setPosition({ x: event.clientX, y: event.clientY });
      const selection = editorView.state.selection;
      setHasSelection(!selection.empty);
      const range = selection.empty ? null : { from: selection.from, to: selection.to };
      selectionRangeRef.current = range;
      setSelectionRange(range);

      const posFromLayout = renderedDomContext
        ? clickToPositionDom(
            renderedDomContext.pagesContainer,
            event.clientX,
            event.clientY,
            renderedDomContext.zoom
          )
        : null;
      const coords = { left: event.clientX, top: event.clientY };
      const pos = posFromLayout ?? editorView.posAtCoords(coords)?.pos;
      const pluginState = spellcheckPluginKey.getState(editorView.state);
      const misspellings = pluginState?.misspellings ?? spellcheckState?.misspellings ?? [];
      const misspelling =
        pos !== null && pos !== undefined
          ? misspellings.find((m) => pos >= m.from && pos <= m.to) ?? null
          : null;

      if (misspelling) {
        setActiveMisspelling(misspelling);
        const existing = pluginState?.menu ?? spellcheckState?.menu;
        const matchesExisting =
          existing &&
          existing.word === misspelling.word &&
          existing.from === misspelling.from &&
          existing.to === misspelling.to;
        const suggestions = matchesExisting ? existing.suggestions : [];
        const loading = !matchesExisting || suggestions.length === 0 || existing?.loading === true;

        const menu: SpellcheckMenuState = {
          open: true,
          x: event.clientX,
          y: event.clientY,
          from: misspelling.from,
          to: misspelling.to,
          word: misspelling.word,
          suggestions,
          loading,
        };
        editorView.dispatch(
          editorView.state.tr.setMeta(spellcheckPluginKey, {
            type: 'spellcheck:menuOpen',
            menu,
          })
        );
      } else {
        setActiveMisspelling(null);
        if (spellcheckState?.menu) {
          closeSpellcheckMenu(editorView);
        }
      }

      setIsOpen(true);
    },
    [editorView, getPagesContainer, renderedDomContext, spellcheckState]
  );

  const handleAction = useCallback(
    (action: TextContextAction, value?: string) => {
      if (!editorView) return;
      editorView.focus();

      const preservedRange = selectionRangeRef.current ?? selectionRange;
      if (
        preservedRange &&
        (action === 'textColor' || action === 'highlightColor') &&
        preservedRange.from !== preservedRange.to
      ) {
        editorView.dispatch(
          editorView.state.tr.setSelection(
            TextSelection.create(editorView.state.doc, preservedRange.from, preservedRange.to)
          )
        );
      }

      switch (action) {
        case 'cut':
          document.execCommand('cut');
          break;
        case 'copy':
          document.execCommand('copy');
          break;
        case 'paste':
          document.execCommand('paste');
          break;
        case 'pasteAsPlainText':
          navigator.clipboard
            .readText?.()
            .then((text) => {
              document.execCommand('insertText', false, text);
            })
            .catch(() => {
              document.execCommand('paste');
            });
          break;
        case 'delete':
          document.execCommand('delete');
          break;
        case 'selectAll':
          document.execCommand('selectAll');
          break;
        case 'textColor': {
          const normalized = value ? value.trim() : '';
          if (!normalized || normalized === 'auto') {
            clearTextColor(editorView.state, editorView.dispatch);
            setLastTextColor({ auto: true });
            break;
          }
          const hex = normalizeHexValue(normalized);
          setTextColor({ rgb: hex })(editorView.state, editorView.dispatch);
          setLastTextColor({ rgb: hex });
          break;
        }
        case 'highlightColor': {
          const normalized = normalizeHighlightValue(value);
          if (normalized === 'none') {
            setHighlight('none')(editorView.state, editorView.dispatch);
            setLastHighlightColor('none');
            break;
          }
          const highlightName = mapHexToHighlightName(normalized);
          setHighlight(highlightName || normalized)(editorView.state, editorView.dispatch);
          setLastHighlightColor(normalized);
          break;
        }
        case 'spellcheckReplace':
          if (activeMisspelling && value) {
            editorView.dispatch(
              editorView.state.tr.insertText(value, activeMisspelling.from, activeMisspelling.to)
            );
          }
          break;
        case 'spellcheckIgnore':
          if (activeMisspelling) {
            ignoreMisspelling(editorView, activeMisspelling.from, activeMisspelling.to);
          }
          break;
        case 'spellcheckAddToDictionary':
          if (activeMisspelling) {
            addWordToDictionary(editorView, activeMisspelling.word);
          }
          break;
        case 'spellcheckSuggestions':
        case 'spellcheckLoading':
        case 'separator':
          break;
      }
    },
    [
      activeMisspelling,
      editorView,
      selectionRange,
      setLastHighlightColor,
      setLastTextColor,
    ]
  );

  useEffect(() => {
    const handleContextMenu = (event: MouseEvent) => {
      const container = getPagesContainer();
      if (!container) return;
      const target = event.target as Node | null;
      const rect = container.getBoundingClientRect();
      const inside =
        (target && container.contains(target)) ||
        (event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom);
      if (!inside) return;
      openMenu(event);
    };

    document.addEventListener('contextmenu', handleContextMenu, { capture: true });
    return () => {
      document.removeEventListener('contextmenu', handleContextMenu, { capture: true });
    };
  }, [getPagesContainer, openMenu]);

  return (
    <TextContextMenu
      isOpen={isOpen}
      position={position}
      minY={minY}
      hasSelection={hasSelection}
      isEditable={editorView?.editable ?? true}
      onAction={handleAction}
      onClose={closeMenu}
      items={menuItems}
    />
  );
};

export default EditorContextMenuOverlay;
