// Shared command/query registry + MCP dispatch (document-engine tasks 7.7, 7.10,
// 7.11). One registry is the single source for the command/query surface; MCP
// tool schemas are generated FROM it (so enumerated schemas equal registry
// schemas), and dispatch validates input against the schema BEFORE opening any
// write transaction — invalid tool input never mutates the store.

import { DocumentStore } from '../store/index.ts';
import { paragraphText } from '../model/index.ts';
import { ORIGIN_IDS } from '../registry/frozen-ids.ts';
import { ok, type Result } from './result.ts';
import { resolveWriteScope, type Scope, type ScopeContext } from './scopes.ts';

// Minimal JSON-Schema subset (a full validator is the TypeBox/AJV bake-off, 0.2).
export interface JsonSchema {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, { readonly type: 'string' | 'number' | 'boolean' }>>;
  readonly required: readonly string[];
  readonly additionalProperties: false;
}

export interface CommandDef {
  /** Stable registry id (reverse-domain). */
  readonly id: string;
  /** MCP/automation tool name. */
  readonly tool: string;
  readonly description: string;
  readonly kind: 'command' | 'query';
  readonly input: JsonSchema;
}

const strObj = (props: string[], required = props): JsonSchema => ({
  type: 'object',
  properties: Object.fromEntries(props.map((p) => [p, { type: 'string' as const }])),
  required,
  additionalProperties: false,
});

const ROOT = 'dev.docx-editor.core';

export const COMMANDS: readonly CommandDef[] = [
  {
    id: `${ROOT}.command.insert-text`,
    tool: 'insertText',
    description: 'Insert text into a paragraph by id.',
    kind: 'command',
    input: strObj(['paragraphId', 'text']),
  },
  {
    id: `${ROOT}.command.append-paragraph`,
    tool: 'appendParagraph',
    // The write scope is resolved, never assumed: an omitted scope targets the
    // ACTIVE story (which may be a header/footer), never a silent body fallback.
    description:
      'Append an empty paragraph to a resolved write scope. Optional "scope" is ' +
      'body | active | story | aggregate (default active); "storyId" is required ' +
      'when scope is "story". Aggregate is read-only and is rejected for a write.',
    kind: 'command',
    input: {
      type: 'object',
      properties: { scope: { type: 'string' }, storyId: { type: 'string' } },
      required: [],
      additionalProperties: false,
    },
  },
  {
    id: `${ROOT}.query.paragraph-text`,
    tool: 'getParagraphText',
    description: 'Read a paragraph’s text by id.',
    kind: 'query',
    input: strObj(['paragraphId']),
  },
];

export interface McpTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
}

/** Generate MCP tool descriptors directly from the registry (task 7.11). */
export function mcpTools(): McpTool[] {
  return COMMANDS.map((c) => ({ name: c.tool, description: c.description, inputSchema: c.input }));
}

export type ValidationResult = { readonly ok: true } | { readonly ok: false; readonly errors: readonly string[] };

/** Validate input against a schema (required + type + no extra props). */
export function validateInput(schema: JsonSchema, input: unknown): ValidationResult {
  const errors: string[] = [];
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, errors: ['input must be an object'] };
  }
  const obj = input as Record<string, unknown>;
  for (const key of schema.required) if (!(key in obj)) errors.push(`missing required: ${key}`);
  for (const [key, value] of Object.entries(obj)) {
    const prop = schema.properties[key];
    if (!prop) {
      errors.push(`unexpected property: ${key}`);
      continue;
    }
    if (typeof value !== prop.type) errors.push(`${key} must be ${prop.type}`);
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

type ScopeParse = { readonly ok: true; readonly scope: Scope | undefined } | { readonly ok: false; readonly error: string };

/**
 * Map the flat `scope`/`storyId` string inputs onto a structured {@link Scope}.
 * An absent `scope` yields `undefined`, which resolves to the ACTIVE story — the
 * write is never silently redirected to the body here.
 */
function parseScopeInput(obj: Record<string, unknown>): ScopeParse {
  const raw = obj.scope;
  if (raw === undefined) return { ok: true, scope: undefined };
  switch (raw) {
    case 'body':
      return { ok: true, scope: { kind: 'body' } };
    case 'active':
      return { ok: true, scope: { kind: 'active' } };
    case 'aggregate':
      return { ok: true, scope: { kind: 'aggregate' } };
    case 'story': {
      const storyId = obj.storyId;
      if (typeof storyId !== 'string' || storyId.length === 0) {
        return { ok: false, error: 'scope "story" requires a non-empty storyId' };
      }
      return { ok: true, scope: { kind: 'story', storyId } };
    }
    default:
      return { ok: false, error: `unknown scope: ${String(raw)}` };
  }
}

/**
 * Schema-bound dispatch of a tool call against a store. Validates input FIRST;
 * invalid input returns a validation Result and opens NO write transaction. A
 * write command resolves its target through {@link resolveWriteScope}; an omitted
 * scope targets `ctx.activeStoryId` (which may be a header/footer) and is REJECTED
 * — not silently sent to the body — when there is no active story.
 */
export function dispatchTool(
  store: DocumentStore,
  tool: string,
  input: unknown,
  ctx: ScopeContext = {},
): Result<string | undefined> {
  const def = COMMANDS.find((c) => c.tool === tool);
  if (!def) return { status: 'validation', message: `unknown tool: ${tool}`, revision: store.currentRevision };

  const v = validateInput(def.input, input);
  if (!v.ok) return { status: 'validation', message: v.errors.join('; '), revision: store.currentRevision };

  const obj = input as Record<string, unknown>;
  switch (def.tool) {
    case 'insertText': {
      const r = store.transact(ORIGIN_IDS.mutationAgent, (c) =>
        c.apply({ op: 'insertText', paragraphId: obj.paragraphId as string, text: obj.text as string }),
      );
      return r.ok ? ok(undefined, r.revision) : { status: r.failure.kind, message: r.failure.message, revision: store.currentRevision };
    }
    case 'appendParagraph': {
      const parsed = parseScopeInput(obj);
      if (!parsed.ok) return { status: 'validation', message: parsed.error, revision: store.currentRevision };
      const resolved = resolveWriteScope(store.currentModel, parsed.scope, ctx);
      if (!resolved.ok) return { status: 'validation', message: `scope: ${resolved.reason}`, revision: store.currentRevision };
      const r = store.transact(ORIGIN_IDS.mutationAgent, (c) =>
        c.apply({ op: 'appendParagraph', storyId: resolved.storyId }),
      );
      return r.ok ? ok(r.modelChange.created[0], r.revision) : { status: r.failure.kind, message: r.failure.message, revision: store.currentRevision };
    }
    case 'getParagraphText': {
      const text = paragraphText(store.currentModel, obj.paragraphId as string);
      return text === undefined
        ? { status: 'validation', message: 'paragraph not found', revision: store.currentRevision }
        : ok(text, store.currentRevision);
    }
    default:
      return { status: 'validation', message: 'unhandled tool', revision: store.currentRevision };
  }
}
