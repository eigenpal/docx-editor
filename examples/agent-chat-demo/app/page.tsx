'use client';

/**
 * Roast My Doc — the canonical "plug an agent into the editor" reference.
 *
 * Three pieces:
 *  1. `<DocxEditor agentPanel={{ render }}>` mounts a controllable right-hand
 *     panel. The toolbar gets an assistant button automatically.
 *  2. `useDocxAgentTools` returns `{ tools, executeToolCall, getContext }` —
 *     the hook owns the bridge to the live editor.
 *  3. The chat UI inside `render` is ~40 lines of plain React. We do not
 *     ship message bubbles or a composer; pick your favourite framework
 *     (this example uses raw fetch + OpenAI for zero deps; AI SDK's
 *     `useChat` works with one extra import).
 *
 * Swap the system prompt + tool subset to retarget the agent (legal
 * redlining, writing assistant, summarizer — same plumbing).
 */

import { useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from 'ai';
import {
  type DocxEditorRef,
  AgentChatLog,
  AgentComposer,
  AgentSuggestionChip,
  createEmptyDocument,
} from '@eigenpal/docx-js-editor';
import {
  useDocxAgentTools,
  getToolDisplayName,
  type EditorRefLike,
} from '@eigenpal/docx-editor-agents/react';
import { toAgentMessages } from '@eigenpal/docx-editor-agents/ai-sdk/react';

// SSR-disabled: the editor uses `useSyncExternalStore` which Next.js' SSR
// pre-pass can't snapshot. Lazy-loading on the client sidesteps that.
const DocxEditor = dynamic(
  () => import('@eigenpal/docx-js-editor').then((m) => ({ default: m.DocxEditor })),
  {
    ssr: false,
    loading: () => (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#6b7280',
          fontSize: 13,
        }}
      >
        Loading editor…
      </div>
    ),
  }
);

