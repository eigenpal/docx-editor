/**
 * Opinionated chat primitives for the agent panel — `<AgentChatLog>`,
 * `<AgentComposer>`, `<AgentSuggestionChip>`. Consumers compose these
 * inside `agentPanel.render` to get a Google-Docs-grade chat container
 * without rebuilding bubbles, animations, and a composer from scratch.
 *
 * Stays compatible with any chat framework — the components take plain
 * `messages` / `value` / `onSubmit` props and don't assume a transport.
 *
 * Want full control? Skip these and render whatever you want as the
 * panel's children. These are sugar, not gates.
 */

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, FormEvent, ReactNode } from 'react';
import { useTranslation } from '../i18n';

const KEYFRAMES_STYLE_ID = 'ep-agent-chat-keyframes';
const KEYFRAMES = `
@keyframes epAgentDot {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
  40% { transform: scale(1); opacity: 1; }
}
@keyframes epAgentSpin {
  to { transform: rotate(360deg); }
}
`;

/** Inject the keyframes once per document, no matter how many AgentChatLogs mount. */
function useKeyframes() {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (document.getElementById(KEYFRAMES_STYLE_ID)) return;
    const el = document.createElement('style');
    el.id = KEYFRAMES_STYLE_ID;
    el.textContent = KEYFRAMES;
    document.head.appendChild(el);
  }, []);
}

/** A single tool call the agent made — shown in the collapsible timeline. */
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

