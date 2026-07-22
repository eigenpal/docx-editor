/** @spike-features origin-metadata */
export type LoggedOrigin = 'human' | 'agent' | 'remote' | 'undo' | 'redo' | 'repair';

export interface RevisionOriginEntry {
  readonly fixture: string;
  readonly revision: number;
  readonly origin: LoggedOrigin;
  readonly operationIds: readonly string[];
}

export class RevisionOriginLog {
  readonly #entries: RevisionOriginEntry[] = [];

  append(entry: RevisionOriginEntry): void {
    if (entry.fixture.length === 0) throw new TypeError('fixture must be non-empty');
    if (!Number.isInteger(entry.revision) || entry.revision < 0) {
      throw new TypeError('revision must be a nonnegative integer');
    }
    if (entry.operationIds.length === 0 || entry.operationIds.some((id) => id.length === 0)) {
      throw new TypeError('operationIds must contain non-empty IDs');
    }
    const previous = this.#entries.at(-1);
    if (previous && entry.revision <= previous.revision) {
      throw new RangeError('revisions must increase monotonically');
    }
    this.#entries.push(
      Object.freeze({ ...entry, operationIds: Object.freeze([...entry.operationIds]) })
    );
  }

  entries(): readonly RevisionOriginEntry[] {
    return Object.freeze([...this.#entries]);
  }
}
