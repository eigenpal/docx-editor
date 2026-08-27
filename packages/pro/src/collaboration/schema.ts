/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import * as Y from 'yjs';
import {
  normalizeParagraphIdentity,
  readOoxmlPackage,
  TreePackageStore,
  writeOoxmlPackage,
} from '@docx-editor.dev/core/store';
import { createCollaborationDocumentPort } from '@docx-editor.dev/core/collaboration/replication';
import type { CollaborationFailureCode } from '@docx-editor.dev/core/collaboration';
import type { CollaborationParagraph } from '@docx-editor.dev/core/collaboration/replication';

/** Wire protocol version a replica writes into shared metadata and refuses to mismatch. @public */
export const PROTOCOL_VERSION = 1;
/** Shared Yjs schema version a replica writes into shared metadata and refuses to mismatch. @public */
export const SCHEMA_VERSION = 1;
/** Maximum accepted creator baseline size in bytes. @public */
export const MAX_BASELINE_BYTES = 20 * 1024 * 1024;
export const ROOT_KEY = 'docx-collaboration-v1';
export const PARAGRAPHS_KEY = 'docx-body-paragraphs-v1';
export const BOOTSTRAP_ORIGIN = Object.freeze({ kind: 'docx-collaboration-bootstrap' });

export interface OpenedBaseline {
  readonly bytes: Uint8Array;
  readonly paragraphs: readonly CollaborationParagraph[];
}

export interface CollaborationSchema {
  readonly root: Y.Map<unknown>;
  readonly paragraphs: Y.Map<Y.Text>;
}

/** Typed collaboration schema or trust-boundary failure. @public */
export class CollaborationSchemaError extends Error {
  constructor(
    readonly code: CollaborationFailureCode,
    readonly detail?: string
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'CollaborationSchemaError';
  }
}

export function schemaOf(ydoc: Y.Doc): CollaborationSchema {
  return {
    root: ydoc.getMap<unknown>(ROOT_KEY),
    paragraphs: ydoc.getMap<Y.Text>(PARAGRAPHS_KEY),
  };
}

export function openBaseline(bytes: Uint8Array, documentId: string): OpenedBaseline {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    throw new CollaborationSchemaError('invalid-baseline');
  }
  if (bytes.byteLength > MAX_BASELINE_BYTES) {
    throw new CollaborationSchemaError('baseline-too-large');
  }
  const loaded = readOoxmlPackage(bytes, {
    zip: { maxEntries: 10_000, maxTotalBytes: MAX_BASELINE_BYTES, maxRatio: 200 },
  });
  if (!loaded.ok) throw new CollaborationSchemaError('invalid-baseline');
  const main = loaded.package.parts.get(loaded.package.mainDocumentPart);
  if (!main) throw new CollaborationSchemaError('no-main-document-part');
  const normalized = normalizeParagraphIdentity(main);
  const store = new TreePackageStore(loaded.package, normalized);
  const port = createCollaborationDocumentPort(store, { documentId });
  return {
    bytes: writeOoxmlPackage(store.currentPackage()),
    paragraphs: port.paragraphs(),
  };
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    bytes.slice().buffer as ArrayBuffer
  );
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function requiredString(root: Y.Map<unknown>, key: 'documentId' | 'baselineSha256'): string {
  const value = root.get(key);
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
    throw new CollaborationSchemaError('invalid-shared-metadata', key);
  }
  return value;
}

function requiredInteger(
  root: Y.Map<unknown>,
  key: 'protocolVersion' | 'schemaVersion' | 'baselineByteLength'
): number {
  const value = root.get(key);
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new CollaborationSchemaError('invalid-shared-metadata', key);
  }
  return value as number;
}

export function isInitialized(root: Y.Map<unknown>): boolean {
  return root.get('initialized') === true;
}

