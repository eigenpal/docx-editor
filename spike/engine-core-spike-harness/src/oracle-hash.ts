/** @spike-features fixture-comparators */
import { canonicalJson } from './canonical-json';
import manifest from '../oracles/manifest.v1.json';
import yjsSchema from '../oracles/yjs-schema.v1.json';
import bindingOracle from '../oracles/binding-oracle.v1.json';
import vocabulary from '../oracles/docx-editor-vocabulary.v1.json';
import comparatorContracts from '../oracles/comparator-contracts.v1.json';
import migrationInventory from '../migration/playwright-inventory.v1.json';
import packageTestInventory from '../migration/package-test-inventory.v1.json';
import scopeManifest from '../oracles/scope-manifest.v1.json';

export function sha256Hex(input: string): string {
  return new Bun.CryptoHasher('sha256').update(input).digest('hex');
}

export function paragraphTexts(count = 128): string[] {
  return Array.from({ length: count }, (_, i) => `p${String(i).padStart(3, '0')}`);
}

export function frozenOracleBundle(): Record<string, unknown> {
  const manifestWithoutHash = structuredClone(manifest) as typeof manifest;
  delete (manifestWithoutHash.oracleHash as { value?: string }).value;
  return {
    manifest: manifestWithoutHash,
    yjsSchema,
    bindingOracle,
    vocabulary,
    comparatorContracts,
    migrationInventory,
    packageTestInventory,
    scopeManifest,
  };
}

export function computeOracleHash(bundle: unknown = frozenOracleBundle()): string {
  return sha256Hex(canonicalJson(bundle));
}

export function computePaginationHash(payload: string): string {
  return sha256Hex(payload);
}

export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

export function roundHalfAwayFromZero(value: number): number {
  if (value >= 0) return Math.floor(value + 0.5);
  return Math.ceil(value - 0.5);
}

export function toyAdvance(text: string, advances: Record<string, number>): number {
  let total = 0;
  for (const ch of text) {
    total += advances[ch] ?? advances['a'] ?? 480;
  }
  return total;
}
