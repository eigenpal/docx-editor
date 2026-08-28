// External `text/html` → WordprocessingML fragment package (rich-clipboard-fidelity
// tasks 5.1-5.4). Every fixture round-trips through `readOoxmlPackage`, the same
// bounded reader the paste router uses, so the assertions cover both the projection
// and the fragment's validity as an OPC package.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { projectExternalHtml } from '../clipboard-html-read.ts';
import { readOoxmlPackage, type OoxmlPackage } from '../../store/package/ooxml-package.ts';
import { serializeOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { strFromU8 } from '../../store/package/zip.ts';

/** A valid 1x1 PNG (signature, IHDR 1x1 8-bit RGBA, IDAT, IEND). */
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function pngWithPhysicalSize(width: number, height: number, pixelsPerMeter: number): string {
  const source = Uint8Array.from(atob(TINY_PNG_BASE64), (char) => char.charCodeAt(0));
  const writeUint32 = (bytes: Uint8Array, offset: number, value: number): void => {
    bytes[offset] = (value >>> 24) & 0xff;
    bytes[offset + 1] = (value >>> 16) & 0xff;
    bytes[offset + 2] = (value >>> 8) & 0xff;
    bytes[offset + 3] = value & 0xff;
  };
  writeUint32(source, 16, width);
  writeUint32(source, 20, height);
  const phys = Uint8Array.from([
    0, 0, 0, 9, 0x70, 0x48, 0x59, 0x73, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0,
  ]);
  writeUint32(phys, 8, pixelsPerMeter);
  writeUint32(phys, 12, pixelsPerMeter);
  const bytes = new Uint8Array(source.length + phys.length);
  bytes.set(source.subarray(0, 33));
  bytes.set(phys, 33);
  bytes.set(source.subarray(33), 33 + phys.length);
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
}

interface OpenedFragment {
  readonly pkg: OoxmlPackage;
  readonly docXml: string;
  readonly relsXml: string;
  readonly lastMarkCovered: boolean;
}

/** Project, read back through the bounded package reader, and serialize the body. */
function openFragment(html: string): OpenedFragment {
  const projected = projectExternalHtml(html);
  if (!projected.ok) throw new Error(`projection refused: ${projected.reason}`);
  const read = readOoxmlPackage(projected.fragmentBytes);
  if (!read.ok) throw new Error(`read-back refused: ${read.reason}`);
  const pkg = read.package;
  const part = pkg.parts.get('/word/document.xml');
  if (!part) throw new Error('fragment lost its document part');
  const relsBytes = pkg.partBytes.get('/word/_rels/document.xml.rels');
  return {
    pkg,
    docXml: serializeOoxmlPart(part),
    relsXml: relsBytes ? strFromU8(relsBytes) : '',
    lastMarkCovered: projected.lastMarkCovered,
  };
}

describe('run and paragraph mapping', () => {
  test('headings become bold direct formatting at Word sizes', () => {
    const { docXml, lastMarkCovered } = openFragment('<h1>Alpha</h1><h3>Beta</h3>');
    expect(docXml).toContain('w:sz w:val="64"');
    expect(docXml).toContain('w:sz w:val="44"');
    expect(docXml).toContain('<w:b/>');
    expect(docXml).toContain('Alpha');
    expect(docXml).toContain('Beta');
    expect(lastMarkCovered).toBe(false);
  });

  test('Word heading tags use target styles and include their paragraph mark', () => {
    const html =
      '<html xmlns:o="urn:schemas-microsoft-com:office:office"><body>' +
      '<h2>Target heading</h2></body></html>';
    const { docXml, lastMarkCovered } = openFragment(html);
    expect(docXml).toContain('<w:pStyle w:val="Heading2"/>');
    expect(docXml).not.toContain('w:sz w:val="52"');
    expect(docXml).not.toContain('<w:b/>');
    expect(lastMarkCovered).toBe(true);
  });

  test('Word caption classes use target styles and include their paragraph mark', () => {
    const { docXml, lastMarkCovered } = openFragment(
      '<p class="MsoCaption" style="text-align:center">Figure 1</p>'
    );
    expect(docXml).toContain('<w:pStyle w:val="Caption"/>');
    expect(docXml).toContain('<w:jc w:val="center"/>');
    expect(lastMarkCovered).toBe(true);
  });

  test('generic paragraphs keep the host paragraph mark', () => {
    const { lastMarkCovered } = openFragment('<p>ordinary</p>');
    expect(lastMarkCovered).toBe(false);
  });

  test('only the final projected block controls paragraph mark coverage', () => {
    const { lastMarkCovered } = openFragment(
      '<p class="MsoCaption">caption</p><p>ordinary tail</p>'
    );
    expect(lastMarkCovered).toBe(false);
  });

  test('inline tags and CSS map to run properties', () => {
    const { docXml } = openFragment(
      '<p><b>bold</b><i>italic</i><u>under</u><s>gone</s><sub>low</sub>' +
        '<span style="color:#ff0000;font-size:16px;font-family:\'Georgia\', serif">red</span>' +
        '<span style="background-color:rgb(255,255,0)">mark</span></p>'
    );
    expect(docXml).toContain('<w:b/>');
    expect(docXml).toContain('<w:i/>');
    expect(docXml).toContain('w:u w:val="single"');
    expect(docXml).toContain('<w:strike/>');
    expect(docXml).toContain('w:vertAlign w:val="subscript"');
    expect(docXml).toContain('w:color w:val="FF0000"');
    expect(docXml).toContain('w:sz w:val="24"'); // 16px = 12pt = 24 half-points
    expect(docXml).toContain('w:ascii="Georgia"');
    expect(docXml).toContain('w:fill="FFFF00"');
  });

  test('font-weight CSS overrides in both directions', () => {
    const { docXml } = openFragment(
      '<p><b style="font-weight:normal">off</b><span style="font-weight:700">on</span></p>'
    );
    const runs = docXml.split('<w:r>');
    const offRun = runs.find((run) => run.includes('>off<'));
    const onRun = runs.find((run) => run.includes('>on<'));
    expect(offRun).toBeDefined();
    expect(offRun!).not.toContain('<w:b/>');
    expect(onRun!).toContain('<w:b/>');
  });

  test('paragraph CSS maps to jc, spacing and ind', () => {
    const { docXml } = openFragment(
      '<p style="text-align:center;line-height:1.5">mid</p>' +
        '<p style="margin-left:48px;text-indent:-24px">hang</p>' +
        '<p style="text-align:justify;text-indent:24px">first</p>'
    );
    expect(docXml).toContain('w:jc w:val="center"');
    expect(docXml).toContain('w:line="360"'); // 240 * 1.5
    expect(docXml).toContain('w:lineRule="auto"');
    expect(docXml).toContain('w:left="720"'); // 48px = 36pt = 720 twips
    expect(docXml).toContain('w:hanging="360"');
    expect(docXml).toContain('w:jc w:val="both"');
    expect(docXml).toContain('w:firstLine="360"');
  });
});

describe('lists', () => {
  test('semantic ol/ul nesting projects numPr and a fresh numbering part', () => {
    const { pkg, docXml, relsXml } = openFragment(
      '<ol><li>one</li><li>two<ul><li>sub</li></ul></li></ol>'
    );
    expect(docXml).toContain('w:ilvl w:val="0"');
    expect(docXml).toContain('w:ilvl w:val="1"');
    expect(docXml).toContain('w:numId w:val="1001"');
    const numberingBytes = pkg.partBytes.get('/word/numbering.xml');
    expect(numberingBytes).toBeDefined();
    const numberingXml = strFromU8(numberingBytes!);
    expect(numberingXml).toContain('w:abstractNum');
    expect(numberingXml).toContain('<w:num w:numId="1001">');
    expect(numberingXml).toContain('w:numFmt w:val="decimal"');
    expect(numberingXml).toContain('w:lvlText w:val="%1."');
    expect(relsXml).toContain('relationships/numbering');
  });

  test('each distinct top-level list allocates its own numId', () => {
    const { docXml, pkg } = openFragment('<ol><li>a</li></ol><ul><li>b</li></ul>');
    expect(docXml).toContain('w:numId w:val="1001"');
    expect(docXml).toContain('w:numId w:val="1002"');
    const numberingXml = strFromU8(pkg.partBytes.get('/word/numbering.xml')!);
    expect(numberingXml).toContain('w:numFmt w:val="decimal"');
    expect(numberingXml).toContain('w:numFmt w:val="bullet"');
  });

  test('Word desktop mso-list markup maps to numbering; marker span never becomes text', () => {
    const html =
      '<p class="MsoListParagraph" style="text-indent:-18.0pt;mso-list:l3 level2 lfo5">' +
      '<span style="mso-list:Ignore">1.<span>&nbsp;&nbsp;</span></span>Item text</p>' +
      '<p class="MsoListParagraph" style="mso-list:l3 level1 lfo5">' +
      '<span style="mso-list:Ignore">2.</span>Second</p>';
    const { docXml, pkg } = openFragment(html);
    expect(docXml).toContain('w:ilvl w:val="1"');
    expect(docXml).toContain('w:ilvl w:val="0"');
    expect(docXml).toContain('w:numId w:val="1001"');
    expect(docXml).toContain('Item text');
    expect(docXml).toContain('Second');
    // The literal "1." marker is Word furniture, not content.
    expect(docXml).not.toContain('>1.<');
    expect(docXml).not.toContain('>2.<');
    // The marker text sniffs as ordered.
    const numberingXml = strFromU8(pkg.partBytes.get('/word/numbering.xml')!);
    expect(numberingXml).toContain('w:numFmt w:val="decimal"');
  });
});

describe('tables', () => {
  test('borders, colspan, shading and th styling project to table properties', () => {
    const { docXml } = openFragment(
      '<table border="1"><tr><th colspan="2" style="background-color:#ffff00">head</th></tr>' +
        '<tr><td>b</td><td style="vertical-align:middle">c</td></tr></table>'
    );
    expect(docXml).toContain('<w:tbl>');
    expect(docXml).toContain('w:tblBorders');
    expect(docXml).toContain('w:gridSpan w:val="2"');
    expect(docXml).toContain('w:fill="FFFF00"');
    expect(docXml).toContain('w:vAlign w:val="center"');
    // th → bold runs, centered paragraph.
    expect(docXml).toContain('<w:b/>');
    expect(docXml).toContain('w:jc w:val="center"');
    // Grid carries one w:gridCol per column.
    expect(docXml.split('<w:gridCol').length - 1).toBe(2);
  });

  test('rowspan becomes a vMerge restart plus continuation cells', () => {
    const { docXml } = openFragment(
      '<table><tr><td rowspan="2">tall</td><td>b</td></tr><tr><td>c</td></tr></table>'
    );
    expect(docXml).toContain('w:vMerge w:val="restart"');
    expect(docXml).toContain('<w:vMerge/>');
  });

  test('a table without visible borders emits no tblBorders', () => {
    const { docXml } = openFragment('<table><tr><td>x</td></tr></table>');
    expect(docXml).not.toContain('w:tblBorders');
  });
});

describe('hyperlinks', () => {
  test('a javascript: href drops the link wrapper but keeps its text', () => {
    const { docXml, relsXml } = openFragment('<p><a href="javascript:alert(1)">click</a></p>');
    expect(docXml).not.toContain('w:hyperlink');
    expect(docXml).toContain('click');
    expect(relsXml).not.toContain('javascript');
  });

  test('an https href becomes an External hyperlink relationship', () => {
    const { docXml, relsXml } = openFragment('<p><a href="https://x.example/">go</a></p>');
    expect(docXml).toContain('<w:hyperlink');
    expect(docXml).toContain('go');
    expect(relsXml).toContain('relationships/hyperlink');
    expect(relsXml).toContain('Target="https://x.example/"');
    expect(relsXml).toContain('TargetMode="External"');
  });
});

describe('images', () => {
  test('an external image source is dropped with no artifact and no fetch', () => {
    const { docXml, pkg, relsXml } = openFragment(
      '<p>before<img src="https://remote.example/x.png">after</p>'
    );
    expect(docXml).not.toContain('w:drawing');
    expect(docXml).toContain('before');
    expect(docXml).toContain('after');
    expect(pkg.partBytes.get('/word/media/image1.png')).toBeUndefined();
    expect(relsXml).not.toContain('remote.example');
  });

  test('a data: PNG becomes a media part with an inline drawing', () => {
    const { docXml, pkg, relsXml } = openFragment(
      `<p><img src="data:image/png;base64,${TINY_PNG_BASE64}" width="10" height="20"></p>`
    );
    expect(docXml).toContain('w:drawing');
    expect(docXml).toContain('r:embed=');
    // 10px × 9525, 20px × 9525.
    expect(docXml).toContain('cx="95250"');
    expect(docXml).toContain('cy="190500"');
    const media = pkg.partBytes.get('/word/media/image1.png');
    expect(media).toBeDefined();
    expect(media!.length).toBeGreaterThan(8);
    expect(relsXml).toContain('Target="media/image1.png"');
  });

  test('Word bare image dimensions use points', () => {
    const html =
      '<html xmlns:o="urn:schemas-microsoft-com:office:office"><body><p>' +
      `<img src="data:image/png;base64,${TINY_PNG_BASE64}" width="10" height="20">` +
      '</p></body></html>';
    const { docXml } = openFragment(html);
    // 10pt and 20pt expressed as CSS pixels, then converted to EMU.
    expect(docXml).toContain('cx="127000"');
    expect(docXml).toContain('cy="254000"');
  });

  test('an unsized PNG uses its physical density', () => {
    const png = pngWithPhysicalSize(144, 72, 5669);
    const { docXml } = openFragment(`<p><img src="data:image/png;base64,${png}"></p>`);
    // Integer pixels-per-metre metadata is approximately 144 dpi.
    expect(docXml).toContain('cx="914447"');
    expect(docXml).toContain('cy="457223"');
  });

  test('a data: image above the per-image cap is dropped', () => {
    const projected = projectExternalHtml(
      `<p>kept<img src="data:image/png;base64,${TINY_PNG_BASE64}"></p>`,
      { maxImageBytes: 8 }
    );
    expect(projected.ok).toBe(true);
    if (!projected.ok) return;
    const read = readOoxmlPackage(projected.fragmentBytes);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.package.partBytes.get('/word/media/image1.png')).toBeUndefined();
  });

  test('declared mime must match the magic bytes', () => {
    const { docXml, pkg } = openFragment(
      `<p>x<img src="data:image/jpeg;base64,${TINY_PNG_BASE64}"></p>`
    );
    expect(docXml).not.toContain('w:drawing');
    expect(pkg.partBytes.get('/word/media/image1.jpeg')).toBeUndefined();
  });
});

