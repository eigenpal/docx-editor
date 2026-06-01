/**
 * InlineHeaderFooterEditor — UI chrome for header/footer editing.
 *
 * Phase 5 of HF editing unification (openspec/changes/unify-hf-editing/):
 * this component no longer creates a ProseMirror EditorView. The painter
 * is the visible HF renderer (phase 2), and the persistent hidden HF PM
 * mounted by `HiddenHeaderFooterPMs` is the sole editor. This wrapper
 * floats the separator bar / options menu over the painted HF region and
 * exposes the persistent view via its imperative ref so toolbar commands
 * (bold, font, undo/redo) and save-on-close find the right PM.
 */

import React, {
  useRef,
  useEffect,
  useCallback,
  useState,
  useImperativeHandle,
  useLayoutEffect,
  forwardRef,
} from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from '../i18n';
import { EditorView } from 'prosemirror-view';
import { undo, redo } from 'prosemirror-history';

import { schema } from '@eigenpal/docx-editor-core/prosemirror';
import { proseDocToBlocks } from '@eigenpal/docx-editor-core/prosemirror/conversion';
import { Z_INDEX } from '../styles/zIndex';
import type { HeaderFooter, BlockContent } from '@eigenpal/docx-editor-core/types/document';

// ============================================================================
// TYPES
// ============================================================================

export interface InlineHeaderFooterEditorProps {
  /** The header or footer being edited */
  headerFooter: HeaderFooter;
  /** Whether editing header or footer */
  position: 'header' | 'footer';
  /**
   * The persistent hidden HF EditorView for this slot. Phase 5 of the HF
   * editing unification (openspec/changes/unify-hf-editing/) — this
   * component no longer creates its own EditorView; the painter and this
   * overlay both read from the same persistent PM mounted by
   * `HiddenHeaderFooterPMs`. The component is now UI chrome only:
   * separator bar, options menu, save-and-close on Escape.
   */
  view: EditorView | null;
  /** The DOM element to overlay (the .layout-page-header / .layout-page-footer) */
  targetElement: HTMLElement;
  /** The positioning parent element (the div wrapping PagedEditor) */
  parentElement: HTMLElement;
  /** Callback when editing is complete — receives updated content blocks */
  onSave: (content: BlockContent[]) => void;
  /** Callback when editing is cancelled */
  onClose: () => void;
  /** Callback to remove the header/footer entirely */
  onRemove?: () => void;
}

export interface InlineHeaderFooterEditorRef {
  /** Get the ProseMirror EditorView */
  getView(): EditorView | null;
  /** Focus the editor */
  focus(): void;
  /** Undo */
  undo(): boolean;
  /** Redo */
  redo(): boolean;
}

// ============================================================================
// STYLES
// ============================================================================

const separatorBarStyle: CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  // Sit ABOVE the painted header content so the bar doesn't intercept clicks
  // landing on the first row of header text. Pre-unification the bar floated
  // above an empty box; the painter now shows through so we have to hoist.
  bottom: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '2px 0',
  fontSize: 11,
  color: '#4285f4',
  userSelect: 'none',
  // Container is `pointer-events: none`; restore on the chrome so the
  // label + options button stay clickable.
  pointerEvents: 'auto',
};

const labelStyle: CSSProperties = {
  fontWeight: 500,
  letterSpacing: 0.3,
};

const optionsButtonStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#4285f4',
  cursor: 'pointer',
  fontSize: 11,
  padding: '2px 6px',
  borderRadius: 3,
};

const dropdownStyle: CSSProperties = {
  position: 'absolute',
  right: 0,
  top: '100%',
  background: 'white',
  border: '1px solid #dadce0',
  borderRadius: 4,
  boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
  zIndex: Z_INDEX.dropdown,
  minWidth: 160,
  padding: '4px 0',
};

const dropdownItemStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '6px 12px',
  border: 'none',
  background: 'none',
  textAlign: 'left',
  cursor: 'pointer',
  fontSize: 12,
  color: '#3c4043',
};

// ============================================================================
// COMPONENT
// ============================================================================

export const InlineHeaderFooterEditor = forwardRef<
  InlineHeaderFooterEditorRef,
  InlineHeaderFooterEditorProps
