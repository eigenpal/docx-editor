/** @spike-features one-body-story, stable-paragraph-ids, synthetic-128-paragraph-fixture */
let authoredBlockIdLookupWorkCountForTests = 0;

export function resetAuthoredBlockIdLookupWorkForTests(): void {
  authoredBlockIdLookupWorkCountForTests = 0;
}

export function authoredBlockIdLookupWorkForTests(): number {
  return authoredBlockIdLookupWorkCountForTests;
}

export function recordAuthoredBlockIdLookupWorkForTests(): void {
  authoredBlockIdLookupWorkCountForTests += 1;
}
