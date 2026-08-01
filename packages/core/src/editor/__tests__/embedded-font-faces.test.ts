// The security contract of paint-side registration (issue #78).
//
// `FontFaceSet` is per-DOCUMENT, so a face registered under a family name hides the
// installed font of that name for the whole page. Family names in a DOCX are
// attacker-controlled, so the ONE property that matters here is: a document-declared
// family never reaches the browser's font registry. Everything else (which faces
// register, what the painter is told, disposal) exists to make that safe AND useful.

import { describe, expect, test } from 'bun:test';
import type { FontSource } from '../../contracts/editor.ts';
import {
  registerEmbeddedFontFaces,
  type FontFaceLike,
  type FontFaceSetLike,
} from '../embedded-font-faces.ts';

function source(
  family: string,
  weight = 400,
  style: 'normal' | 'italic' = 'normal',
  hash = `sha256:${family}-${weight}-${style}`
): FontSource {
  return {
    request: { family, weight, style },
    id: `${family}#${weight}#${style}`,
    bytes: new Uint8Array([1, 2, 3]),
    hash,
    faceIndex: 0,
  };
}

class FakeFace implements FontFaceLike {
  constructor(
    readonly family: string,
    readonly bytes: Uint8Array,
    readonly descriptors: { readonly weight: string; readonly style: string },
    private readonly fail: boolean
  ) {}
  load(): Promise<unknown> {
    return this.fail ? Promise.reject(new Error('parse failure')) : Promise.resolve(this);
  }
}

/**
 * `failWhenFamilyMatches` is tested against the family the module actually passes to
 * `FontFace`, which is the ALIAS — the caller never sees a declared name here, which is
 * the whole point of the design.
 */
function fakeEnvironment(options: { failWhenFamilyMatches?: string } = {}) {
  const added: FakeFace[] = [];
  const deleted: FakeFace[] = [];
  const created: FakeFace[] = [];
  const fontSet: FontFaceSetLike = {
    add: (face) => added.push(face as FakeFace),
    delete: (face) => {
      deleted.push(face as FakeFace);
      return true;
    },
  };
  return {
    added,
    deleted,
    created,
    environment: {
      fontSet,
      createFontFace: (family: string, bytes: Uint8Array, descriptors: never) => {
        const shouldFail =
          options.failWhenFamilyMatches !== undefined &&
          family.includes(options.failWhenFamilyMatches);
        const face = new FakeFace(family, bytes, descriptors, shouldFail);
        created.push(face);
        return face;
      },
    },
  };
}

describe('registerEmbeddedFontFaces', () => {
  test('a document-declared family NEVER reaches the FontFaceSet', async () => {
    const env = fakeEnvironment();
    const hostile = ['Segoe UI', 'Roboto', 'Material Symbols Outlined', 'Arial'];
    const registration = await registerEmbeddedFontFaces(
      hostile.map((family) => source(family)),
      env.environment
    );
    expect(registration.installed).toBe(4);
    for (const family of hostile) {
      expect(env.added.some((face) => face.family === family)).toBe(false);
      expect(env.added.some((face) => face.family.includes(family))).toBe(false);
    }
    // Every registered family is an engine-minted alias.
    for (const face of env.added) expect(face.family).toMatch(/^docx-embedded-[a-z0-9]+$/);
  });

  test('the painter is told the alias for a declared family, and nothing else', async () => {
    const env = fakeEnvironment();
    const registration = await registerEmbeddedFontFaces(
      [source('Segoe UI'), source('Segoe UI', 700)],
      env.environment
    );
    const alias = registration.alias('Segoe UI');
    expect(alias).toMatch(/^docx-embedded-/);
    // Both faces of the family share one alias; CSS picks weight through the descriptors.
    expect(new Set(env.added.map((face) => face.family)).size).toBe(1);
    expect(env.added.map((face) => face.descriptors.weight).sort()).toEqual(['400', '700']);
    // A family the document did not embed has no alias, so paint uses the declared name.
    expect(registration.alias('Calibri')).toBeUndefined();
  });

  test('two documents embedding the same family name get different aliases', async () => {
    const first = await registerEmbeddedFontFaces(
      [source('Calibri', 400, 'normal', 'sha256:aaa')],
      fakeEnvironment().environment
    );
    const second = await registerEmbeddedFontFaces(
      [source('Calibri', 400, 'normal', 'sha256:bbb')],
      fakeEnvironment().environment
    );
    expect(first.alias('Calibri')).not.toBe(second.alias('Calibri'));
  });

  test('a family whose every face fails to load advertises no alias', async () => {
    const env = fakeEnvironment({ failWhenFamilyMatches: 'docx-embedded-' });
    const registration = await registerEmbeddedFontFaces([source('Broken')], env.environment);
    expect(registration.installed).toBe(0);
    expect(registration.alias('Broken')).toBeUndefined();
  });

  test('dispose removes exactly the added faces, once, and stops advertising', async () => {
    const env = fakeEnvironment();
    const registration = await registerEmbeddedFontFaces(
      [source('Calibri'), source('Calibri', 700), source('Cambria')],
      env.environment
    );
    expect(registration.alias('Calibri')).toBeDefined();
    registration.dispose();
    registration.dispose();
    expect(env.deleted).toEqual(env.added);
    expect(env.deleted).toHaveLength(3);
    // A disposed registration must not keep pointing paint at a removed face.
    expect(registration.alias('Calibri')).toBeUndefined();
  });

  test('no FontFaceSet in the environment is a silent no-op', async () => {
    const registration = await registerEmbeddedFontFaces([source('Calibri')], {});
    expect(registration.installed).toBe(0);
    expect(registration.alias('Calibri')).toBeUndefined();
    registration.dispose();
  });

  test('no sources is a no-op without touching the set', async () => {
    const env = fakeEnvironment();
    const registration = await registerEmbeddedFontFaces([], env.environment);
    expect(registration.installed).toBe(0);
    expect(env.created).toHaveLength(0);
  });
});
