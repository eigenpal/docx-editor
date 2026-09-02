import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import { defineFontResolver } from '../../editor/index.ts';
import { sha256FontBytes } from '../../layout/index.ts';
import { deobfuscateFont } from '../../store/package/embedded-fonts.ts';
import { ExportResourceError } from '../export-session.ts';
import { openFontBackedDocumentForExport } from '../document-export-shaping.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const FT = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable';
const FONT_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/font';
const GUID = '001B70DC-AA60-4AD5-90EC-18A0948E1EAE';

const fontBytes = new Uint8Array(
  readFileSync(new URL('../../layout/__tests__/fixtures/fonts/DejaVuSans.ttf', import.meta.url))
);
const fontHash = sha256FontBytes(fontBytes);

function fontFragment(family = 'DejaVu Sans', id = family) {
  return {
    sources: [
      {
        request: { family, weight: 400, style: 'normal' as const },
        id: `test:${id}`,
        bytes: fontBytes,
        hash: fontHash,
        faceIndex: 0,
      },
    ],
    defaultFont: { family, sizeHalfPoints: 22 },
  };
}

function minimalDocx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

function docxWithEmbed(family: string, body: string): Uint8Array {
  const obfuscated = deobfuscateFont(fontBytes, GUID)!;
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Default Extension="odttf" ContentType="application/vnd.openxmlformats-officedocument.obfuscatedFont"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId10" Type="${FT}" Target="fontTable.xml"/></Relationships>`
    ),
    'word/_rels/fontTable.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rIdFont1" Type="${FONT_REL}" Target="fonts/font1.odttf"/></Relationships>`
    ),
    'word/fontTable.xml': strToU8(
      `<w:fonts xmlns:w="${W}" xmlns:r="${R}"><w:font w:name="${family}">` +
        `<w:embedRegular r:id="rIdFont1" w:fontKey="{${GUID}}"/></w:font></w:fonts>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
    'word/fonts/font1.odttf': obfuscated,
  });
}

const bodyRun = (family: string, text = 'Body') =>
  `<w:p><w:r><w:rPr><w:rFonts w:ascii="${family}"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;

test('admittedFontFace returns the exact bytes and identity used by the session', async () => {
  const opened = await openFontBackedDocumentForExport(minimalDocx(bodyRun('DejaVu Sans')), {
    fonts: fontFragment(),
  });
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  try {
    const face = opened.session.admittedFontFace({
      family: 'DejaVu Sans',
      weight: 400,
      style: 'normal',
    });
    expect(face).not.toBeNull();
    expect(face?.id).toBe('test:DejaVu Sans');
    expect(face?.identity).toBe(`${fontHash}#0`);
    expect(face?.hash).toBe(fontHash);
    expect(face?.faceIndex).toBe(0);
    expect(face?.byteLength).toBe(fontBytes.byteLength);
    expect(face?.bytes).toEqual(fontBytes);
    expect(face?.substitution).toBeNull();
    const reported = opened.session.fontResolution.families
      .find((family) => family.family === 'DejaVu Sans')
      ?.faces.find((entry) => entry.weight === 400 && entry.style === 'normal');
    expect(reported?.via).toBe('direct');
    expect(reported?.identity).toBe(face?.identity);
    expect(reported?.id).toBe(face?.id);
    expect(reported?.substitution).toBeNull();
  } finally {
    opened.session.dispose();
  }
});

test('substitutions are reported in full on evidence and admitted faces', async () => {
  const opened = await openFontBackedDocumentForExport(minimalDocx(bodyRun('Body Face')), {
    fonts: {
      ...fontFragment(),
      substitutions: [
        {
          from: { family: 'Body Face', weight: 400, style: 'normal' as const },
          to: { family: 'DejaVu Sans', weight: 400, style: 'normal' as const },
        },
      ],
    },
  });
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  try {
    const request = { family: 'Body Face', weight: 400 as const, style: 'normal' as const };
    const face = opened.session.admittedFontFace(request);
    expect(face?.identity).toBe(`${fontHash}#0`);
    expect(face?.bytes).toEqual(fontBytes);
    expect(face?.substitution).toEqual({
      requested: request,
      resolved: { family: 'DejaVu Sans', weight: 400, style: 'normal' },
    });
    const reported = opened.session.fontResolution.families
      .find((family) => family.family === 'Body Face')
      ?.faces.find((entry) => entry.weight === 400 && entry.style === 'normal');
    expect(reported?.via).toBe('substitution');
    expect(reported?.sourceFamily).toBe('DejaVu Sans');
    expect(reported?.identity).toBe(face?.identity);
    expect(reported?.substitution).toEqual(face?.substitution);
  } finally {
    opened.session.dispose();
  }
});

test('byte access stops after disposal while resolution evidence remains', async () => {
  const opened = await openFontBackedDocumentForExport(minimalDocx(bodyRun('DejaVu Sans')), {
    fonts: fontFragment(),
  });
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  const report = opened.session.fontResolution;
  const regular = report.families
    .find((family) => family.family === 'DejaVu Sans')
    ?.faces.find((entry) => entry.weight === 400 && entry.style === 'normal');
  expect(regular?.identity).toBe(`${fontHash}#0`);
  opened.session.dispose();
  expect(opened.session.fontResolution).toBe(report);
  expect(regular).toBeDefined();
  expect(opened.session.fontResolution.families[0]?.faces[0]?.identity).toBe(`${fontHash}#0`);
  expect(opened.session.fontResolution.families[0]?.faces[0]?.substitution).toBeNull();
  try {
    opened.session.admittedFontFace({ family: 'DejaVu Sans', weight: 400, style: 'normal' });
    throw new Error('expected disposed byte access to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(ExportResourceError);
    expect((error as ExportResourceError).code).toBe('disposed');
  }
});

test('byte access stops after abort while resolution evidence remains', async () => {
  const controller = new AbortController();
  const opened = await openFontBackedDocumentForExport(minimalDocx(bodyRun('DejaVu Sans')), {
    fonts: fontFragment(),
    signal: controller.signal,
  });
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  const report = opened.session.fontResolution;
  controller.abort('job-cancelled');
  expect(opened.session.fontResolution).toBe(report);
  try {
    opened.session.admittedFontFace({ family: 'DejaVu Sans', weight: 400, style: 'normal' });
    throw new Error('expected aborted byte access to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(ExportResourceError);
    expect((error as ExportResourceError).code).toBe('aborted');
  }
  opened.session.dispose();
});

test('document-embedded faces auto-admit after empty explicit origins', async () => {
  const opened = await openFontBackedDocumentForExport(
    docxWithEmbed('Body Face', bodyRun('Body Face')),
    { fonts: [] }
  );
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  try {
    const face = opened.session.admittedFontFace({
      family: 'Body Face',
      weight: 400,
      style: 'normal',
    });
    expect(face?.id).toBe('embedded:/word/fonts/font1.odttf#regular');
    expect(face?.identity).toBe(`${fontHash}#0`);
    expect(face?.bytes).toEqual(fontBytes);
    expect(face?.substitution).toBeNull();
    const reported = opened.session.fontResolution.families
      .find((family) => family.family === 'Body Face')
      ?.faces.find((entry) => entry.weight === 400 && entry.style === 'normal');
    expect(reported?.via).toBe('direct');
    expect(reported?.identity).toBe(face?.identity);
    expect(opened.session.fontResolution.droppedEmbeddedFonts).toEqual([]);
  } finally {
    opened.session.dispose();
  }
});

test('dropped embedded faces appear in font-resolution evidence', async () => {
  const opened = await openFontBackedDocumentForExport(
    docxWithEmbed('   ', bodyRun('DejaVu Sans')),
    {
      fonts: fontFragment(),
    }
  );
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  try {
    expect(opened.session.fontResolution.droppedEmbeddedFonts).toEqual([
      {
        request: { family: '   ', weight: 400, style: 'normal' },
        partName: '/word/fonts/font1.odttf',
        reason: 'malformed',
      },
    ]);
    expect(
      opened.session.admittedFontFace({ family: 'DejaVu Sans', weight: 400, style: 'normal' })?.id
    ).toBe('test:DejaVu Sans');
  } finally {
    opened.session.dispose();
  }
});

test('explicit origins keep first-wins precedence over document-embedded faces', async () => {
  const opened = await openFontBackedDocumentForExport(
    docxWithEmbed('Body Face', bodyRun('Body Face')),
    { fonts: fontFragment('Body Face', 'explicit') }
  );
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  try {
    const face = opened.session.admittedFontFace({
      family: 'Body Face',
      weight: 400,
      style: 'normal',
    });
    expect(face?.id).toBe('test:explicit');
    expect(face?.identity).toBe(`${fontHash}#0`);
    expect(face?.bytes).toEqual(fontBytes);
  } finally {
    opened.session.dispose();
  }
});

test('a resolver still wins uncovered faces while embedded fills the rest', async () => {
  const opened = await openFontBackedDocumentForExport(
    docxWithEmbed('Body Face', bodyRun('Body Face') + bodyRun('Other Face', 'Other')),
    {
      fonts: defineFontResolver(() => fontFragment('Other Face', 'resolver')),
    }
  );
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  try {
    const embedded = opened.session.admittedFontFace({
      family: 'Body Face',
      weight: 400,
      style: 'normal',
    });
    const explicit = opened.session.admittedFontFace({
      family: 'Other Face',
      weight: 400,
      style: 'normal',
    });
    expect(embedded?.id).toBe('embedded:/word/fonts/font1.odttf#regular');
    expect(explicit?.id).toBe('test:resolver');
  } finally {
    opened.session.dispose();
  }
});
