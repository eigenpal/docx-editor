/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import * as Y from 'yjs';
import { BODY_KEY } from './schema.ts';

export function openReplica(snapshot: Uint8Array): Y.Doc {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, snapshot, 'join');
  return doc;
}

export function insertBody(doc: Y.Doc, index: number, text: string): Uint8Array {
  let update: Uint8Array | undefined;
  const onUpdate = (value: Uint8Array): void => {
    update = value;
  };
  doc.on('update', onUpdate);
  doc.getText(BODY_KEY).insert(index, text);
  doc.off('update', onUpdate);
  if (!update) throw new Error('no-update');
  return update;
}

export function deleteBody(doc: Y.Doc, index: number, length: number): Uint8Array {
  let update: Uint8Array | undefined;
  const onUpdate = (value: Uint8Array): void => {
    update = value;
  };
  doc.on('update', onUpdate);
  doc.getText(BODY_KEY).delete(index, length);
  doc.off('update', onUpdate);
  if (!update) throw new Error('no-update');
  return update;
}
