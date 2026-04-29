import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { findStartPosForParaId } from '@eigenpal/docx-core';
import {
  DocxEditor,
  type DocxEditorRef,
  createEmptyDocument,
  AgentChatLog,
  type AgentMessage,
} from '@eigenpal/docx-js-editor';
import { getToolDisplayName } from '@eigenpal/docx-editor-agents/react';
import { ExampleSwitcher } from '../../shared/ExampleSwitcher';
import { GitHubBadge } from '../../shared/GitHubBadge';

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
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
    background: '#0f172a',
    color: '#fff',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 500,
    transition: 'background 0.15s',
    whiteSpace: 'nowrap',
  },
  button: {
    padding: '6px 12px',
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 500,
    color: '#334155',
    transition: 'all 0.15s',
    whiteSpace: 'nowrap',
  },
  newButton: {
    padding: '6px 12px',
    background: '#f1f5f9',
    color: '#334155',
    border: '1px solid #e2e8f0',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 500,
    transition: 'all 0.15s',
    whiteSpace: 'nowrap',
  },
  status: {
    fontSize: '12px',
    color: '#64748b',
    padding: '4px 8px',
    background: '#f1f5f9',
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
  const disableFindReplaceShortcuts = useMemo(
    () => new URLSearchParams(window.location.search).get('disableFindReplaceShortcuts') === '1',
    []
  );

  const { zoom: autoZoom, isMobile } = useResponsiveLayout();

  useEffect(() => {
    // Only expose Playwright/E2E hooks under an explicit opt-in. Otherwise
    // this leaks an internal API into the public demo at docx-editor.dev.
    // Opt-in: ?e2e=1 in URL, MODE=test, or VITE_DOCX_EDITOR_E2E=1.
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const env = import.meta.env;
    const isE2E =
      params.get('e2e') === '1' || env.MODE === 'test' || env.VITE_DOCX_EDITOR_E2E === '1';
    if (!isE2E) return;
    window.__DOCX_EDITOR_E2E__ = {
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
      scrollToPage: (pageNumber: number) => {
        editorRef.current?.scrollToPage(pageNumber);
      },
      getTotalPages: () => editorRef.current?.getTotalPages() ?? 0,
      getCurrentPage: () => editorRef.current?.getCurrentPage() ?? 0,
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
    };
    return () => {
      delete window.__DOCX_EDITOR_E2E__;
    };
  }, []);

  useEffect(() => {
    fetch('/docx-editor-demo.docx')
      .then((res) => res.arrayBuffer())
      .then((buffer) => {
        setDocumentBuffer(buffer);
        setFileName('docx-editor-demo.docx');
      })
      .catch(() => {
        setCurrentDocument(createEmptyDocument());
        setFileName('Untitled.docx');
      });
  }, []);

  const handleNewDocument = useCallback(() => {
    setCurrentDocument(createEmptyDocument());
    setDocumentBuffer(null);
    setFileName('Untitled.docx');
    setStatus('');
  }, []);

  const handleFileSelect = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setStatus('Loading...');
      const buffer = await file.arrayBuffer();
      setCurrentDocument(null);
      setDocumentBuffer(buffer);
      setFileName(file.name);
      setStatus('');
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

  const handleFontsLoaded = useCallback(() => {
    console.log('Fonts loaded');
  }, []);

  const renderLogo = useCallback(
    () => (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <GitHubBadge />
        <ExampleSwitcher current="Vite" />
      </div>
    ),
    []
  );

  const renderTitleBarRight = useCallback(
    () => (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
    [handleFileSelect, handleNewDocument, handleSave, status]
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
          ref={editorRef}
          document={documentBuffer ? undefined : currentDocument}
          documentBuffer={documentBuffer}
          author={randomAuthor}
          onError={handleError}
          onFontsLoaded={handleFontsLoaded}
          showToolbar={true}
          showRuler={!isMobile}
          showZoomControl={true}
          initialZoom={autoZoom}
          disableFindReplaceShortcuts={disableFindReplaceShortcuts}
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
