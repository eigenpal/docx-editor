// The paginated surface wired to the real editor chrome (task 11.1).
//
// The surface on its own is a document with no way to act on it but the keyboard. This
// composes the existing toolbar with it, which is the whole point of keeping that toolbar
// driven by plain state and one callback: it does not know or care which engine answers.
//
// The mapping is the interesting part, and it is deliberately DIRECT — a toolbar action
// becomes one OOXML property on the selection, named as the file names it. Anything the
// engine cannot yet express is refused rather than approximated, because a toolbar button
// that silently does nothing is worse than one that is visibly unavailable.

import { useCallback, useRef, useState } from 'react';
import type { PaginatedSurfaceState, TextMeasurer } from '@docx-editor.dev/engine-editor';
import { Toolbar, type FormattingAction, type SelectionFormatting } from './Toolbar';
import { PaginatedDocxEditor, type PaginatedDocxEditorHandle } from './PaginatedDocxEditor';

export interface PaginatedDocxEditorShellProps {
  readonly source: Uint8Array;
  readonly scale?: number;
  readonly measurer?: TextMeasurer;
  readonly onStateChange?: (state: PaginatedSurfaceState) => void;
  readonly onError?: (reason: string, detail?: string) => void;
  readonly className?: string;
}

/** Highlight names OOXML accepts, keyed by the hex a picker hands back. */
const HIGHLIGHT_BY_HEX: ReadonlyMap<string, string> = new Map([
  ['#ffff00', 'yellow'],
  ['#00ff00', 'green'],
  ['#00ffff', 'cyan'],
  ['#ff00ff', 'magenta'],
  ['#0000ff', 'blue'],
  ['#ff0000', 'red'],
  ['#000080', 'darkBlue'],
  ['#008080', 'darkCyan'],
  ['#008000', 'darkGreen'],
  ['#800080', 'darkMagenta'],
  ['#800000', 'darkRed'],
  ['#808000', 'darkYellow'],
  ['#808080', 'darkGray'],
  ['#c0c0c0', 'lightGray'],
  ['#ffffff', 'white'],
]);

const hexOf = (value: string): string | null => {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(value.trim());
  return match ? match[1]!.toUpperCase() : null;
};

export function PaginatedDocxEditorShell({
  source,
  scale,
  measurer,
  onStateChange,
  onError,
  className,
}: PaginatedDocxEditorShellProps) {
  const editorRef = useRef<PaginatedDocxEditorHandle>(null);
  const [state, setState] = useState<PaginatedSurfaceState | null>(null);
  const [formatting, setFormatting] = useState<SelectionFormatting>({});

  const refresh = useCallback(
    (next: PaginatedSurfaceState) => {
      setState(next);
      // Read AFTER the commit, from the engine, rather than predicting what the action did.
      // A toolbar that tracks its own optimistic state drifts the moment an edit is refused.
      const current = editorRef.current?.formatting();
      if (current) {
        setFormatting({
          bold: current.bold,
          italic: current.italic,
          underline: current.underline,
          strike: current.strikethrough,
          superscript: current.superscript,
          subscript: current.subscript,
          ...(current.fontFamily ? { fontFamily: current.fontFamily } : {}),
          ...(current.fontSizeHalfPoints ? { fontSize: current.fontSizeHalfPoints } : {}),
          ...(current.alignment ? { alignment: current.alignment as never } : {}),
          ...(current.styleId ? { styleId: current.styleId } : {}),
          ...(current.color ? { color: `#${current.color}` } : {}),
          ...(current.highlight ? { highlight: current.highlight } : {}),
        });
      }
      onStateChange?.(next);
    },
    [onStateChange]
  );

  const onFormat = useCallback((action: FormattingAction) => {
    const editor = editorRef.current;
    if (!editor) return;

    if (typeof action === 'string') {
      switch (action) {
        case 'bold':
          return editor.toggleRunProperty('b');
        case 'italic':
          return editor.toggleRunProperty('i');
        case 'underline':
          return editor.toggleRunProperty('u', { val: 'single' });
        case 'strikethrough':
          return editor.toggleRunProperty('strike');
        case 'superscript':
          return editor.setRunProperty('vertAlign', { val: 'superscript' });
        case 'subscript':
          return editor.setRunProperty('vertAlign', { val: 'subscript' });
        case 'clearFormatting':
          // Explicit OFF, not removal: the property may be inherited from a style, and
          // dropping the local override would let the inherited value come back.
          editor.setRunProperty('b', { val: '0' });
          editor.setRunProperty('i', { val: '0' });
          editor.setRunProperty('u', { val: 'none' });
          editor.setRunProperty('strike', { val: '0' });
          editor.setRunProperty('vertAlign', { val: 'baseline' });
          return;
        default:
          // Lists, indent, links and direction are deferred lanes. Doing nothing visibly is
          // honest; approximating them would write OOXML the engine cannot round-trip.
          return;
      }
    }

    switch (action.type) {
      case 'fontFamily':
        return editor.setRunProperty('rFonts', { ascii: action.value, hAnsi: action.value });
      case 'fontSize':
        // The picker speaks half-points, which is what `w:sz` stores.
        return editor.setRunProperty('sz', { val: String(action.value) });
      case 'textColor': {
        const hex = hexOf(typeof action.value === 'string' ? action.value : '');
        return hex ? editor.setRunProperty('color', { val: hex }) : undefined;
      }
      case 'highlightColor': {
        const name = HIGHLIGHT_BY_HEX.get(action.value.toLowerCase());
        // `w:highlight` takes a NAME from a fixed list, not a hex. An unmapped colour is
        // refused rather than written as something Word would drop on open.
        return name ? editor.setRunProperty('highlight', { val: name }) : undefined;
      }
      case 'alignment':
        return editor.setParagraphProperty('jc', { val: String(action.value) });
      case 'lineSpacing':
        return editor.setParagraphProperty('spacing', {
          line: String(Math.round(action.value * 240)),
          lineRule: 'auto',
        });
      case 'applyStyle':
        return editor.setParagraphProperty('pStyle', { val: action.value });
      default:
        return;
    }
  }, []);

  // The chrome skeleton: a fixed toolbar above a scroll container holding the pages. The
  // full shell adds rulers, the outline panel and the sidebar, all of which need section
  // properties — page size and margins — that this surface does not publish yet.
  return (
    <div
      className={className ?? 'ep-root docx-editor docx-paginated-shell'}
      style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}
      data-testid="paginated-shell"
    >
      <Toolbar
        currentFormatting={formatting}
        onFormat={onFormat}
        onUndo={() => editorRef.current?.undo()}
        onRedo={() => editorRef.current?.redo()}
        canUndo={state?.canUndo ?? false}
        canRedo={state?.canRedo ?? false}
      />
      <div
        className="docx-editor__scroll-container"
        style={{ flex: 1, minHeight: 0, overflow: 'auto' }}
      >
        <PaginatedDocxEditor
          ref={editorRef}
          source={source}
          {...(scale === undefined ? {} : { scale })}
          {...(measurer ? { measurer } : {})}
          onStateChange={refresh}
          {...(onError ? { onError } : {})}
        />
      </div>
    </div>
  );
}
