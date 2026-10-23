// DrawingML colours used by diagram shapes: linear sRGB and system colours, and the signed
// hue, saturation, luminance and alpha transforms, bounded and exact under identity.

import { describe, expect, test } from 'bun:test';
import { resolveColorNode } from '../package/drawing-shape-color.ts';
import { readOoxmlPart, type OoxmlElement } from '../package/ooxml-tree.ts';

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';

function color(xml: string): OoxmlElement {
  const parsed = readOoxmlPart(xml.replace(/^<a:(\w+)/, `<a:$1 xmlns:a="${A}"`), {
    name: '/word/test.xml',
    contentType: 'application/xml',
  });
  if (!parsed.ok) throw new Error('parse failed');
  return parsed.part.root;
}

function resolve(xml: string) {
  return resolveColorNode(color(xml), (token) => (token === 'accent1' ? '4F81BD' : null));
}

function srgb(hex: string, transforms: string) {
  return resolve(`<a:srgbClr val="${hex}">${transforms}</a:srgbClr>`);
}

describe('shape colour bases', () => {
  test('scrgbClr converts linear percentages through the sRGB transfer curve', () => {
    expect(resolve('<a:scrgbClr r="100000" g="0" b="50000"/>')).toEqual({
      hex: 'FF00BC',
      alpha: 1,
    });
    expect(resolve('<a:scrgbClr r="0" g="0" b="0"/>')).toEqual({ hex: '000000', alpha: 1 });
    expect(resolve('<a:scrgbClr r="0" g="0"/>')).toBeNull();
  });

  test('sysClr keeps its last colour, else the system default', () => {
    expect(resolve('<a:sysClr val="windowText" lastClr="123456"/>')?.hex).toBe('123456');
    expect(resolve('<a:sysClr val="windowText"/>')?.hex).toBe('000000');
    expect(resolve('<a:sysClr val="window"/>')?.hex).toBe('FFFFFF');
    expect(resolve('<a:sysClr val="notASystemColour"/>')).toBeNull();
  });

  test('scheme colours resolve through the resolver; unknown ones refuse', () => {
    expect(resolve('<a:schemeClr val="accent1"/>')?.hex).toBe('4F81BD');
    expect(resolve('<a:schemeClr val="accent6"/>')).toBeNull();
    expect(resolve('<a:hslClr hue="0" sat="100000" lum="50000"/>')).toBeNull();
    expect(resolve('<a:prstClr val="red"/>')?.hex).toBe('FF0000');
    expect(resolve('<a:prstClr val="notAColour"/>')).toBeNull();
  });
});

describe('signed colour transforms', () => {
  test('hue offsets and modulation turn the hue', () => {
    expect(srgb('FF0000', '<a:hueOff val="7200000"/>')?.hex).toBe('00FF00');
    expect(srgb('00FF00', '<a:hueMod val="200000"/>')?.hex).toBe('0000FF');
  });

  test('saturation offsets and modulation', () => {
    expect(srgb('FF0000', '<a:satOff val="-100000"/>')?.hex).toBe('808080');
    expect(srgb('FF0000', '<a:satMod val="50000"/>')?.hex).toBe('BF4040');
  });

  test('luminance offsets work in both directions', () => {
    expect(srgb('FF0000', '<a:lumOff val="-25000"/>')?.hex).toBe('800000');
    expect(srgb('FF0000', '<a:lumOff val="25000"/>')?.hex).toBe('FF8080');
  });

  test('alpha offsets and modulation', () => {
    expect(srgb('000000', '<a:alpha val="50000"/><a:alphaOff val="25000"/>')?.alpha).toBeCloseTo(
      0.75,
      9
    );
    expect(srgb('000000', '<a:alphaMod val="50000"/>')?.alpha).toBeCloseTo(0.5, 9);
    expect(srgb('000000', '<a:alphaOff val="-200000"/>')?.alpha).toBe(0);
  });

  test('identity offsets leave the colour exactly as authored', () => {
    const identity =
      '<a:hueOff val="0"/><a:satOff val="0"/><a:lumOff val="0"/><a:alphaOff val="0"/>' +
      '<a:satMod val="100000"/><a:hueMod val="100000"/><a:alphaMod val="100000"/>';
    for (const hex of ['4F81BD', '1F3864', 'C0504D', '7F7F7F']) {
      expect(srgb(hex, identity)).toEqual({ hex, alpha: 1 });
    }
    expect(resolve(`<a:schemeClr val="accent1">${identity}</a:schemeClr>`)?.hex).toBe('4F81BD');
  });

  test('the Strict percentage spelling matches the integer one', () => {
    expect(srgb('FF0000', '<a:lumOff val="-25%"/>')?.hex).toBe('800000');
    expect(srgb('FF0000', '<a:satMod val="50%"/>')?.hex).toBe('BF4040');
  });

  test('malformed or out-of-range values refuse the colour', () => {
    expect(srgb('FF0000', '<a:hueOff val="99999999999"/>')).toBeNull();
    expect(srgb('FF0000', '<a:hueOff val="21600001"/>')).toBeNull();
    expect(srgb('FF0000', '<a:lumOff val="20000000"/>')).toBeNull();
    expect(srgb('FF0000', '<a:satOff val="abc"/>')).toBeNull();
    expect(srgb('FF0000', '<a:satOff/>')).toBeNull();
    expect(srgb('FF0000', '<a:lumOff val="1e5"/>')).toBeNull();
    expect(srgb('FF0000', '<a:gray/>')).toBeNull();
  });
});
