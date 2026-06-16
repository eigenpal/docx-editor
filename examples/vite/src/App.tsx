import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { createEmptyDocument, findStartPosForParaId } from '@eigenpal/docx-editor-core';
import { setSuggestionMode } from '@eigenpal/docx-editor-core/prosemirror/plugins';
// Re-exported by core, so the demo needs no direct `prosemirror-state` dep
// (which would break the production build — it isn't in examples/vite deps).
import { TextSelection } from '@eigenpal/docx-editor-core/prosemirror';
import {
  acceptChangeById,
  rejectChangeById,
  acceptAllChanges,
  rejectAllChanges,
  addRowBelow,
  deleteRow,
  insertTable,
  insertImageNode,
} from '@eigenpal/docx-editor-core/prosemirror/commands';
import { loadFont } from '@eigenpal/docx-editor-core/utils';
import { DocxEditor, type DocxEditorRef } from '@eigenpal/docx-editor-react';
import {
  AgentChatLog,
  type AgentMessage,
  getToolDisplayName,
} from '@eigenpal/docx-editor-agents/react';
import { ExampleSwitcher } from '../../shared/ExampleSwitcher';
import { AdapterSwitcher } from '../../shared/AdapterSwitcher';
import { BrandLogo } from '../../shared/BrandLogo';

function extractDocumentText(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const maybeText = (value as { text?: unknown }).text;
  if (typeof maybeText === 'string') return maybeText;
  return Object.values(value)
    .map((child) =>
      Array.isArray(child)
        ? child.map((item) => extractDocumentText(item)).join('')
        : extractDocumentText(child)
    )
    .join('');
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
    background: '#f8fafc',
  },
  main: {
    flex: 1,
    display: 'flex',
    overflow: 'hidden',
  },
  fileInputLabel: {
    padding: '6px 12px',
    background: 'var(--doc-text)',
    color: 'var(--doc-on-primary)',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 500,
    transition: 'background 0.15s',
    whiteSpace: 'nowrap',
  },
  button: {
    padding: '6px 12px',
    background: 'var(--doc-surface)',
    border: '1px solid var(--doc-border)',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 500,
    color: 'var(--doc-text)',
    transition: 'all 0.15s',
    whiteSpace: 'nowrap',
  },
  newButton: {
    padding: '6px 12px',
    background: 'var(--doc-bg-subtle)',
    color: 'var(--doc-text)',
    border: '1px solid var(--doc-border)',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 500,
    transition: 'all 0.15s',
    whiteSpace: 'nowrap',
  },
  status: {
    fontSize: '12px',
    color: 'var(--doc-text-muted)',
    padding: '4px 8px',
    background: 'var(--doc-bg-subtle)',
    borderRadius: '4px',
  },
};

function useResponsiveLayout() {
  const calcZoom = () => {
    const pageWidth = 816 + 48; // 8.5in * 96dpi + padding
    const vw = window.innerWidth;
    return vw < pageWidth ? Math.max(0.35, Math.floor((vw / pageWidth) * 20) / 20) : 1.0;
  };

  const [zoom, setZoom] = useState(calcZoom);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768);

  useEffect(() => {
    const onResize = () => {
      setZoom(calcZoom());
      setIsMobile(window.innerWidth <= 768);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return { zoom, isMobile };
}

/** Fumadocs-style segmented light/dark toggle (sun/moon, sliding highlight). */
function ThemeToggle({
  value,
  onChange,
}: {
  value: 'light' | 'dark';
  onChange: (m: 'light' | 'dark') => void;
}) {
  const options: { mode: 'light' | 'dark'; label: string; icon: React.ReactNode }[] = [
    {
      mode: 'light',
      label: 'Light',
      icon: (
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ),
    },
    {
      mode: 'dark',
      label: 'Dark',
      icon: (
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
        </svg>
      ),
    },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Color theme"
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2,
        padding: 2,
        borderRadius: 9999,
        border: '1px solid var(--doc-border)',
        background: 'var(--doc-bg-subtle)',
      }}
    >
      {options.map((opt) => {
        const selected = value === opt.mode;
        return (
          <button
            key={opt.mode}
            type="button"
            role="radio"
            aria-checked={selected}
            title={`${opt.label} mode`}
            onClick={() => onChange(opt.mode)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 26,
              height: 26,
              border: 'none',
              borderRadius: 9999,
              cursor: 'pointer',
              transition: 'background 0.15s, color 0.15s',
              background: selected ? 'var(--doc-surface)' : 'transparent',
              boxShadow: selected ? '0 1px 2px var(--doc-shadow-subtle)' : 'none',
              color: selected ? 'var(--doc-text)' : 'var(--doc-text-subtle)',
            }}
          >
            {opt.icon}
          </button>
        );
      })}
    </div>
  );
}

