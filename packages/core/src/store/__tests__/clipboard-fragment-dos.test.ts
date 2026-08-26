// Resource-exhaustion guards for the paste merge: how its cost GROWS with the size of the
// fragment, for the two axes a prior review measured O(n^2) freezes on.
//
// THEY MEASURE THE SHAPE OF THE CURVE, NOT THE CLOCK. Each guard used to assert one absolute
// millisecond ceiling, which is a claim about the machine as much as about the code: a shared
// CI runner that stalls for a few seconds fails a merge that never changed, and the only way
// to quiet it is to raise the ceiling until it stops catching the regression it exists for.
// One such stall put a 1.5s merge at 12.9s against a 4s ceiling.
//
// So each guard times the SAME merge at two input sizes and asserts how the time grew. Linear
// work over an 8x bigger input takes about 8x as long; quadratic work takes about 64x. A slow
// machine slows both measurements together and the ratio does not move, which is exactly the
// property an absolute ceiling lacks.
//
// WHAT THE TWO AXES ACTUALLY DO TODAY, measured with this harness:
//
//   colliding style ids   linear      growth ~10.5x over 8x   (per-step exponent 0.9-1.1)
//   distinct images       QUADRATIC   growth ~35x over 8x     (per-step exponent 1.6 -> 2.0)
//
// Both numbers repeat to within 2% run to run, which is the property the old ceiling lacked.
//
// The style axis is what its guard always claimed. The MEDIA axis is not: the merge is
// quadratic in the number of distinct images, and the absolute ceiling never noticed because
// 3000 images land at ~1.5s, comfortably under 4s. Its bound below therefore pins the shape
// the merge HAS rather than the one it should have — a characterization, so the axis cannot
// quietly get worse while the real fix is out of this file's reach.

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { readOoxmlPackage, type OoxmlPackage } from '../package/ooxml-package.ts';
import { mergeFragmentIntoPackage } from '../store/clipboard-fragment-merge.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

function load(bytes: Uint8Array): OoxmlPackage {
  const r = readOoxmlPackage(bytes);
  if (!r.ok) throw new Error(r.reason);
  return r.package;
}

const TINY_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

