// @docx-editor.dev/engine-server
//
// Server hosting: addressable-sync hub, versioned RPC, headless parse/edit/layout/save/export, tenant isolation, and streaming. Owns transport.
//
// Production placement is fixed by document-engine task 1.4. Responsibilities and
// dependency rules: docs/architecture/production-engine-packages.md. This is a
// greenfield skeleton; capability implementation lands in the sections that own it.
//
// ADR-S9: production modules MUST NOT import from packages/core/spike/**.

/** Stable package identity used by the import-graph / package-authority checks. */
export const ENGINE_SERVER_PACKAGE = '@docx-editor.dev/engine-server' as const;

export {
  RPC_PROTOCOL_VERSION,
  COMMAND_SCHEMA_VERSION,
  DEFAULT_TENANT,
  type RpcRequest,
  type RpcResponse,
  type RpcCallOptions,
  RpcTransportError,
  RpcServer,
  RpcClient,
} from './rpc.ts';
