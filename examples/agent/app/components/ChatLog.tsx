'use client';

/**
 * The panel's chrome: message log, tool-call trace, composer.
 *
 * None of this ships from the packages, on purpose. `@docx-editor.dev/editor-api`
 * is the editing layer underneath an agent; the chat surface belongs with the
 * rest of your app's chrome, styled however your app is styled. Plain CSS here
 * so the example carries no design dependency.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import type { UIMessage } from 'ai';
import { getToolDisplayName } from '../agent/tools';

/** One thing worth drawing in the log: a chunk of prose, or a tool the agent ran. */
export type AgentEntry =
  | { kind: 'text'; id: string; role: 'user' | 'assistant'; text: string }
  | { kind: 'tool'; id: string; name: string; state: string; failed: boolean };

/**
 * Flatten AI SDK messages into log entries.
 *
 * The SDK models a turn as a message with ordered `parts`, so one assistant turn
 * can interleave prose and tool calls. Rendering the parts in order (rather than
 * grouping all the tools at the end) is what makes the roast read as work
 * happening: "Reading the document", then the verdict.
 */
export function toAgentEntries(messages: UIMessage[]): AgentEntry[] {
  const entries: AgentEntry[] = [];
  for (const message of messages) {
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    // Bound outside the callback: the narrowing above does not survive into a
    // closure, so `message.role` widens back to include "system" in there.
    const role = message.role;
    (message.parts ?? []).forEach((part, index) => {
      const id = `${message.id}:${index}`;
      if (part.type === 'text') {
        const text = part.text?.trim();
        if (text) entries.push({ kind: 'text', id, role, text });
        return;
      }
      if (part.type.startsWith('tool-')) {
        const state = (part as { state?: string }).state ?? '';
        entries.push({
          kind: 'tool',
          id,
          name: part.type.slice('tool-'.length),
          state,
          failed: state === 'output-error',
        });
      }
    });
  }
  return entries;
}

export function ChatLog({
  entries,
  loading,
  error,
  emptyState,
}: {
  entries: AgentEntry[];
  loading: boolean;
  error: string | null;
  emptyState: ReactNode;
}) {
  const logRef = useRef<HTMLDivElement>(null);

  // Drive THIS container's scrollTop, never `scrollIntoView`: that walks every
  // scrollable ancestor, so each token would scroll the whole page. And only
  // while streaming, so someone who scrolled up to re-read an earlier roast is
  // not yanked back down.
  useEffect(() => {
    if (!loading) return;
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length, loading]);

  if (entries.length === 0 && !loading && !error) {
    return (
      <div ref={logRef} className="agent-log">
        {emptyState}
      </div>
    );
  }

  return (
    <div ref={logRef} className="agent-log">
      {entries.map((entry) =>
        entry.kind === 'tool' ? (
          <div
            key={entry.id}
            className={`agent-tool${entry.failed ? ' is-failed' : ''}`}
            data-running={entry.state === 'input-streaming' || entry.state === 'input-available'}
          >
            <span className="agent-tool-dot" />
            {getToolDisplayName(entry.name)}
            {entry.failed ? ' (refused)' : ''}
          </div>
        ) : (
          <div key={entry.id} className={`agent-msg is-${entry.role}`}>
            {entry.text}
          </div>
        )
      )}
      {loading ? <div className="agent-thinking">Thinking…</div> : null}
      {error ? <div className="agent-error">{error}</div> : null}
    </div>
  );
}

export function Composer({
  value,
  onChange,
  onSubmit,
  disabled,
  footnote,
}: {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  footnote?: string;
}) {
  return (
    <div className="agent-composer">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, Shift+Enter breaks the line.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              onSubmit();
            }
          }}
          rows={1}
          placeholder="Ask the assistant…"
        />
        <button type="submit" disabled={disabled || value.trim().length === 0}>
          Send
        </button>
      </form>
      {footnote ? <p className="agent-footnote">{footnote}</p> : null}
    </div>
  );
}
