/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Room identifier helpers shared by the provider convenience wrappers.
 *
 * The WebRTC and Hocuspocus factories validate the same room-id shape. This module holds
 * the rule once, with no provider import, so each provider subpath re-exports it without
 * dragging in the other provider's package.
 */

/** Create a cryptographically strong room identifier. It is not an authorization token. @public */
export function createCollaborationRoomId(): string {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

/** Validate and normalize a room identifier from a host interface. @public */
export function validateRoomId(value: string): string {
  const roomId = value.trim();
  if (!/^[A-Za-z0-9_-]{24,256}$/.test(roomId)) {
    throw new TypeError('roomId must contain 24 to 256 URL-safe characters');
  }
  return roomId;
}
