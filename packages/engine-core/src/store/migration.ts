// Versioned, resumable migrations (document-engine task 5.7 / design D10). Each
// step migrates one schema version to the next and validates the result BEFORE
// it is published. The runner applies steps to a working copy and returns the
// fully-migrated data ONLY on complete success; on any interruption (a throwing
// step, a failed validation, a missing path) it returns the ORIGINAL prior
// checkpoint — never a partially-migrated state — so migration is safe to resume.

export interface MigrationStep<T> {
  readonly from: number;
  readonly to: number;
  migrate(data: T): T;
  /** Validate the migrated result before publication. */
  validate(data: T): boolean;
}

export type MigrationFailure = 'no-path' | 'validation-failed' | 'migration-threw';

export type MigrationResult<T> =
  | { readonly ok: true; readonly version: number; readonly data: T; readonly applied: readonly number[] }
  | {
      readonly ok: false;
      readonly reason: MigrationFailure;
      /** The prior checkpoint (original input) — safe to resume from. */
      readonly recovered: T;
      readonly recoveredVersion: number;
    };

export class MigrationRunner<T> {
  private readonly steps = new Map<number, MigrationStep<T>>();

  register(step: MigrationStep<T>): this {
    if (step.to !== step.from + 1) throw new Error('migration steps must increment by one version');
    this.steps.set(step.from, step);
    return this;
  }

  /**
   * Migrate `data` from `fromVersion` to `toVersion`. Atomic: returns fully
   * migrated data on success, otherwise the untouched original.
   */
  run(data: T, fromVersion: number, toVersion: number): MigrationResult<T> {
    if (fromVersion === toVersion) return { ok: true, version: fromVersion, data, applied: [] };
    if (toVersion < fromVersion) {
      return { ok: false, reason: 'no-path', recovered: data, recoveredVersion: fromVersion };
    }
    let current = data;
    let version = fromVersion;
    const applied: number[] = [];
    const fail = (reason: MigrationFailure): MigrationResult<T> => ({
      ok: false,
      reason,
      recovered: data, // ALWAYS the original prior checkpoint, never a partial
      recoveredVersion: fromVersion,
    });

    while (version < toVersion) {
      const step = this.steps.get(version);
      if (!step) return fail('no-path');
      let next: T;
      try {
        next = step.migrate(current);
      } catch {
        return fail('migration-threw');
      }
      if (!step.validate(next)) return fail('validation-failed');
      current = next;
      version = step.to;
      applied.push(step.to);
    }
    return { ok: true, version, data: current, applied };
  }
}
