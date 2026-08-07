'use client';

/**
 * The whole agent wiring, in one file. This is the part to copy.
 *
 * Three seams:
 *  1. `useEditorApiRuntime` turns the live editor into an editor-api runtime.
 *  2. `useReviewOf` from pro supplies the one write editor-api cannot do: create
 *     a comment on the current selection.
 *  3. `useChat` streams from `/api/chat` and hands every tool call to
 *     `runAgentTool`, which drives both of the above.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from 'ai';
import type { DocxEditorRuntime } from '@docx-editor.dev/editor-api/browser';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { useReviewOf } from '@docx-editor.dev/pro/react';
import { createBrowserRuntime, runAgentTool, readAgentContext } from '../agent/run-tool';
import { ChatLog, Composer, toAgentEntries } from './ChatLog';

const AUTHOR = 'Roastmaster';

const SUGGESTIONS = [
  'Roast every paragraph that deserves it.',
  'Find the worst sentence and explain why.',
  'Where am I being too wordy?',
];

/**
 * Holds the editor-api runtime for the editor currently mounted.
 *
 * A runtime is per-editor and disposal is final, so it is rebuilt whenever the
 * editor is replaced and disposed on the way out. Leaking one would keep the
 * previous document's host alive.
 */
function useEditorApiRuntime(editor: DocxEditorInstance | null): DocxEditorRuntime | null {
  const [runtime, setRuntime] = useState<DocxEditorRuntime | null>(null);

  useEffect(() => {
    if (!editor) return;
    const next = createBrowserRuntime(editor);
    // An effect rather than a `useMemo`: the runtime borrows the editor instance
    // and must be disposed with it, and a memo leaks one under StrictMode's
    // double render. This runs once per document load, not per keystroke.
    setRuntime(next);
    return () => {
      next.dispose();
      setRuntime(null);
    };
  }, [editor]);

  return runtime;
}

export function AgentPanel({ editor }: { editor: DocxEditorInstance | null }) {
  const [input, setInput] = useState('');
  const runtime = useEditorApiRuntime(editor);

  // pro's review API bound to the editor we hold, rather than the context-bound
  // `useReview`: this panel renders outside the editor's own React tree.
  const review = useReviewOf(editor);

  // `onToolCall` is captured once by `useChat`, so reach the CURRENT runtime and
  // review binding through a ref rather than through the closure.
  const depsRef = useRef({ runtime, review });
  useEffect(() => {
    depsRef.current = { runtime, review };
  }, [runtime, review]);

  const chatRef = useRef<{ addToolResult: (args: unknown) => Promise<void> } | null>(null);

  const chat = useChat({
    transport: new DefaultChatTransport({
      api: '/api/chat',
      prepareSendMessagesRequest: async ({ messages }) => {
        const current = depsRef.current.runtime;
        return {
          body: { messages, context: current ? await readAgentContext(current) : undefined },
        };
      },
    }),
    // After a tool result is delivered the SDK does not continue on its own.
    // This re-sends the conversation so the model can read its own tool outputs
    // and either call another tool or write the final reply.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onToolCall: async ({ toolCall }) => {
      const { runtime: current, review: currentReview } = depsRef.current;

      // A throwing tool MUST still answer. `addToolResult` below is what lets
      // the model continue; if the executor rejects, this callback unwinds
      // before reaching it and the turn never ends. The panel then sits on
      // "Reading the document" for ever with no error anywhere. Hand the failure
      // to the model instead and let it decide what to do.
      let output: string;
      try {
        const result = current
          ? await runAgentTool(
              {
                runtime: current,
                commentOnSelection: currentReview.comment,
                author: AUTHOR,
              },
              toolCall.toolName,
              (toolCall.input ?? {}) as Record<string, unknown>
            )
          : { output: 'The editor is not ready yet.' };
        output = result.output;
      } catch (error) {
        output = `The ${toolCall.toolName} tool failed: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }

      // NOT awaited, and that is load-bearing. `addToolResult` schedules the
      // continuation request, and the SDK will not start it until this
      // `onToolCall` settles. Awaiting it here deadlocks: the tool finishes, no
      // second request is ever sent, and the panel hangs with no error.
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

  const isLoading = chat.status === 'submitted' || chat.status === 'streaming';
  const entries = useMemo(() => toAgentEntries(chat.messages), [chat.messages]);

  const send = useCallback(
    (overrideText?: string) => {
      const text = (overrideText ?? input).trim();
      if (!text || isLoading) return;
      chat.sendMessage({ text });
      if (!overrideText) setInput('');
    },
    [chat, input, isLoading]
  );

  return (
    <aside className="agent-panel">
      <header className="agent-panel-title">{AUTHOR}</header>
      <ChatLog
        entries={entries}
        loading={isLoading}
        error={chat.error ? chat.error.message : null}
        emptyState={
          <div className="agent-empty">
            <p>
              I read your document and leave a (constructive) roast on every paragraph that deserves
              one.
            </p>
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="agent-suggestion"
                onClick={() => send(suggestion)}
                disabled={isLoading || !runtime}
              >
                {suggestion}
              </button>
            ))}
          </div>
        }
      />
      <Composer
        value={input}
        onChange={setInput}
        onSubmit={() => send()}
        disabled={isLoading || !runtime}
        footnote="Read + comment only. The catalog exposes no tool that edits text."
      />
    </aside>
  );
}
