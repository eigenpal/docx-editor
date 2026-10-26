// Bookkeeping for faces that arrive after the first paint.
//
// - pending holds from the promise until the installation finishes, not until the download
// - a host promise that rejects, or a stalled one, ends the wait instead of holding it forever
// - a late installation keeps the full composition's first-wins choice
// - an answer already installed is recognized, so it lays nothing out twice

import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { FontSource } from '../../contracts/editor.ts';
import { sha256FontBytes } from '../../layout/index.ts';
import type { FontConfigurationFragment } from '../font-composition.ts';
import { composeFontOrigins } from '../font-resolver.ts';
import {
  createLateFontArrival,
  lateFacesInstalled,
  lateFontOrigins,
  type LateFontDelivery,
} from '../late-font-arrival.ts';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const toFace = (family: string) => ({ family, weight: 400, style: 'normal' as const });
/** A late answer that brings something: one substitution. */
const someFaces: FontConfigurationFragment = {
  substitutions: [{ from: toFace('Late'), to: toFace('Early') }],
};

function arrivalFor(waitMs?: number) {
  const delivered: LateFontDelivery[] = [];
  const reported: unknown[] = [];
  let changes = 0;
  const arrival = createLateFontArrival({
    deliver: (_generation, delivery) => delivered.push(delivery),
    changed: () => changes++,
    report: (cause) => reported.push(cause),
    ...(waitMs !== undefined ? { waitMs } : {}),
  });
  return { arrival, delivered, reported, changes: () => changes };
}

test('pending holds until the delivered faces install', async () => {
  const { arrival, delivered, changes } = arrivalFor();
  arrival.track(Promise.resolve(someFaces), undefined, 1, () => true);
  await tick();
  expect(delivered).toHaveLength(1);
  // Downloaded but not installed: `resolving` must still read true.
  expect(arrival.pending()).toBe(true);
  arrival.settle(delivered[0]);
  expect(arrival.pending()).toBe(false);
  expect(changes()).toBe(1);
});

test('a rejected host promise ends the wait', async () => {
  const { arrival, changes } = arrivalFor();
  arrival.track(Promise.reject(new Error('host bug')), undefined, 1, () => true);
  expect(arrival.pending()).toBe(true);
  await tick();
  expect(arrival.pending()).toBe(false);
  expect(changes()).toBe(1);
});

test('faces for a load that moved on are never delivered', async () => {
  const { arrival, delivered } = arrivalFor();
  arrival.track(Promise.resolve(someFaces), undefined, 1, () => false);
  await tick();
  expect(delivered).toEqual([]);
  expect(arrival.pending()).toBe(false);
});

test('an arrival with nothing in it installs nothing', async () => {
  const { arrival, delivered } = arrivalFor();
  arrival.track(Promise.resolve({ sources: [], substitutions: [] }), undefined, 1, () => true);
  await tick();
  expect(delivered).toEqual([]);
  expect(arrival.pending()).toBe(false);
});

test("a raw resolver's late faces install with its immediate answer and settings", async () => {
  const { arrival, delivered } = arrivalFor();
  const installed = {
    defaultFont: { family: 'Early', sizeHalfPoints: 24 },
    substitutions: [{ from: toFace('Body'), to: toFace('Early') }],
  };
  arrival.track(Promise.resolve(someFaces), installed, 1, () => true);
  await tick();
  const full = delivered[0]!.full as typeof installed;
  expect(full.defaultFont).toEqual(installed.defaultFont);
  expect(full.substitutions.map((entry) => entry.from.family)).toEqual(['Late', 'Body']);
});

test("a raw late answer's failures are reported", async () => {
  const { arrival, reported } = arrivalFor();
  const late = { sources: [], failures: ['offline'] } as FontConfigurationFragment;
  arrival.track(Promise.resolve(late), undefined, 1, () => true);
  await tick();
  expect(reported).toEqual(['offline']);
});

test('a stalled download stops holding the wait, and still installs if it lands', async () => {
  const { arrival, delivered } = arrivalFor(5);
  let release!: (value: FontConfigurationFragment) => void;
  arrival.track(new Promise((resolve) => (release = resolve)), undefined, 1, () => true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(arrival.pending()).toBe(false);
  release(someFaces);
  await tick();
  expect(delivered).toHaveLength(1);
});

test('a late installation keeps the first-wins choice of the full composition', async () => {
  const bytes = new Uint8Array(
    readFileSync(new URL('../../layout/__tests__/fixtures/fonts/DejaVuSans.ttf', import.meta.url))
  );
  const face = (family: string): FontSource => ({
    request: toFace(family),
    id: family,
    bytes,
    hash: sha256FontBytes(bytes),
    faceIndex: 0,
  });
  // The earlier origin answered SimSun late (SC); the later one answered it at once (JP).
  const installed: FontConfigurationFragment = {
    sources: [face('JP')],
    substitutions: [{ from: toFace('SimSun'), to: toFace('JP') }],
  };
  const full: FontConfigurationFragment = {
    sources: [face('SC'), face('JP')],
    substitutions: [{ from: toFace('SimSun'), to: toFace('SC') }],
  };
  const composed = await composeFontOrigins(lateFontOrigins(full, installed), {
    families: ['SimSun'],
    defaultFamily: 'Calibri',
  });
  expect(composed?.substitutions?.map((entry) => entry.to.family)).toEqual(['SC']);
});

test('a late installation does not report the immediate answer failures again', () => {
  const installed = { sources: [], failures: [new Error('reported once')] };
  const origins = lateFontOrigins(someFaces, installed as FontConfigurationFragment);
  expect(origins.some((origin) => 'failures' in origin)).toBe(false);
});

test('a late answer already installed is recognized, so it lays nothing out again', () => {
  expect(lateFacesInstalled(someFaces, someFaces)).toBe(true);
  expect(lateFacesInstalled(someFaces, { substitutions: [] })).toBe(false);
  expect(lateFacesInstalled(someFaces, undefined)).toBe(false);
});