export function App() {
  const randomAuthor = useMemo(
    () => `Docx Editor User ${Math.floor(Math.random() * 900) + 100}`,
    []
  );
  const editorRef = useRef<DocxEditorRef>(null);
  const [currentDocument, setCurrentDocument] = useState<Document | null>(null);
  const [documentBuffer, setDocumentBuffer] = useState<ArrayBuffer | null>(null);
  const [fileName, setFileName] = useState<string>('docx-editor-demo.docx');
  const [status, setStatus] = useState<string>('');
  const [colorMode, setColorMode] = useState<'light' | 'dark'>('light');
  const disableFindReplaceShortcuts = useMemo(
    () => new URLSearchParams(window.location.search).get('disableFindReplaceShortcuts') === '1',
    []
  );
  // E2E hook: ?customFonts=1 wires a custom-font registration against the
  // bundled fixture so the Playwright suite can verify the `fonts` prop both
  // injects @font-face and renders glyphs from the loaded face.
  const customFonts = useMemo(() => {
    if (typeof window === 'undefined') return undefined;
    const params = new URLSearchParams(window.location.search);
    if (params.get('customFonts') !== '1') return undefined;
    return [
      { family: 'E2E Custom Font', src: '/e2e-fixtures/inter-regular.woff2' },
      { family: 'E2E Custom Font', src: '/e2e-fixtures/inter-bold.woff2', weight: 700 },
    ];
  }, []);

  // E2E hook: ?googleFont=Pacifico demonstrates the existing Google Fonts
  // path. The `fonts` prop is for self-hosted faces; for Google Fonts call
  // `loadFont(name)` from `@eigenpal/docx-editor-core/utils` directly.
  const googleFontName = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get('googleFont');
  }, []);
  useEffect(() => {
    if (googleFontName) void loadFont(googleFontName);
  }, [googleFontName]);

  // E2E opt-in: ?e2e=1 in URL, MODE=test, or VITE_DOCX_EDITOR_E2E=1. Gates the
  // Playwright debug hooks below. By default E2E still loads the demo fixture
  // (so existing tests are unaffected); ?empty=1 boots from an empty document
  // instead, giving tests that build their own content a deterministic start
  // that doesn't race the demo fetch.
  const { isE2E, e2eBootEmpty } = useMemo(() => {
    if (typeof window === 'undefined') return { isE2E: false, e2eBootEmpty: false };
    const params = new URLSearchParams(window.location.search);
    const env = import.meta.env;
    const e2e =
      params.get('e2e') === '1' || env.MODE === 'test' || env.VITE_DOCX_EDITOR_E2E === '1';
    return { isE2E: e2e, e2eBootEmpty: e2e && params.get('empty') === '1' };
  }, []);

  const { zoom: autoZoom, isMobile } = useResponsiveLayout();

  useEffect(() => {
    // Only expose Playwright/E2E hooks under an explicit opt-in. Otherwise
    // this leaks an internal API into the public demo at docx-editor.dev.
    if (!isE2E) return;
    window.__DOCX_EDITOR_E2E__ = {
      // Raw body EditorView — lets specs build precise PM states (e.g. a line
      // with mixed font sizes) without driving the toolbar UI.
      getView: () => editorRef.current?.getEditorRef()?.getView?.() ?? null,
      getPmStartForParaId: (paraId: string) => {
        const state = editorRef.current?.getEditorRef()?.getState?.();
        if (!state || !paraId) return null;
        return findStartPosForParaId(state.doc, paraId);
      },
      getSelectionAnchor: () => {
        const state = editorRef.current?.getEditorRef()?.getState?.();
        return state?.selection.anchor ?? null;
      },
      getTextblockEndForParaId: (paraId: string) => {
        const state = editorRef.current?.getEditorRef()?.getState?.();
        if (!state || !paraId) return null;
        const start = findStartPosForParaId(state.doc, paraId);
        if (start == null) return null;
        const node = state.doc.nodeAt(start);
        return node?.isTextblock === true ? start + 1 + node.content.size : null;
      },
      getFirstTextblockParaId: () => {
        const view = editorRef.current?.getEditorRef()?.getView?.();
        if (!view) return null;
        let found: string | null = null;
        view.state.doc.descendants((node) => {
          if (node.isTextblock && node.attrs?.paraId) {
            found = String(node.attrs.paraId);
            return false;
          }
          return true;
        });
        return found;
      },
      getLastTextblockParaId: () => {
        const view = editorRef.current?.getEditorRef()?.getView?.();
        if (!view) return null;
        let found: string | null = null;
        view.state.doc.descendants((node) => {
          if (node.isTextblock && node.attrs?.paraId) {
            found = String(node.attrs.paraId);
          }
          return true;
        });
        return found;
      },
      scrollToParaId: (paraId: string) => editorRef.current?.scrollToParaId(paraId) ?? false,
      scrollToPosition: (pmPos: number) => {
        editorRef.current?.scrollToPosition(pmPos);
      },
      getDocSize: () => {
        const state = editorRef.current?.getEditorRef()?.getState?.();
        return state?.doc.content.size ?? null;
      },
      highlightRange: (from: number, to: number) => {
        editorRef.current?.highlightRange(from, to);
      },
      scrollToCommentId: (commentId: number) =>
        editorRef.current?.scrollToCommentId(commentId) ?? false,
      scrollToChangeId: (revisionId: number) =>
        editorRef.current?.scrollToChangeId(revisionId) ?? false,
      scrollToPage: (pageNumber: number) => {
        editorRef.current?.scrollToPage(pageNumber);
      },
      getTotalPages: () => editorRef.current?.getTotalPages() ?? 0,
      getCurrentPage: () => editorRef.current?.getCurrentPage() ?? 0,
      saveByteLength: async () => {
        const buffer = await editorRef.current?.save();
        return buffer?.byteLength ?? null;
      },
      // Content-control (SDT) addressing surface.
      agentGetContentControls: (filter?: {
        tag?: string;
        alias?: string;
        id?: number;
        type?: string;
      }) =>
        editorRef.current
          ?.getContentControls(filter as Parameters<typeof editorRef.current.getContentControls>[0])
          .map((c) => ({ tag: c.tag, alias: c.alias, sdtType: c.sdtType, text: c.text })) ?? [],
      agentSetContentControlContent: (
        filter: { tag?: string; alias?: string; id?: number },
        text: string,
        options?: { force?: boolean }
      ) => editorRef.current?.setContentControlContent(filter, text, options) ?? false,
      agentRemoveContentControl: (
        filter: { tag?: string; alias?: string; id?: number },
        options?: { force?: boolean; keepContent?: boolean }
      ) => editorRef.current?.removeContentControl(filter, options) ?? false,
      agentScrollToContentControl: (filter: { tag?: string; alias?: string; id?: number }) =>
        editorRef.current?.scrollToContentControl(filter) ?? false,
      // Agent-bridge surface — drives the same paths the live agent uses.
      agentAddComment: (opts: { paraId: string; text: string; author?: string; search?: string }) =>
        editorRef.current?.addComment({
          paraId: opts.paraId,
          text: opts.text,
          author: opts.author ?? 'E2E',
          search: opts.search,
        }) ?? null,
      agentProposeChange: (opts: {
        paraId: string;
        search: string;
        replaceWith: string;
        author?: string;
      }) =>
        editorRef.current?.proposeChange({
          paraId: opts.paraId,
          search: opts.search,
          replaceWith: opts.replaceWith,
          author: opts.author ?? 'E2E',
        }) ?? false,
      agentReplyComment: (commentId: number, text: string, author = 'E2E') =>
        editorRef.current?.replyToComment(commentId, text, author) ?? null,
      agentResolveComment: (commentId: number) => editorRef.current?.resolveComment(commentId),
      agentFind: (query: string) => editorRef.current?.findInDocument(query) ?? [],
      agentSelection: () => editorRef.current?.getSelectionInfo() ?? null,
      agentGetCommentCount: () => editorRef.current?.getComments().length ?? 0,
      // Event subscriptions — count fires so tests can assert listeners are wired.
      agentOnContentChangeCount: 0,
      agentOnSelectionChangeCount: 0,
      agentSubscribeContentChange: () => {
        const hook = window.__DOCX_EDITOR_E2E__;
        if (!hook) return () => undefined;
        const unsub = editorRef.current?.onContentChange(() => {
          hook.agentOnContentChangeCount = (hook.agentOnContentChangeCount ?? 0) + 1;
        });
        return unsub ?? (() => undefined);
      },
      agentSubscribeSelectionChange: () => {
        const hook = window.__DOCX_EDITOR_E2E__;
        if (!hook) return () => undefined;
        const unsub = editorRef.current?.onSelectionChange(() => {
          hook.agentOnSelectionChangeCount = (hook.agentOnSelectionChangeCount ?? 0) + 1;
        });
        return unsub ?? (() => undefined);
      },
      agentApplyFormatting: (opts: {
        paraId: string;
        search?: string;
        marks: Parameters<NonNullable<typeof editorRef.current>['applyFormatting']>[0]['marks'];
      }) => editorRef.current?.applyFormatting(opts) ?? false,
      agentSetParagraphStyle: (opts: { paraId: string; styleId: string }) =>
        editorRef.current?.setParagraphStyle(opts) ?? false,
      agentGetPageContent: (pageNumber: number) =>
        editorRef.current?.getPageContent(pageNumber) ?? null,
      agentGetDocumentText: () => extractDocumentText(editorRef.current?.getDocument()),
      // Tracked structural revisions (#614). Drive the suggesting-mode plugin
      // and the new id-based accept/reject commands directly against the
      // active PM view, so tests don't depend on React mode-prop wiring.
      setSuggestionMode: (active: boolean, authorOverride?: string) => {
        const view = editorRef.current?.getEditorRef()?.getView?.();
        if (!view) return false;
        setSuggestionMode(active, view.state, view.dispatch, authorOverride ?? randomAuthor);
        return true;
      },
      getParagraphRevisionAt: (index: number) => {
        const view = editorRef.current?.getEditorRef()?.getView?.();
        if (!view) return null;
        let count = 0;
        let out: { pPrIns: unknown; pPrDel: unknown } | null = null;
        view.state.doc.descendants((node) => {
          if (out != null) return false;
          if (node.type.name !== 'paragraph') return true;
          if (count === index) {
            out = {
              pPrIns: (node.attrs as Record<string, unknown>).pPrIns ?? null,
              pPrDel: (node.attrs as Record<string, unknown>).pPrDel ?? null,
            };
            return false;
          }
          count += 1;
          return true;
        });
        return out;
      },
      acceptChangeById: (revisionId: number) => {
        const view = editorRef.current?.getEditorRef()?.getView?.();
        if (!view) return false;
        return acceptChangeById(revisionId)(view.state, view.dispatch);
      },
      rejectChangeById: (revisionId: number) => {
        const view = editorRef.current?.getEditorRef()?.getView?.();
        if (!view) return false;
        return rejectChangeById(revisionId)(view.state, view.dispatch);
      },
      acceptAllChanges: () => {
        const view = editorRef.current?.getEditorRef()?.getView?.();
        if (!view) return false;
        return acceptAllChanges()(view.state, view.dispatch);
      },
      rejectAllChanges: () => {
        const view = editorRef.current?.getEditorRef()?.getView?.();
        if (!view) return false;
        return rejectAllChanges()(view.state, view.dispatch);
      },
      // Test-only: read full attrs of the Nth paragraph, including new
      // revision attrs (pPrIns/pPrDel/pPrChange).
      getParagraphAttrs: (index: number) => {
        const view = editorRef.current?.getEditorRef()?.getView?.();
        if (!view) return null;
        let count = 0;
        let out: Record<string, unknown> | null = null;
        view.state.doc.descendants((node) => {
          if (out != null) return false;
          if (node.type.name !== 'paragraph') return true;
          if (count === index) {
            out = { ...node.attrs };
            return false;
          }
          count += 1;
          return true;
        });
        return out;
      },
      // Test-only: insert a 1x1 table at the cursor (replaces selection),
      // bypassing the toolbar. Used by the trIns spec.
      // Calls the real insertTable command — exercises the suggesting-mode
      // tracking path (trIns + cellMarker:ins) when used after setSuggestionMode.
      insertTable: (rows: number, cols: number) => {
        const view = editorRef.current?.getEditorRef()?.getView?.();
        if (!view) return false;
        return insertTable(rows, cols)(view.state, view.dispatch);
      },
      // Test-only: insert an inline image at the cursor via the same helper the
      // UI uses, so it is wrapped in the `insertion` mark under suggesting mode.
      insertImage: (src: string, width = 80, height = 60) => {
        const view = editorRef.current?.getEditorRef()?.getView?.();
        if (!view) return false;
        const imageNode = view.state.schema.nodes.image.create({
          src,
          alt: 'test image',
          width,
          height,
          wrapType: 'inline',
          displayMode: 'inline',
        });
        return insertImageNode(view.state, view.dispatch, imageNode, view.state.selection.from);
      },
      // Test-only: select the first image (a text selection spanning the atom)
      // so a following Backspace/Delete exercises the suggesting-mode
      // atom-deletion path.
      selectFirstImage: () => {
        const view = editorRef.current?.getEditorRef()?.getView?.();
        if (!view) return false;
        let imgPos: number | null = null;
        view.state.doc.descendants((node, pos) => {
          if (imgPos != null) return false;
          if (node.type.name === 'image') {
            imgPos = pos;
            return false;
          }
          return true;
        });
        if (imgPos == null) return false;
        const tr = view.state.tr.setSelection(
          TextSelection.create(view.state.doc, imgPos, imgPos + 1)
        );
        view.dispatch(tr);
        view.focus();
        return true;
      },
      plantSimpleTable: () => {
        const view = editorRef.current?.getEditorRef()?.getView?.();
        if (!view) return false;
        const { schema } = view.state;
        const cellPara = schema.node('paragraph', {}, [schema.text('A')]);
        const cell = schema.node('tableCell', { colspan: 1, rowspan: 1 }, [cellPara]);
        const row = schema.node('tableRow', {}, [cell]);
        const table = schema.node('table', {}, [row]);
        view.dispatch(view.state.tr.replaceSelectionWith(table));
        return true;
      },
      // Test-only: count the rows of the first table in the doc.
      countTableRows: () => {
        const view = editorRef.current?.getEditorRef()?.getView?.();
        if (!view) return 0;
        let count = 0;
        let inFirstTable = false;
        view.state.doc.descendants((node) => {
          if (node.type.name === 'table') {
            if (inFirstTable) return false;
            inFirstTable = true;
            return true;
          }
          if (inFirstTable && node.type.name === 'tableRow') count += 1;
          return false;
        });
        return count;
      },
      // Test-only: place the caret inside the first cell of the first
      // table in the doc so suggesting-mode commands like `addRowBelow`
      // have a row index to work with.
      focusFirstTableCell: () => {
        const view = editorRef.current?.getEditorRef()?.getView?.();
        if (!view) return false;
        let target: number | null = null;
        view.state.doc.descendants((node, pos) => {
          if (target != null) return false;
          if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
            // `pos + 2` works when the first child is a paragraph (the
            // typical case). If it's a nested table, `TextSelection.near`
            // snaps forward to the next text-allowing position.
            target = pos + 2;
            return false;
          }
          return true;
        });
        if (target == null) return false;
        // Use the constructor on the live selection to avoid a direct
        // `prosemirror-state` dependency in the demo's package.json.
        const SelectionCtor = view.state.selection.constructor as unknown as {
          near: (
            $pos: import('prosemirror-model').ResolvedPos
          ) => import('prosemirror-state').Selection;
        };
        const tr = view.state.tr.setSelection(SelectionCtor.near(view.state.doc.resolve(target)));
        view.dispatch(tr);
        view.focus();
        return true;
      },
      // Test-only: dispatch the `addRowBelow` table command. Suggesting-mode
      // active → sets `trIns` on the new row + `cellMarker: ins` on each cell.
      addRowBelow: () => {
        const view = editorRef.current?.getEditorRef()?.getView?.();
        if (!view) return false;
        return addRowBelow(view.state, view.dispatch);
      },
      // Test-only: dispatch the schema-free `deleteRow` table command.
      // Suggesting-mode active → sets `trDel` on the row + `cellMarker: del`.
      deleteCurrentRow: () => {
        const view = editorRef.current?.getEditorRef()?.getView?.();
        if (!view) return false;
        return deleteRow(view.state, view.dispatch);
      },
      // Test-only: plant trIns on the first table row in the document.
      // Returns false if no table exists.
      plantTableRowInsertion: (revisionId: number) => {
        const view = editorRef.current?.getEditorRef()?.getView?.();
        if (!view) return false;
        let rowPos: number | null = null;
        let rowNode: import('prosemirror-model').Node | null = null;
        view.state.doc.descendants((node, pos) => {
          if (rowPos != null) return false;
          if (node.type.name === 'tableRow') {
            rowPos = pos;
            rowNode = node;
            return false;
          }
          return true;
        });
        if (rowPos == null || rowNode == null) return false;
        view.dispatch(
          view.state.tr.setNodeMarkup(rowPos, undefined, {
            ...(rowNode as import('prosemirror-model').Node).attrs,
            trIns: {
              revisionId,
              author: 'Jane',
              date: new Date().toISOString(),
            },
          })
        );
        return true;
      },
      getFirstTableRowAttrs: () => {
        const view = editorRef.current?.getEditorRef()?.getView?.();
        if (!view) return null;
        let out: Record<string, unknown> | null = null;
        view.state.doc.descendants((node) => {
          if (out != null) return false;
          if (node.type.name === 'tableRow') {
            out = { ...node.attrs };
            return false;
          }
          return true;
        });
        return out;
      },
      // Test-only: plant a pPrChange entry on the first paragraph for
      // round-trip / reject-restore verification. `current` and `paraAttrs`
      // let a test simulate a post-save/reload state (e.g. a list-creation
      // suggestion whose empty prior `<w:pPr/>` round-tripped without numPr).
      plantParagraphPropertyChange: (
        revisionId: number,
        prior: unknown,
        current?: unknown,
        paraAttrs?: Record<string, unknown>
      ) => {
        const view = editorRef.current?.getEditorRef()?.getView?.();
        if (!view) return false;
        let firstParaPos: number | null = null;
        let firstPara: import('prosemirror-model').Node | null = null;
        view.state.doc.descendants((node, pos) => {
          if (firstParaPos != null) return false;
          if (node.type.name === 'paragraph') {
            firstParaPos = pos;
            firstPara = node;
            return false;
          }
          return true;
        });
        if (firstParaPos == null || firstPara == null) return false;
        const tr = view.state.tr.setNodeMarkup(firstParaPos, undefined, {
          ...(firstPara as import('prosemirror-model').Node).attrs,
          ...(paraAttrs ?? {}),
          pPrChange: [
            {
              type: 'paragraphPropertyChange',
              info: { id: revisionId, author: 'Jane', date: new Date().toISOString() },
              previousFormatting: prior,
              ...(current !== undefined ? { currentFormatting: current } : {}),
            },
          ],
        });
        view.dispatch(tr);
        return true;
      },
    };
    return () => {
      delete window.__DOCX_EDITOR_E2E__;
    };
  }, [isE2E, randomAuthor]);

  // Set once the user starts their own document (New / open a file). The demo
  // fixture fetch below resolves asynchronously and must NOT clobber that
  // choice if it lands afterwards — otherwise New during the (slow) demo load
  // silently restores the demo. This was the root cause of the formatting /
  // text-editing E2E flakes: `newDocument` cleared the doc, then the late
  // fetch repopulated it and subsequent edits landed on the demo content.
  const userStartedOwnDocRef = useRef(false);
  // Bumped on New / open to force a fresh DocxEditor instance (see handlers).
  const [docVersion, setDocVersion] = useState(0);

  useEffect(() => {
    // Under E2E with ?empty=1, boot empty so tests get a deterministic,
    // known starting document instead of racing this async fixture fetch.
    if (e2eBootEmpty) {
      setCurrentDocument(createEmptyDocument());
      setFileName('Untitled.docx');
      return;
    }
    fetch(`${import.meta.env.BASE_URL}docx-editor-demo.docx`)
      .then((res) => res.arrayBuffer())
      .then((buffer) => {
        if (userStartedOwnDocRef.current) return; // user already moved on
        setDocumentBuffer(buffer);
        setFileName('docx-editor-demo.docx');
      })
      .catch(() => {
        if (userStartedOwnDocRef.current) return;
        setCurrentDocument(createEmptyDocument());
        setFileName('Untitled.docx');
      });
  }, [e2eBootEmpty]);

  const handleNewDocument = useCallback(() => {
    userStartedOwnDocRef.current = true;
    setCurrentDocument(createEmptyDocument());
    setDocumentBuffer(null);
    setFileName('Untitled.docx');
    setStatus('');
    // Force a fresh editor instance. Switching the `documentBuffer` prop from a
    // loaded buffer back to an empty `document` does not reliably re-init the
    // editor's content, so remount it via a changing key — otherwise "New"
    // leaves the previous document in the editor.
    setDocVersion((v) => v + 1);
  }, []);

  const handleFileSelect = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      userStartedOwnDocRef.current = true;
      setStatus('Loading...');
      const buffer = await file.arrayBuffer();
      setCurrentDocument(null);
      setDocumentBuffer(buffer);
      setFileName(file.name);
      setStatus('');
      setDocVersion((v) => v + 1);
    } catch {
      setStatus('Error loading file');
    }
  }, []);

  const handleSave = useCallback(async () => {
    if (!editorRef.current) return;

    try {
      setStatus('Saving...');
      const buffer = await editorRef.current.save();
      if (buffer) {
        const blob = new Blob([buffer], {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName || 'document.docx';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setStatus('Saved!');
        setTimeout(() => setStatus(''), 2000);
      }
    } catch {
      setStatus('Save failed');
    }
  }, [fileName]);

  const handleError = useCallback((error: Error) => {
    console.error('Editor error:', error);
    setStatus(`Error: ${error.message}`);
  }, []);

  const renderLogo = useCallback(
    () => (
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <BrandLogo />
        <AdapterSwitcher current="react" />
        <ExampleSwitcher current="Vite" />
      </div>
    ),
    []
  );

  const renderTitleBarRight = useCallback(
    () => (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <ThemeToggle value={colorMode} onChange={setColorMode} />
        <label style={styles.fileInputLabel} onMouseDown={(e) => e.stopPropagation()}>
          <input
            type="file"
            accept=".docx"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
          Open DOCX
        </label>
        <button style={styles.newButton} onClick={handleNewDocument}>
          New
        </button>
        <button style={styles.button} onClick={handleSave}>
          Save
        </button>
        {status && <span style={styles.status}>{status}</span>}
      </div>
    ),
    [handleFileSelect, handleNewDocument, handleSave, status, colorMode]
  );

  // Opt-in agent panel for E2E + manual smoke testing. Adds the right-hand
  // panel + toolbar toggle when ?agentPanel=1 (or VITE_DOCX_EDITOR_AGENT_PANEL=1)
  // is set, so the live demo at docx-editor.dev stays unchanged.
  const showAgentPanel = (() => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    if (params.get('agentPanel') === '1' || params.get('agentTimeline') === '1') return true;
    return import.meta.env.VITE_DOCX_EDITOR_AGENT_PANEL === '1';
  })();

  // Fixture for the AgentTimeline e2e test. `?agentTimeline=streaming` boots
  // with an in-flight turn (timeline expanded, spinner). `?agentTimeline=done`
  // boots with a completed turn (timeline collapsed). `?agentTimeline=long`
  // boots with 8 calls so the test can assert the "+N earlier steps" cap.
  // Falls back to no fixture so other agent-panel tests are unaffected.
  const agentTimelineFixture: AgentMessage[] | null = (() => {
    if (typeof window === 'undefined') return null;
    const mode = new URLSearchParams(window.location.search).get('agentTimeline');
    if (!mode) return null;
    const isStreaming = mode === 'streaming';
    if (mode === 'long') {
      const calls: NonNullable<AgentMessage['toolCalls']> = [
        { id: 't1', name: 'read_document', status: 'done', result: '...' },
        ...Array.from({ length: 7 }, (_, i) => ({
          id: `t${i + 2}`,
          name: 'add_comment',
          status: 'done' as const,
          result: `Comment ${i + 1} added.`,
        })),
      ];
      return [
        { id: 'u1', role: 'user', text: 'Roast everything.' },
        {
          id: 'a1',
          role: 'assistant',
          text: 'Done — 7 comments.',
          status: 'done',
          toolCalls: calls,
        },
      ];
    }
    return [
      { id: 'u1', role: 'user', text: 'Roast my doc.' },
      {
        id: 'a1',
        role: 'assistant',
        text: isStreaming ? '' : 'Done — left 3 comments.',
        status: isStreaming ? 'streaming' : 'done',
        toolCalls: [
          { id: 't1', name: 'read_document', status: 'done', result: '...' },
          { id: 't2', name: 'add_comment', status: 'done', result: 'Comment 1 added.' },
          {
            id: 't3',
            name: 'add_comment',
            status: isStreaming ? 'running' : 'done',
            result: isStreaming ? undefined : 'Comment 2 added.',
          },
        ],
      },
    ];
  })();

  return (
    <div style={styles.container}>
      <main style={styles.main}>
        <DocxEditor
          key={docVersion}
          ref={editorRef}
          document={documentBuffer ? undefined : currentDocument}
          documentBuffer={documentBuffer}
          author={randomAuthor}
          colorMode={colorMode}
          onError={handleError}
          showToolbar={true}
          showRuler={!isMobile}
          showZoomControl={true}
          initialZoom={autoZoom}
          disableFindReplaceShortcuts={disableFindReplaceShortcuts}
          fonts={customFonts}
          watermarkPresets={['SAMPLE', 'DEMO ONLY', 'PREVIEW', 'NOT FOR DISTRIBUTION']}
          renderLogo={renderLogo}
          documentName={fileName}
          onDocumentNameChange={setFileName}
          renderTitleBarRight={renderTitleBarRight}
          agentPanel={
            showAgentPanel
              ? {
                  render: ({ close }) => (
                    <div
                      data-testid="agent-panel-content"
                      style={{ flex: 1, padding: 16, overflow: 'auto' }}
                    >
                      {agentTimelineFixture && (
                        <AgentChatLog
                          messages={agentTimelineFixture}
                          autoScroll={false}
                          humanizeToolName={getToolDisplayName}
                        />
                      )}
                      <p style={{ marginTop: 12, fontSize: 13, color: '#6b7280' }}>
                        BYO chat goes here. This is the demo&apos;s placeholder content.
                      </p>
                      <button
                        type="button"
                        onClick={close}
                        style={{
                          marginTop: 8,
                          padding: '6px 10px',
                          fontSize: 12,
                          background: '#f1f5f9',
                          border: '1px solid #e2e8f0',
                          borderRadius: 6,
                          cursor: 'pointer',
                        }}
                      >
                        Close from inside
                      </button>
                    </div>
                  ),
                }
              : undefined
          }
        />
      </main>
    </div>
  );
}
