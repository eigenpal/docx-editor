/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The deletion index answers "did a participant delete this character" for every identity a
// paragraph shows. Records arrive, change, and are withdrawn by undo; after each, the index
// must answer as a fresh reading of the records that remain does, and a withdrawal must cost
// only the records of the clients it named.
import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { TEXT_DELETIONS_KEY, textDeletionsOf } from '../document/paragraph-text-deletions.ts';

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

describe('the deletion index', () => {
  test('answers as the records that remain say, through writes, rewrites and withdrawals', () => {
    const doc = new Y.Doc();
    doc.clientID = 7;
    const map = doc.getMap<string>(TEXT_DELETIONS_KEY);
    const deletions = textDeletionsOf(doc);
    const next = random(42);
    const keys: string[] = [];
    const expected = (client: number, clock: number): boolean => {
      for (const value of map.values()) {
        for (const part of value.split(';')) {
          const [runClient, from, length] = part.split(':').map(Number);
          if (runClient === client && clock >= from! && clock < from! + length!) return true;
        }
      }
      return false;
    };
    for (let step = 0; step < 300; step += 1) {
      const roll = next();
      if (roll < 0.6 || keys.length === 0) {
        const runs = Array.from({ length: 1 + Math.floor(next() * 4) }, () => {
          const client = 1 + Math.floor(next() * 3);
          return `${client}:${Math.floor(next() * 200)}:${1 + Math.floor(next() * 10)}`;
        });
        const key = `d7:${step}`;
        map.set(key, runs.join(';'));
        keys.push(key);
      } else if (roll < 0.8) {
        const key = keys[Math.floor(next() * keys.length)]!;
        map.set(key, `${1 + Math.floor(next() * 3)}:${Math.floor(next() * 200)}:5`);
      } else {
        const [key] = keys.splice(Math.floor(next() * keys.length), 1);
        map.delete(key!);
      }
      for (let client = 1; client <= 3; client += 1) {
        for (let clock = 0; clock < 215; clock += 1) {
          if (deletions.isDeleted(client, clock) !== expected(client, clock)) {
            throw new Error(`step ${step}: ${client}:${clock} answers wrong`);
          }
        }
      }
    }
  });

  test('withdrawing many records costs the records of their clients once', () => {
    const doc = new Y.Doc();
    doc.clientID = 9;
    const map = doc.getMap<string>(TEXT_DELETIONS_KEY);
    const deletions = textDeletionsOf(doc);
    // Many records, written in reverse order, then withdrawn before the next read, as one undo
    // step does. Every record names client 1, and a client of its own besides.
    const records = 4000;
    for (let at = records - 1; at >= 0; at -= 1) {
      map.set(`d9:${at}`, `${100 + at}:0:1;1:${at * 2}:1`);
    }
    const started = performance.now();
    for (let at = 0; at < records; at += 1) map.delete(`d9:${at}`);
    expect(deletions.isDeleted(1, 0)).toBe(false);
    const elapsed = performance.now() - started;
    // Rebuilding every record on each withdrawal took seconds here.
    expect(elapsed).toBeLessThan(2000);
  });
});
