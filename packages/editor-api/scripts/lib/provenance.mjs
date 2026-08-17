/**
 * Builds and validates the provenance record checked in alongside the
 * normalized reference fixture: exactly which upstream package
 * version/integrity, source repository, license, Word requirement sets,
 * and verified `office-js-docs-reference` docs commit the fixture's facts
 * were derived from.
 */

import { isWellFormedCommitSha, validateDocsReferenceMetadata } from './docs-reference.mjs';

const SCHEMA_VERSION = 1;

/**
 * The only repository and directory this reference may claim to come from.
 * `sourceRepository.url`/`directory` arrive from npm registry metadata, which
 * the publisher controls, while `commit`/`sourceUrl` are generated here
 * against DefinitelyTyped. Without this check a hostile or simply renamed
 * publish could commit a provenance record whose two halves disagree about
 * which repository was read.
 */
const EXPECTED_SOURCE_REPOSITORY_URL = 'https://github.com/DefinitelyTyped/DefinitelyTyped.git';
const EXPECTED_SOURCE_DIRECTORY = 'types/office-js';

function collectRequirementSets(fixture) {
  const set = new Set();
  for (const symbol of Object.values(fixture.symbols ?? {})) {
    if (symbol.requirementSet) set.add(symbol.requirementSet);
    for (const member of Object.values(symbol.members ?? {})) {
      if (member.requirementSet) set.add(member.requirementSet);
    }
  }
  return [...set].sort();
}

export function buildProvenance({ upstreamPackage, fixture, fetchedAt, docsReference }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    upstreamPackage: {
      name: upstreamPackage.name,
      version: upstreamPackage.version,
      integrity: upstreamPackage.integrity,
      shasum: upstreamPackage.shasum,
      tarballUrl: upstreamPackage.tarballUrl,
      typesPublisherContentHash: upstreamPackage.typesPublisherContentHash ?? null,
      sourceRepository: upstreamPackage.sourceRepository ?? null,
    },
    license: upstreamPackage.license,
    docsReference,
    targetRequirementSets: collectRequirementSets(fixture),
    fetchedAt,
    fetchedBy: 'packages/editor-api/scripts/fetch-office-reference.mjs',
  };
}

export function validateProvenance(provenance) {
  const errors = [];
  const p = provenance ?? {};
  const up = p.upstreamPackage ?? {};

  if (p.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`schemaVersion: expected ${SCHEMA_VERSION}, got ${p.schemaVersion}`);
  }
  if (!up.name) errors.push('upstreamPackage.name: required');
  if (!up.version) errors.push('upstreamPackage.version: required');
  if (!up.integrity) errors.push('upstreamPackage.integrity: required (npm dist.integrity)');
  if (!up.tarballUrl) errors.push('upstreamPackage.tarballUrl: required');
  if (!up.sourceRepository || !up.sourceRepository.url) {
    errors.push('upstreamPackage.sourceRepository: required (with a url)');
  } else {
    if (up.sourceRepository.url !== EXPECTED_SOURCE_REPOSITORY_URL) {
      errors.push(
        `upstreamPackage.sourceRepository.url: expected ${JSON.stringify(EXPECTED_SOURCE_REPOSITORY_URL)}, got ${JSON.stringify(up.sourceRepository.url)}`
      );
    }
    if (up.sourceRepository.directory !== EXPECTED_SOURCE_DIRECTORY) {
      errors.push(
        `upstreamPackage.sourceRepository.directory: expected ${JSON.stringify(EXPECTED_SOURCE_DIRECTORY)}, got ${JSON.stringify(up.sourceRepository.directory)}`
      );
    }
    if (!isWellFormedCommitSha(up.sourceRepository.commit)) {
      errors.push(
        `upstreamPackage.sourceRepository.commit: expected a 40-character hex commit sha, got ${JSON.stringify(up.sourceRepository.commit)}`
      );
    }
    if (
      typeof up.sourceRepository.sourceUrl !== 'string' ||
      !up.sourceRepository.sourceUrl.startsWith('https://github.com/') ||
      !up.sourceRepository.sourceUrl.includes(up.sourceRepository.commit ?? '')
    ) {
      errors.push(
        'upstreamPackage.sourceRepository.sourceUrl: expected an immutable https://github.com/... URL containing the recorded commit'
      );
    }
  }
  if (!p.license) errors.push('license: required');
  if (!p.fetchedAt) errors.push('fetchedAt: required');
  if (!Array.isArray(p.targetRequirementSets)) {
    errors.push('targetRequirementSets: expected an array');
  }
  errors.push(...validateDocsReferenceMetadata(p.docsReference));

  return errors;
}
