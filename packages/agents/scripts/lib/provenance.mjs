/**
 * Builds and validates the provenance record checked in alongside the
 * normalized reference fixture: exactly which upstream package
 * version/integrity, source repository, license, Word requirement sets,
 * and verified `office-js-docs-reference` docs commit the fixture's facts
 * were derived from.
 */

import { isWellFormedCommitSha, validateDocsReferenceMetadata } from './docs-reference.mjs';

const SCHEMA_VERSION = 1;

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
    fetchedBy: 'packages/agents/scripts/fetch-office-reference.mjs',
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
