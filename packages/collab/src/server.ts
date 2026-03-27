/**
 * Hocuspocus Collaborative Editing Server
 *
 * WebSocket server that syncs Yjs documents between connected clients.
 * Persists document snapshots to Postgres (Supabase) so documents
 * survive server restarts and can be loaded by new clients.
 *
 * Usage:
 *   import { createCollabServer } from '@eigenpal/docx-collab/server';
 *
 *   const server = createCollabServer({
 *     port: 8080,
 *     databaseUrl: process.env.DATABASE_URL,
 *     onAuthenticate: async ({ token }) => {
 *       // validate Supabase JWT
 *     },
 *   });
 */

import { Server } from '@hocuspocus/server';
import { Database } from '@hocuspocus/extension-database';

export interface CollabServerOptions {
  /** WebSocket port (default: 8080) */
  port?: number;
  /** Postgres connection URL (Supabase) */
  databaseUrl?: string;
  /** Custom fetch function for loading documents from your DB */
  fetchDocument?: (documentName: string) => Promise<Uint8Array | null>;
  /** Custom store function for persisting documents to your DB */
  storeDocument?: (documentName: string, state: Uint8Array) => Promise<void>;
  /** Auth callback — validate JWT token, return user data or throw to reject */
  onAuthenticate?: (data: {
    token: string;
    documentName: string;
  }) => Promise<{ userId: string; userName: string }>;
  /** Called when a user connects */
  onConnect?: (data: { documentName: string; userId?: string }) => Promise<void>;
  /** Called when a user disconnects */
  onDisconnect?: (data: { documentName: string; userId?: string }) => void;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * SQL for creating the documents table in Supabase.
 * Run this once in your Supabase SQL editor:
 *
 * ```sql
 * CREATE TABLE IF NOT EXISTS collab_documents (
 *   name TEXT PRIMARY KEY,
 *   data BYTEA NOT NULL,
 *   updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 * );
 *
 * CREATE INDEX IF NOT EXISTS idx_collab_documents_updated
 *   ON collab_documents(updated_at);
 * ```
 */
export const COLLAB_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS collab_documents (
  name TEXT PRIMARY KEY,
  data BYTEA NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_collab_documents_updated
  ON collab_documents(updated_at);
`;

export function createCollabServer(options: CollabServerOptions = {}) {
  const {
    port = 8080,
    databaseUrl,
    fetchDocument,
    storeDocument,
    onAuthenticate,
    onConnect,
    onDisconnect,
    debug = false,
  } = options;

  const extensions: any[] = [];

  // Database persistence — either custom callbacks or Postgres via connection URL
  if (fetchDocument && storeDocument) {
    extensions.push(
      new Database({
        fetch: async ({ documentName }) => {
          const data = await fetchDocument(documentName);
          return data ?? null;
        },
        store: async ({ documentName, state }) => {
          await storeDocument(documentName, state);
        },
      })
    );
  } else if (databaseUrl) {
    // Use raw pg queries for Supabase Postgres
    let pg: any;
    try {
      pg = require('pg');
    } catch {
      throw new Error('pg package required for database persistence. Install with: bun add pg');
    }

    const pool = new pg.Pool({ connectionString: databaseUrl });

    extensions.push(
      new Database({
        fetch: async ({ documentName }) => {
          const result = await pool.query('SELECT data FROM collab_documents WHERE name = $1', [
            documentName,
          ]);
          if (result.rows.length === 0) return null;
          return new Uint8Array(result.rows[0].data);
        },
        store: async ({ documentName, state }) => {
          await pool.query(
            `INSERT INTO collab_documents (name, data, updated_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (name)
             DO UPDATE SET data = $2, updated_at = NOW()`,
            [documentName, Buffer.from(state)]
          );
        },
      })
    );
  }

  const server = new Server({
    port,
    extensions,
    quiet: !debug,

    async onAuthenticate(data: any) {
      if (!onAuthenticate) return;
      const token = data.token;
      if (!token) {
        throw new Error('Authentication required');
      }
      const user = await onAuthenticate({
        token,
        documentName: data.documentName,
      });
      return { user };
    },

    async onConnect(data: any) {
      if (onConnect) {
        await onConnect({
          documentName: data.documentName,
        });
      }
    },

    async onDisconnect(data: any) {
      if (onDisconnect) {
        onDisconnect({
          documentName: data.documentName,
        });
      }
    },
  });

  return {
    /** Start the WebSocket server */
    listen: (listenPort?: number) => server.listen(listenPort ?? port),
    /** Stop the server */
    destroy: () => server.destroy(),
    /** The underlying Hocuspocus Server instance */
    server,
  };
}

// Auto-start if run directly (not imported)
if (require.main === module) {
  const port = parseInt(process.env.COLLAB_PORT || '8080', 10);
  const databaseUrl = process.env.DATABASE_URL;

  console.log(`Starting collab server on port ${port}...`);
  if (databaseUrl) {
    console.log('Database persistence enabled');
  } else {
    console.log('WARNING: No DATABASE_URL — documents will not persist across restarts');
  }

  const server = createCollabServer({ port, databaseUrl, debug: true });
  server.listen();
}
