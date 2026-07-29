// Ephemeral awareness + role gating (document-engine task 10.6 / design D10). Presence
// (cursor/selection) is ephemeral and is EXCLUDED from authored state, snapshots,
// history, undo, and replay — it lives only in this registry (the y-protocols/awareness
// clock/protocol is the transport mechanism; the engine owns roles, leases, and the
// exclusion guarantee). A read-only viewer may observe presence but cannot submit
// updates or exports.

export type Role = 'editor' | 'viewer';

export interface Presence {
  readonly actorId: string;
  readonly role: Role;
  readonly cursor?: { readonly paragraphId: string; readonly offset: number };
  /** Lease timestamp; a stale lease is dropped (bounded lease policy). */
  readonly at: number;
}

/** Whether a role may submit canonical updates (viewers may not). */
export function canSubmitUpdate(role: Role): boolean {
  return role === 'editor';
}
/** Whether a role may export (viewers may not). */
export function canExport(role: Role): boolean {
  return role === 'editor';
}

export class PresenceRegistry {
  private readonly states = new Map<string, Presence>();

  constructor(private readonly leaseWindow = Number.MAX_SAFE_INTEGER) {}

  /** Publish ephemeral presence for an actor. */
  set(p: Presence): void {
    this.states.set(p.actorId, p);
  }

  get(actorId: string): Presence | undefined {
    return this.states.get(actorId);
  }

  remove(actorId: string): void {
    this.states.delete(actorId);
  }

  /** Live presences (leases older than the window are dropped). */
  all(now: number): Presence[] {
    const out: Presence[] = [];
    for (const [id, p] of [...this.states]) {
      if (now - p.at > this.leaseWindow) this.states.delete(id);
      else out.push(p);
    }
    return out;
  }
}
