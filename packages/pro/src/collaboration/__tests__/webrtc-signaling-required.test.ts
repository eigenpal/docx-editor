/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A default signaling host would receive room ids and signaling traffic from an integrator
// who never chose it. `createWebrtcCollaboration` has no default: an omitted `signaling`
// rejects before any connection opens, and only an explicit list reaches the provider.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createCollaborationRoomId,
  createWebrtcCollaboration,
  DEMO_SIGNALING_ENDPOINTS,
  requireSignaling,
  type CreateWebrtcCollaborationOptions,
} from '../webrtc.ts';
import type { UseWebrtcCollaborationConnectOptions as ReactConnectOptions } from '../../react/useWebrtcCollaboration.ts';
import type { UseWebrtcCollaborationConnectOptions as VueConnectOptions } from '../../vue/useWebrtcCollaboration.ts';

const originalWebSocket = globalThis.WebSocket;
let socketUrls: string[] = [];

beforeEach(() => {
  socketUrls = [];
  globalThis.WebSocket = class {
    constructor(url: string | URL) {
      socketUrls.push(String(url));
      throw new Error('no network in tests');
    }
  } as unknown as typeof WebSocket;
});

afterEach(() => {
  globalThis.WebSocket = originalWebSocket;
});

const withoutSignaling = (): CreateWebrtcCollaborationOptions =>
  ({
    roomId: createCollaborationRoomId(),
    identity: { actorId: 'alex', name: 'Alex' },
    bootstrap: { kind: 'join' },
  }) as unknown as CreateWebrtcCollaborationOptions;

describe('WebRTC signaling has no default', () => {
  test('an omitted signaling option rejects before any connection opens', async () => {
    let failure: unknown;
    try {
      await createWebrtcCollaboration(withoutSignaling());
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(TypeError);
    expect((failure as Error).message).toContain('signaling');
    expect((failure as Error).message).toContain('DEMO_SIGNALING_ENDPOINTS');
    expect(socketUrls).toEqual([]);
  });

  test('an undefined signaling value rejects like an omitted one', async () => {
    const options = { ...withoutSignaling(), signaling: undefined };
    await expect(
      createWebrtcCollaboration(options as unknown as CreateWebrtcCollaborationOptions)
    ).rejects.toBeInstanceOf(TypeError);
    expect(socketUrls).toEqual([]);
  });

  test('explicit endpoints pass through unchanged', () => {
    expect(requireSignaling(DEMO_SIGNALING_ENDPOINTS)).toBe(DEMO_SIGNALING_ENDPOINTS);
    const own = ['wss://signaling.example'];
    expect(requireSignaling(own)).toBe(own);
  });

  test('an explicit empty list is accepted and names no host', () => {
    expect(requireSignaling([])).toEqual([]);
  });

  test('a value that is not a list is refused', () => {
    expect(() => requireSignaling('wss://signaling.example' as unknown as string[])).toThrow(
      TypeError
    );
  });
});

describe('the types require signaling', () => {
  test('every WebRTC option type rejects an omitted signaling list', () => {
    const base = {
      roomId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
      identity: { actorId: 'alex', name: 'Alex' },
      bootstrap: { kind: 'join' },
    } as const;
    // @ts-expect-error `signaling` is required.
    const factory: CreateWebrtcCollaborationOptions = base;
    // @ts-expect-error `signaling` is required.
    const react: ReactConnectOptions = base;
    // @ts-expect-error `signaling` is required.
    const vue: VueConnectOptions = base;
    const accepted: CreateWebrtcCollaborationOptions[] = [
      { ...base, signaling: DEMO_SIGNALING_ENDPOINTS },
      { ...base, signaling: [] },
      { ...base, signaling: ['wss://signaling.example'] as const },
    ];
    const hooks: [ReactConnectOptions, VueConnectOptions] = [
      { ...base, signaling: DEMO_SIGNALING_ENDPOINTS },
      { ...base, signaling: [] },
    ];
    expect([factory, react, vue, ...accepted, ...hooks]).toHaveLength(8);
  });
});
