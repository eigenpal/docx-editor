import { useCallback, useEffect, useRef, useState } from 'react';
import type { Style, Theme } from '@eigenpal/docx-core/types/document';
import type { TableContextInfo } from '@eigenpal/docx-core/prosemirror';

import type { FormattingAction, SelectionFormatting } from '../toolbarTypes';
import type { EditorMode } from '../ui/EditingModeDropdown';
import type { TableAction } from '../ui/TableToolbar';
import { MaterialSymbol } from '../ui/MaterialSymbol';
import { useToolbarItems, type RibbonItemModel } from '../toolbarItems';
import { ribbonIcons } from './ribbonIcons';

export interface RibbonProps {
  currentFormatting?: SelectionFormatting;
  documentStyles?: Style[];
  theme?: Theme | null;
  readOnly?: boolean;
  onFormat?: (action: FormattingAction) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onFind?: () => void;
  onReplace?: () => void;
  onPageSetup?: () => void;
  onInsertTable?: (rows: number, columns: number) => void;
  onInsertImage?: () => void;
  onInsertPageBreak?: () => void;
  onInsertTOC?: () => void;
  onToggleCommentsSidebar?: () => void;
  editingMode?: EditorMode;
  onSetEditingMode?: (mode: EditorMode) => void;
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
  onToggleOutline?: () => void;
  tableContext?: TableContextInfo | null;
  onTableAction?: (action: TableAction) => void;
  imageContext?: {
    wrapType: string;
    displayMode: string;
    cssFloat: string | null;
  } | null;
  onCopy?: () => void;
  onCut?: () => void;
  onPaste?: () => void;
  onToggleLocalClipboard?: () => void;
  localClipboardEnabled?: boolean;
  onToggleShowMarks?: () => void;
  showMarksEnabled?: boolean;
  onToggleParagraphBorder?: () => void;
  rulerEnabled?: boolean;
  onToggleRuler?: () => void;
  onZoomPageWidth?: () => void;
  onZoomOnePage?: () => void;
  layoutMode?: 'print' | 'web';
  onSetLayoutMode?: (mode: 'print' | 'web') => void;
  onOpenHeaderFooter?: (position: 'header' | 'footer') => void;
  onCloseHeaderFooter?: () => void;
  hfEditPosition?: 'header' | 'footer' | null;
  onOpenImageProperties?: () => void;
  onRefocusEditor?: () => void;
}

type ScrollState = {
  canScrollLeft: boolean;
  canScrollRight: boolean;
};

function useHorizontalScrollState(deps: React.DependencyList = []) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<ScrollState>({
    canScrollLeft: false,
    canScrollRight: false,
  });

  const update = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    setState({
      canScrollLeft: el.scrollLeft > 0,
      canScrollRight: el.scrollLeft < maxScroll - 1,
    });
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    update();
    const onScroll = () => update();

    el.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);

    return () => {
      el.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [update, ...deps]);

  const scrollBy = useCallback((direction: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    const delta = Math.max(120, Math.round(el.clientWidth * 0.6));
    el.scrollBy({ left: direction === 'left' ? -delta : delta, behavior: 'smooth' });
  }, []);

  return {
    scrollRef,
    scrollState: state,
    scrollBy,
  };
}

function resolveIconName(iconId?: string): string | undefined {
  if (!iconId) return undefined;
  return ribbonIcons[iconId]?.material || iconId;
}

