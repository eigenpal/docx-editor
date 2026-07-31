/** @spike-features yjs-backend */
import * as Y from 'yjs';
import type { RelativeEndpointEnvelope } from '../../comparators/yjs-schema-fingerprint';
import { YJS_BACKEND_VERSION, YJS_SCHEMA_VERSION } from './constants';

function base64UrlEncode(bytes: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (padded.length % 4)) % 4;
  const base64 = padded + '='.repeat(padLength);
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function encodeRelativeEndpoint(input: {
  doc: Y.Doc;
  ytext: Y.Text;
  textCreationId: string;
  index: number;
  affinity: 'before' | 'after';
  documentId: string;
  checkpoint: string;
}): RelativeEndpointEnvelope {
  const assoc = input.affinity === 'before' ? -1 : 0;
  const relativePosition = Y.createRelativePositionFromTypeIndex(input.ytext, input.index, assoc);
  const relativeBytes = base64UrlEncode(Y.encodeRelativePosition(relativePosition));
  return Object.freeze({
    version: 'relative-endpoint/1',
    documentId: input.documentId,
    backendVersion: YJS_BACKEND_VERSION,
    schemaVersion: YJS_SCHEMA_VERSION,
    checkpoint: input.checkpoint,
    textCreationId: input.textCreationId,
    affinity: input.affinity,
    relativeBytes,
  });
}

export function resolveEndpointOffset(doc: Y.Doc, ytext: Y.Text, endpoint: RelativeEndpointEnvelope): number {
  const relativePosition = Y.decodeRelativePosition(base64UrlDecode(endpoint.relativeBytes));
  const absolute = Y.createAbsolutePositionFromRelativePosition(relativePosition, doc);
  if (!absolute || absolute.type !== ytext) {
    throw new TypeError('mark endpoint does not resolve in owning text');
  }
  return absolute.index;
}
