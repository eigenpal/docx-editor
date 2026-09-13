/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Deterministic operation histories: replica winner may vary, text conservation may not.
import { test, expect } from 'bun:test';
import { createPeerHarness, nodeText, zipDocument } from './document-peer-support.ts';
for (let seed = 1; seed <= 30; seed++)
  test(`five mixed edit rounds preserve text (seed ${seed})`, async () => {
    const h = createPeerHarness('review592-' + seed);
    let state = seed;
    const n = (bound: number) => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state % bound;
    };
    let expected = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmnopqrstuvwxyz';
    try {
      const { alice, bob, pause, resume } = await h.pair(
        zipDocument(
          `<w:p><w:r><w:rPr><w:color w:val="123456"/></w:rPr><w:t>${expected}</w:t></w:r></w:p><w:sectPr/>`
        )
      );
      const check = () => {
        for (const p of [alice, bob]) {
          expect(p.room.session.status()).toBe('ready');
          expect(nodeText(p.store.bodyStore().part.root)).toBe(expected);
        }
        h.expectConverged(alice, bob);
      };
      for (let round = 0; round < 5; round++) {
        pause();
        for (const [p, localName] of [
          [alice, 'b'],
          [bob, 'i'],
        ] as const) {
          const start = n(expected.length - 1);
          const end = start + 1 + n(expected.length - start);
          h.apply(p, [
            {
              op: 'setRunProperties',
              paragraphId: h.paragraphIdAt(p, 0),
              start,
              end,
              properties: [{ localName }],
            },
          ]);
        }
        resume();
        check();
        const p = round % 2 ? alice : bob;
        const offset = n(expected.length + 1);
        h.apply(p, [{ op: 'insertText', paragraphId: h.paragraphIdAt(p, 0), offset, text: '!' }]);
        expected = expected.slice(0, offset) + '!' + expected.slice(offset);
        check();
        const start = n(expected.length - 1);
        const end = start + 1 + n(Math.min(4, expected.length - start));
        h.apply(p, [{ op: 'deleteText', paragraphId: h.paragraphIdAt(p, 0), start, end }]);
        expected = expected.slice(0, start) + expected.slice(end);
        check();
      }
      const c = await h.join(alice, 'cold');
      h.expectConverged(alice, c);
      expect(nodeText(c.store.bodyStore().part.root)).toBe(expected);
    } finally {
      h.cleanup();
    }
  });
