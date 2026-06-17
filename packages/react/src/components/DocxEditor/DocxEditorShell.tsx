import type { CSSProperties, ReactNode } from 'react';
import type { SectionProperties, TabMark } from '@eigenpal/docx-editor-core/types/document';
import type { TrackedChangesResult } from '@eigenpal/docx-editor-core/prosemirror/utils/extractTrackedChanges';
import { LocaleProvider } from '../../i18n';
import { cn } from '../../lib/utils';
import { ErrorBoundary, ErrorProvider } from '../ErrorBoundary';
import { HorizontalRuler } from '../ui/HorizontalRuler';
import { VerticalRuler, RULER_WIDTH } from '../ui/VerticalRuler';
import {
  DocumentOutline,
  OUTLINE_LEFT_OFFSET,
  OUTLINE_BUTTON_LEFT_OFFSET,
} from '../DocumentOutline';
import { OutlineToggleButton } from './OutlineToggleButton';
import { PageIndicator } from './PageIndicator';
import { LocalizedAgentPanel } from './LocalizedAgentPanel';
import { SIDEBAR_DOCUMENT_SHIFT } from '../sidebar/constants';
import { Z_INDEX } from '../../styles/zIndex';
import type { HeadingInfo } from '@eigenpal/docx-editor-core/utils';
import type { AgentPanelOptions } from './types';

interface ScrollPageInfo {
  currentPage: number;
  totalPages: number;
  visible: boolean;
}

interface HorizontalRulerProps {
  sectionProps: SectionProperties | undefined;
  zoom: number;
  unit: 'inch' | 'cm';
  editable: boolean;
  onLeftMarginChange: (marginTwips: number) => void;
  onRightMarginChange: (marginTwips: number) => void;
  indentLeft: number;
  indentRight: number;
  onIndentLeftChange: (twips: number) => void;
  onIndentRightChange: (twips: number) => void;
  firstLineIndent: number;
  hangingIndent: boolean;
  onFirstLineIndentChange: (twips: number) => void;
  tabMarks: TabMark[] | null;
  onTabMarkRemove: (positionTwips: number) => void;
}

interface VerticalRulerProps {
  sectionProps: SectionProperties | undefined;
  zoom: number;
  unit: 'inch' | 'cm';
  editable: boolean;
  onTopMarginChange: (marginTwips: number) => void;
  onBottomMarginChange: (marginTwips: number) => void;
}

interface OutlineProps {
  headings: HeadingInfo[];
  onHeadingClick: (pmPos: number) => void;
  onClose: () => void;
  topOffset: number;
  scrollLeft: number;
}

/**
 * Outer chrome of the editor: i18n + error provider wrappers, the
 * scroll container with its background-click handler, horizontal and
 * vertical rulers, the floating page indicator, document outline panel
 * + toggle button, agent panel mount, plus slots for the toolbar,
 * paged-area body, overlays, dialogs, and hidden file inputs.
 *
 * The expanded-sidebar-item highlight styles are computed here from
 * `expandedSidebarItem` + `trackedChanges` because they need to live
 * inside the editor-content `<div>` for proper scoping.
 */
