// Shared command/query registry + MCP dispatch (document-engine tasks 7.7, 7.10,
// 7.11). One registry is the single source for the command/query surface; MCP
// tool schemas are generated FROM it (so enumerated schemas equal registry
// schemas), and dispatch validates input against the schema BEFORE opening any
// write transaction — invalid tool input never mutates the store.

import { DocumentStore } from '../store/index.ts';
import { bodyStoryId, paragraphText } from '../model/index.ts';
import { ORIGIN_IDS } from '../registry/frozen-ids.ts';
import { ok, type Result } from './result.ts';

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
    description: 'Append an empty paragraph to the body.',
    kind: 'command',
    input: { type: 'object', properties: {}, required: [], additionalProperties: false },
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

/**
 * Schema-bound dispatch of a tool call against a store. Validates input FIRST;
 * invalid input returns a validation Result and opens NO write transaction.
 */
export function dispatchTool(store: DocumentStore, tool: string, input: unknown): Result<string | undefined> {
  const def = COMMANDS.find((c) => c.tool === tool);
  if (!def) return { status: 'validation', message: `unknown tool: ${tool}`, revision: store.currentRevision };

  const v = validateInput(def.input, input);
  if (!v.ok) return { status: 'validation', message: v.errors.join('; '), revision: store.currentRevision };

  const obj = input as Record<string, unknown>;
  switch (def.tool) {
    case 'insertText': {
      const r = store.transact(ORIGIN_IDS.mutationAgent, (ctx) =>
        ctx.apply({ op: 'insertText', paragraphId: obj.paragraphId as string, text: obj.text as string }),
      );
      return r.ok ? ok(undefined, r.revision) : { status: r.failure.kind, message: r.failure.message, revision: store.currentRevision };
    }
    case 'appendParagraph': {
      const r = store.transact(ORIGIN_IDS.mutationAgent, (ctx) =>
        ctx.apply({ op: 'appendParagraph', storyId: bodyStoryId(store.currentModel) }),
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
