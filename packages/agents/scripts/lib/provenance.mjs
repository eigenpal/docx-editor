/**
 * Builds and validates the provenance record checked in alongside the
 * normalized reference fixture: exactly which upstream package
 * version/integrity, source repository, license, and Word requirement sets
 * the fixture's facts were derived from.
 */

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
    docsReference: docsReference ?? {
      url: 'https://learn.microsoft.com/en-us/javascript/api/word',
      note: 'Requirement-set ([Api set: ...]) facts are read from the pinned declaration file itself, not scraped separately from the docs site.',
    },
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
  }
  if (!p.license) errors.push('license: required');
  if (!p.fetchedAt) errors.push('fetchedAt: required');
  if (!Array.isArray(p.targetRequirementSets)) {
    errors.push('targetRequirementSets: expected an array');
  }

  return errors;
}
