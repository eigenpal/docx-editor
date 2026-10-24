/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// WMF text is single bytes in its font's character set, in the face its font record names.

import { expect, test } from 'bun:test';
import { replayMetafile } from '../metafile-replay.ts';
import { wmf, type WmfRecord } from './metafile-fixture.ts';

const META_CREATEFONTINDIRECT = 0x02fb;
const META_SELECTOBJECT = 0x012d;
const META_TEXTOUT = 0x0521;

/** Little-endian 16-bit words of `bytes`, padded to an even length. */
function words(bytes: readonly number[]): number[] {
  const even = bytes.length % 2 ? [...bytes, 0] : [...bytes];
  const out: number[] = [];
  for (let at = 0; at < even.length; at += 2) out.push(even[at]! | (even[at + 1]! << 8));
  return out;
}

function font(face: string, charset: number): WmfRecord {
  const logfont = new Array<number>(50).fill(0);
  logfont[0] = 0xec; // lfHeight -20
  logfont[1] = 0xff;
  logfont[8] = 0x90; // lfWeight 400
  logfont[9] = 0x01;
  logfont[13] = charset;
  logfont[14] = 3; // output precision, which a face name read from byte 14 would start with
  [...face].forEach((char, index) => (logfont[18 + index] = char.charCodeAt(0)));
  return { fn: META_CREATEFONTINDIRECT, words: words(logfont) };
}

function textOut(bytes: readonly number[]): WmfRecord {
  return { fn: META_TEXTOUT, words: [bytes.length, ...words(bytes), 40, 10] };
}

async function texts(records: readonly WmfRecord[]) {
  const replay = await replayMetafile(wmf(200, 100, records), 'image/x-wmf', {
    textAdvance: (text, face) => text.length * face.sizePx * 0.5,
  });
  return replay!.drawing.commands.flatMap((command) =>
    command.kind === 'text' ? [{ text: command.text, family: command.font.family }] : []
  );
}

test('text bytes decode in the selected font character set, in its own face', async () => {
  const arabic = [0xc7, 0xe1, 0xd3, 0xe1, 0xc7, 0xe3]; // windows-1256
  expect(
    await texts([font('Tahoma', 178), { fn: META_SELECTOBJECT, words: [0] }, textOut(arabic)])
  ).toEqual([{ text: 'السلام', family: 'Tahoma' }]);
});

test('a later font selection decodes the text after it; ANSI uses its code page', async () => {
  const records = [
    font('Arial', 0),
    font('Times New Roman', 204),
    { fn: META_SELECTOBJECT, words: [0] },
    textOut([0x93, 0x41, 0x94]),
    { fn: META_SELECTOBJECT, words: [1] },
    textOut([0xcc, 0xe8, 0xf0]),
  ];
  expect(await texts(records)).toEqual([
    { text: '“A”', family: 'Arial' },
    { text: 'Мир', family: 'Times New Roman' },
  ]);
});

test('text sits by the alignment in force: top left by default, then as set', async () => {
  const replay = await replayMetafile(
    wmf(200, 100, [
      font('Arial', 0),
      { fn: META_SELECTOBJECT, words: [0] },
      textOut([0x41]),
      { fn: 0x012e, words: [24 | 6] }, // META_SETTEXTALIGN: TA_BASELINE | TA_CENTER
      textOut([0x42]),
    ]),
    'image/x-wmf',
    { textAdvance: (text, face) => text.length * face.sizePx * 0.5 }
  );
  const placed = replay!.drawing.commands.flatMap((command) =>
    command.kind === 'text' ? [[command.text, command.baseline, command.align]] : []
  );
  expect(placed).toEqual([
    ['A', 'top', 'left'],
    ['B', 'alphabetic', 'center'],
  ]);
});

test('a symbol font keeps its bytes', async () => {
  const records = [font('Wingdings', 2), { fn: META_SELECTOBJECT, words: [0] }, textOut([0xfe])];
  expect(await texts(records)).toEqual([{ text: 'þ', family: 'Wingdings' }]);
});