export function Ribbon({
  currentFormatting = {},
  documentStyles,
  theme,
  readOnly = false,
  onFormat,
  onUndo,
  onRedo,
  onFind,
  onReplace,
  onPageSetup,
  onInsertTable,
  onInsertImage,
  onInsertPageBreak,
  onInsertTOC,
  onToggleCommentsSidebar,
  editingMode,
  onSetEditingMode,
  zoom,
  onZoomChange,
  onToggleOutline,
  tableContext,
  onTableAction,
  imageContext,
  onCopy,
  onCut,
  onPaste,
  onToggleLocalClipboard,
  localClipboardEnabled = false,
  onToggleShowMarks,
  showMarksEnabled = false,
  onToggleParagraphBorder,
  rulerEnabled,
  onToggleRuler,
  onZoomPageWidth,
  onZoomOnePage,
  layoutMode,
  onSetLayoutMode,
  onOpenHeaderFooter,
  onCloseHeaderFooter,
  hfEditPosition,
  onOpenImageProperties,
  onRefocusEditor,
}: RibbonProps) {
  const { ribbon, renderRibbonComponent } = useToolbarItems({
    currentFormatting,
    documentStyles,
    theme,
    readOnly,
    onFormat,
    onUndo,
    onRedo,
    onFind,
    onReplace,
    onPageSetup,
    onInsertTable,
    onInsertImage,
    onInsertPageBreak,
    onInsertTOC,
    onToggleCommentsSidebar,
    editingMode,
    onSetEditingMode,
    zoom,
    onZoomChange,
    onToggleOutline,
    tableContext,
    onTableAction,
    imageContext,
    onCopy,
    onCut,
    onPaste,
    onToggleLocalClipboard,
    localClipboardEnabled,
    onToggleShowMarks,
    showMarksEnabled,
    onToggleParagraphBorder,
    showRulerEnabled: rulerEnabled,
    onToggleRuler,
    onZoomPageWidth,
    onZoomOnePage,
    layoutMode,
    onSetLayoutMode,
    onOpenHeaderFooter,
    onCloseHeaderFooter,
    hfEditPosition,
    onOpenImageProperties,
    onRefocusEditor,
  });

  const visibleTabs = ribbon;
  const [activeTabId, setActiveTabId] = useState(() => visibleTabs[0]?.id ?? '');

  useEffect(() => {
    if (!visibleTabs.find((tab) => tab.id === activeTabId)) {
      setActiveTabId(visibleTabs[0]?.id ?? '');
    }
  }, [activeTabId, visibleTabs]);

  const activeTab = visibleTabs.find((tab) => tab.id === activeTabId) ?? visibleTabs[0];
  const tabsScroll = useHorizontalScrollState([visibleTabs.length]);
  const groupsScroll = useHorizontalScrollState([activeTab?.id]);

  const renderItem = (item: RibbonItemModel) => {
    const size =
      item.size ?? (item.kind === 'button' && item.showLabel === false ? 'small' : 'medium');
    const wrapperClassName = `ribbon__item ribbon__item--${size}`;

    if (item.kind === 'component') {
      const content = renderRibbonComponent(item.component, item.id);
      if (!content) return null;
      return (
        <div key={item.id} className={wrapperClassName}>
          {content}
        </div>
      );
    }

    const iconName = resolveIconName(item.icon);
    const isIconOnly = item.showLabel === false;
    const buttonClassName = [
      'ribbon__button',
      item.disabled ? 'ribbon__button--disabled' : '',
      item.isActive ? 'ribbon__button--active' : '',
      isIconOnly ? 'ribbon__button--icon' : '',
    ]
      .filter(Boolean)
      .join(' ');
    const hasPressedState = typeof item.isActive === 'boolean';

    const handlePress = () => {
      if (item.disabled) return;
      item.onClick?.();
    };

    return (
      <div key={item.id} className={wrapperClassName}>
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            handlePress();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handlePress();
            }
          }}
          className={buttonClassName}
          disabled={item.disabled}
          aria-pressed={hasPressedState ? (item.isActive ? 'true' : 'false') : undefined}
          aria-label={item.label}
          data-testid={`ribbon-${item.id}`}
        >
          {iconName && <MaterialSymbol className="ribbon__icon" name={iconName} size={16} />}
          {item.showLabel !== false && <span>{item.label}</span>}
        </button>
      </div>
    );
  };

  return (
    <div
      data-testid="ribbon"
      data-has-toggle-comments={onToggleCommentsSidebar ? 'true' : 'false'}
      role="toolbar"
      aria-label="Ribbon toolbar"
      className="ribbon"
    >
      <div
        className="ribbon__tabs ribbon__scroll"
        data-scroll-left={tabsScroll.scrollState.canScrollLeft}
        data-scroll-right={tabsScroll.scrollState.canScrollRight}
      >
        <button
          type="button"
          className="ribbon__scroll-btn ribbon__scroll-btn--left"
          aria-label="Scroll tabs left"
          data-testid="ribbon-tabs-scroll-left"
          disabled={!tabsScroll.scrollState.canScrollLeft}
          onClick={() => tabsScroll.scrollBy('left')}
        >
          <MaterialSymbol name="keyboard_arrow_left" size={16} />
        </button>
        <div className="ribbon__scroll-viewport ribbon__tabs-viewport">
          <div
            ref={tabsScroll.scrollRef}
            role="tablist"
            aria-label="Ribbon tabs"
            className="ribbon__scroll-inner ribbon__tabs-inner"
          >
            {visibleTabs.map((tab) => {
              const isActive = tab.id === activeTab?.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActiveTabId(tab.id)}
                  className={isActive ? 'ribbon__tab ribbon__tab--active' : 'ribbon__tab'}
                >
                  <span className="ribbon__tab-text">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>
        <button
          type="button"
          className="ribbon__scroll-btn ribbon__scroll-btn--right"
          aria-label="Scroll tabs right"
          data-testid="ribbon-tabs-scroll-right"
          disabled={!tabsScroll.scrollState.canScrollRight}
          onClick={() => tabsScroll.scrollBy('right')}
        >
          <MaterialSymbol name="keyboard_arrow_right" size={16} />
        </button>
      </div>

      <div
        className="ribbon__groups ribbon__scroll ribbon__scroll--groups"
        data-scroll-left={groupsScroll.scrollState.canScrollLeft}
        data-scroll-right={groupsScroll.scrollState.canScrollRight}
      >
        <button
          type="button"
          className="ribbon__scroll-btn ribbon__scroll-btn--left"
          aria-label="Scroll ribbon left"
          data-testid="ribbon-groups-scroll-left"
          disabled={!groupsScroll.scrollState.canScrollLeft}
          onClick={() => groupsScroll.scrollBy('left')}
        >
          <MaterialSymbol name="keyboard_arrow_left" size={16} />
        </button>
        <div className="ribbon__scroll-viewport ribbon__groups-viewport">
          <div
            ref={groupsScroll.scrollRef}
            role="group"
            aria-label={`${activeTab?.label ?? 'Ribbon'} groups`}
            className="ribbon__scroll-inner ribbon__groups-inner"
          >
            {activeTab?.groups.map((group) => (
              <div key={group.id} role="group" aria-label={group.label} className="ribbon__group">
                <div className="ribbon__group-content">
                  {group.items.map((item) => renderItem(item))}
                </div>
                <span className="ribbon__group-label">{group.label}</span>
              </div>
            ))}
          </div>
        </div>
        <button
          type="button"
          className="ribbon__scroll-btn ribbon__scroll-btn--right"
          aria-label="Scroll ribbon right"
          data-testid="ribbon-groups-scroll-right"
          disabled={!groupsScroll.scrollState.canScrollRight}
          onClick={() => groupsScroll.scrollBy('right')}
        >
          <MaterialSymbol name="keyboard_arrow_right" size={16} />
        </button>
      </div>
    </div>
  );
}

export default Ribbon;
