// Unit contract for the paint-side registration of admitted embedded faces
// (embedded-font-paint-registration): registration is injected-environment testable,
// best-effort per face, escapes attacker-controlled family names, and disposal removes
// exactly the faces this registration added — no more, no less, idempotently.

import { describe, expect, test } from 'bun:test';
import type { FontSource } from '../../contracts/editor.ts';
import {
  registerEmbeddedFontFaces,
  type FontFaceLike,
  type FontFaceSetLike,
} from '../embedded-font-faces.ts';

function source(family: string, weight = 400, style: 'normal' | 'italic' = 'normal'): FontSource {
  return {
    request: { family, weight, style },
    id: `${family}#${weight}#${style}`,
    bytes: new Uint8Array([1, 2, 3]),
    hash: 'sha256:test',
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

function fakeEnvironment(options: { failFamilies?: readonly string[] } = {}) {
  const added: FakeFace[] = [];
  const deleted: FakeFace[] = [];
  const fontSet: FontFaceSetLike = {
    add: (face) => added.push(face as FakeFace),
    delete: (face) => {
      deleted.push(face as FakeFace);
      return true;
    },
  };
  const created: FakeFace[] = [];
  return {
    added,
    deleted,
    created,
    environment: {
      fontSet,
      createFontFace: (family: string, bytes: Uint8Array, descriptors: never) => {
        const face = new FakeFace(
          family,
          bytes,
          descriptors,
          (options.failFamilies ?? []).some((f) => family.includes(f))
        );
        created.push(face);
        return face;
      },
    },
  };
}

describe('registerEmbeddedFontFaces', () => {
  test('registers each face with quoted family and canonical descriptors', async () => {
    const env = fakeEnvironment();
    const registration = await registerEmbeddedFontFaces(
      [source('DejaVu Sans'), source('DejaVu Sans', 700), source('Book Antiqua', 400, 'italic')],
      env.environment
    );
    expect(registration.installed).toBe(3);
    expect(
      env.added.map((face) => [face.family, face.descriptors.weight, face.descriptors.style])
    ).toEqual([
      ['"DejaVu Sans"', '400', 'normal'],
      ['"DejaVu Sans"', '700', 'normal'],
      ['"Book Antiqua"', '400', 'italic'],
    ]);
  });

  test('escapes quotes and backslashes in attacker-controlled family names', async () => {
    const env = fakeEnvironment();
    await registerEmbeddedFontFaces([source('Ev"il\\Font')], env.environment);
    expect(env.added[0]!.family).toBe('"Ev\\"il\\\\Font"');
  });

  test('a face that fails to load is skipped; the rest still install', async () => {
    const env = fakeEnvironment({ failFamilies: ['Broken'] });
    const registration = await registerEmbeddedFontFaces(
      [source('Fine'), source('Broken')],
      env.environment
    );
    expect(registration.installed).toBe(1);
    expect(env.added.map((face) => face.family)).toEqual(['"Fine"']);
  });

  test('dispose removes exactly the added faces, once', async () => {
    const env = fakeEnvironment({ failFamilies: ['Broken'] });
    const registration = await registerEmbeddedFontFaces(
      [source('Fine'), source('Broken'), source('Fine', 700)],
      env.environment
    );
    registration.dispose();
    registration.dispose();
    expect(env.deleted).toEqual(env.added);
    expect(env.deleted).toHaveLength(2);
  });

  test('no FontFaceSet in the environment is a silent no-op', async () => {
    const registration = await registerEmbeddedFontFaces([source('DejaVu Sans')], {});
    expect(registration.installed).toBe(0);
    registration.dispose();
  });

  test('no sources is a no-op without touching the set', async () => {
    const env = fakeEnvironment();
    const registration = await registerEmbeddedFontFaces([], env.environment);
    expect(registration.installed).toBe(0);
    expect(env.created).toHaveLength(0);
  });
});
