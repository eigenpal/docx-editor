/**
 * Shared agent UI types — framework-agnostic. Both React and Vue
 * adapters (and the AI SDK adapters) consume this single declaration.
 *
 * Keeping the types here lets us tweak the chat schema without writing
 * the same drift fix in four files.
 */

export interface AgentToolCall {
  /** Stable id for keying. */
  id: string;
  /** Tool name (e.g. `read_document`, `add_comment`). */
  name: string;
  /** JSON-able input the agent passed. Rendered in the expanded view. */
  input?: unknown;
  /** Result text or summary. Set after the call completes. */
  result?: string;
  /** Set when the call errored — surfaces in the timeline as failed. */
  error?: string;
  /** `running` while in flight, `done` on success, `error` on failure. */
  status: 'running' | 'done' | 'error';
}

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /**
   * Tool calls the assistant made for this turn, in order. The timeline
   * stays expanded while `status === 'streaming'` and auto-collapses to
   * an "N steps" summary when the message hits `status === 'done'`.
   */
  toolCalls?: AgentToolCall[];
  /** `streaming` while the model is still calling tools / writing text; `done` once the turn is final. */
  status?: 'streaming' | 'done';
}

/**
 * Default name → friendly label resolver: falls back to a sentence-case
 * version of the snake_case identifier so consumer-defined tools still
 * render readably (e.g. `fetch_clause_template` → "Fetch clause template").
 */
export function defaultHumanizeToolName(name: string): string {
  const spaced = name.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
