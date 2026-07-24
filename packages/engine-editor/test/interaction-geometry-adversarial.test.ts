// Seeded adversarial/property tests for interaction geometry (interactive-paginated-editing 3.9).

import { describe, expect, test } from 'bun:test';
import {
  clientToContent,
  contentToClient,
  contentToPageLocal,
  pageLocalToContent,
  applyAffine,
  applyInverseAffine,
  invertAffine,
  validateHostMetrics,
  IDENTITY_HOST_METRICS,
} from '../src/coordinate-mapper.ts';
import { hitTestPointer } from '../src/interaction-geometry.ts';
import { clientPointForStackedText, publishFrame, stackedFrame, modelWith } from './interaction-test-helpers.ts';

const SEED = 0x359a0d; // recorded seed for deterministic adversarial probes
function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

describe(`interaction geometry adversarial (seed=${SEED})`, () => {
  test('client/content/page round trips stay finite under random metrics', () => {
    const rand = mulberry32(SEED);
    const frame = stackedFrame(3, 24);
    for (let i = 0; i < 40; i += 1) {
      const metrics = {
        clientOrigin: { x: rand() * 200 - 50, y: rand() * 200 - 50 },
        scrollOffset: { x: rand() * 80, y: rand() * 80 },
        zoom: 0.5 + rand() * 2,
      };
      const pageIndex = Math.floor(rand() * frame.pageGeometry.length);
      const stacked = frame.pageGeometry[pageIndex]!.box;
      const content = {
        x: stacked.x + rand() * stacked.width * 0.8,
        y: stacked.y + rand() * stacked.height * 0.8,
      };
      const client = contentToClient(content, metrics);
      expect(client.ok).toBe(true);
      if (!client.ok) continue;
      const back = clientToContent(client.value, metrics);
      expect(back.ok).toBe(true);
      if (!back.ok) continue;
      expect(back.value.x).toBeCloseTo(content.x, 6);
      expect(back.value.y).toBeCloseTo(content.y, 6);
      const pageLocal = contentToPageLocal(back.value, frame);
      expect(pageLocal.ok).toBe(true);
      if (!pageLocal.ok) continue;
      const round = pageLocalToContent(pageLocal.value.pageIndex, pageLocal.value.local, frame);
      expect(round.ok).toBe(true);
      if (!round.ok) continue;
      expect(round.value.x).toBeCloseTo(back.value.x, 6);
      expect(round.value.y).toBeCloseTo(back.value.y, 6);
    }
  });

  test('valid affine apply/invert round trips under random transforms', () => {
    const rand = mulberry32(SEED + 1);
    for (let i = 0; i < 30; i += 1) {
      const transform = {
        a: 0.5 + rand(),
        b: rand() * 0.4 - 0.2,
        c: rand() * 0.4 - 0.2,
        d: 0.5 + rand(),
        tx: rand() * 40 - 20,
        ty: rand() * 40 - 20,
      };
      const inverse = invertAffine(transform);
      if (!inverse) continue;
      const point = { x: rand() * 100, y: rand() * 100 };
      const mapped = applyAffine(transform, point);
      const back = applyInverseAffine(transform, mapped);
      expect(back?.x).toBeCloseTo(point.x, 6);
      expect(back?.y).toBeCloseTo(point.y, 6);
    }
  });

  test('malformed and non-finite inputs fail closed', () => {
    expect(validateHostMetrics(undefined).ok).toBe(false);
    expect(clientToContent({ x: Infinity, y: 0 }, IDENTITY_HOST_METRICS).ok).toBe(false);
    expect(contentToPageLocal({ x: NaN, y: 0 }, stackedFrame(1)).ok).toBe(false);
    expect(pageLocalToContent(0, { x: 0, y: 0 }, stackedFrame(0)).ok).toBe(false);
  });

  test('stale frame publication/read interleaving rejects superseded identity', () => {
    const frame = publishFrame(modelWith(['stale']));
    const staleId = frame.id;
    const superseded = hitTestPointer(frame, { x: 0, y: 0 }, IDENTITY_HOST_METRICS, { frameId: { value: staleId.value - 1 } });
    expect(superseded.ok).toBe(false);
    expect(superseded.ok ? null : superseded.code).toBe('staleFrame');
    const item = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    const point = clientPointForStackedText(frame, 0, { x: item.box.x + 2, y: item.box.y + 2 }, IDENTITY_HOST_METRICS);
    const current = hitTestPointer(frame, point, IDENTITY_HOST_METRICS, { frameId: staleId });
    expect(current.ok).toBe(true);
  });

  test('grapheme edge tie remains deterministic for repeated probes', () => {
    const frame = publishFrame(modelWith(['ab']));
    const item = frame.display[0]!.items.find((i) => i.kind === 'text');
    if (item?.kind !== 'text') throw new Error('text');
    const left = item.clusters[0]!;
    const right = item.clusters[1]!;
    const tieX = (left.box.x + left.box.width + right.box.x + right.box.width) / 2;
    const point = clientPointForStackedText(
      frame,
      0,
      { x: tieX, y: left.box.y + left.box.height / 2 },
      IDENTITY_HOST_METRICS,
    );
    const first = hitTestPointer(frame, point, IDENTITY_HOST_METRICS);
    const second = hitTestPointer(frame, point, IDENTITY_HOST_METRICS);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok || first.value.target.kind !== 'text' || second.value.target.kind !== 'text') {
      throw new Error('hits');
    }
    expect(first.value.target.graphemeOffset).toBe(2);
    expect(first.value.target.affinity).toBe('downstream');
    expect(second.value.target.graphemeOffset).toBe(first.value.target.graphemeOffset);
    expect(second.value.target.affinity).toBe(first.value.target.affinity);
  });
});
