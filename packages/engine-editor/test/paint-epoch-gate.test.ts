import { expect, test } from 'bun:test';
import { PaintEpochGate } from '../src/paint-epoch-gate.ts';

test('a stale font load cannot publish interaction for a newer display frame', () => {
  const gate = new PaintEpochGate();
  const first = gate.beginFrame();
  const second = gate.beginFrame();

  expect(gate.commitPaint(first)).toBe(false);
  expect(gate.interactionReady).toBe(false);
  expect(gate.commitPaint(second)).toBe(true);
  expect(gate.interactionReady).toBe(true);
});

test('publishing a frame synchronously makes the previous committed frame unready', () => {
  const gate = new PaintEpochGate();
  const first = gate.beginFrame();
  expect(gate.commitPaint(first)).toBe(true);

  gate.beginFrame();

  expect(gate.interactionReady).toBe(false);
});