describe('caps and refusals', () => {
  test('html above maxHtmlBytes refuses before parse', () => {
    expect(projectExternalHtml('<p>hello</p>', { maxHtmlBytes: 4 })).toEqual({
      ok: false,
      reason: 'too-large',
    });
  });

  test('the node cap truncates instead of throwing', () => {
    const html = Array.from({ length: 50 }, (_, i) => `<p>block${i}</p>`).join('');
    const projected = projectExternalHtml(html, { maxNodes: 10 });
    expect(projected.ok).toBe(true);
    if (!projected.ok) return;
    const read = readOoxmlPackage(projected.fragmentBytes);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const docXml = strFromU8(read.package.partBytes.get('/word/document.xml')!);
    expect(docXml).toContain('block0');
    expect(docXml).not.toContain('block49');
  });

  test('empty and content-free payloads refuse as no-content', () => {
    expect(projectExternalHtml('')).toEqual({ ok: false, reason: 'no-content' });
    expect(projectExternalHtml('<script>evil()</script>')).toEqual({
      ok: false,
      reason: 'no-content',
    });
  });

  test('a missing DOMParser refuses as parse-unavailable', () => {
    const scope = globalThis as { DOMParser?: unknown };
    const original = scope.DOMParser;
    scope.DOMParser = undefined;
    try {
      expect(projectExternalHtml('<p>x</p>')).toEqual({
        ok: false,
        reason: 'parse-unavailable',
      });
    } finally {
      scope.DOMParser = original;
    }
  });
});

