'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { DocxEditor, type DocxEditorRef } from '@eigenpal/docx-js-editor';
import { useAgentChat, type EditorRefLike } from '@eigenpal/docx-editor-agents/bridge';

// ── Types ───────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCallLog[];
}

interface ToolCallLog {
  name: string;
  input: Record<string, string | number | boolean | undefined>;
  result: string;
}

// Full OpenAI message for multi-turn context (keeps tool_calls + tool results)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OpenAIMessage = any;

// ── Helpers ─────────────────────────────────────────────────────────────────

const TOOL_LABELS: Record<string, string> = {
  read_document: 'Read document',
  read_comments: 'Read comments',
  read_changes: 'Read tracked changes',
  add_comment: 'Add comment',
  suggest_replacement: 'Suggest change',
  scroll_to: 'Scroll to',
};

const SYSTEM_PROMPT = `You are a helpful document assistant. The user has a DOCX document open and is chatting with you about it.

You have tools to:
- READ the document content (always do this first if you haven't seen the document yet)
- ADD COMMENTS to specific paragraphs
- SUGGEST REPLACEMENTS as tracked changes the user can accept/reject
- SCROLL to specific paragraphs

Guidelines:
- Always read the document before making changes
- When adding comments or suggesting changes, reference the paragraph index [N] from read_document
- Keep comments concise and actionable
- For replacements, use a short search phrase (3-8 words) that uniquely identifies the text
- You can make multiple tool calls in a single turn
- After making changes, briefly tell the user what you did`;

// ── Main Component ──────────────────────────────────────────────────────────

