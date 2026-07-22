/** @spike-features local-backend */
import type {
  BackendCoverageBookkeeping,
  ImmutableStringSet,
} from './types';

export interface BackendCoverageState {
  readonly constituentIds: ReadonlySet<string>;
  readonly commitIds: ReadonlySet<string>;
}

export function createBackendCoverage(
  constituentIds: Iterable<string> = [],
  commitIds: Iterable<string> = []
): BackendCoverageState {
  return Object.freeze({
    constituentIds: new Set(constituentIds),
    commitIds: new Set(commitIds),
  });
}

export function nextBackendCoverage(
  coverage: BackendCoverageState,
  constituentIds: readonly string[],
  commitId: string
): BackendCoverageState {
  const nextConstituents = new Set(coverage.constituentIds);
  for (const constituentId of constituentIds) nextConstituents.add(constituentId);
  const nextCommits = new Set(coverage.commitIds);
  nextCommits.add(commitId);
  return createBackendCoverage(nextConstituents, nextCommits);
}

export function snapshotBackendCoverage(
  coverage: BackendCoverageState
): BackendCoverageBookkeeping {
  return Object.freeze({
    constituentIds: immutableStringSet(coverage.constituentIds),
    commitIds: immutableStringSet(coverage.commitIds),
  });
}

export function immutableStringSet(values: Iterable<string>): ImmutableStringSet {
  const snapshot = Object.freeze([...new Set(values)]);
  return Object.freeze({
    get size() {
      return snapshot.length;
    },
    has(value: string) {
      return snapshot.includes(value);
    },
    values() {
      return snapshot.values();
    },
    [Symbol.iterator]() {
      return snapshot[Symbol.iterator]();
    },
  });
}
