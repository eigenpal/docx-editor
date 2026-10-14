/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Keep each signaling connection to the rooms that chose its URL.
 *
 * `y-webrtc` keeps one signaling connection per URL for the whole page, and announces every
 * open room through every connection: a room's `signaling` list only decides which
 * connections exist, not which rooms they carry. So a room configured with its own server, or
 * with no server at all, still sent its room id and announcements to a server another room
 * chose, and accepted peer offers from it.
 *
 * Each connection already records the providers that listed its URL (`providers`). This guard
 * scopes the traffic to them: subscriptions and publications for any other room are dropped
 * before they are sent, and publications for any other room are ignored when they arrive.
 * It patches the shared `SignalingConn` prototype once, so it also covers connections that
 * existed before the first room, and connections other providers on the page open.
 *
 * @internal
 */

import { SignalingConn } from 'y-webrtc';

/** The slice of a signaling message the guard reads. */
interface SignalingMessage {
  readonly type?: unknown;
  readonly topic?: unknown;
  readonly topics?: unknown;
}

interface ScopedConnection {
  readonly providers: ReadonlySet<{ readonly roomName: string }>;
}

type Send = (message: unknown) => void;
type Emit = (name: string, args: unknown[]) => void;

const INSTALLED = Symbol.for('docx-editor.webrtc-signaling-scope');

/** Topics this connection subscribed to, so an unsubscribe still reaches the server. */
const subscribedTopics = new WeakMap<object, Set<string>>();

const subscribedOf = (connection: object): Set<string> => {
  let topics = subscribedTopics.get(connection);
  if (!topics) {
    topics = new Set();
    subscribedTopics.set(connection, topics);
  }
  return topics;
};

/** Whether a provider that listed this connection's URL owns `topic`. */
export function connectionCarriesTopic(connection: ScopedConnection, topic: unknown): boolean {
  if (typeof topic !== 'string') return false;
  for (const provider of connection.providers) if (provider.roomName === topic) return true;
  return false;
}

const stringTopics = (topics: unknown): string[] =>
  Array.isArray(topics) ? topics.filter((topic): topic is string => typeof topic === 'string') : [];

/**
 * The part of an outgoing message this connection may carry, or `null` to drop it.
 *
 * `unsubscribe` is scoped to topics this connection subscribed: a provider leaves the
 * connection's `providers` before its room unsubscribes, and the server must still hear it.
 */
export function scopeOutgoingSignalingMessage(
  connection: ScopedConnection,
  message: unknown
): unknown {
  if (message === null || typeof message !== 'object') return message;
  const { type, topic, topics } = message as SignalingMessage;
  switch (type) {
    case 'subscribe': {
      const allowed = stringTopics(topics).filter((name) =>
        connectionCarriesTopic(connection, name)
      );
      if (allowed.length === 0) return null;
      const subscribed = subscribedOf(connection);
      for (const name of allowed) subscribed.add(name);
      return { ...message, topics: allowed };
    }
    case 'unsubscribe': {
      const subscribed = subscribedOf(connection);
      const leaving = stringTopics(topics).filter((name) => subscribed.has(name));
      if (leaving.length === 0) return null;
      for (const name of leaving) subscribed.delete(name);
      return { ...message, topics: leaving };
    }
    case 'publish':
      return connectionCarriesTopic(connection, topic) ? message : null;
    default:
      return message;
  }
}

/** Whether an incoming message may reach the rooms. Only publications name a room. */
export function acceptsIncomingSignalingMessage(
  connection: ScopedConnection,
  message: unknown
): boolean {
  if (message === null || typeof message !== 'object') return true;
  const { type, topic } = message as SignalingMessage;
  return type !== 'publish' || connectionCarriesTopic(connection, topic);
}

/** Scope every `y-webrtc` signaling connection on the page. Idempotent. */
export function installSignalingScope(): void {
  const prototype = SignalingConn.prototype as unknown as {
    send: Send;
    emit: Emit;
    [INSTALLED]?: true;
  };
  if (prototype[INSTALLED]) return;
  const send = prototype.send;
  const emit = prototype.emit;
  prototype.send = function scopedSend(this: ScopedConnection, message: unknown): void {
    const scoped = scopeOutgoingSignalingMessage(this, message);
    if (scoped !== null) send.call(this, scoped);
  };
  prototype.emit = function scopedEmit(this: ScopedConnection, name: string, args: unknown[]) {
    if (name === 'message' && !acceptsIncomingSignalingMessage(this, args?.[0])) return;
    emit.call(this, name, args);
  };
  prototype[INSTALLED] = true;
}
