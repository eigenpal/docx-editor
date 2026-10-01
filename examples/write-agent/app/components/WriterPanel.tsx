'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from 'ai';
import type { DocxEditorRuntime } from '@docx-editor.dev/editor-api/browser';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { createWriterRuntime, runWriterTool } from '../agent/run-tool';
import { useTranslation } from '@docx-editor.dev/react';
import type { WriterMode } from '../agent/run-tool';
import { WriterStreamEdits } from '../agent/stream-edits';
import type { WriterPart } from '../agent/stream-input';

const SUGGESTIONS = ['nda', 'intake', 'proposal'] as const;

function toolFailure(part: { type: string }): string | null {
  const output = (part as { output?: unknown }).output;
  if (typeof output !== 'string') return null;
  try {
    const result = JSON.parse(output);
    return result.success === false && typeof result.output === 'string' ? result.output : null;
  } catch {
    return null;
  }
}

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
  const { t } = useTranslation();
  const [mode, setMode] = useState<WriterMode>('direct');
  const [input, setInput] = useState('');
  const [stopped, setStopped] = useState(false);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const interrupted = useRef(false);
  const requestStopped = useRef(false);
  const requestAbort = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const runtime = useWriterRuntime(editor);
  const notReady = t('writerAgent.notReady');
  const dependencies = useRef({ runtime, editor, onDocumentTitle, mode, notReady });
  useEffect(() => {
    dependencies.current = { runtime, editor, onDocumentTitle, mode, notReady };
  }, [runtime, editor, onDocumentTitle, mode, notReady]);

  const streamEdits = useMemo(
    () =>
      new WriterStreamEdits(
        async (name, input, callId, appendDraft, draftPreviousList, signal) => {
          if (!runtime || !editor) return { success: false, output: dependencies.current.notReady };
          const result = await runWriterTool(
            runtime,
            editor,
            name,
            input,
            dependencies.current.mode,
            callId,
            { appendDraft, draftPreviousList, signal }
          );
          if (result.success && name === 'create_document' && !appendDraft)
            dependencies.current.onDocumentTitle(input.title as string);
          return result;
        },
        (id, count) => setProgress((previous) => ({ ...previous, [id]: count }))
      ),
    [runtime, editor]
  );
  useEffect(
    () => () => {
      streamEdits.stop();
      requestAbort.current?.abort();
    },
    [streamEdits]
  );

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/chat',
        body: () => ({ mode: dependencies.current.mode, interrupted: interrupted.current }),
      }),
    []
  );
  const chatRef = useRef<{ addToolResult: (args: unknown) => Promise<void> } | null>(null);
  const chat = useChat({
    transport,
    sendAutomaticallyWhen: (context) =>
      !requestStopped.current && lastAssistantMessageIsCompleteWithToolCalls(context),
    onData: (part) => {
      if (!requestStopped.current && part.type === 'data-writer-part')
        streamEdits.push(part.data as WriterPart);
    },
    onError: () => {
      streamEdits.stop();
      requestAbort.current?.abort();
      requestStopped.current = true;
      interrupted.current = true;
      generation.current++;
    },
    onToolCall: async ({ toolCall }) => {
      if (requestStopped.current) return;
      const startedGeneration = generation.current;
      const current = dependencies.current;
      let output: string;
      try {
        const streamed = await streamEdits.finish(
          toolCall.toolCallId,
          toolCall.toolName,
          toolCall.input
        );
        if (startedGeneration !== generation.current || requestStopped.current) return;
        const result =
          streamed ??
          (current.runtime && current.editor
            ? await runWriterTool(
                current.runtime,
                current.editor,
                toolCall.toolName,
                (toolCall.input ?? {}) as Record<string, unknown>,
                current.mode,
                toolCall.toolCallId,
                { signal: requestAbort.current?.signal }
              )
            : { success: false, output: t('writerAgent.notReady') });
        output = JSON.stringify(result);
        if (result.success && toolCall.toolName === 'create_document') {
          const title = (toolCall.input as { title?: unknown } | undefined)?.title;
          if (typeof title === 'string') current.onDocumentTitle(title);
        }
      } catch (error) {
        output = JSON.stringify({
          success: false,
          code: 'OperationFailed',
          output: error instanceof Error ? error.message : String(error),
        });
      }
      if (startedGeneration !== generation.current || requestStopped.current) return;
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
      generation.current++;
      requestStopped.current = false;
      requestAbort.current = new AbortController();
      setStopped(false);
      chat.sendMessage({ text });
      if (!suggestion) setInput('');
    },
    [chat, input, loading]
  );

  return (
    <aside className="agent-panel">
      <header className="agent-panel-title">
        <strong>{t('writerAgent.title')}</strong>
        <span>{t('writerAgent.subtitle')}</span>
      </header>
      <div className="agent-log">
        {chat.messages.length === 0 ? (
          <div className="agent-empty">
            <p>{t('writerAgent.empty')}</p>
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="agent-suggestion"
                onClick={() => send(t(`writerAgent.suggestions.${suggestion}`))}
                disabled={!runtime || loading}
              >
                {t(`writerAgent.suggestions.${suggestion}`)}
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
              const errorText = (part as { errorText?: unknown }).errorText;
              const count = progress[(part as { toolCallId: string }).toolCallId];
              const failure =
                state === 'output-error'
                  ? typeof errorText === 'string'
                    ? errorText
                    : t('writerAgent.failed')
                  : toolFailure(part);
              return (
                <div
                  key={key}
                  className="agent-tool"
                  data-running={!state.startsWith('output-')}
                  data-failed={failure !== null}
                  title={failure ?? undefined}
                >
                  <span className="agent-tool-dot" />
                  {failure !== null ? t('writerAgent.failed') + ' — ' : null}
                  {t(
                    `writerAgent.tools.${part.type.slice('tool-'.length)}` as Parameters<
                      typeof t
                    >[0]
                  )}
                  {count ? <span>{t('writerAgent.updatedParts', { count })}</span> : null}
                </div>
              );
            }
            return null;
          })
        )}
        {loading ? <div className="agent-thinking">{t('writerAgent.working')}</div> : null}
        {stopped ? <div className="agent-thinking">{t('writerAgent.stopped')}</div> : null}
        {chat.error ? <div className="agent-error">{chat.error.message}</div> : null}
      </div>
      <div className="agent-composer">
        {loading ? (
          <button
            type="button"
            onClick={() => {
              streamEdits.stop();
              requestAbort.current?.abort();
              requestStopped.current = true;
              interrupted.current = true;
              generation.current++;
              chat.stop();
              setStopped(true);
            }}
          >
            {t('writerAgent.stop')}
          </button>
        ) : null}
        <label>
          {t('writerAgent.mode')}
          <select
            value={mode}
            disabled={loading}
            onChange={(event) => setMode(event.target.value as WriterMode)}
          >
            <option value="direct">{t('writerAgent.direct')}</option>
            <option value="suggest">{t('writerAgent.suggest')}</option>
          </select>
        </label>
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
            placeholder={t('writerAgent.placeholder')}
          />
          <button type="submit" disabled={!runtime || loading || !input.trim()}>
            {t('writerAgent.send')}
          </button>
        </form>
      </div>
    </aside>
  );
}
