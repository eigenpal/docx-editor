'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from 'ai';
import type { DocxEditorRuntime } from '@docx-editor.dev/editor-api/browser';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { createWriterRuntime, runWriterTool } from '../agent/run-tool';
import { toolLabel } from '../agent/tools';

const SUGGESTIONS = [
  'Draft a mutual NDA.',
  'Create a medical intake form.',
  'Write a project proposal.',
];

function useWriterRuntime(editor: DocxEditorInstance | null): DocxEditorRuntime | null {
  const [runtime, setRuntime] = useState<DocxEditorRuntime | null>(null);
  useEffect(() => {
    if (!editor) return;
    const next = createWriterRuntime(editor);
    setRuntime(next);
    return () => {
      next.dispose();
      setRuntime(null);
    };
  }, [editor]);
  return runtime;
}

export function WriterPanel({
  editor,
  onDocumentTitle,
}: {
  editor: DocxEditorInstance | null;
  onDocumentTitle: (title: string) => void;
}) {
  const [input, setInput] = useState('');
  const runtime = useWriterRuntime(editor);
  const dependencies = useRef({ runtime, editor, onDocumentTitle });
  useEffect(() => {
    dependencies.current = { runtime, editor, onDocumentTitle };
  }, [runtime, editor, onDocumentTitle]);

  const transport = useMemo(() => new DefaultChatTransport({ api: '/api/chat' }), []);
  const chatRef = useRef<{ addToolResult: (args: unknown) => Promise<void> } | null>(null);
  const chat = useChat({
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onToolCall: async ({ toolCall }) => {
      const current = dependencies.current;
      let output: string;
      try {
        const result =
          current.runtime && current.editor
            ? await runWriterTool(
                current.runtime,
                current.editor,
                toolCall.toolName,
                (toolCall.input ?? {}) as Record<string, unknown>
              )
            : { success: false, output: 'The editor is not ready.' };
        output = result.success ? result.output : `ERROR: ${result.output}`;
        if (result.success && toolCall.toolName === 'create_document') {
          const title = (toolCall.input as { title?: unknown } | undefined)?.title;
          if (typeof title === 'string') current.onDocumentTitle(title);
        }
      } catch (error) {
        output = `ERROR: ${error instanceof Error ? error.message : String(error)}`;
      }
      void chatRef.current?.addToolResult({
        tool: toolCall.toolName,
        toolCallId: toolCall.toolCallId,
        output,
      });
    },
  });
  useEffect(() => {
    chatRef.current = chat as unknown as typeof chatRef.current;
  }, [chat]);

  const loading = chat.status === 'submitted' || chat.status === 'streaming';
  const send = useCallback(
    (suggestion?: string) => {
      const text = (suggestion ?? input).trim();
      if (!text || loading) return;
      chat.sendMessage({ text });
      if (!suggestion) setInput('');
    },
    [chat, input, loading]
  );

  return (
    <aside className="agent-panel">
      <header className="agent-panel-title">
        <strong>Writer agent</strong>
        <span>Drafts from a short request, then suggests revisions</span>
      </header>
      <div className="agent-log">
        {chat.messages.length === 0 ? (
          <div className="agent-empty">
            <p>
              Describe the document in one line. The writer fills safe gaps with placeholders and
              starts the draft.
            </p>
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="agent-suggestion"
                onClick={() => send(suggestion)}
                disabled={!runtime || loading}
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}
        {chat.messages.flatMap((message) =>
          (message.parts ?? []).map((part, index) => {
            const key = `${message.id}:${index}`;
            if (part.type === 'text' && part.text.trim()) {
              return (
                <div key={key} className={`agent-msg is-${message.role}`}>
                  {part.text}
                </div>
              );
            }
            if (part.type.startsWith('tool-')) {
              const state = (part as { state?: string }).state ?? '';
              return (
                <div key={key} className="agent-tool" data-running={!state.startsWith('output-')}>
                  <span className="agent-tool-dot" />
                  {toolLabel(part.type.slice('tool-'.length))}
                </div>
              );
            }
            return null;
          })
        )}
        {loading ? <div className="agent-thinking">Working…</div> : null}
        {chat.error ? <div className="agent-error">{chat.error.message}</div> : null}
      </div>
      <div className="capability-note">
        Every draft showcases styles, lists, a populated table, content controls, headers, footers,
        and page fields. Columns remain unsupported.
      </div>
      <div className="agent-composer">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
        >
          <textarea
            rows={2}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
            placeholder="Describe the document or request a revision…"
          />
          <button type="submit" disabled={!runtime || loading || !input.trim()}>
            Send
          </button>
        </form>
      </div>
    </aside>
  );
}
