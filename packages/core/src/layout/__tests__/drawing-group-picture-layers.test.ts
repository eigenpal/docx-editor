// The helpers that order and place the picture members of a drawing group.
//
// A group paints its members in document order (`wpg:grpSp`, CT_WordprocessingGroup; ECMA-376 Part 1,
// 20.4.2.32). `vectorPictureBand` puts each vector component in a band between the pictures:
// band `n` paints above the first `n` pictures and below the rest. `turnedPictureCorners` gives
// the corners of a picture that mirrors left to right and then turns clockwise about the
// centre of its box (`a:xfrm`, CT_Transform2D; Part 1, 20.1.7.6). `pictureCornerFrame` reads
// the box, the turn and the mirror back from those corners.

import { describe, expect, test } from 'bun:test';
import {
  pictureCornerFrame,
  turnedPictureCorners,
  vectorPictureBand,
} from '../drawing-group-picture-layers.ts';
import type { VectorShapeComponent } from '../../store/package/drawing-shape-projection.ts';

function component(fields: Partial<VectorShapeComponent> = {}): VectorShapeComponent {
  return {
    subpathsEmu: [],
    subpathsClosed: [],
    fillHex: '000000',
    fillAlpha: 1,
    strokeHex: null,
    strokeWidthEmu: 0,
    ...fields,
  } as VectorShapeComponent;
}

describe('vectorPictureBand', () => {
  test('a component paints in the band of the pictures under it', () => {
    expect(vectorPictureBand(component({ picturesBelow: 0 }), 3)).toBe(0);
    expect(vectorPictureBand(component({ picturesBelow: 1 }), 3)).toBe(1);
    expect(vectorPictureBand(component({ picturesBelow: 2 }), 3)).toBe(2);
  });

  test('a component without a count paints above every picture', () => {
    expect(vectorPictureBand(component(), 3)).toBe(3);
    expect(vectorPictureBand(component(), 1)).toBe(1);
    expect(vectorPictureBand(component(), 0)).toBe(0);
  });

  test("a picture frame's own fill and shadow paint under the picture", () => {
    expect(vectorPictureBand(component({ belowPicture: true }), 1)).toBe(0);
    // `belowPicture` wins over a count.
    expect(vectorPictureBand(component({ belowPicture: true, picturesBelow: 2 }), 3)).toBe(0);
  });

  test('a count outside the pictures stays inside the bands', () => {
    expect(vectorPictureBand(component({ picturesBelow: 9 }), 2)).toBe(2);
    expect(vectorPictureBand(component({ picturesBelow: -1 }), 2)).toBe(0);
    expect(vectorPictureBand(component({ picturesBelow: 1.9 }), 2)).toBe(1);
    expect(vectorPictureBand(component({ picturesBelow: Number.NaN }), 2)).toBe(2);
    expect(vectorPictureBand(component({ picturesBelow: Number.POSITIVE_INFINITY }), 2)).toBe(2);
  });
});

const BOX = { x: 10, y: 20, width: 200, height: 100 };

function expectPoints(
  actual: readonly Readonly<{ x: number; y: number }>[],
  expected: readonly (readonly [number, number])[]
): void {
  expect(actual).toHaveLength(expected.length);
  expected.forEach(([x, y], index) => {
    expect(actual[index]!.x).toBeCloseTo(x, 9);
    expect(actual[index]!.y).toBeCloseTo(y, 9);
  });
}

describe('turnedPictureCorners', () => {
  test('an upright picture has the corners of its box, in image order', () => {
    expectPoints(turnedPictureCorners(BOX, 0, false), [
      [10, 20],
      [210, 20],
      [210, 120],
      [10, 120],
    ]);
  });

  test('a quarter turn clockwise moves the top left corner to the top right', () => {
    // The box centre is (110, 70). The turned picture is 100 wide and 200 high about it.
    expectPoints(turnedPictureCorners(BOX, 90, false), [
      [160, -30],
      [160, 170],
      [60, 170],
      [60, -30],
    ]);
  });

  test('a mirrored picture swaps its left and right corners', () => {
    expectPoints(turnedPictureCorners(BOX, 0, true), [
      [210, 20],
      [10, 20],
      [10, 120],
      [210, 120],
    ]);
  });

  test('a mirrored picture mirrors before it turns', () => {
    // Mirror: the top left image corner goes to the top right of the box. Then a quarter turn
    // clockwise takes that corner to the bottom right of the turned box.
    expectPoints(turnedPictureCorners(BOX, 90, true), [
      [160, 170],
      [160, -30],
      [60, -30],
      [60, 170],
    ]);
  });
});

describe('pictureCornerFrame', () => {
  test('reads back the box, the turn and the mirror of every corner set', () => {
    for (const flipH of [false, true]) {
      for (const degrees of [0, 1, 30, 90, 135, 180, 270, 359]) {
        const frame = pictureCornerFrame(turnedPictureCorners(BOX, degrees, flipH))!;
        expect(frame.flipH).toBe(flipH);
        expect(frame.rotationDegrees).toBeCloseTo(degrees, 6);
        expect(frame.box.x).toBeCloseTo(BOX.x, 6);
        expect(frame.box.y).toBeCloseTo(BOX.y, 6);
        expect(frame.box.width).toBeCloseTo(BOX.width, 6);
        expect(frame.box.height).toBeCloseTo(BOX.height, 6);
      }
    }
  });

  test('an upright picture reads as exactly no turn', () => {
    const frame = pictureCornerFrame(turnedPictureCorners(BOX, 0, false))!;
    expect(frame).toEqual({ box: BOX, rotationDegrees: 0, flipH: false });
    // A full turn is no turn.
    expect(pictureCornerFrame(turnedPictureCorners(BOX, 360, false))!.rotationDegrees).toBe(0);
  });

  test('a vertical mirror reads as a horizontal mirror and a half turn', () => {
    // Top and bottom swapped: bottom left, bottom right, top right, top left.
    const frame = pictureCornerFrame([
      { x: 10, y: 120 },
      { x: 210, y: 120 },
      { x: 210, y: 20 },
      { x: 10, y: 20 },
    ])!;
    expect(frame.flipH).toBe(true);
    expect(frame.rotationDegrees).toBeCloseTo(180, 6);
    expect(frame.box).toEqual(BOX);
  });

  test('anything but four corners has no frame', () => {
    expect(pictureCornerFrame([])).toBeNull();
    expect(pictureCornerFrame(turnedPictureCorners(BOX, 0, false).slice(0, 3))).toBeNull();
  });
});
