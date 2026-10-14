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
 * Each connection records the providers that listed its URL (`providers`). This guard scopes
 * the traffic to them: subscriptions and publications for any other room are dropped before
 * they are sent, and publications for any other room are ignored when they arrive. It
 * patches the shared `y-webrtc` prototypes once, so it also covers connections that existed
 * before the first room, and connections other providers on the page open.
 *
 * A provider's room name alone does not prove the room is live: `y-webrtc` leaves a destroyed
 * provider in `providers`, and a publication encrypted before a room closed reaches `send`
 * after it. So the guard records which room currently owns each name and asks whether THAT
 * room's provider listed the URL, retires the name when the room is destroyed, and makes a
 * provider release its connections when it is destroyed.
 *
 * @internal
 */

import { Room, SignalingConn, WebrtcProvider } from 'y-webrtc';

/** The slice of a signaling message the guard reads. */
interface SignalingMessage {
  readonly type?: unknown;
  readonly topic?: unknown;
  readonly topics?: unknown;
}

interface ScopedProvider {
  readonly roomName: string;
  readonly shouldConnect?: boolean;
}

interface ScopedConnection {
  readonly providers: ReadonlySet<ScopedProvider>;
}

interface ScopedRoom {
  readonly name: string;
  readonly provider: ScopedProvider;
}

type Method = (...args: unknown[]) => unknown;

const INSTALLED = Symbol.for('docx-editor.webrtc-signaling-scope');

/** Topics this connection subscribed to, so an unsubscribe still reaches the server. */
const subscribedTopics = new WeakMap<object, Set<string>>();

/**
 * The room that currently owns each name. `y-webrtc` allows one room per name in a page, and
 * a room registers here when it connects or disconnects, which it does as soon as it opens.
 */
const roomOwners = new Map<string, ScopedRoom>();

/**
 * Names whose room the guard saw destroyed and no room has taken since. Nothing may signal
 * for them: a publication encrypted before the room closed still arrives at `send` after it.
 */
const retiredRooms = new Set<string>();

const subscribedOf = (connection: object): Set<string> => {
  let topics = subscribedTopics.get(connection);
  if (!topics) {
    topics = new Set();
    subscribedTopics.set(connection, topics);
  }
  return topics;
};

/** Record `room` as the owner of its name. @internal */
export function recordRoomOwner(room: ScopedRoom): void {
  roomOwners.set(room.name, room);
  retiredRooms.delete(room.name);
}

/** Retire `room`'s name, unless a newer room took it. @internal */
export function forgetRoomOwner(room: ScopedRoom): void {
  if (roomOwners.get(room.name) !== room) return;
  roomOwners.delete(room.name);
  retiredRooms.add(room.name);
}

/** Whether this connection may carry signaling for the room named `topic`. */
export function connectionCarriesTopic(connection: ScopedConnection, topic: unknown): boolean {
  if (typeof topic !== 'string') return false;
  const owner = roomOwners.get(topic);
  if (owner) {
    // Only a connected room signals; a disconnected one has left every connection.
    return owner.provider.shouldConnect !== false && connection.providers.has(owner.provider);
  }
  if (retiredRooms.has(topic)) return false;
  // A room that opened before the guard was installed: trust the connection's providers.
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

/** A closed socket loses every subscription on the server, so the record starts over. */
export function forgetSubscriptions(connection: object): void {
  subscribedTopics.delete(connection);
}

const patch = (prototype: object, name: string, wrap: (original: Method) => Method): void => {
  const target = prototype as Record<string, Method>;
  target[name] = wrap(target[name]!);
};

/** Scope every `y-webrtc` signaling connection on the page. Idempotent. */
export function installSignalingScope(): void {
  const marker = SignalingConn.prototype as unknown as { [INSTALLED]?: true };
  if (marker[INSTALLED]) return;
  marker[INSTALLED] = true;

  patch(
    SignalingConn.prototype,
    'send',
    (send) =>
      function scopedSend(this: ScopedConnection, message: unknown) {
        const scoped = scopeOutgoingSignalingMessage(this, message);
        if (scoped !== null) send.call(this, scoped);
      }
  );
  patch(
    SignalingConn.prototype,
    'emit',
    (emit) =>
      function scopedEmit(this: ScopedConnection, name: unknown, args: unknown) {
        if (name === 'disconnect') forgetSubscriptions(this);
        const message = Array.isArray(args) ? args[0] : undefined;
        if (name === 'message' && !acceptsIncomingSignalingMessage(this, message)) return;
        return emit.call(this, name, args);
      }
  );

  patch(
    Room.prototype,
    'connect',
    (connect) =>
      function ownedConnect(this: ScopedRoom) {
        recordRoomOwner(this);
        return connect.call(this);
      }
  );
  patch(
    Room.prototype,
    'disconnect',
    (disconnect) =>
      function ownedDisconnect(this: ScopedRoom) {
        recordRoomOwner(this);
        return disconnect.call(this);
      }
  );
  patch(
    Room.prototype,
    'destroy',
    (destroy) =>
      function forgottenDestroy(this: ScopedRoom) {
        const result = destroy.call(this);
        forgetRoomOwner(this);
        return result;
      }
  );

  // `y-webrtc` deletes each released connection from the page registry by URL. A second
  // `disconnect()` would delete the connection another provider opened since, under the same
  // URL. Disconnecting a provider that is not connected does nothing. A `status` listener may
  // reconnect inside the call, so only the connections that still list the provider stay.
  patch(
    WebrtcProvider.prototype,
    'disconnect',
    (disconnect) =>
      function idempotentDisconnect(this: ReleasableProvider) {
        if (!this.shouldConnect) return;
        disconnect.call(this);
        this.signalingConns = [
          ...new Set(this.signalingConns.filter((connection) => connection.providers.has(this))),
        ];
      }
  );
  // `destroy()` leaves the provider registered on its signaling connections, which keeps the
  // last socket open and lets the dead provider vouch for its room name. Release them first.
  patch(
    WebrtcProvider.prototype,
    'destroy',
    (destroy) =>
      function releasingDestroy(this: ReleasableProvider) {
        if (this.shouldConnect) this.disconnect();
        return destroy.call(this);
      }
  );
}

interface ReleasableProvider {
  shouldConnect: boolean;
  signalingConns: { readonly providers: ReadonlySet<unknown> }[];
  disconnect(): void;
}
