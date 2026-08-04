/**
 * Pins and verifies a single commit of `OfficeDev/office-js-docs-reference`
 * — the docs source repository behind learn.microsoft.com/javascript/api/word
 * — as reference-only provenance alongside the `@types/office-js` shape
 * fixture. This is deliberately *not* a docs-scraping pipeline: requirement-
 * set (`[Api set: ...]`) facts are read from the pinned declaration file
 * itself (see `extract-word-reference.mjs`), never from these docs. What
 * this module adds is a verified answer to "which docs snapshot was known
 * to exist, at what commit, when the reference was last regenerated" —
 * network-fetched (GitHub's commit API) only from
 * `scripts/fetch-office-reference.mjs`, the same script that fetches the
 * `@types/office-js` tarball, so normal `bun test`/`typecheck`/`build`
 * stays offline exactly as before.
 */

export const DOCS_REFERENCE_REPOSITORY = 'OfficeDev/office-js-docs-reference';

/**
 * Pinned commit, verified reachable via the GitHub commits API on the date
 * this was pinned. Bump deliberately (with `fetchDocsReferenceCommitMetadata`
 * re-verifying the new value) when adopting a newer upstream reference —
 * never silently, and never inferred from a moving branch ref at runtime.
 */
export const PINNED_DOCS_REFERENCE_COMMIT = '8548490a8014ff25cc0702fd6d947d5c6f178655';

const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;

export function isWellFormedCommitSha(value) {
  return typeof value === 'string' && COMMIT_SHA_PATTERN.test(value);
}

/**
 * Builds the normalized `docsReference` shape stored on `provenance.json`.
 * Never throws; `validateDocsReferenceMetadata` is the separate, explicit
 * validation step (same split as `buildReferenceFixture`/
 * `validateReferenceFixture` elsewhere in this task).
 */
export function buildDocsReferenceMetadata({ repository, commit, commitDate, commitMessage, htmlUrl }) {
  return {
    repository,
    commit,
    commitDate,
    commitMessage: commitMessage ?? null,
    htmlUrl,
    note: 'Requirement-set ([Api set: ...]) facts are read from the pinned @types/office-js declaration file itself, not scraped from these docs. This record is provenance for which docs-reference commit was verified reachable when the shape fixture was last regenerated.',
  };
}

export function validateDocsReferenceMetadata(metadata) {
  const issues = [];
  const m = metadata ?? {};
  if (m.repository !== DOCS_REFERENCE_REPOSITORY) {
    issues.push(
      `docsReference.repository: expected ${JSON.stringify(DOCS_REFERENCE_REPOSITORY)}, got ${JSON.stringify(m.repository)}`
    );
  }
  if (!isWellFormedCommitSha(m.commit)) {
    issues.push(`docsReference.commit: expected a 40-character hex commit sha, got ${JSON.stringify(m.commit)}`);
  }
  if (typeof m.commitDate !== 'string' || m.commitDate.length === 0) {
    issues.push('docsReference.commitDate: required (non-empty string)');
  }
  if (typeof m.htmlUrl !== 'string' || !m.htmlUrl.startsWith('https://github.com/')) {
    issues.push(`docsReference.htmlUrl: expected an https://github.com/... URL, got ${JSON.stringify(m.htmlUrl)}`);
  }
  return issues;
}

/**
 * Fetches and verifies commit metadata for `commit` from the GitHub commits
 * API — the network call that makes "pin *and validate*" real rather than
 * aspirational: a renamed/rewritten/force-pushed-away commit fails loudly
 * here (non-2xx, or a returned `sha` that doesn't match what was
 * requested) instead of silently recording stale or wrong provenance.
 * Injectable `fetchImpl` (defaults to the global `fetch`) keeps this
 * offline-testable with a fake response, the same pattern
 * `fetch-office-reference.mjs`'s own network calls could use.
 */
export async function fetchDocsReferenceCommitMetadata(commit, { fetchImpl = fetch } = {}) {
  const url = `https://api.github.com/repos/${DOCS_REFERENCE_REPOSITORY}/commits/${commit}`;
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'docx-editor-office-compat-drift-check',
    },
  });
  if (!response.ok) {
    throw new Error(
      `GitHub API request for ${DOCS_REFERENCE_REPOSITORY}@${commit} failed: ${response.status} ${response.statusText}`
    );
  }
  const data = await response.json();
  if (!isWellFormedCommitSha(data.sha) || data.sha.toLowerCase() !== commit.toLowerCase()) {
    throw new Error(
      `GitHub API returned an unexpected commit sha for pinned ${DOCS_REFERENCE_REPOSITORY}@${commit}: ${JSON.stringify(data.sha)}`
    );
  }
  const commitDate = data.commit?.author?.date;
  if (typeof commitDate !== 'string' || commitDate.length === 0) {
    throw new Error(
      `GitHub API response for ${DOCS_REFERENCE_REPOSITORY}@${commit} is missing commit.author.date`
    );
  }
  const commitMessage = typeof data.commit?.message === 'string' ? data.commit.message.split('\n')[0] : null;

  return buildDocsReferenceMetadata({
    repository: DOCS_REFERENCE_REPOSITORY,
    commit: data.sha,
    commitDate,
    commitMessage,
    htmlUrl: data.html_url,
  });
}
