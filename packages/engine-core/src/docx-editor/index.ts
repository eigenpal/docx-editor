// The DocxEditor public namespace (document-engine tasks 7.2, 7.3, 7.5, 7.8).
// This is the ONLY object-model namespace the engine exports; there are no bare
// durable object-model function or type exports at the package root (design D8).

import {
  create as _create,
  run as _run,
  query as _query,
  DocumentHandle as _DocumentHandle,
  RequestContext as _RequestContext,
  DocumentProxy as _DocumentProxy,
  BodyProxy as _BodyProxy,
  ParagraphProxy as _ParagraphProxy,
} from './document-editor.ts';
import type { Result as _Result, ResultStatus as _ResultStatus } from './result.ts';
import {
  mcpTools as _mcpTools,
  dispatchTool as _dispatchTool,
  validateInput as _validateInput,
  COMMANDS as _COMMANDS,
  type McpTool as _McpTool,
  type CommandDef as _CommandDef,
} from './commands.ts';
import {
  resolveWriteScope as _resolveWriteScope,
  resolveReadScope as _resolveReadScope,
  type Scope as _Scope,
  type ScopeResolution as _ScopeResolution,
  type ScopeContext as _ScopeContext,
} from './scopes.ts';

export namespace DocxEditor {
  export const create = _create;
  export const run = _run;
  export const query = _query;

  export type Result<T = void> = _Result<T>;
  export type ResultStatus = _ResultStatus;
  export type DocumentHandle = _DocumentHandle;
  export type RequestContext = _RequestContext;
  export type DocumentProxy = _DocumentProxy;
  export type BodyProxy = _BodyProxy;
  export type ParagraphProxy = _ParagraphProxy;

  export type McpTool = _McpTool;
  export type CommandDef = _CommandDef;
  export type Scope = _Scope;
  export type ScopeResolution = _ScopeResolution;
  export type ScopeContext = _ScopeContext;
  export const resolveWriteScope = _resolveWriteScope;
  export const resolveReadScope = _resolveReadScope;

  /** MCP transport surface: tool schemas generated from the shared registry, and
   *  schema-bound dispatch that opens no write transaction on invalid input. The
   *  optional scope context carries the active story so an omitted write scope
   *  targets the active header/footer rather than silently falling back to body. */
  export const mcp = {
    tools: _mcpTools,
    commands: _COMMANDS,
    validateInput: _validateInput,
    dispatch: (handle: _DocumentHandle, tool: string, input: unknown, ctx?: _ScopeContext): _Result<string | undefined> =>
      _dispatchTool(handle.internalStore, tool, input, ctx),
  };
}