export default function Home() {
  const [documentBuffer, setDocumentBuffer] = useState<ArrayBuffer | null>(null);
  const [documentName, setDocumentName] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());

  const editorRef = useRef<DocxEditorRef>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const openaiHistoryRef = useRef<OpenAIMessage[]>([]);
  const msgIdRef = useRef(0);
  const nextId = () => `msg-${++msgIdRef.current}`;

  // Hook: wires agent tools to the live editor
  const { executeToolCall, toolSchemas } = useAgentChat({
    editorRef: editorRef as React.RefObject<EditorRefLike | null>,
    author: 'Assistant',
  });

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // ── File handling ─────────────────────────────────────────────────────────

  const handleFile = useCallback((f: File) => {
    if (!f.name.endsWith('.docx')) {
      setError('Please upload a .docx file');
      return;
    }
    setError(null);
    setDocumentName(f.name);
    f.arrayBuffer().then((buf) => {
      setDocumentBuffer(buf);
      setMessages([]);
      openaiHistoryRef.current = [];
    });
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files[0];
      if (f) handleFile(f);
    },
    [handleFile]
  );

  // ── Chat with client-side tool execution ──────────────────────────────────

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || !editorRef.current || isLoading) return;

    const userMsg: ChatMessage = { id: nextId(), role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);
    setError(null);

    try {
      openaiHistoryRef.current.push({ role: 'user', content: text });
      const allToolCalls: ToolCallLog[] = [];

      // Tool-use loop — call API, execute tools locally, repeat
      const MAX_ITERATIONS = 10;
      for (let i = 0; i < MAX_ITERATIONS; i++) {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...openaiHistoryRef.current],
            tools: toolSchemas,
          }),
        });

        if (!response.ok) {
          const err = await response.json();
          throw new Error(err.error || 'Request failed');
        }

        const data = await response.json();
        const msg = data.message;

        // No tool calls — we're done, show the text response
        if (!msg.tool_calls || msg.tool_calls.length === 0) {
          openaiHistoryRef.current.push({ role: 'assistant', content: msg.content || '' });
          const assistantMsg: ChatMessage = {
            id: nextId(),
            role: 'assistant',
            content: msg.content || '',
            toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
          };
          setMessages((prev) => [...prev, assistantMsg]);
          break;
        }

        // Execute tool calls on the client via EditorBridge
        openaiHistoryRef.current.push(msg);

        for (const toolCall of msg.tool_calls) {
          let args: Record<string, unknown>;
          try {
            args = JSON.parse(toolCall.function.arguments);
          } catch {
            args = {};
          }
          const result = executeToolCall(toolCall.function.name, args);

          const resultStr =
            typeof result.data === 'string'
              ? result.data
              : result.error || JSON.stringify(result.data);

          allToolCalls.push({
            name: toolCall.function.name,
            input: args as Record<string, string | number | boolean | undefined>,
            result: resultStr,
          });

          // Append tool result to persistent history
          openaiHistoryRef.current.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: resultStr,
          });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const toggleToolExpand = (id: string) => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ── Upload screen ─────────────────────────────────────────────────────────

  if (!documentBuffer) {
    return (
      <div style={styles.fullScreen}>
        <div style={styles.uploadCard}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>&#128172;</div>
          <h1 style={styles.title}>Chat with your Doc</h1>
          <p style={styles.subtitle}>
            Upload a DOCX file and have a conversation with AI about it. The assistant can read your
            document, add comments, and suggest changes — all live in the editor, no reloads.
          </p>

          <div
            style={{
              ...styles.dropZone,
              ...(dragOver ? styles.dropZoneActive : {}),
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".docx"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
            <div style={{ fontSize: 40, marginBottom: 8 }}>&#128196;</div>
            <div style={styles.dropText}>Drop your DOCX here</div>
            <div style={styles.dropHint}>or click to browse</div>
          </div>

          {error && <div style={styles.errorBox}>{error}</div>}

          <div style={styles.footer}>
            Powered by{' '}
            <a
              href="https://www.npmjs.com/package/@eigenpal/docx-editor-agents"
              style={styles.link}
            >
              @eigenpal/docx-editor-agents
            </a>
          </div>
        </div>
      </div>
    );
  }

  // ── Main layout: editor + chat ────────────────────────────────────────────

  return (
    <div style={styles.layout}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <span style={{ fontSize: 20 }}>&#128172;</span>
          <span style={styles.headerTitle}>{documentName}</span>
        </div>
        <button
          style={styles.newDocBtn}
          onClick={() => {
            setDocumentBuffer(null);
            setDocumentName('');
            setMessages([]);
            openaiHistoryRef.current = [];
            setError(null);
          }}
        >
          Open another
        </button>
      </div>

      <div style={styles.main}>
        {/* Editor */}
        <div style={styles.editorPane}>
          <DocxEditor
            ref={editorRef}
            documentBuffer={documentBuffer}
            documentName={documentName}
            showToolbar={false}
            showRuler={false}
            showZoomControl={false}
          />
        </div>

        {/* Chat panel */}
        <div style={styles.chatPane}>
          {/* Messages */}
          <div style={styles.messageList}>
            {messages.length === 0 && (
              <div style={styles.emptyChat}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>&#128172;</div>
                <div>Ask anything about your document.</div>
                <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>
                  Try: &quot;Review this for grammar issues&quot; or &quot;Summarize the key
                  points&quot;
                </div>
              </div>
            )}

            {messages.map((msg) => (
              <div key={msg.id} style={styles.messageWrap}>
                <div style={msg.role === 'user' ? styles.userBubble : styles.assistantBubble}>
                  <div style={styles.messageText}>{msg.content}</div>
                </div>

                {msg.toolCalls && msg.toolCalls.length > 0 && (
                  <div style={styles.toolCallsWrap}>
                    {msg.toolCalls.map((tc, i) => {
                      const tcId = `${msg.id}-tool-${i}`;
                      const isExpanded = expandedTools.has(tcId);
                      const isWrite = ['add_comment', 'suggest_replacement'].includes(tc.name);
                      return (
                        <div key={tcId} style={styles.toolCallCard}>
                          <div style={styles.toolCallHeader} onClick={() => toggleToolExpand(tcId)}>
                            <span style={styles.toolCallIcon}>
                              {isWrite ? '\u270E' : '\u{1F50D}'}
                            </span>
                            <span style={styles.toolCallName}>
                              {TOOL_LABELS[tc.name] || tc.name}
                            </span>
                            {tc.name === 'add_comment' && tc.input.text && (
                              <span style={styles.toolCallSummary}>
                                {' '}
                                &mdash; &quot;{String(tc.input.text).slice(0, 50)}
                                {String(tc.input.text).length > 50 ? '...' : ''}&quot;
                              </span>
                            )}
                            {tc.name === 'suggest_replacement' && (
                              <span style={styles.toolCallSummary}>
                                {' '}
                                &mdash; &quot;{String(tc.input.search)}&quot; &rarr; &quot;
                                {String(tc.input.replaceWith)}&quot;
                              </span>
                            )}
                            <span style={styles.toolCallChevron}>
                              {isExpanded ? '\u25B2' : '\u25BC'}
                            </span>
                          </div>
                          {isExpanded && (
                            <div style={styles.toolCallBody}>
                              <div style={styles.toolCallSection}>
                                <strong>Input:</strong>
                                <pre style={styles.toolCallPre}>
                                  {JSON.stringify(tc.input, null, 2)}
                                </pre>
                              </div>
                              <div style={styles.toolCallSection}>
                                <strong>Result:</strong>
                                <pre style={styles.toolCallPre}>
                                  {tc.result.length > 500
                                    ? tc.result.slice(0, 500) + '...'
                                    : tc.result}
                                </pre>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}

            {isLoading && (
              <div style={styles.messageWrap}>
                <div style={styles.assistantBubble}>
                  <div style={styles.loadingDots}>
                    <span style={styles.dot} />
                    <span style={{ ...styles.dot, animationDelay: '0.2s' }} />
                    <span style={{ ...styles.dot, animationDelay: '0.4s' }} />
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div style={styles.messageWrap}>
                <div style={styles.errorBubble}>{error}</div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Input */}
          <div style={styles.inputWrap}>
            <textarea
              style={styles.input}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your document..."
              rows={1}
              disabled={isLoading}
            />
            <button
              style={{
                ...styles.sendBtn,
                ...(input.trim() && !isLoading ? {} : styles.sendBtnDisabled),
              }}
              onClick={sendMessage}
              disabled={!input.trim() || isLoading}
            >
              &#9650;
            </button>
          </div>
        </div>
      </div>

      <style>{animationCSS}</style>
    </div>
  );
}

// ── Animations ──────────────────────────────────────────────────────────────

const animationCSS = `
@keyframes dotPulse {
  0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
  40% { opacity: 1; transform: scale(1); }
}
`;

// ── Styles ──────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  fullScreen: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%)',
    padding: 20,
  },
  uploadCard: {
    background: '#fff',
    borderRadius: 20,
    padding: '48px 40px',
    maxWidth: 500,
    width: '100%',
    textAlign: 'center' as const,
    boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
  },
  title: { fontSize: 32, fontWeight: 900, margin: '0 0 8px', color: '#0f172a' },
  subtitle: { fontSize: 15, color: '#64748b', margin: '0 0 32px', lineHeight: 1.6 },
  dropZone: {
    border: '2px dashed #cbd5e1',
    borderRadius: 14,
    padding: '40px 20px',
    cursor: 'pointer',
    transition: 'all 0.2s',
    marginBottom: 24,
  },
  dropZoneActive: { borderColor: '#3b82f6', background: '#eff6ff' },
  dropText: { fontSize: 16, fontWeight: 600, color: '#334155' },
  dropHint: { fontSize: 13, color: '#94a3b8', marginTop: 4 },
  errorBox: {
    background: '#fef2f2',
    color: '#dc2626',
    padding: '12px 16px',
    borderRadius: 8,
    fontSize: 14,
    marginBottom: 20,
  },
  footer: { fontSize: 13, color: '#94a3b8' },
  link: { color: '#3b82f6', textDecoration: 'none' },
  layout: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100vh',
    overflow: 'hidden',
    background: '#f8fafc',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 20px',
    background: '#fff',
    borderBottom: '1px solid #e2e8f0',
    flexShrink: 0,
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 8 },
  headerTitle: { fontSize: 15, fontWeight: 700, color: '#0f172a' },
  newDocBtn: {
    padding: '6px 14px',
    fontSize: 13,
    fontWeight: 600,
    color: '#334155',
    background: '#f1f5f9',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    cursor: 'pointer',
  },
  main: { flex: 1, display: 'flex', overflow: 'hidden' },
  editorPane: { flex: 1, overflow: 'hidden', borderRight: '1px solid #e2e8f0' },
  chatPane: {
    width: 400,
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column' as const,
    background: '#fff',
  },
  messageList: { flex: 1, overflow: 'auto', padding: '16px 16px 8px' },
  emptyChat: {
    textAlign: 'center' as const,
    color: '#64748b',
    marginTop: 60,
    fontSize: 15,
  },
  messageWrap: { marginBottom: 12 },
  userBubble: {
    background: '#3b82f6',
    color: '#fff',
    padding: '10px 14px',
    borderRadius: '16px 16px 4px 16px',
    fontSize: 14,
    lineHeight: 1.5,
    marginLeft: 40,
  },
  assistantBubble: {
    background: '#f1f5f9',
    color: '#1e293b',
    padding: '10px 14px',
    borderRadius: '16px 16px 16px 4px',
    fontSize: 14,
    lineHeight: 1.5,
    marginRight: 40,
  },
  messageText: { whiteSpace: 'pre-wrap' as const, wordBreak: 'break-word' as const },
  errorBubble: {
    background: '#fef2f2',
    color: '#dc2626',
    padding: '10px 14px',
    borderRadius: 12,
    fontSize: 13,
    marginRight: 40,
  },
  toolCallsWrap: {
    marginTop: 6,
    marginRight: 40,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
  },
  toolCallCard: {
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    overflow: 'hidden',
    fontSize: 12,
  },
  toolCallHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 10px',
    background: '#f8fafc',
    cursor: 'pointer',
    userSelect: 'none' as const,
  },
  toolCallIcon: { fontSize: 12 },
  toolCallName: { fontWeight: 600, color: '#334155' },
  toolCallSummary: {
    color: '#64748b',
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  },
  toolCallChevron: { fontSize: 10, color: '#94a3b8' },
  toolCallBody: { padding: '8px 10px', borderTop: '1px solid #e2e8f0' },
  toolCallSection: { marginBottom: 6 },
  toolCallPre: {
    margin: '4px 0 0',
    fontSize: 11,
    background: '#f1f5f9',
    padding: 8,
    borderRadius: 6,
    overflow: 'auto',
    maxHeight: 200,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
  },
  loadingDots: { display: 'flex', gap: 4, padding: '4px 0' },
  dot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: '#94a3b8',
    animation: 'dotPulse 1.4s ease-in-out infinite',
  },
  inputWrap: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: 8,
    padding: '12px 16px',
    borderTop: '1px solid #e2e8f0',
    background: '#fff',
  },
  input: {
    flex: 1,
    padding: '10px 14px',
    fontSize: 14,
    border: '1px solid #e2e8f0',
    borderRadius: 12,
    outline: 'none',
    resize: 'none' as const,
    fontFamily: 'inherit',
    lineHeight: 1.5,
    maxHeight: 120,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    border: 'none',
    background: '#3b82f6',
    color: '#fff',
    fontSize: 14,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  sendBtnDisabled: { opacity: 0.3, cursor: 'not-allowed' },
};