function blankTarget(): OoxmlPackage {
  return load(
    zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body><w:p/></w:body></w:document>`
      ),
    })
  );
}

// ---------------------------------------------------------------------------
// Measuring
// ---------------------------------------------------------------------------

/** The size step between the two measurements. Linear grows by this; quadratic by its square. */
const SIZE_FACTOR = 8;

/**
 * How much growth still counts as linear.
 *
 * Three times the size factor, which sits well clear of both ends: linear work lands at about
 * `SIZE_FACTOR` and quadratic at about `SIZE_FACTOR ** 2` (64), so there is 3x of headroom
 * above the shape that must pass and 2.7x of margin below the shape that must fail. The gap is
 * that wide because the small measurement carries a fixed setup cost the large one amortises,
 * which deflates the ratio — in the permissive direction, never the flaky one.
 */
const NEAR_LINEAR_GROWTH = SIZE_FACTOR * 3;

/**
 * What the MEDIA axis costs today: quadratic, ~35x over an 8x step (see the file header).
 *
 * Pinned rather than asserted, and deliberately not dressed up as a linearity check. It holds
 * the axis where it is — a further slide, or a constant-factor blowup on top of it, still
 * fails — while saying plainly in one number that this axis does not have the property the
 * other one does.
 */
const MEASURED_MEDIA_GROWTH = 50;

/**
 * A backstop no plausible machine reaches, for a regression that is slow without being
 * quadratic — a constant factor a hundred times worse grows linearly and the ratio would miss
 * it. Two orders of magnitude above the ~0.5s these merges actually take, so a stall cannot
 * reach it.
 */
const ABSURD_MS = 60_000;

/**
 * The FASTEST of several runs, in milliseconds.
 *
 * The minimum, not the mean: noise on a shared runner only ever adds time, so the best run is
 * the closest estimate of what the code costs and the outliers are exactly what should be
 * discarded. Two runs is enough to drop a single stall, and these merges are slow enough that
 * a third would cost more suite time than it buys. `prepare` builds the inputs and returns the
 * call to time, so fixture construction stays outside the measurement.
 */
function fastestMs(prepare: () => () => void, repeats = 2): number {
  let best = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < repeats; attempt += 1) {
    const run = prepare();
    const start = performance.now();
    run();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

/**
 * How much slower the merge gets when the fragment grows by `SIZE_FACTOR`.
 *
 * `fragmentOf` builds the fragment for a size and `targetOf` a fresh target per run, because a
 * merge returns a new package and a reused one would measure a different starting state.
 */
function growthOverSizeStep(
  small: number,
  fragmentOf: (n: number) => OoxmlPackage,
  targetOf: () => OoxmlPackage
): number {
  const timeAt = (n: number): number => {
    const fragment = fragmentOf(n);
    return fastestMs(() => {
      const target = targetOf();
      return () => {
        const merged = mergeFragmentIntoPackage(target, fragment, target.mainDocumentPart);
        // Asserted every run: a merge that started failing would "get faster" and pass a
        // ratio it never earned.
        expect(merged.ok).toBe(true);
      };
    });
  };
  const smallMs = timeAt(small);
  const largeMs = timeAt(small * SIZE_FACTOR);
  expect(largeMs).toBeLessThan(ABSURD_MS);
  // Guard the division: a small measurement of zero on a very fast machine is not a signal.
  return smallMs > 0 ? largeMs / smallMs : 0;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A fragment of `n` paragraphs, each holding one distinct inline image. */
function mediaFragment(n: number): OoxmlPackage {
  const entries: Record<string, Uint8Array> = {};
  const paras: string[] = [];
  const rels: string[] = [];
  for (let i = 0; i < n; i += 1) {
    // Each distinct image: flip one byte so the content hash differs.
    const bytes = new Uint8Array(TINY_PNG);
    bytes[bytes.length - 5] = i & 0xff;
    bytes[bytes.length - 6] = (i >> 8) & 0xff;
    entries[`word/media/img${i}.png`] = bytes;
    rels.push(`<Relationship Id="rId${i + 10}" Type="${R}/image" Target="media/img${i}.png"/>`);
    paras.push(
      `<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><wp:extent cx="100" cy="100"/><wp:docPr id="${i + 1}" name=""/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId${i + 10}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
    );
  }
  entries['[Content_Types].xml'] = strToU8(
    `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
  );
  entries['_rels/.rels'] = strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
  );
  entries['word/_rels/document.xml.rels'] = strToU8(
    `<Relationships xmlns="${REL}">${rels.join('')}</Relationships>`
  );
  entries['word/document.xml'] = strToU8(
    `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${paras.join('')}</w:body></w:document>`
  );
  return load(zipSync(entries));
}

/** A fragment whose `n` styles are all named `Normal`, all colliding with the target's. */
function collidingStyleFragment(n: number): OoxmlPackage {
  const styles: string[] = [];
  for (let i = 0; i < n; i += 1) {
    styles.push(
      `<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:sz w:val="${20 + (i % 40)}"/></w:rPr></w:style>`
    );
  }
  return load(
    zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rIdS" Type="${R}/styles" Target="styles.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>x</w:t></w:r></w:p></w:body></w:document>`
      ),
      'word/styles.xml': strToU8(
        `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${styles.join('')}</w:styles>`
      ),
    })
  );
}

/** A target whose own `Normal` differs, so every incoming style collides on name. */
function styledTarget(): OoxmlPackage {
  return load(
    zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rIdS" Type="${R}/styles" Target="styles.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body><w:p/></w:body></w:document>`
      ),
      'word/styles.xml': strToU8(
        `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:b/></w:rPr></w:style></w:styles>`
      ),
    })
  );
}

describe('how the paste merge grows with the fragment', () => {
  test('colliding style ids resolve in linear time (no O(style^2))', () => {
    // 1000 then 8000. The target's own `Normal` differs, so every one of them collides.
    expect(growthOverSizeStep(1000, collidingStyleFragment, styledTarget)).toBeLessThan(
      NEAR_LINEAR_GROWTH
    );
  }, 60_000);

  test('distinct images do not get slower to merge than they already are', () => {
    // 375 then 3000, the size the declared media budget is written against. This axis is
    // QUADRATIC today — see the file header. The bound holds it there.
    expect(growthOverSizeStep(375, mediaFragment, blankTarget)).toBeLessThan(MEASURED_MEDIA_GROWTH);
  });
});
