import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  canonicalJson,
  computeOracleHash,
  computePaginationHash,
  frozenOracleBundle,
  loadOracleManifest,
  paragraphTexts,
  roundHalfAwayFromZero,
  toyAdvance,
} from '../src';

describe('manifest.v1 self-test', () => {
  const manifest = loadOracleManifest();

  test('fixture counts match spec verbatim values', () => {
    expect(manifest.fixture.paragraphCount).toBe(128);
    expect(manifest.fixture.paragraphsPerPage).toBe(4);
    expect(manifest.styleMutation.affectedParagraphIndices).toEqual([64, 65, 66, 67]);
    expect(manifest.styleMutation.styleId).toBe('style-A');
    expect(manifest.pagination.restartParagraphIndex).toBe(64);
    expect(manifest.pagination.maxPasses).toBe(4);
    expect(manifest.counters.measuredParagraphs.ceiling).toBe(4);
    expect(manifest.counters.projectedParagraphs.ceiling).toBe(4);
    expect(manifest.counters.paginatedPages.ceiling).toBe(2);
    expect(manifest.counters.fullDocumentScans.ceiling).toBe(0);
    expect(manifest.counters.fullDocumentRebuilds.ceiling).toBe(0);
    expect(manifest.counters.dependencyEdgeVisits.ceiling).toBe(128);
  });

  test('source paragraph pattern expands to 128 deterministic texts', () => {
    const texts = paragraphTexts();
    expect(texts).toHaveLength(128);
    expect(texts[0]).toBe('p000');
    expect(texts[127]).toBe('p127');
    expect(texts[64]).toBe('p064');
  });

  test('pagination fingerprint hash matches independent procedure', () => {
    const { structure, canonicalBytesHex, hash } = manifest.pagination.fingerprint;
    const canonical = canonicalJson(structure);
    expect(Buffer.from(canonical).toString('hex')).toBe(canonicalBytesHex);
    expect(computePaginationHash(canonical)).toBe(hash);
  });

  test('oracle hash binds every frozen artifact', () => {
    expect(Object.keys(frozenOracleBundle()).sort()).toEqual([
      'bindingOracle',
      'comparatorContracts',
      'manifest',
      'migrationInventory',
      'scopeManifest',
      'vocabulary',
      'yjsSchema',
    ]);
    expect(computeOracleHash()).toBe(manifest.oracleHash.value);
  });

  test('external node crypto recomputation matches oracle hash', () => {
    const read = (path: string) =>
      JSON.parse(readFileSync(join(import.meta.dir, '..', path), 'utf8'));
    const externalManifest = read('oracles/manifest.v1.json');
    delete externalManifest.oracleHash.value;
    const bundle = {
      manifest: externalManifest,
      yjsSchema: read('oracles/yjs-schema.v1.json'),
      bindingOracle: read('oracles/binding-oracle.v1.json'),
      vocabulary: read('oracles/docx-editor-vocabulary.v1.json'),
      comparatorContracts: read('oracles/comparator-contracts.v1.json'),
      migrationInventory: read('migration/playwright-inventory.v1.json'),
      scopeManifest: read('oracles/scope-manifest.v1.json'),
    };
    const serialize = (value: unknown): string => {
      if (Array.isArray(value)) return `[${value.map(serialize).join(',')}]`;
      if (value !== null && typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
          a < b ? -1 : a > b ? 1 : 0
        );
        return `{${entries
          .map(([key, child]) => `${JSON.stringify(key)}:${serialize(child)}`)
          .join(',')}}`;
      }
      return JSON.stringify(value);
    };
    const externalHash = createHash('sha256').update(serialize(bundle)).digest('hex');
    expect(externalHash).toBe(manifest.oracleHash.value);
  });

  test('shaping uses round-half-away-from-zero at fixed-point scale 16', () => {
    expect(manifest.shapingEnvironment.fixedPointScale).toBe(16);
    expect(manifest.shapingEnvironment.roundingRule).toBe('round-half-away-from-zero');
    expect(manifest.shapingEnvironment.paragraphUsedHeightPolicy).toBe(
      'line-height-plus-space-after-in-twips'
    );
    expect(manifest.shapingEnvironment.styleAUsedHeightTwipsAfterMutation).toBe(408);
    expect(manifest.shapingEnvironment.styleAUsedHeightFixedAfterMutation).toBe(408 * 16);
    expect(manifest.pagination.fingerprint.structure.pages[0]?.usedHeightFixed).toBe(4 * 408 * 16);
    expect(roundHalfAwayFromZero(1.5)).toBe(2);
    expect(roundHalfAwayFromZero(2.5)).toBe(3);
    expect(roundHalfAwayFromZero(-1.5)).toBe(-2);
    const advances = manifest.shapingEnvironment.glyphAdvancesFixed;
    expect(toyAdvance('p064', advances)).toBe(4 * advances.p!);
  });

  test('phases include setup projection measurement pagination', () => {
    expect(manifest.phases).toEqual(['setup', 'projection', 'measurement', 'pagination']);
  });

  test('capsule bytes length matches frozen boundaries', () => {
    const { byteBoundaryStart, byteBoundaryEnd, bytesHex } = manifest.unsupportedCapsule;
    expect(byteBoundaryEnd - byteBoundaryStart).toBe(bytesHex.length / 2);
  });
});