export interface AgentChatLogProps {
  messages: AgentMessage[];
  /** Render thinking dots at the bottom of the list. */
  loading?: boolean;
  /** Render an error bubble after the last message. */
  error?: string | null;
  /** Shown when there are no messages and not loading. */
  emptyState?: ReactNode;
  /** Auto-scroll to bottom on new messages / loading toggles. Default: true. */
  autoScroll?: boolean;
  /**
   * Map a tool name to a friendly label for the per-message timeline.
   * Pass `getToolDisplayName` from `@eigenpal/docx-editor-agents/react` to
   * use the toolkit's registry-aware labels (e.g. "Adding comment").
   */
  humanizeToolName?: (name: string) => string;
  /** Cap the tool-call timeline to this many recent rows. Default 3. */
  maxVisibleCalls?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * Default name → friendly label resolver: falls back to a sentence-case
 * version of the snake_case identifier so consumer-defined tools still
 * render readably (e.g. `fetch_clause_template` → "Fetch clause template").
 *
 * The agent toolkit ships a richer registry-aware version
 * (`getToolDisplayName` from `@eigenpal/docx-editor-agents/react`) that
 * looks up `displayName` on each tool definition. Pass that as the
 * `humanizeName` prop to opt in.
 */
function defaultHumanizeName(name: string): string {
  const spaced = name.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const DEFAULT_VISIBLE_TOOL_CALLS = 3;

export interface AgentTimelineProps {
  /** Tool calls in chronological order. */
  toolCalls: AgentToolCall[];
  /**
   * Whether the parent assistant turn is still streaming. While true, the
   * timeline is forced expanded and shows a spinner; on false it
   * auto-collapses to an "N steps" summary unless the user expanded it.
   */
  streaming?: boolean;
  /**
   * Cap the number of rendered call rows — older entries collapse into a
   * "+N earlier steps" header. Default 3.
   */
  maxVisibleCalls?: number;
  /**
   * Map a tool name to a friendly label. Defaults to a sentence-case
   * conversion of the snake_case name. Pass `getToolDisplayName` from
   * `@eigenpal/docx-editor-agents/react` to use the toolkit's registry.
   */
  humanizeName?: (name: string) => string;
}

/**
 * Collapsible timeline of an assistant turn's tool calls. Lives above the
 * assistant text bubble. Auto-collapses when the turn finishes; click the
 * summary row to re-expand.
 */
export function AgentTimeline({
  toolCalls,
  streaming,
  maxVisibleCalls = DEFAULT_VISIBLE_TOOL_CALLS,
  humanizeName = defaultHumanizeName,
}: AgentTimelineProps) {
  const { t } = useTranslation();
  // Once the user clicks the toggle we respect their choice; before that,
  // expanded mirrors `streaming`.
  const [userToggled, setUserToggled] = useState<boolean | null>(null);
  const expanded = userToggled ?? !!streaming;

  if (toolCalls.length === 0) return null;

  const summary = streaming
    ? t('agentPanel.timeline.working', { count: toolCalls.length })
    : t('agentPanel.timeline.summary', { count: toolCalls.length });

  const visibleCalls = toolCalls.slice(-maxVisibleCalls);
  const hiddenEarlier = Math.max(0, toolCalls.length - visibleCalls.length);

  return (
    <div style={S.timelineWrap} data-testid="agent-timeline">
      <button
        type="button"
        onClick={() => setUserToggled(!expanded)}
        aria-expanded={expanded}
        style={S.timelineHeader}
        data-testid="agent-timeline-toggle"
      >
        <span style={S.timelineSummary}>
          {streaming ? <Spinner /> : <DoneCheck />}
          {summary}
        </span>
        <span
          style={{
            ...S.timelineChevron,
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
          aria-hidden="true"
        >
          ▾
        </span>
      </button>
      {expanded && (
        <ol style={S.timelineList}>
          {hiddenEarlier > 0 && (
            <li style={S.timelineMore} data-testid="agent-timeline-earlier">
              {t('agentPanel.timeline.earlier', { count: hiddenEarlier })}
            </li>
          )}
          {visibleCalls.map((call) => (
            <li key={call.id} style={S.timelineItem}>
              {call.status === 'running' ? (
                <Spinner size={10} compact />
              ) : (
                <span
                  style={{
                    ...S.timelineDot,
                    background: call.status === 'error' ? '#d93025' : '#1e8e3e',
                  }}
                  aria-hidden="true"
                />
              )}
              <span style={S.timelineCall}>
                <span style={S.timelineCallName}>{humanizeName(call.name)}</span>
                {call.error && <span style={S.timelineError}>{call.error}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Spinner({ size = 12, compact = false }: { size?: number; compact?: boolean } = {}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={{
        marginRight: compact ? 0 : 6,
        animation: 'epAgentSpin 0.8s linear infinite',
        flexShrink: 0,
      }}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="#dadce0" strokeWidth="3" fill="none" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="#0b57d0" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function DoneCheck() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={{ marginRight: 6 }}
    >
      <path
        d="M5 13l4 4L19 7"
        stroke="#1e8e3e"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function AgentChatLog({
  messages,
  loading,
  error,
  emptyState,
  autoScroll = true,
  humanizeToolName,
  maxVisibleCalls,
  className,
  style,
}: AgentChatLogProps) {
  const { t } = useTranslation();
  useKeyframes();
  const endRef = useRef<HTMLDivElement>(null);
  // Track tool-call growth on the in-flight assistant turn so the log
  // follows the timeline as new calls land. Pick `'auto'` while streaming
  // (avoids queueing 30 smooth-scroll animations) and `'smooth'` once the
  // turn settles or a brand-new message arrives.
  const lastMessage = messages[messages.length - 1];
  const lastToolCallCount = lastMessage?.toolCalls?.length ?? 0;
  const isLastStreaming = lastMessage?.status === 'streaming';
  useEffect(() => {
    if (!autoScroll) return;
    endRef.current?.scrollIntoView({
      behavior: isLastStreaming || loading ? 'auto' : 'smooth',
      block: 'end',
    });
  }, [messages.length, lastToolCallCount, loading, isLastStreaming, autoScroll]);

  const isEmpty = messages.length === 0 && !loading && !error;

  return (
    <div
      className={`ep-agent-chat-log${className ? ` ${className}` : ''}`}
      style={{
        flex: 1,
        overflow: 'auto',
        padding: '16px 14px 8px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        ...style,
      }}
    >
      {isEmpty && emptyState}
      {messages.map((m) => {
        const showTimeline = m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0;
        const showText = m.text.length > 0;
        return (
          <div key={m.id} style={S.messageGroup} data-role={m.role}>
            {showTimeline && (
              <AgentTimeline
                toolCalls={m.toolCalls!}
                streaming={m.status === 'streaming'}
                humanizeName={humanizeToolName}
                maxVisibleCalls={maxVisibleCalls}
              />
            )}
            {showText && (
              <div style={m.role === 'user' ? S.userBubble : S.assistantBubble}>{m.text}</div>
            )}
          </div>
        );
      })}
      {loading && (
        <div style={S.thinkingBubble} aria-label={t('agentPanel.thinking')}>
          <span style={{ ...S.dot, animationDelay: '0s' }} />
          <span style={{ ...S.dot, animationDelay: '0.15s' }} />
          <span style={{ ...S.dot, animationDelay: '0.3s' }} />
        </div>
      )}
      {error && (
        <div style={S.errorBubble} role="alert">
          {error}
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}

export interface AgentComposerProps {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  placeholder?: string;
  /** Small text under the input — typically a scope reminder. */
  footnote?: ReactNode;
  className?: string;
}

export function AgentComposer({
  value,
  onChange,
  onSubmit,
  disabled,
  placeholder,
  footnote,
  className,
}: AgentComposerProps) {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t('agentPanel.composerPlaceholder');
  const canSend = value.trim().length > 0 && !disabled;
  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canSend) return;
    onSubmit();
  };
  return (
    <form
      onSubmit={handleSubmit}
      className={`ep-agent-composer${className ? ` ${className}` : ''}`}
      style={S.composerWrap}
    >
      <div style={S.composerShell}>
        <input
          style={S.composerInput}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={resolvedPlaceholder}
          disabled={disabled}
        />
        <button
          type="submit"
          aria-label={t('agentPanel.send')}
          disabled={!canSend}
          style={{
            ...S.sendBtn,
            opacity: canSend ? 1 : 0.35,
            cursor: canSend ? 'pointer' : 'not-allowed',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 19V5M5 12l7-7 7 7"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      {footnote && <div style={S.footnote}>{footnote}</div>}
    </form>
  );
}

export interface AgentSuggestionChipProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

export function AgentSuggestionChip({ label, onClick, disabled }: AgentSuggestionChipProps) {
  return (
    <button type="button" style={S.chip} onClick={onClick} disabled={disabled}>
      {label}
    </button>
  );
}

// ── Internal styles ─────────────────────────────────────────────────────────

// Tuned to match the Google Docs Gemini side panel: 'Google Sans' fallback,
// pill-shaped composer, fully rounded bubbles, soft surfaces, blue
// `#0b57d0` (Google Material 3 primary) for the user/send affordances.
const S: Record<string, CSSProperties> = {
  messageGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    width: '100%',
  },
  userBubble: {
    background: '#0b57d0',
    color: '#fff',
    padding: '10px 14px',
    borderRadius: '20px 20px 4px 20px',
    fontSize: 13.5,
    lineHeight: 1.5,
    alignSelf: 'flex-end',
    maxWidth: '88%',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    fontFamily: "'Google Sans', 'Google Sans Text', system-ui, -apple-system, sans-serif",
  },
  assistantBubble: {
    background: '#f0f4f9',
    color: '#1f1f1f',
    padding: '12px 16px',
    borderRadius: '20px 20px 20px 4px',
    fontSize: 13.5,
    lineHeight: 1.55,
    alignSelf: 'flex-start',
    maxWidth: '92%',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    fontFamily: "'Google Sans', 'Google Sans Text', system-ui, -apple-system, sans-serif",
  },
  thinkingBubble: {
    background: '#f0f4f9',
    padding: '12px 16px',
    borderRadius: '20px 20px 20px 4px',
    alignSelf: 'flex-start',
    display: 'flex',
    gap: 4,
    alignItems: 'center',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: '#5f6368',
    display: 'inline-block',
    animation: 'epAgentDot 1.4s infinite ease-in-out',
  },
  errorBubble: {
    background: '#fce8e6',
    color: '#b3261e',
    padding: '10px 14px',
    borderRadius: 16,
    fontSize: 12.5,
    alignSelf: 'flex-start',
    maxWidth: '92%',
    whiteSpace: 'pre-wrap',
    fontFamily: "'Google Sans Text', system-ui, sans-serif",
  },
  composerWrap: {
    padding: '8px 12px 14px',
    background: '#fff',
    flex: '0 0 auto',
  },
  composerShell: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '6px 6px 6px 18px',
    background: '#fff',
    border: '1px solid #c4c7c5',
    borderRadius: 28,
    boxShadow: '0 1px 2px rgba(60,64,67,0.04)',
    transition: 'border-color 0.15s, box-shadow 0.15s',
    fontFamily: "'Google Sans Text', system-ui, sans-serif",
  },
  composerInput: {
    flex: 1,
    padding: '8px 0',
    fontSize: 14,
    border: 'none',
    outline: 'none',
    background: 'transparent',
    fontFamily: 'inherit',
    color: '#1f1f1f',
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    border: 'none',
    background: '#0b57d0',
    color: '#fff',
    flexShrink: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'background 0.15s, opacity 0.15s, transform 0.15s',
  },
  footnote: {
    fontSize: 11,
    color: '#5f6368',
    textAlign: 'center',
    marginTop: 10,
    fontFamily: "'Google Sans Text', system-ui, sans-serif",
  },
  chip: {
    textAlign: 'left',
    background: '#fff',
    border: '1px solid #dadce0',
    borderRadius: 18,
    padding: '10px 14px',
    fontSize: 13,
    color: '#1f1f1f',
    cursor: 'pointer',
    fontFamily: "'Google Sans Text', system-ui, sans-serif",
    lineHeight: 1.4,
    transition: 'background 0.15s, border-color 0.15s, box-shadow 0.15s',
    width: '100%',
  },
  timelineWrap: {
    alignSelf: 'flex-start',
    maxWidth: '92%',
    background: '#fff',
    border: '1px solid #e1e3e6',
    borderRadius: 12,
    overflow: 'hidden',
    fontFamily: "'Google Sans Text', system-ui, sans-serif",
  },
  timelineHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    padding: '8px 12px',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    fontSize: 12.5,
    color: '#1f1f1f',
    fontFamily: 'inherit',
  },
  timelineSummary: {
    display: 'inline-flex',
    alignItems: 'center',
    fontWeight: 500,
  },
  timelineChevron: {
    fontSize: 12,
    color: '#5f6368',
    transition: 'transform 0.15s ease',
    marginLeft: 8,
  },
  timelineList: {
    listStyle: 'none',
    margin: 0,
    padding: '4px 12px 10px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    borderTop: '1px solid #ececf0',
  },
  timelineItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
    color: '#444746',
  },
  timelineDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    flexShrink: 0,
  },
  timelineCall: {
    display: 'inline-flex',
    flexDirection: 'column',
    minWidth: 0,
  },
  timelineCallName: {
    color: '#1f1f1f',
  },
  timelineError: {
    color: '#d93025',
    fontSize: 11,
  },
  timelineMore: {
    fontSize: 11,
    color: '#5f6368',
    fontStyle: 'italic',
    paddingLeft: 14,
  },
};
