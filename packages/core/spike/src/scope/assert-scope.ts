/** @spike-features fixture-comparators */
import scopeManifest from '../../oracles/scope-manifest.v1.json';

const ALLOWED = new Set(scopeManifest.allowedProofFeatures);
const FORBIDDEN = new Set(scopeManifest.explicitlyForbiddenInSpike);

export function assertScopedProofFeature(feature: string): void {
  if (FORBIDDEN.has(feature)) {
    throw new Error(`forbidden spike feature: ${feature}`);
  }
  if (!ALLOWED.has(feature)) {
    throw new Error(`unlisted spike feature (not in scope manifest): ${feature}`);
  }
}

export function listAllowedProofFeatures(): readonly string[] {
  return scopeManifest.allowedProofFeatures;
}

export function listForbiddenSpikeFeatures(): readonly string[] {
  return scopeManifest.explicitlyForbiddenInSpike;
}

export { scopeManifest };