export function DocxEditorShell({
  i18n,
  isDark,
  onEditorError,
  containerRef,
  scrollContainerRef,
  editorContentRef,
  className,
  containerStyle,
  mainContentStyle,
  editorContainerStyle,
  showRuler,
  readOnlyProp,
  showOutline,
  showOutlineButton,
  sidebarOpen,
  minLayoutWidth,
  toolbarHeight,
  editorScrollLeft,
  expandedSidebarItem,
  trackedChanges,
  onScrollContainerMouseDown,
  onEditorBgMouseDown,
  onEditorContextMenu,
  horizontalRulerProps,
  verticalRulerProps,
  outlineProps,
  onToggleOutline,
  scrollPageInfo,
  agentPanel,
  agentPanelOpen,
  onAgentPanelClose,
  toolbar,
  pagedArea,
  overlays,
  dialogs,
  fileInputs,
}: {
  i18n: React.ComponentProps<typeof LocaleProvider>['i18n'];
  isDark?: boolean;
  onEditorError: (error: Error) => void;
  containerRef: React.Ref<HTMLDivElement>;
  scrollContainerRef: React.Ref<HTMLDivElement>;
  editorContentRef: React.Ref<HTMLDivElement>;
  className: string | undefined;
  containerStyle: CSSProperties;
  mainContentStyle: CSSProperties;
  editorContainerStyle: CSSProperties;
  showRuler: boolean;
  readOnlyProp: boolean | undefined;
  showOutline: boolean;
  showOutlineButton: boolean;
  sidebarOpen: boolean;
  minLayoutWidth: number;
  toolbarHeight: number;
  editorScrollLeft: number;
  expandedSidebarItem: string | null;
  trackedChanges: TrackedChangesResult['entries'];
  onScrollContainerMouseDown: (e: React.MouseEvent) => void;
  onEditorBgMouseDown: (e: React.MouseEvent) => void;
  onEditorContextMenu: (e: React.MouseEvent) => void;
  horizontalRulerProps: HorizontalRulerProps;
  verticalRulerProps: VerticalRulerProps;
  outlineProps: OutlineProps;
  onToggleOutline: () => void;
  scrollPageInfo: ScrollPageInfo;
  agentPanel: AgentPanelOptions | undefined;
  agentPanelOpen: boolean;
  onAgentPanelClose: () => void;
  toolbar: ReactNode;
  pagedArea: ReactNode;
  overlays: ReactNode;
  dialogs: ReactNode;
  fileInputs: ReactNode;
}) {
  return (
    <LocaleProvider i18n={i18n}>
      <ErrorProvider>
        <ErrorBoundary onError={onEditorError}>
          <div
            ref={containerRef}
            className={cn('ep-root docx-editor', isDark && 'dark', className)}
            style={containerStyle}
            data-testid="docx-editor"
          >
            <div style={mainContentStyle}>
              <div
                style={{
                  position: 'relative',
                  flex: 1,
                  minHeight: 0,
                  minWidth: 0,
                  display: 'flex',
                  flexDirection: 'column',
                }}
              >
                {toolbar}

                <div
                  ref={scrollContainerRef}
                  style={editorContainerStyle}
                  onMouseDown={onScrollContainerMouseDown}
                >
                  {/* Horizontal ruler — sticky-top, scrolls horizontally with
                      the doc. paddingRight biases the centered ruler so it
                      tracks the page when the comments sidebar shifts the
                      page left. Outline doesn't bias; the page stays centered
                      until minLayoutWidth forces horizontal scroll. */}
                  {showRuler && (
                    <div
                      className="flex justify-center py-1 flex-shrink-0 bg-doc-bg"
                      style={{
                        position: 'sticky',
                        top: 0,
                        // Must sit above the inline HF editor so the ruler stays readable.
                        zIndex: Z_INDEX.ruler,
                        paddingLeft: 20,
                        paddingRight: 20 + (sidebarOpen ? SIDEBAR_DOCUMENT_SHIFT * 2 : 0),
                        minWidth: minLayoutWidth,
                        transition: 'padding 0.2s ease',
                      }}
                    >
                      <HorizontalRuler {...horizontalRulerProps} />
                    </div>
                  )}
                  <div
                    style={{
                      display: 'flex',
                      flex: 1,
                      minHeight: 0,
                      position: 'relative',
                      minWidth: minLayoutWidth,
                    }}
                  >
                    <div
                      ref={editorContentRef}
                      style={{
                        position: 'relative',
                        flex: 1,
                        minWidth: 0,
                      }}
                      onMouseDown={onEditorBgMouseDown}
                      onContextMenu={onEditorContextMenu}
                    >
                      {/* Vertical ruler — sits at the editor content's left
                          edge so it scrolls horizontally with the page. */}
                      {showRuler && !readOnlyProp && (
                        <div
                          style={{
                            position: 'absolute',
                            left: 0,
                            top: 0,
                            // Above the inline HF editor so it stays readable on horizontal scroll.
                            zIndex: Z_INDEX.ruler,
                            // Must match `.paged-editor__pages` padding-top
                            // (24 viewport + 24 pages container) in editor.css.
                            paddingTop: 48,
                          }}
                        >
                          <VerticalRuler {...verticalRulerProps} />
                        </div>
                      )}
                      {/* Brightened highlight for the focused/expanded sidebar item. */}
                      {expandedSidebarItem && expandedSidebarItem.startsWith('comment-') && (
                        <style>{`.paged-editor__pages [data-comment-id="${expandedSidebarItem.replace('comment-', '')}"] { background-color: rgba(255, 212, 0, 0.35) !important; border-bottom: 2px solid rgba(255, 212, 0, 0.7) !important; }`}</style>
                      )}
                      {expandedSidebarItem?.startsWith('tc-') &&
                        (() => {
                          const revId = expandedSidebarItem.split('-')[1];
                          const tc = trackedChanges.find((c) => String(c.revisionId) === revId);
                          const insRevId = tc?.insertionRevisionId;
                          return (
                            <style>{`
                            .paged-editor__pages .docx-insertion[data-revision-id="${insRevId ?? revId}"] { background-color: rgba(52, 168, 83, 0.2) !important; border-bottom: 2px solid #2e7d32 !important; }
                            .paged-editor__pages .docx-deletion[data-revision-id="${revId}"] { background-color: rgba(211, 47, 47, 0.2) !important; text-decoration-thickness: 2px !important; }
                          `}</style>
                          );
                        })()}
                      {pagedArea}
                    </div>
                  </div>
                </div>

                {scrollPageInfo.totalPages > 1 && (
                  <PageIndicator
                    currentPage={scrollPageInfo.currentPage}
                    totalPages={scrollPageInfo.totalPages}
                    visible={scrollPageInfo.visible}
                  />
                )}

                {/* When the vertical ruler is shown it overlays the editor's
                    left edge (left:0, width RULER_WIDTH); inset the outline
                    toggle/panel past it so they don't render on top. */}
                {showOutline && (
                  <DocumentOutline
                    {...outlineProps}
                    leftOffset={OUTLINE_LEFT_OFFSET + (showRuler ? RULER_WIDTH : 0)}
                  />
                )}

                {showOutlineButton && !showOutline && (
                  <OutlineToggleButton
                    onClick={onToggleOutline}
                    // Aligns with the page top: toolbar + horizontal ruler row
                    // (22 ruler + 8 py-1 padding) + PagedEditor viewport
                    // padding-top (24) + pages container padding (24).
                    topPx={toolbarHeight + (showRuler ? 30 : 0) + 48}
                    scrollLeft={editorScrollLeft}
                    leftOffset={OUTLINE_BUTTON_LEFT_OFFSET + (showRuler ? RULER_WIDTH : 0)}
                  />
                )}
              </div>

              {/* Agent panel (right-side dock) — always mounted when the prop
                  is set so chat state survives close/reopen. `closed={!agentPanelOpen}`
                  drives the slide / fade. */}
              {agentPanel && (
                <LocalizedAgentPanel
                  agentPanel={agentPanel}
                  closed={!agentPanelOpen}
                  onClose={onAgentPanelClose}
                />
              )}
            </div>

            {overlays}
            {dialogs}
            {fileInputs}
          </div>
        </ErrorBoundary>
      </ErrorProvider>
    </LocaleProvider>
  );
}