export async function initializeSchema(
  ydoc: Y.Doc,
  documentId: string,
  actorId: string,
  baseline: OpenedBaseline
): Promise<void> {
  const { root, paragraphs } = schemaOf(ydoc);
  if (isInitialized(root)) throw new CollaborationSchemaError('already-initialized');
  const digest = await sha256(baseline.bytes);
  ydoc.transact(() => {
    if (isInitialized(root)) throw new CollaborationSchemaError('already-initialized');
    root.set('protocolVersion', PROTOCOL_VERSION);
    root.set('schemaVersion', SCHEMA_VERSION);
    root.set('documentId', documentId);
    root.set('baselineSha256', digest);
    root.set('baselineByteLength', baseline.bytes.byteLength);
    root.set('initializedBy', actorId);
    root.set('baseline', new Uint8Array(baseline.bytes));
    for (const paragraph of baseline.paragraphs) {
      if (paragraphs.has(paragraph.paragraphId)) {
        throw new CollaborationSchemaError('duplicate-paragraph-id');
      }
      const text = new Y.Text();
      paragraphs.set(paragraph.paragraphId, text);
      text.insert(0, paragraph.text);
    }
    root.set('initialized', true);
  }, BOOTSTRAP_ORIGIN);
}

export async function validateInitializedSchema(
  ydoc: Y.Doc,
  expectedDocumentId: string
): Promise<OpenedBaseline> {
  const { root, paragraphs } = schemaOf(ydoc);
  if (!isInitialized(root)) throw new CollaborationSchemaError('not-initialized');
  if (requiredInteger(root, 'protocolVersion') !== PROTOCOL_VERSION) {
    throw new CollaborationSchemaError('protocol-version-mismatch');
  }
  if (requiredInteger(root, 'schemaVersion') !== SCHEMA_VERSION) {
    throw new CollaborationSchemaError('schema-version-mismatch');
  }
  if (requiredString(root, 'documentId') !== expectedDocumentId) {
    throw new CollaborationSchemaError('document-id-mismatch');
  }
  const expectedLength = requiredInteger(root, 'baselineByteLength');
  if (expectedLength === 0 || expectedLength > MAX_BASELINE_BYTES) {
    throw new CollaborationSchemaError('baseline-too-large');
  }
  const baseline = root.get('baseline');
  if (!(baseline instanceof Uint8Array) || baseline.byteLength !== expectedLength) {
    throw new CollaborationSchemaError('invalid-baseline');
  }
  if ((await sha256(baseline)) !== requiredString(root, 'baselineSha256')) {
    throw new CollaborationSchemaError('baseline-digest-mismatch');
  }
  const opened = openBaseline(new Uint8Array(baseline), expectedDocumentId);
  const expectedIds = new Set(opened.paragraphs.map((paragraph) => paragraph.paragraphId));
  if (paragraphs.size !== expectedIds.size) {
    throw new CollaborationSchemaError('paragraph-set-mismatch');
  }
  for (const [paragraphId, text] of paragraphs) {
    if (!expectedIds.has(paragraphId) || !(text instanceof Y.Text)) {
      throw new CollaborationSchemaError('paragraph-set-mismatch');
    }
  }
  return opened;
}

export function waitForInitialization(
  ydoc: Y.Doc,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<void> {
  const { root } = schemaOf(ydoc);
  if (isInitialized(root)) return Promise.resolve();
  if (signal?.aborted) {
    return Promise.reject(new CollaborationSchemaError('initialization-aborted'));
  }
  return new Promise((resolve, reject) => {
    const finish = (error?: Error): void => {
      clearTimeout(timer);
      root.unobserve(onChange);
      signal?.removeEventListener('abort', onAbort);
      error ? reject(error) : resolve();
    };
    const onChange = (): void => {
      if (isInitialized(root)) finish();
    };
    const onAbort = (): void => finish(new CollaborationSchemaError('initialization-aborted'));
    const timer = setTimeout(
      () => finish(new CollaborationSchemaError('initialization-timeout')),
      timeoutMs
    );
    root.observe(onChange);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
