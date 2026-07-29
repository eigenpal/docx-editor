// Audit index + replay journal (document-engine task 4.11 / design D5). Two
// DISTINCT records with independent retention and security: the redacted audit
// index is for routine observability and MUST NOT contain raw text; the replay
// journal holds complete versioned DocOp payloads behind access control. Raw
// authored text never enters the redacted index.

import type { DocOp } from './contracts.ts';

/** Redacted observability entry — identities and metadata only, NEVER raw text. */
export interface AuditEntry {
  readonly commitId: string;
  readonly toRevision: number;
  readonly origin: string;
  readonly dirtyIds: readonly string[];
  readonly at: number;
}

export class AuditIndex {
  private readonly entries: AuditEntry[] = [];
  constructor(private readonly maxEntries = 10_000) {}

  append(entry: AuditEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) this.entries.shift(); // finite retention
  }

  list(): readonly AuditEntry[] {
    return this.entries;
  }
}

/** Full replay entry — complete versioned operations (sensitive). */
export interface JournalEntry {
  readonly commitId: string;
  readonly toRevision: number;
  readonly origin: string;
  readonly ops: readonly DocOp[];
  readonly at: number;
}

/**
 * Access-controlled replay journal with its own retention. Reads require the
 * authorization token; the journal's security and retention are independent of
 * the redacted audit index.
 */
export class ReplayJournal {
  private readonly entries: JournalEntry[] = [];
  constructor(
    private readonly authToken: string,
    private readonly maxEntries = 10_000
  ) {}

  append(entry: JournalEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) this.entries.shift();
  }

  /** Read the journal; throws unless the caller presents the authorization token. */
  read(token: string): readonly JournalEntry[] {
    if (token !== this.authToken) throw new Error('unauthorized replay-journal access');
    return this.entries;
  }

  get size(): number {
    return this.entries.length;
  }
}
