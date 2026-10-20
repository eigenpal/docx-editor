/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Whether one peer link keeps losing large messages.
 *
 * Each loss closes that peer's connection, and y-webrtc reconnects and resends the whole
 * state. A link too slow for that loops forever while the room's own status still says the
 * signaling connection is up. So after a few losses the link is reported as failing, and the
 * report ends when a large message from that peer arrives whole, when the signaling
 * connection comes back, or when the peer has lost nothing for a while (it left, or the link
 * recovered without a large message to prove it).
 * @internal
 */
export interface LinkHealth {
  abandoned(peerId: string): void;
  delivered(peerId: string): void;
  /** The signaling connection came back: start every count over. */
  reset(): void;
  destroy(): void;
}

/**
 * How a failing link shows on the room's status. The room stays `ready`: the other peers
 * still receive every edit, and with `offlineEditing: false` a `disconnected` status would
 * pause editing for everyone over one link. While signaling itself is down, its own
 * `disconnected` status already says more, so the link report waits.
 * @internal
 */
export function linkHealthStatus(
  session: {
    setTransportStatus(status: 'ready', reason?: 'transport-disconnected', detail?: string): void;
  },
  signalingConnected: () => boolean
): (failing: boolean) => void {
  return (failing) => {
    if (!signalingConnected()) return;
    if (failing) {
      session.setTransportStatus(
        'ready',
        'transport-disconnected',
        'a peer link cannot carry large updates'
      );
    } else {
      session.setTransportStatus('ready');
    }
  };
}

/** Losses from one peer before its link is reported as failing. */
export const MAX_ABANDONED_PER_PEER = 3;
/** A failing report ends this long after that peer's last loss. */
export const FAILING_REPORT_MS = 60_000;

export function createLinkHealth(
  report: (failing: boolean) => void,
  timers: {
    readonly set: (run: () => void, ms: number) => unknown;
    readonly clear: (handle: unknown) => void;
  } = {
    set: (run, ms) => setTimeout(run, ms),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  }
): LinkHealth {
  const losses = new Map<string, number>();
  const expiries = new Map<string, unknown>();
  const failing = new Set<string>();
  const recover = (peerId: string): void => {
    losses.delete(peerId);
    const expiry = expiries.get(peerId);
    if (expiry !== undefined) timers.clear(expiry);
    expiries.delete(peerId);
    if (failing.delete(peerId) && failing.size === 0) report(false);
  };
  return {
    abandoned(peerId) {
      const count = (losses.get(peerId) ?? 0) + 1;
      losses.set(peerId, count);
      const expiry = expiries.get(peerId);
      if (expiry !== undefined) timers.clear(expiry);
      expiries.set(
        peerId,
        timers.set(() => recover(peerId), FAILING_REPORT_MS)
      );
      if (count < MAX_ABANDONED_PER_PEER || failing.has(peerId)) return;
      failing.add(peerId);
      if (failing.size === 1) report(true);
    },
    delivered: recover,
    reset() {
      for (const peerId of [...losses.keys(), ...failing]) recover(peerId);
    },
    destroy() {
      for (const expiry of expiries.values()) timers.clear(expiry);
      expiries.clear();
      losses.clear();
      failing.clear();
    },
  };
}