>(function InlineHeaderFooterEditor(
  {
    headerFooter: _headerFooter,
    position,
    view,
    targetElement,
    parentElement,
    onSave,
    onClose,
    onRemove,
  },
  ref
) {
  const viewRef = useRef<EditorView | null>(view);
  viewRef.current = view;
  const [showOptions, setShowOptions] = useState(false);
  const optionsRef = useRef<HTMLDivElement>(null);

  // Compute overlay position relative to the parent element so the
  // separator-bar / options-menu chrome floats over the painted HF region.
  // No PM is mounted here any more (phase 5) — the persistent hidden HF PM
  // mounted by `HiddenHeaderFooterPMs` is the sole HF editor.
  const [overlayPos, setOverlayPos] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);

  useLayoutEffect(() => {
    const computePosition = () => {
      const parentRect = parentElement.getBoundingClientRect();
      const targetRect = targetElement.getBoundingClientRect();
      setOverlayPos({
        top: targetRect.top - parentRect.top + parentElement.scrollTop,
        left: targetRect.left - parentRect.left + parentElement.scrollLeft,
        width: targetRect.width,
        height: targetRect.height,
      });
    };
    computePosition();

    // Recompute on scroll/resize so the bar follows the painter.
    const scrollParent = parentElement.closest('[style*="overflow"]') || parentElement;
    scrollParent.addEventListener('scroll', computePosition);
    window.addEventListener('resize', computePosition);
    return () => {
      scrollParent.removeEventListener('scroll', computePosition);
      window.removeEventListener('resize', computePosition);
    };
  }, [targetElement, parentElement]);

  // Auto-focus the persistent PM when the overlay first mounts — this is
  // what makes typing land in HF content after a double-click. Clicks
  // inside the painter route through `usePagesPointer.onHfPagesMouseDown`
  // which also calls `view.focus()`, but mount-time focus is needed for
  // the initial entry. Guarded by a ref so a later view-identity change
  // (e.g. HF EditorView re-mount on doc reload) doesn't yank focus away
  // from the user's current selection mid-session.
  const didAutoFocusRef = useRef(false);
  useEffect(() => {
    if (!view || didAutoFocusRef.current) return;
    didAutoFocusRef.current = true;
    requestAnimationFrame(() => view.focus());
  }, [view]);

  // Save current content from the persistent PM.
  const handleSave = useCallback(() => {
    if (!viewRef.current) return;
    const blocks = proseDocToBlocks(viewRef.current.state.doc);
    onSave(blocks);
  }, [onSave]);

  // Save-and-close: always save (the persistent PM may have edits that
  // never went through this overlay, e.g. via the agent bridge).
  const handleSaveAndClose = useCallback(() => {
    handleSave();
    onClose();
  }, [handleSave, onClose]);

  // Handle Escape key — save + close
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        handleSaveAndClose();
      }
    }
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [handleSaveAndClose]);

  // Close options dropdown when clicking outside
  useEffect(() => {
    if (!showOptions) return;
    function handleClick(e: MouseEvent) {
      if (optionsRef.current && !optionsRef.current.contains(e.target as Node)) {
        setShowOptions(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showOptions]);

  // Expose ref
  useImperativeHandle(ref, () => ({
    getView: () => viewRef.current,
    focus: () => viewRef.current?.focus(),
    undo: () => {
      const view = viewRef.current;
      if (!view) return false;
      return undo(view.state, view.dispatch);
    },
    redo: () => {
      const view = viewRef.current;
      if (!view) return false;
      return redo(view.state, view.dispatch);
    },
  }));

  const { t } = useTranslation();
  const label = position === 'header' ? t('headerFooter.header') : t('headerFooter.footer');

  if (!overlayPos) return null;

  const containerStyle: CSSProperties = {
    position: 'absolute',
    top: overlayPos.top,
    left: overlayPos.left,
    width: overlayPos.width,
    // Match the painted HF rect height so the chrome bar (positioned via
    // `top: 100%` / `bottom: 100%`) sits flush against the painter.
    height: overlayPos.height,
    zIndex: Z_INDEX.hfInlineEditor,
    // Post-unification (openspec/changes/unify-hf-editing): the painter shows
    // through this overlay — only the chrome (separator bar, options menu)
    // should swallow clicks. Painter clicks must reach the pages container so
    // `usePagesPointer.handlePagesMouseDown` can route them via
    // `onHfPagesMouseDown` to the persistent HF EditorView. Without this,
    // clicking anywhere inside the painted HF region was a no-op (#468).
    pointerEvents: 'none',
  };

  // Footer bar sits BELOW the painted footer; header bar ABOVE the painted
  // header. Both anchored so they never overlap the cells underneath.
  const footerBarStyle: CSSProperties = { ...separatorBarStyle, bottom: 'auto', top: '100%' };

  return (
    <div className="hf-inline-editor" style={containerStyle}>
      {position === 'footer' && (
        <div className="hf-separator-bar" style={footerBarStyle}>
          <span style={labelStyle}>{label}</span>
          <OptionsMenu
            label={label}
            showOptions={showOptions}
            setShowOptions={setShowOptions}
            optionsRef={optionsRef}
            onRemove={onRemove}
            onClose={handleSaveAndClose}
            viewRef={viewRef}
          />
        </div>
      )}

      {position === 'header' && (
        <div className="hf-separator-bar" style={separatorBarStyle}>
          <span style={labelStyle}>{label}</span>
          <OptionsMenu
            label={label}
            showOptions={showOptions}
            setShowOptions={setShowOptions}
            optionsRef={optionsRef}
            onRemove={onRemove}
            onClose={handleSaveAndClose}
            viewRef={viewRef}
          />
        </div>
      )}
    </div>
  );
});

// ============================================================================
// OPTIONS MENU SUB-COMPONENT
// ============================================================================

function OptionsMenu({
  label,
  showOptions,
  setShowOptions,
  optionsRef,
  onRemove,
  onClose,
  viewRef,
}: {
  label: string;
  showOptions: boolean;
  setShowOptions: (v: boolean | ((prev: boolean) => boolean)) => void;
  optionsRef: React.RefObject<HTMLDivElement | null>;
  onRemove?: () => void;
  onClose: () => void;
  viewRef: React.RefObject<EditorView | null>;
}) {
  const { t } = useTranslation();
  const insertField = (fieldType: 'PAGE' | 'NUMPAGES') => {
    const view = viewRef.current;
    if (!view) return;
    // Get marks at the current cursor position so the field inherits surrounding styling
    const { $from, from } = view.state.selection;
    const marks = view.state.storedMarks || $from.marks();
    const node = schema.nodes.field.create({
      fieldType,
      instruction: ` ${fieldType} \\* MERGEFORMAT `,
      fieldKind: 'simple',
      dirty: true,
    });
    const tr = view.state.tr.insert(from, node.mark(marks));
    view.dispatch(tr);
    // PM's `view.focus()` (NOT `view.dom.focus()`) — the former dispatches
    // a no-op transaction internally to refresh the selection display,
    // which the painter pipeline observes and re-paints with the freshly
    // inserted field resolved. `view.dom.focus()` skips that step and
    // leaves the painter showing pre-insert content until the next
    // keystroke triggers a transaction. The hidden host is at
    // `position: fixed; left:-9999px` so PM's focus doesn't actually
    // scroll the viewport, despite the earlier comment to the contrary.
    view.focus();
  };

  return (
    <div style={{ position: 'relative' }} ref={optionsRef}>
      <button
        type="button"
        style={optionsButtonStyle}
        onClick={(e) => {
          e.stopPropagation();
          setShowOptions((prev) => !prev);
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {t('headerFooter.options')} ▾
      </button>
      {showOptions && (
        <div style={dropdownStyle} onMouseDown={(e) => e.stopPropagation()}>
          {/*
            `onMouseDown={(e) => e.stopPropagation()}` on the dropdown is
            CRITICAL — without it, the button's mousedown bubbles to the
            pages container, where `handlePagesMouseDown` treats the click
            as "in HF area but not on a span" and snaps the HF cursor to
            end-of-doc. The button's onClick then runs insertField with
            `from = end-of-doc` and the field lands far away from where
            the user was typing. Stopping propagation keeps the HF
            selection where the user left it.
          */}
          <button
            type="button"
            style={dropdownItemStyle}
            onClick={() => {
              setShowOptions(false);
              insertField('PAGE');
            }}
            onMouseOver={(e) => {
              (e.target as HTMLElement).style.backgroundColor = '#f1f3f4';
            }}
            onMouseOut={(e) => {
              (e.target as HTMLElement).style.backgroundColor = 'transparent';
            }}
          >
            {t('headerFooter.insertPageNumber')}
          </button>
          <button
            type="button"
            style={dropdownItemStyle}
            onClick={() => {
              setShowOptions(false);
              insertField('NUMPAGES');
            }}
            onMouseOver={(e) => {
              (e.target as HTMLElement).style.backgroundColor = '#f1f3f4';
            }}
            onMouseOut={(e) => {
              (e.target as HTMLElement).style.backgroundColor = 'transparent';
            }}
          >
            {t('headerFooter.insertTotalPages')}
          </button>
          <div style={{ borderTop: '1px solid #e8eaed', margin: '4px 0' }} />
          {onRemove && (
            <button
              type="button"
              style={dropdownItemStyle}
              onClick={() => {
                setShowOptions(false);
                onRemove();
              }}
              onMouseOver={(e) => {
                (e.target as HTMLElement).style.backgroundColor = '#f1f3f4';
              }}
              onMouseOut={(e) => {
                (e.target as HTMLElement).style.backgroundColor = 'transparent';
              }}
            >
              {t('headerFooter.remove', { label: label.toLowerCase() })}
            </button>
          )}
          <button
            type="button"
            style={dropdownItemStyle}
            onClick={() => {
              setShowOptions(false);
              onClose();
            }}
            onMouseOver={(e) => {
              (e.target as HTMLElement).style.backgroundColor = '#f1f3f4';
            }}
            onMouseOut={(e) => {
              (e.target as HTMLElement).style.backgroundColor = 'transparent';
            }}
          >
            {t('headerFooter.closeEditing', { label: label.toLowerCase() })}
          </button>
        </div>
      )}
    </div>
  );
}
