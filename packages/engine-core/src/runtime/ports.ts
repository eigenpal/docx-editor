// Runtime ports and their resolution (document-engine task 0.3 / design D9 /
// extensions-and-runtime-ports spec). The engine reaches environment-dependent
// services only through these declared ports, so browser, worker, and server
// adapters supply only what that runtime offers. Missing a required port is a
// typed resolution error, never a silent fallback to a browser global.

import { RUNTIME_PORT_IDS } from '../registry/frozen-ids.ts';
import type { CancellationToken } from './cancellation.ts';

/** Injectable time source — the engine never calls Date.now directly (determinism). */
export interface ClockPort {
  now(): number;
}
/** Stable id minting for sessions, commits, and allocator seeds. */
export interface IdentityPort {
  newId(): string;
}
/** Cooperative scheduling of deferred work. */
export interface SchedulingPort {
  schedule(task: () => void): void;
}
/** Redacted observability sink (raw text never enters here — design D5). */
export interface AuditPort {
  record(entry: {
    readonly kind: string;
    readonly at: number;
    readonly meta?: Record<string, unknown>;
  }): void;
}
/** Read/write/export authorization decisions. */
export interface AuthorizationPort {
  authorize(action: string, subject?: string): boolean;
}
/** Explicit consent gate for any remote/external resource (no zero-click fetch). */
export interface ExternalResourceConsentPort {
  requestConsent(target: string): boolean;
}
/** Cancellation source for the current operation. */
export interface CancellationPort {
  readonly token: CancellationToken;
}

// Ports owned/detailed by later sections; declared here so the registry can
// resolve them uniformly. Kept as opaque markers until their milestone.
export interface PersistencePort {
  readonly kind: 'persistence';
}
export interface TransportPort {
  readonly kind: 'transport';
}
export interface FontPort {
  readonly kind: 'font';
}
export interface ShapingPort {
  readonly kind: 'shaping';
}
export interface ImagePort {
  readonly kind: 'image';
}
export interface ResourceAccountingPort {
  readonly kind: 'resource-accounting';
}

export class PortResolutionError extends Error {
  constructor(readonly portId: string) {
    super(`runtime port not available: ${portId}`);
    this.name = 'PortResolutionError';
  }
}

export class PortRegistry {
  private readonly ports = new Map<string, unknown>();

  provide(portId: string, port: unknown): this {
    this.ports.set(portId, port);
    return this;
  }

  has(portId: string): boolean {
    return this.ports.has(portId);
  }

  /** Resolve a port by id or throw. */
  resolve<T>(portId: string): T {
    if (!this.ports.has(portId)) throw new PortResolutionError(portId);
    return this.ports.get(portId) as T;
  }

  /** Assert every id in `portIds` is present; returns the missing ones (empty if all present). */
  missing(portIds: readonly string[]): string[] {
    return portIds.filter((id) => !this.ports.has(id));
  }

  /** The provided port ids (for bridging to registry.resolve availablePorts). */
  availablePorts(): string[] {
    return [...this.ports.keys()];
  }

  // Typed accessors for the well-known ports.
  clock(): ClockPort {
    return this.resolve<ClockPort>(RUNTIME_PORT_IDS.clock);
  }
  identity(): IdentityPort {
    return this.resolve<IdentityPort>(RUNTIME_PORT_IDS.identity);
  }
}

/** Deterministic clock: starts at `start` and advances by `step` each call. */
export class DeterministicClock implements ClockPort {
  private t: number;
  constructor(
    start = 0,
    private readonly step = 1
  ) {
    this.t = start;
  }
  now(): number {
    const v = this.t;
    this.t += this.step;
    return v;
  }
}

/** Sequential identity for tests and deterministic fixtures. */
export class SequentialIdentity implements IdentityPort {
  private n = 0;
  constructor(private readonly prefix = 'id') {}
  newId(): string {
    this.n += 1;
    return `${this.prefix}-${this.n}`;
  }
}