describe('hostile payloads stay inert', () => {
  test('script, style and event handlers leave no artifacts', () => {
    const { docXml } = openFragment(
      '<script>window.evil = true;</script><style>p { color: red; }</style>' +
        '<p onclick="steal()" onmouseover="steal()">safe</p>' +
        '<iframe src="https://evil.example/"></iframe><template><p>hidden</p></template>'
    );
    expect(docXml).toContain('safe');
    expect(docXml).not.toContain('evil');
    expect(docXml).not.toContain('steal');
    expect(docXml).not.toContain('onclick');
    expect(docXml).not.toContain('color: red');
  });
});

describe('whitespace and breaks', () => {
  test('whitespace runs collapse to single spaces outside pre', () => {
    const { docXml } = openFragment('<p>alpha\n   beta\t\tgamma</p>');
    expect(docXml).toContain('alpha beta gamma');
  });

  test('br becomes w:br', () => {
    const { docXml } = openFragment('<p>one<br>two</p>');
    expect(docXml).toContain('<w:br/>');
  });

  test('pre preserves whitespace, converts newlines to w:br and uses Courier New', () => {
    const { docXml } = openFragment('<pre>line1\n  line2</pre>');
    expect(docXml).toContain('<w:br/>');
    expect(docXml).toContain('  line2');
    expect(docXml).toContain('w:ascii="Courier New"');
  });

  test('whitespace-only text between blocks does not become a paragraph', () => {
    const { docXml } = openFragment('<p>a</p>\n   \n<p>b</p>');
    expect(docXml.split('<w:p>').length - 1).toBe(2);
  });
});
