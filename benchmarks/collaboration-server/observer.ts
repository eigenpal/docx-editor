// A connected participant who reads but does not type.
//
// The server treats it exactly as an idle person: it authenticates, syncs the whole room,
// receives every update and every presence change, and publishes its own presence. It keeps
// no document store, because the server never sees that cost and a load machine running 50
// full replicas would measure itself instead of the server.

import { HocuspocusProvider } from '@hocuspocus/provider';
import { COLLABORATION_FORMAT_VERSION } from '@docx-editor.dev/pro/collaboration';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { now, type ClientDigest, type ClientReport, type StatusEvent } from './protocol.ts';

export interface Observer {
  readonly index: number;
  readonly ydoc: Y.Doc;
  readonly provider: HocuspocusProvider;
  readonly joinMs: number;
  readonly statusEvents: StatusEvent[];
}

export async function joinObserver(
  index: number,
  url: string,
  roomId: string,
  token: string
): Promise<Observer> {
  const started = now();
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  const statusEvents: StatusEvent[] = [];
  const provider = new HocuspocusProvider({
    url,
    name: roomId,
    document: ydoc,
    awareness,
    token: JSON.stringify({ token, collaborationVersion: COLLABORATION_FORMAT_VERSION }),
  });
  provider.on('status', (event: { status: string }) => {
    // `connecting` follows every drop, so counting it too would double each disconnect.
    if (event.status === 'connecting') return;
    statusEvents.push({
      t: now(),
      status: event.status === 'connected' ? 'ready' : 'disconnected',
    });
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('observer did not sync')), 60_000);
    provider.on('synced', () => {
      clearTimeout(timer);
      resolve();
    });
    provider.on('authenticationFailed', (event: { reason: string }) => {
      clearTimeout(timer);
      reject(new Error(`authentication failed: ${event.reason}`));
    });
  });
  // An idle person still shows in the participant list.
  awareness.setLocalStateField('user', { name: `Reader ${index + 1}` });
  // Connecting is not a disconnect; only changes after the sync count.
  statusEvents.length = 0;
  return { index, ydoc, provider, joinMs: now() - started, statusEvents };
}

/**
 * The deleted ranges of a document. A state vector counts inserts only, so two documents
 * can share one state vector while one of them missed a delete-only update.
 */
export function deleteSetDigest(ydoc: Y.Doc): string {
  const { clients } = Y.createDeleteSetFromStructStore(ydoc.store);
  return [...clients.entries()]
    .sort(([a], [b]) => a - b)
    .map(
      ([client, items]) => `${client}:${items.map((item) => `${item.clock}+${item.len}`).join(',')}`
    )
    .join(';');
}

export function observerDigest(observer: Observer): ClientDigest {
  return {
    index: observer.index,
    status: observer.provider.isSynced ? 'ready' : 'disconnected',
    stateVector: Buffer.from(Y.encodeStateVector(observer.ydoc)).toString('base64'),
    deleteSet: deleteSetDigest(observer.ydoc),
    text: null,
  };
}

export function observerReport(observer: Observer): ClientReport {
  return {
    index: observer.index,
    observer: true,
    clientId: observer.ydoc.clientID,
    joinMs: observer.joinMs,
    sent: [],
    received: [],
    planned: 0,
    applied: 0,
    refused: {},
    schedulerLagMs: [],
    remoteApplyMs: [],
    statusEvents: observer.statusEvents,
  };
}

export function closeObserver(observer: Observer): void {
  observer.provider.destroy();
  observer.ydoc.destroy();
}