export default function Page() {
  // Boot directly into the editor with an empty doc — no upload screen.
  const [documentBuffer, setDocumentBuffer] = useState<ArrayBuffer | null>(null);
  const [documentName, setDocumentName] = useState('Untitled.docx');
  const [input, setInput] = useState('');
  const [openError, setOpenError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);

  const editorRef = useRef<DocxEditorRef>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Empty seed document — created once so React doesn't reload the editor on every render.
  const emptyDoc = useMemo(() => createEmptyDocument(), []);

  // Toolkit hook — gives us a tool executor + a context snapshot for the
  // system prompt. This is the entire docx-agents wiring on the React side.
  const { executeToolCall, getContext } = useDocxAgentTools({
    editorRef: editorRef as React.RefObject<EditorRefLike | null>,
    author: 'Roastmaster',
  });

  // AI SDK does the streaming protocol, history, error handling, and
  // tool-call lifecycle. We just hand it our `executeToolCall` for the
  // `onToolCall` hook and inject `getContext()` into the request body.
  // `chat` isn't defined yet inside `onToolCall`, so route the result back
  // through a ref that we set after `useChat` returns.
  const chatRef = useRef<{ addToolResult: (args: unknown) => Promise<void> } | null>(null);
  const chat = useChat({
    transport: new DefaultChatTransport({
      api: '/api/chat',
      prepareSendMessagesRequest: ({ messages: msgs }) => ({
        body: { messages: msgs, context: getContext() },
      }),
    }),
    // After we deliver a tool result via addToolResult, AI SDK won't
    // automatically continue the agent loop. This re-sends the
    // conversation so the model can read its own tool outputs and
    // either call another tool or write the final reply.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onToolCall: ({ toolCall }) => {
      const result = executeToolCall(
        toolCall.toolName,
        (toolCall.input ?? {}) as Record<string, unknown>
      );
      const output =
        typeof result.data === 'string'
          ? result.data
          : (result.error ?? JSON.stringify(result.data));
      // Ship the result back to AI SDK so it commits to message history
      // and the next stream turn can see it. AI SDK v5 changed onToolCall
      // to fire-and-forget; we deliver via addToolResult.
      void chatRef.current?.addToolResult({
        tool: toolCall.toolName,
        toolCallId: toolCall.toolCallId,
        output,
      });
    },
  });
  chatRef.current = chat as unknown as typeof chatRef.current;

  const isLoading = chat.status === 'submitted' || chat.status === 'streaming';
  const messages = useMemo(
    () => toAgentMessages(chat.messages, chat.status),
    [chat.messages, chat.status]
  );
  const error = openError ?? (chat.error ? chat.error.message : null);

  function openFile(f: File) {
    if (!f.name.endsWith('.docx')) {
      setOpenError('Please pick a .docx file');
      return;
    }
    setOpenError(null);
    setDocumentName(f.name);
    f.arrayBuffer().then((buf) => {
      setDocumentBuffer(buf);
      chat.setMessages([]);
    });
  }

  function sendMessage(overrideText?: string) {
    const text = (overrideText ?? input).trim();
    if (!text || isLoading) return;
    chat.sendMessage({ text });
    if (!overrideText) setInput('');
  }

  return (
    <div style={S.layout}>
      <div style={S.editorWrap}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".docx"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) openFile(f);
            e.target.value = '';
          }}
        />
        <DocxEditor
          ref={editorRef}
          // Uncontrolled: pass either the loaded buffer or the empty seed doc.
          // `key` forces a remount when switching between the two so the
          // editor reloads from scratch.
          key={documentBuffer ? documentName : 'empty'}
          documentBuffer={documentBuffer ?? undefined}
          document={documentBuffer ? undefined : emptyDoc}
          documentName={documentName}
          onDocumentNameChange={setDocumentName}
          showRuler={true}
          showZoomControl={true}
          renderTitleBarRight={() => (
            <button style={S.ghostBtn} onClick={() => fileInputRef.current?.click()}>
              Open .docx
            </button>
          )}
          agentPanel={{
            open: panelOpen,
            onOpenChange: setPanelOpen,
            title: 'Roastmaster',
            minWidth: 320,
            defaultWidth: 380,
            render: () => (
              <>
                <AgentChatLog
                  messages={messages}
                  loading={isLoading}
                  error={error}
                  humanizeToolName={getToolDisplayName}
                  emptyState={
                    <div style={S.welcomeCard}>
                      <div style={S.welcomeTitle}>Hi, I&apos;m Roastmaster.</div>
                      <p style={S.welcomeBody}>
                        I read your document and leave a (constructive) roast on every paragraph
                        that deserves one.
                      </p>
                      <div style={S.chipStack}>
                        {SUGGESTIONS.map((s) => (
                          <AgentSuggestionChip
                            key={s}
                            label={s}
                            onClick={() => sendMessage(s)}
                            disabled={isLoading}
                          />
                        ))}
                      </div>
                    </div>
                  }
                />
                <AgentComposer
                  value={input}
                  onChange={setInput}
                  onSubmit={() => sendMessage()}
                  disabled={isLoading}
                  placeholder="Ask the assistant…"
                  footnote="Roastmaster only reads + comments. Won't edit text."
                />
              </>
            ),
          }}
        />
      </div>
    </div>
  );
}

const SUGGESTIONS = [
  'Roast every paragraph that deserves it.',
  'Find the worst sentence and explain why.',
  'Where am I being too wordy?',
];

// Page-level styles only — chat chrome (bubbles, composer, suggestion
// chips) ships from `@eigenpal/docx-js-editor`. The welcome card matches
// the panel's typography for a single visual surface.
const S: Record<string, React.CSSProperties> = {
  layout: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    overflow: 'hidden',
    background: 'var(--doc-bg, #f8f9fa)',
  },
  editorWrap: { flex: 1, overflow: 'hidden', display: 'flex' },
  ghostBtn: {
    padding: '6px 12px',
    fontSize: 13,
    fontWeight: 500,
    color: '#1f1f1f',
    background: '#fff',
    border: '1px solid #dadce0',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: "'Google Sans', 'Google Sans Text', system-ui, sans-serif",
  },
  welcomeCard: {
    background: 'linear-gradient(180deg, #f7f9ff 0%, #fbf6ff 100%)',
    border: '1px solid #e3e8f4',
    borderRadius: 18,
    padding: '18px 16px',
    fontFamily: "'Google Sans', 'Google Sans Text', system-ui, sans-serif",
    color: '#1f1f1f',
  },
  welcomeTitle: { fontSize: 14, fontWeight: 600, marginBottom: 6, color: '#1a1f36' },
  welcomeBody: {
    fontSize: 13,
    color: '#444746',
    lineHeight: 1.55,
    margin: '0 0 14px',
  },
  chipStack: { display: 'flex', flexDirection: 'column', gap: 8 },
};
