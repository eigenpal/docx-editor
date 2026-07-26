// Generated language-client binding (document-engine tasks 11.6, 11.8 core /
// design D11). The client is GENERATED from the shared command registry — it
// carries no engine implementation, only schema-derived methods over an opaque
// transport. Because the methods come from the same registry the server dispatches
// from, a generated-client call is equivalent to the direct/API/MCP/RPC paths.
// (This is the TypeScript binding; the Python `docx_editor` package mirrors it.)

import { DocxEditor } from '@docx-editor.dev/engine-core';

/** The wire transport a client speaks over (RPC, in-process, ...). */
export interface ClientTransport {
  call(method: string, params: unknown): DocxEditor.Result<string | undefined>;
}

export type ClientMethod = (
  params?: Record<string, unknown>
) => DocxEditor.Result<string | undefined>;

/**
 * Build a client whose methods are generated from the command registry: one
 * method per tool name, each forwarding to the transport. Adding a command to the
 * registry adds a method here with no code change.
 */
export function makeGeneratedClient(transport: ClientTransport): Record<string, ClientMethod> {
  const client: Record<string, ClientMethod> = {};
  for (const cmd of DocxEditor.mcp.commands) {
    client[cmd.tool] = (params = {}) => transport.call(cmd.tool, params);
  }
  return client;
}

/** Typed facade over the generated client for the base command set. */
export class DocxClient {
  private readonly gen: Record<string, ClientMethod>;
  constructor(transport: ClientTransport) {
    this.gen = makeGeneratedClient(transport);
  }
  insertText(paragraphId: string, text: string): DocxEditor.Result<string | undefined> {
    return this.gen.insertText({ paragraphId, text });
  }
  /** Append a paragraph to the body. The base facade declares the body scope
   *  explicitly; targeting an active header/footer uses the raw generated client
   *  with a scope context on the transport. */
  appendParagraph(): DocxEditor.Result<string | undefined> {
    return this.gen.appendParagraph({ scope: 'body' });
  }
  getParagraphText(paragraphId: string): DocxEditor.Result<string | undefined> {
    return this.gen.getParagraphText({ paragraphId });
  }
  /** The generated method names (== registry tool names). */
  get methods(): string[] {
    return Object.keys(this.gen);
  }
}
